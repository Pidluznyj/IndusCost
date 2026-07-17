/**
 * SYNC-08 — Runner de backfill técnico de lifecycle (Prisma + lock).
 * Preview não escreve. Apply só campos de lifecycle. Sem delete físico.
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
import { NOMUS_SALES_ORDER_SOURCE } from "../salesOrderNomusSync.server.js";
import {
  chunkLifecycleBackfillItems,
  parseLifecycleBackfillResumeCursor,
  parseNomusLifecycleBackfillCli,
  planNomusLifecycleBackfill,
  serializeLifecycleBackfillResumeCursor,
  type NomusLifecycleBackfillCliOptions,
  type NomusLifecycleBackfillItem,
  type NomusLifecycleBackfillLocalRow,
} from "./nomusLifecycleBackfill.js";

export const NOMUS_LIFECYCLE_BACKFILL_LOCK_ENV =
  "NOMUS_LIFECYCLE_BACKFILL_LOCK_FILE";
export const NOMUS_LIFECYCLE_BACKFILL_LOCK_DEFAULT =
  "/tmp/induscost-nomus-lifecycle-backfill.lock";

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

export function acquireLifecycleBackfillLock(input: {
  mode: "preview" | "apply";
  env?: NodeJS.ProcessEnv;
}):
  | { ok: true; lockFile: string; token: string; release: () => void }
  | { ok: false; code: "LOCK_HELD"; message: string; lockFile: string } {
  const env = input.env ?? process.env;
  const raw = (env[NOMUS_LIFECYCLE_BACKFILL_LOCK_ENV] ?? "").trim();
  const lockFile = raw || NOMUS_LIFECYCLE_BACKFILL_LOCK_DEFAULT;
  mkdirSync(dirname(lockFile), { recursive: true });

  if (existsSync(lockFile)) {
    try {
      const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as Partial<LockPayload>;
      if (parsed.version === 1 && typeof parsed.pid === "number" && isPidAlive(parsed.pid)) {
        return {
          ok: false,
          code: "LOCK_HELD",
          message: `Backfill de lifecycle já em andamento (pid=${parsed.pid}).`,
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
  writeFileSync(
    lockFile,
    JSON.stringify({
      version: 1,
      token,
      pid: process.pid,
      mode: input.mode,
      startedAt: new Date().toISOString(),
      hostname: hostname(),
    } satisfies LockPayload),
    "utf8"
  );

  return {
    ok: true,
    lockFile,
    token,
    release: () => {
      try {
        if (!existsSync(lockFile)) return;
        const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as Partial<LockPayload>;
        if (parsed.token === token) unlinkSync(lockFile);
      } catch {
        /* ignore */
      }
    },
  };
}

