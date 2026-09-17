/**
 * Compras → Performance — cliente HTTP (browser-safe).
 * Nenhuma regra de negócio: a UI consome o read model calculado no servidor.
 */

import { fetchJsonOk } from "@/src/lib/http";
import type {
  DashboardMaterialDetail,
  DashboardMaterialOption,
  DashboardSupplierDetail,
  SupplierMaterialMatrixQuery,
  SupplierMaterialMatrixResult,
  SupplierPerformanceDashboardFilters,
  SupplierPerformanceDashboardReadModel,
} from "./supplierPerformanceDashboard";
import type {
  SupplierClassificationReport,
  SupplierClassificationReportQuery,
} from "./supplierClassificationReport";

export const SUPPLIER_PERFORMANCE_DASHBOARD_API = "/api/purchases/performance";

export function buildSupplierPerformanceDashboardParams(
  filters: SupplierPerformanceDashboardFilters
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.period.from) params.set("from", filters.period.from);
  if (filters.period.to) params.set("to", filters.period.to);
  if (filters.supplierExternalId != null) params.set("supplierExternalId", String(filters.supplierExternalId));
  if (filters.materialKey) params.set("materialKey", filters.materialKey);
  if (filters.materialGroup) params.set("materialGroup", filters.materialGroup);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.includeCanceled) params.set("includeCanceled", "1");
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function fetchSupplierPerformanceDashboard(
  filters: SupplierPerformanceDashboardFilters,
  signal?: AbortSignal
): Promise<SupplierPerformanceDashboardReadModel> {
  return fetchJsonOk<SupplierPerformanceDashboardReadModel>(
    withQuery(SUPPLIER_PERFORMANCE_DASHBOARD_API, buildSupplierPerformanceDashboardParams(filters)),
    signal ? { signal } : undefined
  );
}

export const SUPPLIER_CLASSIFICATION_API = `${SUPPLIER_PERFORMANCE_DASHBOARD_API}/classification`;

/** Filtros da população + consulta de leitura, idênticos em tela, XLSX e PDF. */
export function buildSupplierClassificationParams(
  filters: SupplierPerformanceDashboardFilters,
  query: SupplierClassificationReportQuery
): URLSearchParams {
  const params = buildSupplierPerformanceDashboardParams(filters);
  if (query.search) params.set("search", query.search);
  if (query.classification) params.set("classification", query.classification);
  if (query.registryStatus) params.set("registryStatus", query.registryStatus);
  if (query.onlyPending) params.set("onlyPending", "1");
  params.set("sort", query.sort);
  params.set("direction", query.direction);
  return params;
}

export function fetchSupplierClassificationReport(
  filters: SupplierPerformanceDashboardFilters,
  query: SupplierClassificationReportQuery,
  signal?: AbortSignal
): Promise<SupplierClassificationReport> {
  return fetchJsonOk<SupplierClassificationReport>(
    withQuery(SUPPLIER_CLASSIFICATION_API, buildSupplierClassificationParams(filters, query)),
    signal ? { signal } : undefined
  );
}

/** URL de download — o arquivo é gerado no servidor, nunca montado no browser. */
export function buildSupplierClassificationExportUrl(
  extension: "xlsx" | "pdf",
  filters: SupplierPerformanceDashboardFilters,
  query: SupplierClassificationReportQuery
): string {
  return withQuery(
    `${SUPPLIER_CLASSIFICATION_API}.${extension}`,
    buildSupplierClassificationParams(filters, query)
  );
}

export function fetchSupplierPerformanceSupplierDetail(
  supplierExternalId: number,
  filters: SupplierPerformanceDashboardFilters,
  signal?: AbortSignal
): Promise<DashboardSupplierDetail> {
  return fetchJsonOk<DashboardSupplierDetail>(
    withQuery(
      `${SUPPLIER_PERFORMANCE_DASHBOARD_API}/suppliers/${encodeURIComponent(String(supplierExternalId))}`,
      buildSupplierPerformanceDashboardParams(filters)
    ),
    signal ? { signal } : undefined
  );
}

export function fetchSupplierPerformanceMaterialDetail(
  materialKey: string,
  filters: SupplierPerformanceDashboardFilters,
  signal?: AbortSignal
): Promise<DashboardMaterialDetail> {
  return fetchJsonOk<DashboardMaterialDetail>(
    withQuery(
      `${SUPPLIER_PERFORMANCE_DASHBOARD_API}/materials/${encodeURIComponent(materialKey)}`,
      buildSupplierPerformanceDashboardParams(filters)
    ),
    signal ? { signal } : undefined
  );
}

export function fetchSupplierMaterialMatrix(
  filters: SupplierPerformanceDashboardFilters,
  query: Partial<SupplierMaterialMatrixQuery>,
  signal?: AbortSignal
): Promise<SupplierMaterialMatrixResult> {
  const params = buildSupplierPerformanceDashboardParams(filters);
  if (query.search) params.set("search", query.search);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  return fetchJsonOk<SupplierMaterialMatrixResult>(
    withQuery(`${SUPPLIER_PERFORMANCE_DASHBOARD_API}/supplier-materials`, params),
    signal ? { signal } : undefined
  );
}

export function searchSupplierPerformanceMaterialOptions(
  filters: SupplierPerformanceDashboardFilters,
  term: string,
  signal?: AbortSignal
): Promise<{ materials: DashboardMaterialOption[] }> {
  const params = buildSupplierPerformanceDashboardParams(filters);
  params.delete("materialKey");
  params.delete("materialGroup");
  params.set("q", term);
  return fetchJsonOk<{ materials: DashboardMaterialOption[] }>(
    withQuery(`${SUPPLIER_PERFORMANCE_DASHBOARD_API}/materials`, params),
    signal ? { signal } : undefined
  );
}
