/**
 * Cliente HTTP da worklist de avaliação de Pedidos Nomus (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http";
import type { SupplierEvaluationSavePayload } from "./supplierPerformanceClient";
import type {
  NomusEvaluationSupplierSuggestion,
  NomusSupplierEvaluationBatchItemResult,
  NomusSupplierEvaluationDto,
  NomusSupplierEvaluationWorklistResponse,
  NomusSupplierEvaluationWorklistRow,
} from "./nomusPurchaseOrderEvaluation";
import type { SupplierPerformancePeriod } from "./supplierPerformance";

export type NomusSupplierEvaluationWorklistQuery = SupplierPerformancePeriod & {
  q?: string | null;
  supplier?: string | null;
  supplierExternalId?: number | null;
  stage?: string | null;
  evaluationStatus?: string | null;
  page?: number;
  pageSize?: number;
};

export function buildNomusSupplierEvaluationWorklistQuery(
  input: NomusSupplierEvaluationWorklistQuery
): string {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.q) params.set("q", input.q);
  if (input.supplier) params.set("supplier", input.supplier);
  if (input.supplierExternalId != null) params.set("supplierExternalId", String(input.supplierExternalId));
  if (input.stage) params.set("stage", input.stage);
  if (input.evaluationStatus) params.set("evaluationStatus", input.evaluationStatus);
  if (input.page) params.set("page", String(input.page));
  if (input.pageSize) params.set("pageSize", String(input.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchNomusSupplierEvaluationWorklist(
  input: NomusSupplierEvaluationWorklistQuery,
  signal?: AbortSignal
): Promise<NomusSupplierEvaluationWorklistResponse> {
  return fetchJsonOk<NomusSupplierEvaluationWorklistResponse>(
    `/api/supplier-performance/nomus-orders/worklist${buildNomusSupplierEvaluationWorklistQuery(input)}`,
    signal ? { signal } : undefined
  );
}

export function saveNomusPurchaseOrderSupplierEvaluationRequest(
  nomusPurchaseOrderId: string,
  payload: SupplierEvaluationSavePayload
): Promise<NomusSupplierEvaluationDto> {
  return fetchJsonOk<NomusSupplierEvaluationDto>(
    `/api/supplier-performance/nomus-orders/${encodeURIComponent(nomusPurchaseOrderId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function saveNomusPurchaseOrderSupplierEvaluationsBatchRequest(
  items: Array<
    SupplierEvaluationSavePayload & { nomusPurchaseOrderId: string }
  >
): Promise<{ results: NomusSupplierEvaluationBatchItemResult[] }> {
  return fetchJsonOk<{ results: NomusSupplierEvaluationBatchItemResult[] }>(
    "/api/supplier-performance/nomus-orders/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }
  );
}

export function searchNomusEvaluationSuppliersRequest(
  q: string,
  signal?: AbortSignal
): Promise<{ suppliers: NomusEvaluationSupplierSuggestion[] }> {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", "20");
  return fetchJsonOk<{ suppliers: NomusEvaluationSupplierSuggestion[] }>(
    `/api/supplier-performance/nomus-orders/suppliers?${params}`,
    signal ? { signal } : undefined
  );
}

export type { NomusSupplierEvaluationWorklistRow, NomusSupplierEvaluationWorklistResponse, NomusEvaluationSupplierSuggestion };
