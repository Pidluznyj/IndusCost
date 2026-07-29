/**
 * OP-57 — Hook pós-sync Nomus para recomputação incremental do Fluxo de Pedidos.
 * Puro: flags, triggers, dedupe e formatação de log.
 * Sem I/O; sem lock de rebuild completo.
 */

export const SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV =
  "SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC";

export type SalesOrderFlowRecomputeAfterSyncSource =
  | "sales-orders"
  | "production-orders"
  | "stock-documents"
  | "nfes"
  | "sales-order-nfe-links"
  | "production-order-sales-links"
  | "cut-fulfillment-cancel"
  /** Após apply do rebuild OrderToCashAudit (facts materializados). */
  | "order-to-cash-audit";

export type SalesOrderFlowRecomputeAfterSyncTrigger = {
  source: SalesOrderFlowRecomputeAfterSyncSource;
  syncMode: "apply" | "dry" | "preview";
  /** UUIDs IndusCost já resolvidos. */
  salesOrderIds?: string[];
  /** NF-e externas → resolvidas via SalesOrderNfeLink. */
  nfeIds?: number[];
  /** OPs externas → resolvidas via NomusProductionOrderSalesLink. */
  productionOrderExternalIds?: number[];
  /** Documentos de saída externos → via idNfe / O2C. */
  stockDocumentExternalIds?: number[];
};

export type SalesOrderFlowRecomputeOrderFailure = {
  salesOrderId: string;
  message: string;
};

export type SalesOrderFlowRecomputeAfterSyncObservability = {
  ordersEvaluated: number;
  itemsEvaluated: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  eventsCreated: number;
  inconsistencies: number;
  computationVersion: string | null;
};

export type SalesOrderFlowRecomputeAfterSyncSummary = {
  ordersSelected: number;
  ordersProcessed: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  failures: SalesOrderFlowRecomputeOrderFailure[];
  durationMs: number;
  /** Contadores agregados do motor (OP-74). */
  observability?: SalesOrderFlowRecomputeAfterSyncObservability;
};

export type SalesOrderFlowRecomputeAfterSyncResult = {
  enabled: boolean;
  skipped: boolean;
  skipReason?: string;
  summary?: SalesOrderFlowRecomputeAfterSyncSummary;
  error?: string;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function uniquePositiveInts(values: readonly number[]): number[] {
  return [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))];
}

/**
 * Default ON (como OP after sales). Desliga com false/0/off/no.
 */
export function isSalesOrderFlowRecomputeAfterSyncEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = (env[SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV] ?? "true")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function buildSalesOrderFlowRecomputeAfterSyncTrigger(input: {
  source: SalesOrderFlowRecomputeAfterSyncSource;
  syncMode: "apply" | "dry" | "preview";
  salesOrderIds?: string[];
  nfeIds?: number[];
  productionOrderExternalIds?: number[];
  stockDocumentExternalIds?: number[];
}): SalesOrderFlowRecomputeAfterSyncTrigger {
  return {
    source: input.source,
    syncMode: input.syncMode,
    salesOrderIds: input.salesOrderIds?.length
      ? uniqueStrings(input.salesOrderIds)
      : undefined,
    nfeIds: input.nfeIds?.length ? uniquePositiveInts(input.nfeIds) : undefined,
    productionOrderExternalIds: input.productionOrderExternalIds?.length
      ? uniquePositiveInts(input.productionOrderExternalIds)
      : undefined,
    stockDocumentExternalIds: input.stockDocumentExternalIds?.length
      ? uniquePositiveInts(input.stockDocumentExternalIds)
      : undefined,
  };
}

export function hasSalesOrderFlowRecomputeTriggerTargets(
  trigger: SalesOrderFlowRecomputeAfterSyncTrigger
): boolean {
  return Boolean(
    trigger.salesOrderIds?.length ||
      trigger.nfeIds?.length ||
      trigger.productionOrderExternalIds?.length ||
      trigger.stockDocumentExternalIds?.length
  );
}

/** Deduplica orderIds na mesma execução (evita recomputar dezenas de vezes). */
export function dedupeSalesOrderFlowOrderIds(
  ids: readonly string[]
): string[] {
  return uniqueStrings(ids);
}

export function mergeSalesOrderFlowOrderIdBatches(
  ...batches: Array<readonly string[] | undefined>
): string[] {
  const all: string[] = [];
  for (const batch of batches) {
    if (batch?.length) all.push(...batch);
  }
  return dedupeSalesOrderFlowOrderIds(all);
}

export function emptySalesOrderFlowRecomputeAfterSyncSummary(): SalesOrderFlowRecomputeAfterSyncSummary {
  return {
    ordersSelected: 0,
    ordersProcessed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    failures: [],
    durationMs: 0,
  };
}

export function formatSalesOrderFlowRecomputeAfterSyncLog(
  result: SalesOrderFlowRecomputeAfterSyncResult,
  trigger: SalesOrderFlowRecomputeAfterSyncTrigger
): string {
  const prefix = "[sales-order-flow-recompute-after-sync]";
  if (!result.enabled) {
    return `${prefix} desabilitado (${SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV}=false)`;
  }
  if (result.skipped) {
    return `${prefix} ignorado source=${trigger.source} reason=${result.skipReason ?? "unknown"}`;
  }
  if (result.error) {
    return `${prefix} ERRO source=${trigger.source} error=${result.error}`;
  }
  const s = result.summary;
  if (!s) {
    return `${prefix} concluído source=${trigger.source} sem resumo`;
  }
  return (
    `${prefix} source=${trigger.source} selected=${s.ordersSelected} ` +
    `processed=${s.ordersProcessed} created=${s.created} updated=${s.updated} ` +
    `unchanged=${s.unchanged} errors=${s.errors} durationMs=${s.durationMs}`
  );
}
