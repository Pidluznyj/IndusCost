/**
 * Cliente HTTP — consulta CR Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_PROMISES_PATH,
  TREASURY_RECEIVABLES_PATH,
  type TreasuryCollectionActionCancelInput,
  type TreasuryCollectionActionCreateInput,
  type TreasuryCollectionActionDto,
  type TreasuryCustomerFinancialSummaryDto,
  type TreasuryDisputeCreateInput,
  type TreasuryDisputeDto,
  type TreasuryDisputeUpdateStatusInput,
  type TreasuryPaymentPromiseDto,
  type TreasuryPromiseCancelInput,
  type TreasuryPromiseMarkFulfilledInput,
  type TreasuryReceivableExpectationInput,
  type TreasuryReceivableListItemDto,
  type TreasuryReceivablePromiseCreateInput,
  type TreasuryReceivableSortField,
  type TreasuryReceivablesListResponse,
  type TreasurySortDirection,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryReceivablesListParams = {
  page?: number;
  pageSize?: number;
  sortBy?: TreasuryReceivableSortField;
  sortDirection?: TreasurySortDirection;
  customerName?: string | null;
  customerTaxId?: string | null;
  document?: string | null;
  salesOrder?: string | null;
  invoice?: string | null;
  sellerName?: string | null;
  commercialOwnerName?: string | null;
  collectionOwnerUserId?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  expectedFrom?: string | null;
  expectedTo?: string | null;
  hasPromise?: boolean | null;
  operationalStatus?: string | null;
  complementStatus?: string | null;
  daysOverdueMin?: number | null;
  daysOverdueMax?: number | null;
  openAmountMin?: string | null;
  openAmountMax?: string | null;
  plannedAccountId?: string | null;
  priority?: string | null;
  nextAction?: string | null;
  includeCancelled?: boolean;
  signal?: AbortSignal;
};

export type TreasuryReceivablesListPayload = TreasuryReceivablesListResponse & {
  requestId?: string;
};

function setIf(
  qs: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined
) {
  if (value == null || value === "") return;
  qs.set(key, String(value));
}

function buildListUrl(params: TreasuryReceivablesListParams): string {
  const qs = new URLSearchParams();
  setIf(qs, "page", params.page);
  setIf(qs, "pageSize", params.pageSize);
  setIf(qs, "sortBy", params.sortBy);
  setIf(qs, "sortDirection", params.sortDirection);
  setIf(qs, "customerName", params.customerName?.trim());
  setIf(qs, "customerTaxId", params.customerTaxId?.trim());
  setIf(qs, "document", params.document?.trim());
  setIf(qs, "salesOrder", params.salesOrder?.trim());
  setIf(qs, "invoice", params.invoice?.trim());
  setIf(qs, "sellerName", params.sellerName?.trim());
  setIf(qs, "commercialOwnerName", params.commercialOwnerName?.trim());
  setIf(qs, "collectionOwnerUserId", params.collectionOwnerUserId?.trim());
  setIf(qs, "dueFrom", params.dueFrom);
  setIf(qs, "dueTo", params.dueTo);
  setIf(qs, "expectedFrom", params.expectedFrom);
  setIf(qs, "expectedTo", params.expectedTo);
  if (params.hasPromise === true) qs.set("hasPromise", "true");
  if (params.hasPromise === false) qs.set("hasPromise", "false");
  setIf(qs, "operationalStatus", params.operationalStatus);
  setIf(qs, "complementStatus", params.complementStatus);
  setIf(qs, "daysOverdueMin", params.daysOverdueMin);
  setIf(qs, "daysOverdueMax", params.daysOverdueMax);
  setIf(qs, "openAmountMin", params.openAmountMin?.trim());
  setIf(qs, "openAmountMax", params.openAmountMax?.trim());
  setIf(qs, "plannedAccountId", params.plannedAccountId?.trim());
  setIf(qs, "priority", params.priority);
  setIf(qs, "nextAction", params.nextAction?.trim());
  if (params.includeCancelled) qs.set("includeCancelled", "true");
  const query = qs.toString();
  return query
    ? `${TREASURY_RECEIVABLES_PATH}?${query}`
    : TREASURY_RECEIVABLES_PATH;
}

export async function fetchTreasuryReceivables(
  params: TreasuryReceivablesListParams = {}
): Promise<TreasuryReceivablesListPayload> {
  return fetchJsonOk<TreasuryReceivablesListPayload>(buildListUrl(params), {
    credentials: "include",
    signal: params.signal,
  });
}

export async function fetchTreasuryReceivable(
  titleId: string,
  signal?: AbortSignal
): Promise<TreasuryReceivableListItemDto> {
  const res = await fetchJsonOk<{
    receivable: TreasuryReceivableListItemDto;
  }>(`${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}`, {
    credentials: "include",
    signal,
  });
  return res.receivable;
}

export async function fetchTreasuryCustomerFinancialSummary(
  titleId: string,
  signal?: AbortSignal
): Promise<TreasuryCustomerFinancialSummaryDto> {
  const res = await fetchJsonOk<{
    summary: TreasuryCustomerFinancialSummaryDto;
  }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/customer-summary`,
    { credentials: "include", signal }
  );
  return res.summary;
}

export async function putTreasuryReceivableExpectation(
  titleId: string,
  body: TreasuryReceivableExpectationInput
): Promise<TreasuryReceivableListItemDto> {
  const res = await fetchJsonOk<{
    receivable: TreasuryReceivableListItemDto;
  }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/expectation`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.receivable;
}

export async function fetchTreasuryReceivablePromises(
  titleId: string,
  signal?: AbortSignal
): Promise<TreasuryPaymentPromiseDto[]> {
  const res = await fetchJsonOk<{ promises: TreasuryPaymentPromiseDto[] }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/promises`,
    { credentials: "include", signal }
  );
  return res.promises;
}

export async function createTreasuryReceivablePromise(
  titleId: string,
  body: TreasuryReceivablePromiseCreateInput
): Promise<TreasuryPaymentPromiseDto> {
  const res = await fetchJsonOk<{ promise: TreasuryPaymentPromiseDto }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/promises`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.promise;
}

export async function cancelTreasuryPaymentPromise(
  promiseId: string,
  body: TreasuryPromiseCancelInput
): Promise<TreasuryPaymentPromiseDto> {
  const res = await fetchJsonOk<{ promise: TreasuryPaymentPromiseDto }>(
    `${TREASURY_PROMISES_PATH}/${encodeURIComponent(promiseId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.promise;
}

export async function markTreasuryPaymentPromiseFulfilled(
  promiseId: string,
  body: TreasuryPromiseMarkFulfilledInput
): Promise<TreasuryPaymentPromiseDto> {
  const res = await fetchJsonOk<{ promise: TreasuryPaymentPromiseDto }>(
    `${TREASURY_PROMISES_PATH}/${encodeURIComponent(promiseId)}/mark-fulfilled`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.promise;
}

export async function fetchTreasuryCollectionActions(
  titleId: string,
  signal?: AbortSignal
): Promise<TreasuryCollectionActionDto[]> {
  const res = await fetchJsonOk<{ actions: TreasuryCollectionActionDto[] }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/collection-actions`,
    { credentials: "include", signal }
  );
  return res.actions;
}

export async function createTreasuryCollectionAction(
  titleId: string,
  body: TreasuryCollectionActionCreateInput
): Promise<TreasuryCollectionActionDto> {
  const res = await fetchJsonOk<{ action: TreasuryCollectionActionDto }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/collection-actions`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.action;
}

export async function cancelTreasuryCollectionAction(
  actionId: string,
  body: TreasuryCollectionActionCancelInput
): Promise<TreasuryCollectionActionDto> {
  const res = await fetchJsonOk<{ action: TreasuryCollectionActionDto }>(
    `${TREASURY_COLLECTION_ACTIONS_PATH}/${encodeURIComponent(actionId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.action;
}

export async function fetchTreasuryDisputes(
  titleId: string,
  signal?: AbortSignal
): Promise<TreasuryDisputeDto[]> {
  const res = await fetchJsonOk<{ disputes: TreasuryDisputeDto[] }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/disputes`,
    { credentials: "include", signal }
  );
  return res.disputes;
}

export async function createTreasuryDispute(
  titleId: string,
  body: TreasuryDisputeCreateInput
): Promise<TreasuryDisputeDto> {
  const res = await fetchJsonOk<{ dispute: TreasuryDisputeDto }>(
    `${TREASURY_RECEIVABLES_PATH}/${encodeURIComponent(titleId)}/disputes`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.dispute;
}

export async function updateTreasuryDisputeStatus(
  disputeId: string,
  body: TreasuryDisputeUpdateStatusInput
): Promise<TreasuryDisputeDto> {
  const res = await fetchJsonOk<{ dispute: TreasuryDisputeDto }>(
    `${TREASURY_DISPUTES_PATH}/${encodeURIComponent(disputeId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.dispute;
}
