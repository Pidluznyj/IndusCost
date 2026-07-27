/**
 * Cliente HTTP da Central de Exceções (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_EXCEPTIONS_PATH,
  type TreasuryExceptionAcknowledgeInput,
  type TreasuryExceptionAssignInput,
  type TreasuryExceptionCancelInput,
  type TreasuryExceptionDto,
  type TreasuryExceptionIgnoreInput,
  type TreasuryExceptionResolveInput,
  type TreasuryExceptionSetDueAtInput,
  type TreasuryExceptionSetStatusInput,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryExceptionsListParams = {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  companyCode?: string | null;
  status?: string | null;
  type?: string | null;
  severity?: string | null;
  responsibleUserId?: string | null;
  search?: string | null;
  signal?: AbortSignal;
};

export type TreasuryExceptionsListPayload = {
  ok: true;
  items: TreasuryExceptionDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  sortBy: string;
  sortDirection: "asc" | "desc";
  requestId?: string;
};

function buildListUrl(params: TreasuryExceptionsListParams): string {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDirection) qs.set("sortDirection", params.sortDirection);
  if (params.companyCode?.trim()) qs.set("companyCode", params.companyCode.trim());
  if (params.status) qs.set("status", params.status);
  if (params.type) qs.set("type", params.type);
  if (params.severity) qs.set("severity", params.severity);
  if (params.responsibleUserId?.trim()) {
    qs.set("responsibleUserId", params.responsibleUserId.trim());
  }
  if (params.search?.trim()) qs.set("search", params.search.trim());
  const query = qs.toString();
  return query
    ? `${TREASURY_EXCEPTIONS_PATH}?${query}`
    : TREASURY_EXCEPTIONS_PATH;
}

export async function fetchTreasuryExceptions(
  params: TreasuryExceptionsListParams = {}
): Promise<TreasuryExceptionsListPayload> {
  return fetchJsonOk<TreasuryExceptionsListPayload>(buildListUrl(params), {
    credentials: "include",
    signal: params.signal,
  });
}

export async function fetchTreasuryExceptionById(
  id: string,
  signal?: AbortSignal
): Promise<{ exception: TreasuryExceptionDto }> {
  return fetchJsonOk(
    `${TREASURY_EXCEPTIONS_PATH}/${encodeURIComponent(id)}`,
    { credentials: "include", signal }
  );
}

async function postAction<TBody>(
  id: string,
  action: string,
  body: TBody
): Promise<{ exception: TreasuryExceptionDto }> {
  return fetchJsonOk(
    `${TREASURY_EXCEPTIONS_PATH}/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function acknowledgeTreasuryException(
  id: string,
  body: TreasuryExceptionAcknowledgeInput
) {
  return postAction(id, "acknowledge", body);
}

export function assignTreasuryException(
  id: string,
  body: TreasuryExceptionAssignInput
) {
  return postAction(id, "assign", body);
}

export function setTreasuryExceptionDueAt(
  id: string,
  body: TreasuryExceptionSetDueAtInput
) {
  return postAction(id, "due-at", body);
}

export function setTreasuryExceptionStatus(
  id: string,
  body: TreasuryExceptionSetStatusInput
) {
  return postAction(id, "status", body);
}

export function resolveTreasuryException(
  id: string,
  body: TreasuryExceptionResolveInput
) {
  return postAction(id, "resolve", body);
}

export function ignoreTreasuryException(
  id: string,
  body: TreasuryExceptionIgnoreInput
) {
  return postAction(id, "ignore", body);
}

export function cancelTreasuryException(
  id: string,
  body: TreasuryExceptionCancelInput
) {
  return postAction(id, "cancel", body);
}
