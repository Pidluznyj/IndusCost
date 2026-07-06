/**
 * Mapeia payload da API (mesma fonte da tela) para shape CostToCashTrace — sem recálculo.
 */
import type { CostToCashTrace } from "./costToCashTrace.js";
import type { CostToCashTraceApiResponse } from "./costToCashTraceApi.js";
import type { CostToCashTracePageSections } from "./costToCashTracePageView.js";

export type CostToCashTraceApiPayloadInput = CostToCashTraceApiResponse<CostToCashTracePageSections>;

export function apiPayloadToCostToCashTrace(
  payload: CostToCashTraceApiPayloadInput
): CostToCashTrace {
  return {
    status: payload.status === "EMPTY" ? "FAIL" : payload.status,
    auditedAt: payload.summary.auditedAt,
    errorMessage: payload.summary.message,
    calculationMode: payload.summary.calculationMode ?? "PUBLISHED",
    product: payload.sections.product,
    publishedPrice: payload.sections.publishedPrice,
    salesOrder: payload.sections.salesOrder,
    commission: payload.sections.commission,
    chain: payload.sections.chain ?? [],
    diagnostics: payload.diagnostics,
    dataSources: [],
    checklist: {},
  };
}
