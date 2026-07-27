/**
 * Cliente HTTP — consulta CR Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_RECEIVABLES_PATH,
  type TreasuryReceivableListItemDto,
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
