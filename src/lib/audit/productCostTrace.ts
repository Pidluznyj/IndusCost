/**
 * Cost-to-Cash — rastreabilidade de custo de produto (camada pública).
 * Implementação: productCostTraceAudit.* — reutiliza custo oficial e engine de engenharia.
 */
export type {
  ProductCostTraceAuditReport as ProductCostTrace,
  ProductCostTraceAuditQuery as ProductCostTraceQuery,
  ProductCostTraceAuditStatus as ProductCostTraceStatus,
  ProductCostTraceAlert,
  ProductCostTraceCommercialPrice,
  ProductCostTraceCostLine,
  ProductCostTraceDataSource,
} from "../productCostTraceAudit.js";

export {
  buildEmptyProductCostTraceReport,
  buildProductCostTraceAlerts,
  buildProductCostTraceCsv,
  computeCostSharePercent,
  formatProductCostTraceText,
  mapBomLineToCostLine,
  mapProcessAuditToTrace,
  rankCostLinesByTotal,
  roundCost,
} from "../productCostTraceAudit.js";

export { TRACE_DIAGNOSTIC_RECALC_NOTE, type TraceCalculationMode } from "./traceCommon.js";
export {
  createTraceDiagnostic,
  mapAlertToDiagnostic,
  type TraceDiagnostic,
} from "./traceDiagnostic.js";
