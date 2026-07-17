/**
 * Cliente HTTP tipado do Fluxo de Pedidos (Kanban Comercial).
 */
import { fetchJsonOk } from "@/src/lib/http.js";
import type { SalesOrderFlowListPayload } from "@/src/lib/sales/salesOrderFlowList.js";
import type {
  SalesOrderFlowDetailPayload,
  SalesOrderFlowEventsPayload,
} from "@/src/lib/sales/salesOrderFlowDetail.js";
import type { SalesOrderFlowManagementApi } from "@/src/lib/sales/salesOrderFlowManagement.js";
import type {
  SalesOrderFlowSummaryPayload,
  SalesOrderFlowSummaryPriority,
} from "@/src/lib/sales/salesOrderFlowSummary.js";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog.js";
import type { SalesOrderFlowEventType } from "@/src/lib/sales/salesOrderFlowTimeline.js";
import { SALES_ORDER_FLOW_FEATURE_RESOURCE } from "@/src/lib/sales/salesOrderFlowFeatureFlags.js";

export type {
  SalesOrderFlowListPayload,
  SalesOrderFlowSummaryPayload,
  SalesOrderFlowDetailPayload,
  SalesOrderFlowEventsPayload,
  SalesOrderFlowManagementApi,
};

export const SALES_ORDER_FLOW_LIST_API_PATH =
  "/api/commercial/sales-order-flow";
export const SALES_ORDER_FLOW_SUMMARY_API_PATH =
  "/api/commercial/sales-order-flow/summary";
export const SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH =
  "/api/commercial/sales-order-flow/feature-status";

export function getSalesOrderFlowDetailApiPath(salesOrderId: string): string {
  return `${SALES_ORDER_FLOW_LIST_API_PATH}/${encodeURIComponent(salesOrderId)}`;
}

export function getSalesOrderFlowEventsApiPath(salesOrderId: string): string {
  return `${getSalesOrderFlowDetailApiPath(salesOrderId)}/events`;
}

export function getSalesOrderFlowManagementApiPath(salesOrderId: string): string {
  return `${getSalesOrderFlowDetailApiPath(salesOrderId)}/management`;
}

export function getSalesOrderFlowRecomputeApiPath(salesOrderId: string): string {
  return `${getSalesOrderFlowDetailApiPath(salesOrderId)}/recompute`;
}

export type SalesOrderFlowRecomputeResult = {
  salesOrderId: string;
  action: "unchanged" | "created" | "updated";
  reason: "fingerprint_match" | "first_run" | "fingerprint_changed";
  currentOrderStage: string;
  previousOrderStage: string | null;
  skippedWrite: boolean;
  computedAt: string | null;
  computationVersion?: string;
  observability?: {
    sourceFingerprint: string;
    durationMs: number;
    metrics: {
      ordersEvaluated: number;
      itemsEvaluated: number;
      snapshotsCreated: number;
      snapshotsUpdated: number;
      unchanged: number;
      eventsCreated: number;
      inconsistencies: number;
      failures: number;
      durationMs: number;
      computationVersion: string;
      source: string;
    };
  };
};

export const SALES_ORDER_FLOW_RESPONSIBLE_USERS_LOOKUP_API_PATH =
  `${SALES_ORDER_FLOW_LIST_API_PATH}/lookup/responsible-users`;

export type SalesOrderFlowResponsibleUserLookupItem = {
  id: string;
  name: string;
  email: string | null;
};

export type SalesOrderFlowManagementPatchBody = {
  expectedUpdatedAt: string | null;
  priority?: string;
  responsibleUserId?: string | null;
  responsibleArea?: string | null;
  isBlocked?: boolean;
  blockReason?: string | null;
  expectedResolutionAt?: string | null;
  internalNote?: string | null;
};

export type SalesOrderFlowManagementPatchResult = {
  salesOrderId: string;
  management: SalesOrderFlowManagementApi;
  changedFields: string[];
  eventId: string;
};

export type SalesOrderFlowEventsClientQuery = {
  page?: number;
  pageSize?: number;
  eventType?: SalesOrderFlowEventType | null;
  salesOrderItemId?: string | null;
};

export function buildSalesOrderFlowEventsQueryString(
  query: SalesOrderFlowEventsClientQuery = {}
): string {
  const params = new URLSearchParams();
  if (query.page != null) params.set("page", String(query.page));
  if (query.pageSize != null) params.set("pageSize", String(query.pageSize));
  if (query.eventType) params.set("eventType", query.eventType);
  if (query.salesOrderItemId?.trim()) {
    params.set("salesOrderItemId", query.salesOrderItemId.trim());
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

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

export async function fetchSalesOrderFlowDetail(
  salesOrderId: string,
  signal?: AbortSignal
): Promise<SalesOrderFlowDetailPayload> {
  return fetchJsonOk<SalesOrderFlowDetailPayload>(
    getSalesOrderFlowDetailApiPath(salesOrderId),
    { signal }
  );
}

export async function fetchSalesOrderFlowEvents(
  salesOrderId: string,
  query: SalesOrderFlowEventsClientQuery = {},
  signal?: AbortSignal
): Promise<SalesOrderFlowEventsPayload> {
  return fetchJsonOk<SalesOrderFlowEventsPayload>(
    `${getSalesOrderFlowEventsApiPath(salesOrderId)}${buildSalesOrderFlowEventsQueryString(query)}`,
    { signal }
  );
}

export async function patchSalesOrderFlowManagement(
  salesOrderId: string,
  body: SalesOrderFlowManagementPatchBody,
  signal?: AbortSignal
): Promise<SalesOrderFlowManagementPatchResult> {
  return fetchJsonOk<SalesOrderFlowManagementPatchResult>(
    getSalesOrderFlowManagementApiPath(salesOrderId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }
  );
}

export async function fetchSalesOrderFlowResponsibleUsers(
  query: string,
  signal?: AbortSignal
): Promise<SalesOrderFlowResponsibleUserLookupItem[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  const qs = params.toString();
  const payload = await fetchJsonOk<{
    rows: SalesOrderFlowResponsibleUserLookupItem[];
  }>(
    `${SALES_ORDER_FLOW_RESPONSIBLE_USERS_LOOKUP_API_PATH}${qs ? `?${qs}` : ""}`,
    { signal }
  );
  return Array.isArray(payload.rows) ? payload.rows : [];
}

export async function recomputeSalesOrderFlowOrder(
  salesOrderId: string,
  signal?: AbortSignal
): Promise<SalesOrderFlowRecomputeResult> {
  return fetchJsonOk<SalesOrderFlowRecomputeResult>(
    getSalesOrderFlowRecomputeApiPath(salesOrderId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    }
  );
}
