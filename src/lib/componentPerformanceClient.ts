import { fetchJsonOk } from "@/src/lib/http";
import type { ComponentPerformanceProcessSnapshot } from "@/src/lib/componentPerformanceChange";

export type ComponentPerformanceListItem = {
  id: string;
  sku: string;
  name: string;
  status: string | null;
  type: string;
  costingMode: string;
  defaultLotSize: number | null;
  process: ComponentPerformanceProcessSnapshot;
  missingProcess: boolean;
  soldCount: number;
  routingStepCount: number;
  updatedAt: string | null;
  lastPerformanceChangeAt: string | null;
  estimatedPiecesPerHour: number | null;
};

export type ComponentPerformanceListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: ComponentPerformanceListItem[];
};

export type ComponentPerformanceChangeLogItem = {
  id: string;
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  changedAt: string;
  changedByUserId: string;
  changedByUserName: string;
  changedByUserEmail: string;
  responsiblePersonName: string;
  note: string | null;
  oldCycleTimeSeconds: number | null;
  newCycleTimeSeconds: number | null;
  oldCavities: number | null;
  newCavities: number | null;
  oldValuesJson: ComponentPerformanceProcessSnapshot | null;
  newValuesJson: ComponentPerformanceProcessSnapshot | null;
  changedFields: string[];
  source: string;
};

export type ComponentPerformanceHistoryResponse = {
  productId: string;
  total: number;
  limit: number;
  offset: number;
  items: ComponentPerformanceChangeLogItem[];
};

export type ComponentPerformanceListQuery = {
  sku?: string;
  name?: string;
  status?: string;
  soldOnly?: boolean;
  missingProcessOnly?: boolean;
  missingCycleOnly?: boolean;
  missingCavitiesOnly?: boolean;
  soldMissingOnly?: boolean;
  pendingOnly?: boolean;
  recentlyChangedOnly?: boolean;
  recentDays?: number;
  limit?: number;
  offset?: number;
};

export type ComponentPerformanceCoverageTotals = {
  activeComponents: number;
  soldComponentsInPeriod: number;
  withoutCycle: number;
  withoutCavities: number;
  withoutCycleOrCavities: number;
  soldWithoutCompletePerformance: number;
  neverReviewed: number;
  recentlyChanged: number;
};

export type ComponentPerformanceCoverageResponse = {
  periodLabel: string;
  periodFrom: string | null;
  periodTo: string | null;
  totals: ComponentPerformanceCoverageTotals;
  topSoldWithoutCompletePerformance: Array<Record<string, unknown>>;
  recentlyChanged: Array<Record<string, unknown>>;
};

function buildQueryString(query: ComponentPerformanceListQuery): string {
  const params = new URLSearchParams();
  if (query.sku?.trim()) params.set("sku", query.sku.trim());
  if (query.name?.trim()) params.set("name", query.name.trim());
  if (query.status?.trim()) params.set("status", query.status.trim());
  if (query.soldOnly) params.set("soldOnly", "1");
  if (query.missingProcessOnly) params.set("missingProcessOnly", "1");
  if (query.missingCycleOnly) params.set("missingCycleOnly", "1");
  if (query.missingCavitiesOnly) params.set("missingCavitiesOnly", "1");
  if (query.soldMissingOnly) params.set("soldMissingOnly", "1");
  if (query.pendingOnly) params.set("pendingOnly", "1");
  if (query.recentlyChangedOnly) params.set("recentlyChangedOnly", "1");
  if (query.recentDays != null) params.set("recentDays", String(query.recentDays));
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchComponentPerformanceList(
  query: ComponentPerformanceListQuery = {}
): Promise<ComponentPerformanceListResponse> {
  return fetchJsonOk<ComponentPerformanceListResponse>(
    `/api/operations/performance/components${buildQueryString(query)}`
  );
}

export async function fetchComponentPerformanceCoverage(
  query?: { year?: number; month?: number; top?: number }
): Promise<ComponentPerformanceCoverageResponse> {
  const params = new URLSearchParams();
  if (query?.year != null) params.set("year", String(query.year));
  if (query?.month != null) params.set("month", String(query.month));
  if (query?.top != null) params.set("top", String(query.top));
  const qs = params.toString();
  return fetchJsonOk<ComponentPerformanceCoverageResponse>(
    `/api/operations/performance/coverage${qs ? `?${qs}` : ""}`
  );
}

export async function fetchComponentPerformanceProduct(
  productId: string
): Promise<ComponentPerformanceListItem> {
  return fetchJsonOk<ComponentPerformanceListItem>(
    `/api/operations/performance/components/${encodeURIComponent(productId)}`
  );
}

export async function fetchComponentPerformanceHistory(
  productId: string,
  query?: { limit?: number; offset?: number }
): Promise<ComponentPerformanceHistoryResponse> {
  const params = new URLSearchParams();
  if (query?.limit != null) params.set("limit", String(query.limit));
  if (query?.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  return fetchJsonOk<ComponentPerformanceHistoryResponse>(
    `/api/operations/performance/components/${encodeURIComponent(productId)}/history${qs ? `?${qs}` : ""}`
  );
}

export type PatchComponentPerformancePayload = {
  cycleTimeSeconds?: number;
  cavities?: number;
  setupTimeMin?: number;
  efficiencyExpected?: number;
  responsiblePersonName: string;
  note?: string | null;
};

export type PatchComponentPerformanceResponse = {
  ok: true;
  changed: boolean;
  product: ComponentPerformanceListItem;
  changeLog?: ComponentPerformanceChangeLogItem;
  message?: string;
};

export async function patchComponentPerformanceProduct(
  productId: string,
  payload: PatchComponentPerformancePayload
): Promise<PatchComponentPerformanceResponse> {
  return fetchJsonOk<PatchComponentPerformanceResponse>(
    `/api/operations/performance/components/${encodeURIComponent(productId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}
