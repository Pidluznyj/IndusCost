/**
 * Cliente HTTP tipado do Fluxo de Pedidos (Kanban Comercial).
 */
import { fetchJsonOk } from "@/src/lib/http.js";
import type { SalesOrderFlowListPayload } from "@/src/lib/sales/salesOrderFlowList.js";
import type {
  SalesOrderFlowSummaryPayload,
  SalesOrderFlowSummaryPriority,
} from "@/src/lib/sales/salesOrderFlowSummary.js";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog.js";
import { SALES_ORDER_FLOW_FEATURE_RESOURCE } from "@/src/lib/sales/salesOrderFlowFeatureFlags.js";

export type {
  SalesOrderFlowListPayload,
  SalesOrderFlowSummaryPayload,
};

export const SALES_ORDER_FLOW_LIST_API_PATH =
  "/api/commercial/sales-order-flow";
export const SALES_ORDER_FLOW_SUMMARY_API_PATH =
  "/api/commercial/sales-order-flow/summary";
export const SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH =
  "/api/commercial/sales-order-flow/feature-status";

export type SalesOrderFlowFeatureStatusPayload = {
  enabled: boolean;
  resource: typeof SALES_ORDER_FLOW_FEATURE_RESOURCE;
};

export type SalesOrderFlowClientQuery = {
  q?: string | null;
  customerId?: string | null;
  sellerKey?: string | null;
  seller?: string | null;
  company?: string | null;
  product?: string | null;
  sector?: string | null;
  issueFrom?: string | null;
  issueTo?: string | null;
  promisedFrom?: string | null;
  promisedTo?: string | null;
  overdue?: boolean | null;
  blocked?: boolean | null;
  inconsistent?: boolean | null;
  partiallyShipped?: boolean | null;
  withCut?: boolean | null;
  withActiveResidual?: boolean | null;
  priority?: SalesOrderFlowSummaryPriority | null;
  stages?: readonly SalesOrderFlowStage[] | null;
  limit?: number | null;
  /** Cursor único (válido quando `stages` tem exatamente uma etapa). */
  cursor?: string | null;
  /** Cursors por etapa (`cursor.STAGE`). */
  cursors?: Partial<Record<SalesOrderFlowStage, string | null>> | null;
};

function setOptionalText(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined
): void {
  if (value?.trim()) params.set(key, value.trim());
}

function setOptionalBoolean(
  params: URLSearchParams,
  key: string,
  value: boolean | null | undefined
): void {
  if (value == null) return;
  params.set(key, value ? "true" : "false");
}

export function buildSalesOrderFlowQueryString(
  query: SalesOrderFlowClientQuery = {}
): string {
  const params = new URLSearchParams();
  setOptionalText(params, "q", query.q);
  setOptionalText(params, "customerId", query.customerId);
  setOptionalText(params, "sellerKey", query.sellerKey);
  setOptionalText(params, "seller", query.seller);
  setOptionalText(params, "company", query.company);
  setOptionalText(params, "product", query.product);
  setOptionalText(params, "sector", query.sector);
  setOptionalText(params, "issueFrom", query.issueFrom);
  setOptionalText(params, "issueTo", query.issueTo);
  setOptionalText(params, "promisedFrom", query.promisedFrom);
  setOptionalText(params, "promisedTo", query.promisedTo);
  setOptionalBoolean(params, "overdue", query.overdue);
  setOptionalBoolean(params, "blocked", query.blocked);
  setOptionalBoolean(params, "inconsistent", query.inconsistent);
  setOptionalBoolean(params, "partiallyShipped", query.partiallyShipped);
  setOptionalBoolean(params, "withCut", query.withCut);
  setOptionalBoolean(params, "withActiveResidual", query.withActiveResidual);
  if (query.priority) params.set("priority", query.priority);
  if (query.stages?.length) params.set("stages", query.stages.join(","));
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.cursor?.trim()) params.set("cursor", query.cursor.trim());
  if (query.cursors) {
    for (const [stage, cursor] of Object.entries(query.cursors)) {
      if (cursor?.trim()) params.set(`cursor.${stage}`, cursor.trim());
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchSalesOrderFlowFeatureStatus(
  signal?: AbortSignal
): Promise<SalesOrderFlowFeatureStatusPayload> {
  return fetchJsonOk<SalesOrderFlowFeatureStatusPayload>(
    SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH,
    { signal }
  );
}

export async function fetchSalesOrderFlowSummary(
  query: SalesOrderFlowClientQuery = {},
  signal?: AbortSignal
): Promise<SalesOrderFlowSummaryPayload> {
  return fetchJsonOk<SalesOrderFlowSummaryPayload>(
    `${SALES_ORDER_FLOW_SUMMARY_API_PATH}${buildSalesOrderFlowQueryString(query)}`,
    { signal }
  );
}

export async function fetchSalesOrderFlowList(
  query: SalesOrderFlowClientQuery = {},
  signal?: AbortSignal
): Promise<SalesOrderFlowListPayload> {
  return fetchJsonOk<SalesOrderFlowListPayload>(
    `${SALES_ORDER_FLOW_LIST_API_PATH}${buildSalesOrderFlowQueryString(query)}`,
    { signal }
  );
}
