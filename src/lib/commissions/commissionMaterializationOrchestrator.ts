/**
 * Orquestração da materialização de comissão (snapshot + schedule por CR).
 * Lógica pura — persistência e descoberta em commissionMaterializationOrchestrator.server.ts.
 */
import type { CommissionOrderMaterializationAction } from "./commissionOrderMaterializer.js";
import type { CommissionReceivableScheduleRebuildResult } from "./commissionReceivableScheduler.js";

/** Orquestrador grava apenas snapshot/schedule — nunca muta fechamento CLOSED. */
export const COMMISSION_MATERIALIZATION_CLOSING_GUARD =
  "Orchestrator does not write CommissionMonthlyClosing or CommissionReceiptLedgerLine";

export type AffectedSalesOrderSource =
  | "SALES_ORDER"
  | "NFE"
  | "RECEIVABLE"
  | "CUSTOMER"
  | "SELLER"
  | "COMMISSION_RULE"
  | "CUSTOMER_EXCLUSION";

export type AffectedSalesOrderRef = {
  salesOrderId: string;
  sources: AffectedSalesOrderSource[];
};

export type CommissionMaterializationOrderResult = {
  salesOrderId: string;
  sources: AffectedSalesOrderSource[];
  snapshotAction: CommissionOrderMaterializationAction | "skipped" | "error";
  scheduleAction: CommissionReceivableScheduleRebuildResult["action"] | "skipped" | "error";
  snapshotId: string | null;
  schedulesCreated: number;
  schedulesSuperseded: number;
  schedulesStaled: number;
  schedulesUnchanged: number;
  error?: string;
};

export type CommissionMaterializationRunSummary = {
  dryRun: boolean;
  since: string | null;
  ordersProcessed: number;
  snapshotsCreated: number;
  snapshotsUnchanged: number;
  snapshotsSuperseded: number;
  schedulesCreated: number;
  schedulesUpdated: number;
  schedulesStaled: number;
  schedulesUnchanged: number;
  errors: Array<{ salesOrderId: string; message: string }>;
  orders: CommissionMaterializationOrderResult[];
};

const SOURCE_PRIORITY: Record<AffectedSalesOrderSource, number> = {
  SALES_ORDER: 1,
  NFE: 2,
  RECEIVABLE: 3,
  CUSTOMER: 4,
  SELLER: 5,
  COMMISSION_RULE: 6,
  CUSTOMER_EXCLUSION: 7,
};

export function mergeAffectedSalesOrderRefs(
  refs: AffectedSalesOrderRef[]
): AffectedSalesOrderRef[] {
  const map = new Map<string, Set<AffectedSalesOrderSource>>();

  for (const ref of refs) {
    const set = map.get(ref.salesOrderId) ?? new Set<AffectedSalesOrderSource>();
    for (const source of ref.sources) set.add(source);
    map.set(ref.salesOrderId, set);
  }

  return [...map.entries()]
    .map(([salesOrderId, sources]) => ({
      salesOrderId,
      sources: [...sources].sort(
        (a, b) => SOURCE_PRIORITY[a] - SOURCE_PRIORITY[b]
      ),
    }))
    .sort((a, b) => a.salesOrderId.localeCompare(b.salesOrderId));
}

export function aggregateMaterializationRunSummary(input: {
  dryRun: boolean;
  since: Date | null;
  orders: CommissionMaterializationOrderResult[];
}): CommissionMaterializationRunSummary {
  let snapshotsCreated = 0;
  let snapshotsUnchanged = 0;
  let snapshotsSuperseded = 0;
  let schedulesCreated = 0;
  let schedulesUpdated = 0;
  let schedulesStaled = 0;
  let schedulesUnchanged = 0;
  const errors: Array<{ salesOrderId: string; message: string }> = [];

  for (const order of input.orders) {
    if (order.snapshotAction === "created") snapshotsCreated += 1;
    if (order.snapshotAction === "unchanged") snapshotsUnchanged += 1;
    if (order.snapshotAction === "superseded") snapshotsSuperseded += 1;

    schedulesCreated += order.schedulesCreated;
    schedulesStaled += order.schedulesStaled;
    schedulesUnchanged += order.schedulesUnchanged;
    if (
      order.scheduleAction === "updated" ||
      order.scheduleAction === "mixed" ||
      order.scheduleAction === "created"
    ) {
      schedulesUpdated += 1;
    }

    if (order.error) {
      errors.push({ salesOrderId: order.salesOrderId, message: order.error });
    }
  }

  return {
    dryRun: input.dryRun,
    since: input.since?.toISOString() ?? null,
    ordersProcessed: input.orders.length,
    snapshotsCreated,
    snapshotsUnchanged,
    snapshotsSuperseded,
    schedulesCreated,
    schedulesUpdated,
    schedulesStaled,
    schedulesUnchanged,
    errors,
    orders: input.orders,
  };
}

export function buildMaterializationOrderResult(input: {
  salesOrderId: string;
  sources: AffectedSalesOrderSource[];
  snapshot: {
    action: CommissionOrderMaterializationAction;
    snapshotId: string | null;
  } | null;
  schedule: CommissionReceivableScheduleRebuildResult | null;
  error?: string;
}): CommissionMaterializationOrderResult {
  return {
    salesOrderId: input.salesOrderId,
    sources: input.sources,
    snapshotAction: input.error ? "error" : (input.snapshot?.action ?? "skipped"),
    scheduleAction: input.error ? "error" : (input.schedule?.action ?? "skipped"),
    snapshotId: input.snapshot?.snapshotId ?? null,
    schedulesCreated: input.schedule?.schedulesCreated ?? 0,
    schedulesSuperseded: input.schedule?.schedulesSuperseded ?? 0,
    schedulesStaled: input.schedule?.schedulesStaled ?? 0,
    schedulesUnchanged: input.schedule?.schedulesUnchanged ?? 0,
    error: input.error,
  };
}

export function parseMaterializationIdList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(/[,;]/).map((part) => part.trim()).filter(Boolean))];
}

export function parseMaterializationNumericIdList(value: string | undefined): number[] {
  return [
    ...new Set(
      parseMaterializationIdList(value)
        .map((part) => Number(part))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
}

export function parseMaterializationSince(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data inválida em --since: ${value}`);
  }
  return parsed;
}

export function resolveMaterializationDryRun(input: {
  preview?: boolean;
  apply?: boolean;
}): boolean {
  if (input.preview && input.apply) {
    throw new Error("Use apenas um modo: --preview ou --apply.");
  }
  return !input.apply;
}
