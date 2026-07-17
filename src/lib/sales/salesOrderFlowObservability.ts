/**
 * OP-74 — Observabilidade do motor do Fluxo de Pedidos (puro, sem I/O).
 * Métricas + logs sanitizados; sem rawJson, tokens ou senhas.
 */

export const SALES_ORDER_FLOW_SOURCE_FINGERPRINT_SUMMARY_LEN = 12;

export const SALES_ORDER_FLOW_RECOMPUTE_SOURCES = [
  "manual",
  "http",
  "rebuild",
  "rebuild-preview",
  "post-sync",
  "unknown",
] as const;

export type SalesOrderFlowRecomputeSource =
  (typeof SALES_ORDER_FLOW_RECOMPUTE_SOURCES)[number];

export type SalesOrderFlowRecomputeObservabilityMetrics = {
  ordersEvaluated: number;
  itemsEvaluated: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  unchanged: number;
  eventsCreated: number;
  inconsistencies: number;
  failures: number;
  durationMs: number;
  computationVersion: string;
  source: SalesOrderFlowRecomputeSource;
};

export type SalesOrderFlowRecomputeObservabilityLog = {
  salesOrderId: string;
  orderCode: string | null;
  previousStage: string | null;
  currentStage: string | null;
  reason: string;
  computationVersion: string;
  /** Fingerprint resumido (nunca o hash completo em log). */
  sourceFingerprint: string;
  action: "unchanged" | "created" | "updated" | "failed";
  source: SalesOrderFlowRecomputeSource;
  durationMs: number;
  metrics: SalesOrderFlowRecomputeObservabilityMetrics;
  errorMessage?: string;
};

const SENSITIVE_PATTERN =
  /password|passwd|secret|token|authorization|rawJson|nomusRaw|bearer\s+[a-z0-9._\-]+/i;

export function summarizeSalesOrderFlowSourceFingerprint(
  fingerprint: string | null | undefined,
  length: number = SALES_ORDER_FLOW_SOURCE_FINGERPRINT_SUMMARY_LEN
): string {
  const value = fingerprint?.trim() ?? "";
  if (!value) return "";
  const n = Math.max(1, Math.min(length, value.length));
  return value.slice(0, n);
}

export function isSalesOrderFlowRecomputeSource(
  value: unknown
): value is SalesOrderFlowRecomputeSource {
  return (
    typeof value === "string" &&
    (SALES_ORDER_FLOW_RECOMPUTE_SOURCES as readonly string[]).includes(value)
  );
}

export function normalizeSalesOrderFlowRecomputeSource(
  value: unknown
): SalesOrderFlowRecomputeSource {
  return isSalesOrderFlowRecomputeSource(value) ? value : "unknown";
}

export function buildSalesOrderFlowRecomputeObservability(input: {
  salesOrderId: string;
  orderCode?: string | null;
  previousStage?: string | null;
  currentStage?: string | null;
  reason: string;
  computationVersion: string;
  orderFingerprint: string;
  action: "unchanged" | "created" | "updated";
  source?: SalesOrderFlowRecomputeSource | null;
  durationMs: number;
  itemsEvaluated: number;
  itemsCreated: number;
  itemsUpdated: number;
  eventsCreated: number;
  inconsistencies: number;
}): SalesOrderFlowRecomputeObservabilityLog {
  const source = normalizeSalesOrderFlowRecomputeSource(input.source);
  const orderSnapshotCreated = input.action === "created" ? 1 : 0;
  const orderSnapshotUpdated = input.action === "updated" ? 1 : 0;
  const unchanged = input.action === "unchanged" ? 1 : 0;

  const metrics: SalesOrderFlowRecomputeObservabilityMetrics = {
    ordersEvaluated: 1,
    itemsEvaluated: Math.max(0, input.itemsEvaluated),
    snapshotsCreated: orderSnapshotCreated + Math.max(0, input.itemsCreated),
    snapshotsUpdated: orderSnapshotUpdated + Math.max(0, input.itemsUpdated),
    unchanged,
    eventsCreated: Math.max(0, input.eventsCreated),
    inconsistencies: Math.max(0, input.inconsistencies),
    failures: 0,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    computationVersion: input.computationVersion,
    source,
  };

  return {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode?.trim() || null,
    previousStage: input.previousStage ?? null,
    currentStage: input.currentStage ?? null,
    reason: input.reason,
    computationVersion: input.computationVersion,
    sourceFingerprint: summarizeSalesOrderFlowSourceFingerprint(
      input.orderFingerprint
    ),
    action: input.action,
    source,
    durationMs: metrics.durationMs,
    metrics,
  };
}

export function buildSalesOrderFlowRecomputeFailureObservability(input: {
  salesOrderId: string;
  orderCode?: string | null;
  previousStage?: string | null;
  currentStage?: string | null;
  source?: SalesOrderFlowRecomputeSource | null;
  durationMs: number;
  computationVersion: string;
  error: unknown;
}): SalesOrderFlowRecomputeObservabilityLog {
  const source = normalizeSalesOrderFlowRecomputeSource(input.source);
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : String(input.error ?? "unknown_error");

  const metrics: SalesOrderFlowRecomputeObservabilityMetrics = {
    ordersEvaluated: 1,
    itemsEvaluated: 0,
    snapshotsCreated: 0,
    snapshotsUpdated: 0,
    unchanged: 0,
    eventsCreated: 0,
    inconsistencies: 0,
    failures: 1,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    computationVersion: input.computationVersion,
    source,
  };

  return {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode?.trim() || null,
    previousStage: input.previousStage ?? null,
    currentStage: input.currentStage ?? null,
    reason: "recompute_failed",
    computationVersion: input.computationVersion,
    sourceFingerprint: "",
    action: "failed",
    source,
    durationMs: metrics.durationMs,
    metrics,
    errorMessage: errorMessage.slice(0, 500),
  };
}

