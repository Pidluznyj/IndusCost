/**
 * SYNC-05 — Persistência de lifecycle de Contas a Receber + lock.
 * Nunca delete físico; ausência só altera campos de presença.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isNomusAccountsReceivableAbsenceReconciliationEnabled } from "./nomusSourceReconciliationFlags.js";
import type { NomusSourceLifecyclePatch } from "./nomusSourceReconciliationEngine.js";
import type { AccountsReceivableLifecycleLocalSnapshot } from "./nomusAccountsReceivableSourceReconciliation.js";
import {
  buildNomusUrl,
  fetchNomusJson,
  type FetchNomusJsonOptions,
} from "../nomusRestClient.js";
import {
  buildAccountsReceivablePageParams,
  hasNextAccountsReceivablePage,
  pickAccountsReceivableArray,
  resolveAccountsReceivablePageSize,
} from "../nomusAccountsReceivableSyncLogic.js";
import { toInt } from "../nomusAccountsReceivableParser.js";

export const NOMUS_AR_RECONCILE_LOCK_ENV =
  "NOMUS_ACCOUNTS_RECEIVABLE_RECONCILE_LOCK_FILE";
export const NOMUS_AR_RECONCILE_LOCK_DEFAULT =
  "/tmp/induscost-nomus-accounts-receivable-reconcile.lock";

type LockPayload = {
  version: 1;
  token: string;
  pid: number;
  mode: "preview" | "apply";
  startedAt: string;
  hostname: string | null;
};

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    return false;
  }
}

export function resolveAccountsReceivableReconcileLockFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env[NOMUS_AR_RECONCILE_LOCK_ENV] ?? "").trim();
  return raw || NOMUS_AR_RECONCILE_LOCK_DEFAULT;
}

export function acquireAccountsReceivableReconcileLock(input: {
  mode: "preview" | "apply";
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
}):
  | { ok: true; lockFile: string; token: string; release: () => void }
  | { ok: false; code: "LOCK_HELD"; message: string; lockFile: string } {
  const lockFile =
    input.lockFile ?? resolveAccountsReceivableReconcileLockFile(input.env);
  mkdirSync(dirname(lockFile), { recursive: true });

  if (existsSync(lockFile)) {
    try {
      const raw = readFileSync(lockFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockPayload>;
      if (
        parsed.version === 1 &&
        typeof parsed.pid === "number" &&
        isPidAlive(parsed.pid)
      ) {
        return {
          ok: false,
          code: "LOCK_HELD",
          message: `Reconciliação de Contas a Receber já em andamento (pid=${parsed.pid}).`,
          lockFile,
        };
      }
      unlinkSync(lockFile);
    } catch {
      try {
        unlinkSync(lockFile);
      } catch {
        /* ignore */
      }
    }
  }

  const token = randomUUID();
  const payload: LockPayload = {
    version: 1,
    token,
    pid: process.pid,
    mode: input.mode,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
  };
  writeFileSync(lockFile, JSON.stringify(payload), "utf8");

  const release = () => {
    try {
      if (!existsSync(lockFile)) return;
      const raw = readFileSync(lockFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockPayload>;
      if (parsed.token === token) unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
  };

  return { ok: true, lockFile, token, release };
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadAccountsReceivableLifecycleLocals(input: {
  prisma: PrismaClient;
  dueDateFrom?: Date | null;
  dueDateTo?: Date | null;
  externalIds?: number[];
}): Promise<AccountsReceivableLifecycleLocalSnapshot[]> {
  const where: Prisma.NomusAccountsReceivableWhereInput = {};
  if (input.externalIds?.length) {
    where.externalId = { in: input.externalIds };
  }
  if (input.dueDateFrom || input.dueDateTo) {
    where.dueDate = {};
    if (input.dueDateFrom) where.dueDate.gte = input.dueDateFrom;
    if (input.dueDateTo) where.dueDate.lte = input.dueDateTo;
  }

  const rows = await input.prisma.nomusAccountsReceivable.findMany({
    where,
    select: {
      id: true,
      externalId: true,
      payloadHash: true,
      sourcePresenceStatus: true,
      presentInLastPayload: true,
      missingConsecutiveRuns: true,
      missingSince: true,
      sourceRemovedAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
      lastSyncRunId: true,
      dueDate: true,
      balanceReceivable: true,
      amountReceived: true,
      settlementDate: true,
      status: true,
      description: true,
    },
    orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
  });

  return rows.map((r) => ({
    localId: r.id,
    externalId: r.externalId,
    payloadHash: r.payloadHash,
    sourcePresenceStatus: r.sourcePresenceStatus,
    presentInLastPayload: r.presentInLastPayload,
    missingConsecutiveRuns: r.missingConsecutiveRuns,
    missingSince: r.missingSince,
    sourceRemovedAt: r.sourceRemovedAt,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    lastSyncRunId: r.lastSyncRunId,
    dueDateIso: r.dueDate?.toISOString().slice(0, 10) ?? null,
    balanceReceivable: decimalToNumber(r.balanceReceivable),
    amountReceived: decimalToNumber(r.amountReceived),
    settlementDate: r.settlementDate,
    status: r.status,
    description: r.description,
  }));
}

export async function createAccountsReceivableSourceSyncRun(input: {
  prisma: PrismaClient;
  strategy: string;
  scope: Record<string, unknown>;
  startedAt: Date;
  coveredFrom?: Date | null;
  coveredTo?: Date | null;
}): Promise<{ id: string }> {
  const run = await input.prisma.nomusSourceSyncRun.create({
    data: {
      entityType: "ACCOUNTS_RECEIVABLE",
      strategy: input.strategy,
      scope: input.scope as Prisma.InputJsonValue,
      startedAt: input.startedAt,
      status: "RUNNING",
      payloadComplete: false,
      coveredFrom: input.coveredFrom ?? null,
      coveredTo: input.coveredTo ?? null,
    },
    select: { id: true },
  });
  return run;
}

export async function finishAccountsReceivableSourceSyncRun(input: {
  prisma: PrismaClient;
  runId: string;
  status: "SUCCESS" | "FAILED" | "INCONCLUSIVE";
  payloadComplete: boolean;
  finishedAt: Date;
  counters: {
    pagesRead?: number;
    rowsRead?: number;
    createdCount?: number;
    updatedCount?: number;
    unchangedCount?: number;
    missingCandidateCount?: number;
    missingConfirmedCount?: number;
    reactivatedCount?: number;
    http429Count?: number;
    errors?: number;
  };
  summaryJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
}): Promise<void> {
  await input.prisma.nomusSourceSyncRun.update({
    where: { id: input.runId },
    data: {
      status: input.status,
      payloadComplete: input.payloadComplete,
      finishedAt: input.finishedAt,
      pagesRead: input.counters.pagesRead ?? 0,
      rowsRead: input.counters.rowsRead ?? 0,
      createdCount: input.counters.createdCount ?? 0,
      updatedCount: input.counters.updatedCount ?? 0,
      unchangedCount: input.counters.unchangedCount ?? 0,
      missingCandidateCount: input.counters.missingCandidateCount ?? 0,
      missingConfirmedCount: input.counters.missingConfirmedCount ?? 0,
      reactivatedCount: input.counters.reactivatedCount ?? 0,
      http429Count: input.counters.http429Count ?? 0,
      errors: input.counters.errors ?? 0,
      summaryJson: (input.summaryJson ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      errorMessage: input.errorMessage ?? null,
    },
  });
}

function patchToPrismaData(
  patch: NomusSourceLifecyclePatch
): Prisma.NomusAccountsReceivableUpdateInput {
  const data: Prisma.NomusAccountsReceivableUpdateInput = {
    sourcePresenceStatus: patch.sourcePresenceStatus,
    presentInLastPayload: patch.presentInLastPayload,
    missingConsecutiveRuns: patch.missingConsecutiveRuns,
    missingSince:
      patch.missingSince == null
        ? null
        : patch.missingSince instanceof Date
          ? patch.missingSince
          : new Date(patch.missingSince),
    sourceRemovedAt:
      patch.sourceRemovedAt == null
        ? null
        : patch.sourceRemovedAt instanceof Date
          ? patch.sourceRemovedAt
          : new Date(patch.sourceRemovedAt),
  };
  if (patch.lastSeenAt != null) {
    data.lastSeenAt =
      patch.lastSeenAt instanceof Date
        ? patch.lastSeenAt
        : new Date(patch.lastSeenAt);
  }
  if (patch.lastSyncRunId) {
    data.lastSourceSyncRun = { connect: { id: patch.lastSyncRunId } };
  }
  if (patch.payloadHash !== undefined) {
    data.payloadHash = patch.payloadHash;
  }
  if (patch.firstSeenAt != null) {
    data.firstSeenAt =
      patch.firstSeenAt instanceof Date
        ? patch.firstSeenAt
        : new Date(patch.firstSeenAt);
  }
  return data;
}

/** Aplica somente patches de lifecycle em lote transacional. */
export async function applyAccountsReceivableLifecyclePatches(input: {
  prisma: PrismaClient;
  patches: Array<{ localId: string; patch: NomusSourceLifecyclePatch }>;
  batchSize?: number;
}): Promise<{ applied: number }> {
  if (input.patches.length === 0) return { applied: 0 };
  const batchSize = Math.max(1, input.batchSize ?? 50);
  let applied = 0;

  for (let i = 0; i < input.patches.length; i += batchSize) {
    const batch = input.patches.slice(i, i + batchSize);
    await input.prisma.$transaction(async (tx) => {
      for (const row of batch) {
        await tx.nomusAccountsReceivable.update({
          where: { id: row.localId },
          data: patchToPrismaData(row.patch),
        });
        applied += 1;
      }
    });
  }
  return { applied };
}

export function isAccountsReceivableAbsenceReconcileEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isNomusAccountsReceivableAbsenceReconciliationEnabled(env);
}

export type DirectedArLookupResult =
  | { status: "found"; externalId: number }
  | { status: "not_found" }
  | { status: "inconclusive"; reason: string };

/**
 * Consulta direcionada por externalId via scan da lista oficial
 * (não há GET /contasReceber/{id} no IndusCost).
 */
export async function lookupNomusAccountsReceivableByExternalId(args: {
  baseUrl: string;
  externalId: number;
  maxPages?: number;
  fetchJson?: typeof fetchNomusJson;
  env?: NodeJS.ProcessEnv;
}): Promise<DirectedArLookupResult> {
  const env = args.env ?? process.env;
  const fetchJson = args.fetchJson ?? fetchNomusJson;
  const pageSize = resolveAccountsReceivablePageSize(env);
  const maxPages = Math.max(
    1,
    args.maxPages ??
      (Number.parseInt(env.NOMUS_AR_DIRECTED_MAX_PAGES ?? "50", 10) || 50)
  );
  const fetchOpts: FetchNomusJsonOptions = {
    logPrefix: "[nomus-ar-directed-lookup]",
  };

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = buildNomusUrl(
        args.baseUrl,
        "contasReceber",
        buildAccountsReceivablePageParams(page, pageSize, env)
      );
      const payload = await fetchJson(url, fetchOpts);
      const items = pickAccountsReceivableArray(payload).filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item)
      );
      for (const item of items) {
        const id = toInt(item.id);
        if (id === args.externalId) {
          return { status: "found", externalId: id };
        }
      }
      if (!hasNextAccountsReceivablePage(payload, page, items.length, pageSize)) {
        return { status: "not_found" };
      }
      if (page >= maxPages) {
        return {
          status: "inconclusive",
          reason: "max_pages_without_match",
        };
      }
    }
    return { status: "inconclusive", reason: "max_pages_without_match" };
  } catch (error) {
    return {
      status: "inconclusive",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
