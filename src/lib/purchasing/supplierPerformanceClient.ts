/**
 * OP-26 — Cliente HTTP do desempenho de fornecedores (browser-safe).
 * Nenhuma regra de negócio aqui: a UI consome o que o backend calculou.
 */

import { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { fetchSupplyChainFeatureStatus } from "@/src/lib/supply-chain/supplyChainClient";
import type {
  PurchaseOrderSupplierEvaluationResponse,
  SupplierPerformanceDetailResponse,
  SupplierPerformanceEvaluationStatusFilter,
  SupplierPerformancePeriod,
  SupplierPerformanceReportResponse,
  SupplierPerformanceReportSort,
  SupplierEvaluationListSummaryDto,
} from "./supplierPerformance";
import type { SupplierPerformanceDetailCsvRow } from "./supplierPerformanceCsv";

export type SupplierPerformanceReportPayload = SupplierPerformanceReportResponse & {
  methodology: { version: number; text: readonly string[] };
  /** Presente só com `includeOrders` — mesma fonte do CSV detalhado. */
  orders?: SupplierPerformanceDetailCsvRow[];
};

export type SupplierEvaluationSavePayload = {
  qualityScore: number;
  deliveryScore: number;
  conformityScore: number;
  serviceScore: number;
  notes: string | null;
  expectedRevision: number | null;
  revisionReason?: string | null;
};

function appendPeriod(params: URLSearchParams, period: SupplierPerformancePeriod): void {
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
}

export function buildSupplierPerformanceReportQuery(input: {
  period: SupplierPerformancePeriod;
  supplierId?: string | null;
  supplierStatus?: string | null;
  sort?: SupplierPerformanceReportSort;
  includeOrders?: boolean;
}): string {
  const params = new URLSearchParams();
  appendPeriod(params, input.period);
  if (input.supplierId) params.set("supplierId", input.supplierId);
  if (input.supplierStatus) params.set("supplierStatus", input.supplierStatus);
  if (input.sort) params.set("sort", input.sort);
  if (input.includeOrders) params.set("includeOrders", "1");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchPurchaseOrderSupplierEvaluation(
  purchaseOrderId: string,
  signal?: AbortSignal
): Promise<PurchaseOrderSupplierEvaluationResponse> {
  return fetchJsonOk<PurchaseOrderSupplierEvaluationResponse>(
    `/api/purchase-orders/${encodeURIComponent(purchaseOrderId)}/supplier-evaluation`,
    signal ? { signal } : undefined
  );
}

export function savePurchaseOrderSupplierEvaluationRequest(
  purchaseOrderId: string,
  payload: SupplierEvaluationSavePayload
): Promise<PurchaseOrderSupplierEvaluationResponse> {
  return fetchJsonOk<PurchaseOrderSupplierEvaluationResponse>(
    `/api/purchase-orders/${encodeURIComponent(purchaseOrderId)}/supplier-evaluation`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function fetchSupplierEvaluationListSummaries(
  supplierIds: readonly string[],
  signal?: AbortSignal
): Promise<{ items: SupplierEvaluationListSummaryDto[] }> {
  const ids = supplierIds.filter(Boolean);
  if (ids.length === 0) return Promise.resolve({ items: [] });
  const params = new URLSearchParams();
  params.set("ids", ids.join(","));
  return fetchJsonOk<{ items: SupplierEvaluationListSummaryDto[] }>(
    `/api/supplier-performance/suppliers/summaries?${params.toString()}`,
    signal ? { signal } : undefined
  );
}

export function fetchSupplierPerformanceDetail(
  supplierId: string,
  input: {
    period: SupplierPerformancePeriod;
    evaluationStatus: SupplierPerformanceEvaluationStatusFilter;
    page: number;
    pageSize: number;
  },
  signal?: AbortSignal
): Promise<SupplierPerformanceDetailResponse> {
  const params = new URLSearchParams();
  appendPeriod(params, input.period);
  params.set("evaluationStatus", input.evaluationStatus);
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  return fetchJsonOk<SupplierPerformanceDetailResponse>(
    `/api/supplier-performance/suppliers/${encodeURIComponent(supplierId)}?${params.toString()}`,
    signal ? { signal } : undefined
  );
}

export function fetchSupplierPerformanceReport(
  input: {
    period: SupplierPerformancePeriod;
    supplierId?: string | null;
    supplierStatus?: string | null;
    sort?: SupplierPerformanceReportSort;
    includeOrders?: boolean;
  },
  signal?: AbortSignal
): Promise<SupplierPerformanceReportPayload> {
  return fetchJsonOk<SupplierPerformanceReportPayload>(
    `/api/supplier-performance/report${buildSupplierPerformanceReportQuery(input)}`,
    signal ? { signal } : undefined
  );
}

export function buildSupplierPerformanceSummaryCsvUrl(input: {
  period: SupplierPerformancePeriod;
  supplierId?: string | null;
  supplierStatus?: string | null;
  sort?: SupplierPerformanceReportSort;
}): string {
  return `/api/supplier-performance/report.csv${buildSupplierPerformanceReportQuery(input)}`;
}

export function buildSupplierPerformanceDetailCsvUrl(input: {
  period: SupplierPerformancePeriod;
  supplierId?: string | null;
  supplierStatus?: string | null;
}): string {
  return `/api/supplier-performance/orders.csv${buildSupplierPerformanceReportQuery(input)}`;
}

/**
 * Flag da feature no cliente: `null` enquanto carrega, `false` fail-closed.
 * Com `false` a UI não renderiza nada e não chama nenhuma API da feature.
 */
export function useSupplierPerformanceFeatureEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) {
          setEnabled(status.enabled.supplierPerformance === true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    return () => controller.abort();
  }, []);

  return enabled;
}
