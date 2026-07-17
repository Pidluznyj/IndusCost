/**
 * OP-58 — Status administrativo read-only do motor do Fluxo de Pedidos.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  parseSalesOrderFlowRebuildCheckpoint,
  parseSalesOrderFlowRebuildLockPayload,
  SALES_ORDER_FLOW_REBUILD_CHECKPOINT_ENV,
  SALES_ORDER_FLOW_REBUILD_DEFAULT_CHECKPOINT_FILE,
  SALES_ORDER_FLOW_REBUILD_DEFAULT_LOCK_FILE,
  SALES_ORDER_FLOW_REBUILD_LOCK_ENV,
} from "./salesOrderFlowRebuild.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowFingerprint.js";
import {
  isSalesOrderFlowEnabled,
  SALES_ORDER_FLOW_FEATURE_RESOURCE,
} from "./salesOrderFlowFeatureFlags.js";

export type SalesOrderFlowStatusDb = Pick<
  PrismaClient,
  | "salesOrderFlowSnapshot"
  | "salesOrderItemFlowSnapshot"
  | "salesOrderFlowEvent"
  | "integrationRun"
>;

export type SalesOrderFlowEngineStatus = {
  feature: {
    resource: typeof SALES_ORDER_FLOW_FEATURE_RESOURCE;
    enabled: boolean;
    defaultWhenAbsent: false;
  };
  computation: {
    expectedVersion: string;
    latestRecomputedAt: string | null;
    storedVersions: Array<{ version: string; count: number }>;
    versionMismatchCount: number;
  };
  snapshots: {
    orders: number;
    items: number;
    events: number;
    ordersWithInconsistencies: number;
    inconsistentItems: number;
  };
  latestKnownFailure: {
    target: string;
    status: string;
    finishedAt: string | null;
    errorMessage: string | null;
    failedOrders: number;
  } | null;
  rebuild: {
    available: boolean;
    active: boolean;
    mode: string | null;
    startedAt: string | null;
    checkpoint: {
      lastOrderCode: string | null;
      batchesCompleted: number;
      ordersProcessed: number;
      updatedAt: string;
    } | null;
  };
  generatedAt: string;
};

export type SalesOrderFlowStatusOptions = {
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  now?: () => Date;
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
  isPidAlive?: (pid: number) => boolean;
};

function dateIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOptional(
  path: string,
  exists: (path: string) => boolean,
  readText: (path: string) => string
): string | null {
  try {
    return exists(path) ? readText(path) : null;
  } catch {
    return null;
  }
}

function failedOrdersFromSummary(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const summary = (value as { summary?: unknown }).summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return 0;
  const failures = (summary as { failures?: unknown }).failures;
  return Array.isArray(failures) ? failures.length : 0;
}

export async function buildSalesOrderFlowEngineStatus(
  db: SalesOrderFlowStatusDb,
  options: SalesOrderFlowStatusOptions = {}
): Promise<SalesOrderFlowEngineStatus> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const exists = options.exists ?? existsSync;
  const readText = options.readText ?? ((path) => readFileSync(path, "utf8"));
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const root = options.projectRoot ?? process.cwd();

  const [
    orderCount,
    itemCount,
    eventCount,
    latestAggregate,
    storedVersionRows,
    mismatchCount,
    ordersWithInconsistencies,
    inconsistencyAggregate,
    latestFailure,
  ] = await Promise.all([
    db.salesOrderFlowSnapshot.count(),
    db.salesOrderItemFlowSnapshot.count(),
    db.salesOrderFlowEvent.count(),
    db.salesOrderFlowSnapshot.aggregate({ _max: { computedAt: true } }),
    db.salesOrderFlowSnapshot.groupBy({
      by: ["computationVersion"],
      _count: { _all: true },
      orderBy: { computationVersion: "asc" },
    }),
    db.salesOrderFlowSnapshot.count({
      where: {
        computationVersion: { not: SALES_ORDER_FLOW_COMPUTATION_VERSION },
      },
    }),
    db.salesOrderFlowSnapshot.count({
      where: { inconsistentItems: { gt: 0 } },
    }),
    db.salesOrderFlowSnapshot.aggregate({
      _sum: { inconsistentItems: true },
    }),
    db.integrationRun.findFirst({
      where: {
        sourceSystem: "INDUSCOST",
        target: { startsWith: "sales-order-flow-recompute:" },
        status: { in: ["FAILED", "PARTIAL"] },
      },
      select: {
        target: true,
        status: true,
        finishedAt: true,
        createdAt: true,
        errorMessage: true,
        summaryJson: true,
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const checkpointPath = resolve(
    root,
    env[SALES_ORDER_FLOW_REBUILD_CHECKPOINT_ENV]?.trim() ||
      SALES_ORDER_FLOW_REBUILD_DEFAULT_CHECKPOINT_FILE
  );
  const lockPath = resolve(
    root,
    env[SALES_ORDER_FLOW_REBUILD_LOCK_ENV]?.trim() ||
      SALES_ORDER_FLOW_REBUILD_DEFAULT_LOCK_FILE
  );
  const checkpointRaw = readOptional(checkpointPath, exists, readText);
  const lockRaw = readOptional(lockPath, exists, readText);
  const checkpoint = parseSalesOrderFlowRebuildCheckpoint(checkpointRaw);
  const lock = parseSalesOrderFlowRebuildLockPayload(lockRaw);

  return {
    feature: {
      resource: SALES_ORDER_FLOW_FEATURE_RESOURCE,
      enabled: isSalesOrderFlowEnabled(env),
      defaultWhenAbsent: false,
    },
    computation: {
      expectedVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      latestRecomputedAt: dateIso(latestAggregate._max.computedAt),
      storedVersions: storedVersionRows.map((row) => ({
        version: row.computationVersion,
        count: row._count._all,
      })),
      versionMismatchCount: mismatchCount,
    },
    snapshots: {
      orders: orderCount,
      items: itemCount,
      events: eventCount,
      ordersWithInconsistencies,
      inconsistentItems: inconsistencyAggregate._sum.inconsistentItems ?? 0,
    },
    latestKnownFailure: latestFailure
      ? {
          target: latestFailure.target,
          status: latestFailure.status,
          finishedAt: dateIso(
            latestFailure.finishedAt ?? latestFailure.createdAt
          ),
          errorMessage: latestFailure.errorMessage,
          failedOrders: failedOrdersFromSummary(latestFailure.summaryJson),
        }
      : null,
    rebuild: {
      available: checkpointRaw != null || lockRaw != null,
      active: lock != null && isPidAlive(lock.pid),
      mode: lock?.mode ?? null,
      startedAt: lock?.startedAt ?? null,
      checkpoint: checkpoint
        ? {
            lastOrderCode: checkpoint.lastOrderCode,
            batchesCompleted: checkpoint.batchesCompleted,
            ordersProcessed: checkpoint.ordersProcessed,
            updatedAt: checkpoint.updatedAt,
          }
        : null,
    },
    generatedAt: now().toISOString(),
  };
}
