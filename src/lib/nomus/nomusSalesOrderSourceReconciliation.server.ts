/**
 * SYNC-04 — Persistência de lifecycle de Pedidos + lock de reconciliação.
 * Não remove pedidos das telas; só grava campos oficiais de presença.
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
import { NOMUS_SALES_ORDER_SOURCE, canonicalNomusOrderCodeKey } from "../salesOrderNomusSync.server.js";
import { isNomusSalesOrderAbsenceReconciliationEnabled } from "./nomusSourceReconciliationFlags.js";
import type { NomusSourceLifecyclePatch } from "./nomusSourceReconciliationEngine.js";
import type {
  SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";

export const NOMUS_SALES_ORDER_RECONCILE_LOCK_ENV =
  "NOMUS_SALES_ORDERS_RECONCILE_LOCK_FILE";
export const NOMUS_SALES_ORDER_RECONCILE_LOCK_DEFAULT =
  "/tmp/induscost-nomus-sales-orders-reconcile.lock";

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

export function resolveSalesOrderReconcileLockFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env[NOMUS_SALES_ORDER_RECONCILE_LOCK_ENV] ?? "").trim();
  return raw || NOMUS_SALES_ORDER_RECONCILE_LOCK_DEFAULT;
}

export function acquireSalesOrderReconcileLock(input: {
  mode: "preview" | "apply";
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
}):
  | { ok: true; lockFile: string; token: string; release: () => void }
  | { ok: false; code: "LOCK_HELD"; message: string; lockFile: string } {
  const lockFile =
    input.lockFile ?? resolveSalesOrderReconcileLockFile(input.env);
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
          message: `Reconciliação de Pedidos já em andamento (pid=${parsed.pid}).`,
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

export async function loadSalesOrderLifecycleLocals(input: {
  prisma: PrismaClient;
  issueDateFrom: Date;
  issueDateTo: Date;
  orderCode?: string | null;
  externalSalesOrderIds?: number[];
  /** TARGETED_LOOKUP: não restringe por janela de emissão (datas só apoiam busca Nomus). */
  ignoreIssueDateWindow?: boolean;
}): Promise<SalesOrderLifecycleLocalSnapshot[]> {
  const where: Prisma.SalesOrderWhereInput = {
    sourceSystem: NOMUS_SALES_ORDER_SOURCE,
    externalSalesOrderId: { not: null },
  };
  if (!input.ignoreIssueDateWindow) {
    where.issueDate = { gte: input.issueDateFrom, lte: input.issueDateTo };
  }
  if (input.externalSalesOrderIds?.length) {
    where.externalSalesOrderId = { in: input.externalSalesOrderIds };
  }

  const rows = await input.prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      externalSalesOrderId: true,
      orderCode: true,
      externalSalesOrderCode: true,
      payloadHash: true,
      sourcePresenceStatus: true,
      presentInLastPayload: true,
      missingConsecutiveRuns: true,
      missingSince: true,
      sourceRemovedAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
      lastSyncRunId: true,
      issueDate: true,
    },
    orderBy: [{ issueDate: "asc" }, { orderCode: "asc" }],
  });

  const orderCodeKey = input.orderCode?.trim()
    ? canonicalNomusOrderCodeKey(input.orderCode)
    : null;

  return rows
    .filter((r) => r.externalSalesOrderId != null)
    .filter((r) => {
      if (!orderCodeKey) return true;
      const key =
        canonicalNomusOrderCodeKey(r.orderCode) ??
        canonicalNomusOrderCodeKey(r.externalSalesOrderCode);
      return key === orderCodeKey;
    })
    .map((r) => ({
      localId: r.id,
      externalSalesOrderId: r.externalSalesOrderId as number,
      orderCode: r.orderCode,
      payloadHash: r.payloadHash,
      sourcePresenceStatus: r.sourcePresenceStatus,
      presentInLastPayload: r.presentInLastPayload,
      missingConsecutiveRuns: r.missingConsecutiveRuns,
      missingSince: r.missingSince,
      sourceRemovedAt: r.sourceRemovedAt,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      lastSyncRunId: r.lastSyncRunId,
      issueDateIso: r.issueDate.toISOString().slice(0, 10),
    }));
}

export async function createSalesOrderSourceSyncRun(input: {
  prisma: PrismaClient;
  strategy: string;
  scope: Record<string, unknown>;
  startedAt: Date;
  coveredFrom?: Date | null;
  coveredTo?: Date | null;
}): Promise<{ id: string }> {
  const run = await input.prisma.nomusSourceSyncRun.create({
    data: {
      entityType: "SALES_ORDER",
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

export async function finishSalesOrderSourceSyncRun(input: {
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
): Prisma.SalesOrderUpdateInput {
  const data: Prisma.SalesOrderUpdateInput = {
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

/**
 * Aplica somente patches de lifecycle (ausência / confirmação).
 * Transacional por lote; nunca delete físico.
 */
export async function applySalesOrderLifecyclePatches(input: {
  prisma: PrismaClient;
  patches: Array<{ localId: string; patch: NomusSourceLifecyclePatch }>;
}): Promise<{ applied: number }> {
  if (input.patches.length === 0) return { applied: 0 };

  let applied = 0;
  await input.prisma.$transaction(async (tx) => {
    for (const row of input.patches) {
      await tx.salesOrder.update({
        where: { id: row.localId },
        data: patchToPrismaData(row.patch),
      });
      applied += 1;
    }
  });
  return { applied };
}

export function isSalesOrderAbsenceReconcileEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isNomusSalesOrderAbsenceReconciliationEnabled(env);
}