export function formatSalesOrderFlowRecomputeObservabilityLog(
  log: SalesOrderFlowRecomputeObservabilityLog
): string {
  const prefix = "[sales-order-flow-recompute]";
  const parts = [
    `source=${log.source}`,
    `salesOrderId=${log.salesOrderId}`,
    `orderCode=${log.orderCode ?? "-"}`,
    `action=${log.action}`,
    `reason=${log.reason}`,
    `prevStage=${log.previousStage ?? "-"}`,
    `nextStage=${log.currentStage ?? "-"}`,
    `computationVersion=${log.computationVersion}`,
    `sourceFingerprint=${log.sourceFingerprint || "-"}`,
    `items=${log.metrics.itemsEvaluated}`,
    `snapshotsCreated=${log.metrics.snapshotsCreated}`,
    `snapshotsUpdated=${log.metrics.snapshotsUpdated}`,
    `unchanged=${log.metrics.unchanged}`,
    `eventsCreated=${log.metrics.eventsCreated}`,
    `inconsistencies=${log.metrics.inconsistencies}`,
    `failures=${log.metrics.failures}`,
    `durationMs=${log.durationMs}`,
  ];
  if (log.errorMessage) {
    parts.push(`error=${log.errorMessage}`);
  }
  return `${prefix} ${parts.join(" ")}`;
}

export function emptySalesOrderFlowRecomputeObservabilityMetrics(
  source: SalesOrderFlowRecomputeSource = "unknown",
  computationVersion: string
): SalesOrderFlowRecomputeObservabilityMetrics {
  return {
    ordersEvaluated: 0,
    itemsEvaluated: 0,
    snapshotsCreated: 0,
    snapshotsUpdated: 0,
    unchanged: 0,
    eventsCreated: 0,
    inconsistencies: 0,
    failures: 0,
    durationMs: 0,
    computationVersion,
    source,
  };
}

export function aggregateSalesOrderFlowRecomputeObservabilityMetrics(
  logs: readonly SalesOrderFlowRecomputeObservabilityLog[],
  input: {
    source: SalesOrderFlowRecomputeSource;
    computationVersion: string;
    durationMs: number;
  }
): SalesOrderFlowRecomputeObservabilityMetrics {
  const metrics = emptySalesOrderFlowRecomputeObservabilityMetrics(
    input.source,
    input.computationVersion
  );
  for (const log of logs) {
    metrics.ordersEvaluated += log.metrics.ordersEvaluated;
    metrics.itemsEvaluated += log.metrics.itemsEvaluated;
    metrics.snapshotsCreated += log.metrics.snapshotsCreated;
    metrics.snapshotsUpdated += log.metrics.snapshotsUpdated;
    metrics.unchanged += log.metrics.unchanged;
    metrics.eventsCreated += log.metrics.eventsCreated;
    metrics.inconsistencies += log.metrics.inconsistencies;
    metrics.failures += log.metrics.failures;
  }
  metrics.durationMs = Math.max(0, Math.round(input.durationMs));
  return metrics;
}

/**
 * Garante que o payload de observabilidade não carrega segredos / raw.
 * Lança se encontrar padrões sensíveis.
 */
export function assertSalesOrderFlowObservabilitySanitized(
  payload: unknown
): void {
  const serialized = JSON.stringify(payload);
  if (SENSITIVE_PATTERN.test(serialized)) {
    throw new Error(
      "Observabilidade do Fluxo de Pedidos contém campo sensível proibido."
    );
  }
  if (
    typeof payload === "object" &&
    payload != null &&
    "sourceFingerprint" in payload
  ) {
    const fp = String(
      (payload as { sourceFingerprint?: unknown }).sourceFingerprint ?? ""
    );
    if (fp.length > SALES_ORDER_FLOW_SOURCE_FINGERPRINT_SUMMARY_LEN) {
      throw new Error(
        "sourceFingerprint deve ser resumido (não publicar hash completo)."
      );
    }
  }
}

export function buildSalesOrderFlowRecomputeIntegrationRunSummary(input: {
  metrics: SalesOrderFlowRecomputeObservabilityMetrics;
  logs?: readonly SalesOrderFlowRecomputeObservabilityLog[];
  errorMessage?: string | null;
}): Record<string, unknown> {
  const sampleLogs = (input.logs ?? []).slice(0, 20).map((log) => ({
    salesOrderId: log.salesOrderId,
    orderCode: log.orderCode,
    previousStage: log.previousStage,
    currentStage: log.currentStage,
    reason: log.reason,
    action: log.action,
    computationVersion: log.computationVersion,
    sourceFingerprint: log.sourceFingerprint,
    durationMs: log.durationMs,
    errorMessage: log.errorMessage ?? null,
  }));
  const summary = {
    metrics: input.metrics,
    sampleLogs,
    errorMessage: input.errorMessage ?? null,
  };
  assertSalesOrderFlowObservabilitySanitized(summary);
  return summary;
}