function parseIsoDay(value: string | null): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadBackfillRows(
  prisma: PrismaClient,
  options: NomusLifecycleBackfillCliOptions
): Promise<NomusLifecycleBackfillLocalRow[]> {
  const rows: NomusLifecycleBackfillLocalRow[] = [];
  const from = parseIsoDay(options.from);
  const to = parseIsoDay(options.to);
  const entities =
    options.entity === "all"
      ? (["sales-orders", "accounts-receivable", "accounts-payable"] as const)
      : ([options.entity] as const);

  for (const entity of entities) {
    if (entity === "sales-orders") {
      const where: Prisma.SalesOrderWhereInput = {
        sourceSystem: NOMUS_SALES_ORDER_SOURCE,
      };
      if (options.externalId != null) {
        where.externalSalesOrderId = options.externalId;
      }
      if (options.orderCode?.trim()) {
        where.OR = [
          { orderCode: options.orderCode.trim() },
          { externalSalesOrderCode: options.orderCode.trim() },
        ];
      }
      if (from || to) {
        where.issueDate = {};
        if (from) where.issueDate.gte = from;
        if (to) where.issueDate.lte = to;
      }
      const found = await prisma.salesOrder.findMany({
        where,
        select: {
          id: true,
          externalSalesOrderId: true,
          orderCode: true,
          sourcePresenceStatus: true,
          presentInLastPayload: true,
          firstSeenAt: true,
          lastSeenAt: true,
          missingConsecutiveRuns: true,
          missingSince: true,
          sourceRemovedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { id: "asc" },
      });
      for (const r of found) {
        rows.push({
          id: r.id,
          entityType: "SALES_ORDER",
          externalKey: String(r.externalSalesOrderId ?? r.orderCode),
          sourcePresenceStatus: r.sourcePresenceStatus,
          presentInLastPayload: r.presentInLastPayload,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
          missingConsecutiveRuns: r.missingConsecutiveRuns,
          missingSince: r.missingSince,
          sourceRemovedAt: r.sourceRemovedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        });
      }
    }

    if (entity === "accounts-receivable") {
      const where: Prisma.NomusAccountsReceivableWhereInput = {};
      if (options.externalId != null) where.externalId = options.externalId;
      if (from || to) {
        where.dueDate = {};
        if (from) where.dueDate.gte = from;
        if (to) where.dueDate.lte = to;
      }
      const found = await prisma.nomusAccountsReceivable.findMany({
        where,
        select: {
          id: true,
          externalId: true,
          sourcePresenceStatus: true,
          presentInLastPayload: true,
          firstSeenAt: true,
          lastSeenAt: true,
          missingConsecutiveRuns: true,
          missingSince: true,
          sourceRemovedAt: true,
          createdAt: true,
          updatedAt: true,
          syncedAt: true,
        },
        orderBy: { id: "asc" },
      });
      for (const r of found) {
        rows.push({
          id: r.id,
          entityType: "ACCOUNTS_RECEIVABLE",
          externalKey: String(r.externalId),
          sourcePresenceStatus: r.sourcePresenceStatus,
          presentInLastPayload: r.presentInLastPayload,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
          missingConsecutiveRuns: r.missingConsecutiveRuns,
          missingSince: r.missingSince,
          sourceRemovedAt: r.sourceRemovedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          syncedAt: r.syncedAt,
        });
      }
    }

    if (entity === "accounts-payable") {
      const where: Prisma.NomusAccountsPayableWhereInput = {};
      if (options.externalId != null) where.externalId = options.externalId;
      if (from || to) {
        where.dueDate = {};
        if (from) where.dueDate.gte = from;
        if (to) where.dueDate.lte = to;
      }
      const found = await prisma.nomusAccountsPayable.findMany({
        where,
        select: {
          id: true,
          externalId: true,
          sourcePresenceStatus: true,
          presentInLastPayload: true,
          firstSeenAt: true,
          lastSeenAt: true,
          missingConsecutiveRuns: true,
          missingSince: true,
          sourceRemovedAt: true,
          createdAt: true,
          updatedAt: true,
          syncedAt: true,
        },
        orderBy: { id: "asc" },
      });
      for (const r of found) {
        rows.push({
          id: r.id,
          entityType: "ACCOUNTS_PAYABLE",
          externalKey: String(r.externalId),
          sourcePresenceStatus: r.sourcePresenceStatus,
          presentInLastPayload: r.presentInLastPayload,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
          missingConsecutiveRuns: r.missingConsecutiveRuns,
          missingSince: r.missingSince,
          sourceRemovedAt: r.sourceRemovedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          syncedAt: r.syncedAt,
        });
      }
    }
  }

  return rows;
}

async function applyBackfillBatch(
  prisma: PrismaClient,
  items: NomusLifecycleBackfillItem[]
): Promise<number> {
  let applied = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      if (!item.after) continue;
      const data = {
        sourcePresenceStatus: item.after.sourcePresenceStatus,
        presentInLastPayload: item.after.presentInLastPayload,
        firstSeenAt: item.after.firstSeenAt,
        lastSeenAt: item.after.lastSeenAt,
        missingConsecutiveRuns: item.after.missingConsecutiveRuns,
        missingSince: item.after.missingSince,
        sourceRemovedAt: item.after.sourceRemovedAt,
      };
      if (item.entityType === "SALES_ORDER") {
        await tx.salesOrder.update({ where: { id: item.localId }, data });
      } else if (item.entityType === "ACCOUNTS_RECEIVABLE") {
        await tx.nomusAccountsReceivable.update({
          where: { id: item.localId },
          data,
        });
      } else {
        await tx.nomusAccountsPayable.update({
          where: { id: item.localId },
          data,
        });
      }
      applied += 1;
    }
  });
  return applied;
}

export async function runNomusLifecycleBackfill(input: {
  prisma: PrismaClient;
  argv: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>> {
  const options = parseNomusLifecycleBackfillCli(input.argv);
  const lock = acquireLifecycleBackfillLock({
    mode: options.mode,
    env: input.env,
  });
  if (!lock.ok) {
    return {
      ok: false,
      lockBlocked: true,
      code: lock.code,
      message: lock.message,
      mode: options.mode,
      writes: false,
      absencesDeclared: 0,
    };
  }

  try {
    const rows = await loadBackfillRows(input.prisma, options);
    const plan = planNomusLifecycleBackfill(rows, {
      forcePresent: options.forcePresent,
    });
    const resume = parseLifecycleBackfillResumeCursor(options.resumeCursor);
    const offset = resume?.nextOffset ?? 0;
    const pending = plan.toWrite.slice(offset);

    if (options.mode === "preview") {
      return {
        ok: true,
        mode: "preview",
        writes: false,
        absencesDeclared: 0,
        physicalDeletes: 0,
        counters: plan.counters,
        resumeOffset: offset,
        sample: options.explain
          ? plan.items.slice(0, 50)
          : plan.toWrite.slice(0, 20).map((i) => ({
              localId: i.localId,
              externalKey: i.externalKey,
              action: i.action,
              reasons: i.reasons,
            })),
      };
    }

    const batches = chunkLifecycleBackfillItems(pending, options.batchSize);
    let applied = 0;
    let batchIndex = 0;
    for (const batch of batches) {
      applied += await applyBackfillBatch(input.prisma, batch);
      batchIndex += 1;
      const nextOffset = offset + applied;
      // cursor materializado para retomada
      void serializeLifecycleBackfillResumeCursor({
        version: 1,
        entity: options.entity,
        nextOffset,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      ok: true,
      mode: "apply",
      writes: "lifecycle_only",
      absencesDeclared: 0,
      physicalDeletes: 0,
      applied,
      batches: batchIndex,
      counters: plan.counters,
      resumeCursor: serializeLifecycleBackfillResumeCursor({
        version: 1,
        entity: options.entity,
        nextOffset: offset + applied,
        updatedAt: new Date().toISOString(),
      }),
    };
  } finally {
    lock.release();
  }
}
