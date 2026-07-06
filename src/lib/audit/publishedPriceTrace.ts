/**
 * Cost-to-Cash — rastreabilidade de preço publicado (camada pública).
 * Implementação: publishedPriceSourceTrace.* — usa snapshots congelados na publicação.
 */
export type {
  PublishedPriceSourceTrace as PublishedPriceTrace,
  PublishedPriceSourceTraceQuery as PublishedPriceTraceQuery,
  PublishedTraceStatus as PublishedPriceTraceStatus,
} from "../pricing/publishedPriceSourceTrace.js";

export {
  PUBLISHED_TRACE_NEWER_COST_WARNING,
  PUBLISHED_TRACE_UNAVAILABLE_LABEL,
  buildPublishedPriceTraceCsv,
  computePublishedMarkup,
  decTrace,
  deriveOtherVariablesAmount,
  formatPublishedPriceTraceText,
  readCostSnapshotFields,
  readFormulaSnapshotFields,
  toIsoTrace,
} from "../pricing/publishedPriceSourceTrace.js";

export type { TraceDataSource } from "./traceCommon.js";
export {
  createTraceDiagnostic,
  type TraceDiagnostic,
} from "./traceDiagnostic.js";
