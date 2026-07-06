/**
 * Cost-to-Cash — rastreabilidade de venda/pedido (camada pública).
 * Implementação: salesOrderTraceAudit.* — custo oficial versionado + pedidos Nomus.
 */
export type {
  SalesOrderTraceAuditReport as SalesOrderTrace,
  SalesOrderTraceAuditQuery as SalesOrderTraceQuery,
  SalesOrderTraceAuditStatus as SalesOrderTraceStatus,
  SalesOrderTraceAlert,
  SalesOrderTraceCommissionSnapshot,
  SalesOrderTraceDataSource,
  SalesOrderTraceItem,
  SalesOrderTraceNfe,
} from "../salesOrderTraceAudit.js";

export {
  buildEmptySalesOrderTraceReport,
  buildSalesOrderTraceAlerts,
  buildSalesOrderTraceCsv,
  computeSalesOrderTraceTotals,
  formatSalesOrderTraceText,
  isForbiddenNomusCostSource,
  isOfficialIndusCostSource,
  mapMarginPayloadToTraceItem,
  roundMoney,
} from "../salesOrderTraceAudit.js";

export { TRACE_DIAGNOSTIC_RECALC_NOTE } from "./traceCommon.js";
export {
  createTraceDiagnostic,
  mapAlertToDiagnostic,
  type TraceDiagnostic,
} from "./traceDiagnostic.js";
