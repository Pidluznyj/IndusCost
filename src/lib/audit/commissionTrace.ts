/**
 * Cost-to-Cash — rastreabilidade de comissão (camada pública).
 * Implementação: commissionTraceAudit.* — snapshots, schedules e ledger materializados.
 */
export type {
  CommissionTraceAuditReport as CommissionTrace,
  CommissionTraceAuditQuery as CommissionTraceQuery,
  CommissionTraceAuditStatus as CommissionTraceStatus,
  CommissionTraceClosing,
  CommissionTraceDataSource,
  CommissionTraceItem,
  CommissionTraceNomusAudit,
  CommissionTraceReceipt,
  CommissionTraceReceivable,
  CommissionTraceSale,
} from "../commissions/commissionTraceAudit.js";

export {
  buildCommissionTraceCsv,
  buildCommissionTraceNomusAudit,
  buildCommissionTraceReceipt,
  buildEmptyCommissionTraceReport,
  computeCommissionTraceTotals,
  formatCommissionTraceText,
  readRuleNameFromSnapshot,
} from "../commissions/commissionTraceAudit.js";

export type { TraceDataSource } from "./traceCommon.js";
export {
  createTraceDiagnostic,
  mapAlertToDiagnostic,
  type TraceDiagnostic,
} from "./traceDiagnostic.js";
