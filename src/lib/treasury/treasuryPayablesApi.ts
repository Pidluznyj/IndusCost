/**
 * Cliente HTTP — consulta e programação CP Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_PAYABLES_PATH,
  type TreasuryPayableHoldInput,
  type TreasuryPayableListItemDto,
  type TreasuryPayableProgramPaymentCancelInput,
  type TreasuryPayableProgramPaymentInput,
  type TreasuryPayableProgramPaymentUpdateInput,
  type TreasuryPayableProgrammingImpactDto,
  type TreasuryPayableProgrammingView,
  type TreasuryPayableSortField,
  type TreasuryPayablesListResponse,
  type TreasurySortDirection,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryPayablesListParams = {
  page?: number;
  pageSize?: number;
  sortBy?: TreasuryPayableSortField;
  sortDirection?: TreasurySortDirection;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  document?: string | null;
  classification?: string | null;
  costCenter?: string | null;
  costCenterId?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  scheduledFrom?: string | null;
  scheduledTo?: string | null;
  operationalStatus?: string | null;
  openAmountMin?: string | null;
  openAmountMax?: string | null;
  plannedAccountId?: string | null;
  priority?: string | null;
  responsibleUserId?: string | null;
  includeCancelled?: boolean;
  includeSettledInDueRange?: boolean;
  signal?: AbortSignal;
};

export type TreasuryPayablesListPayload = TreasuryPayablesListResponse & {
  requestId?: string;
};

export type TreasuryPayableProgramPaymentPayload = {
  ok: true;
  payable: TreasuryPayableListItemDto;
  programming: TreasuryPayableProgrammingView;
  impact: TreasuryPayableProgrammingImpactDto;
  projectionRecalc?: {
    accepted: boolean;
    deferred: boolean;
    reason: string;
  };
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

function buildListUrl(params: TreasuryPayablesListParams): string {
  const qs = new URLSearchParams();
  setIf(qs, "page", params.page);
  setIf(qs, "pageSize", params.pageSize);
  setIf(qs, "sortBy", params.sortBy);
  setIf(qs, "sortDirection", params.sortDirection);
  setIf(qs, "supplierName", params.supplierName?.trim());
  setIf(qs, "supplierTaxId", params.supplierTaxId?.trim());
  setIf(qs, "document", params.document?.trim());
  setIf(qs, "classification", params.classification?.trim());
  setIf(qs, "costCenter", params.costCenter?.trim());
  setIf(qs, "costCenterId", params.costCenterId?.trim());
  setIf(qs, "dueFrom", params.dueFrom);
  setIf(qs, "dueTo", params.dueTo);
  setIf(qs, "scheduledFrom", params.scheduledFrom);
  setIf(qs, "scheduledTo", params.scheduledTo);
  setIf(qs, "operationalStatus", params.operationalStatus);
  setIf(qs, "openAmountMin", params.openAmountMin?.trim());
  setIf(qs, "openAmountMax", params.openAmountMax?.trim());
  setIf(qs, "plannedAccountId", params.plannedAccountId?.trim());
  setIf(qs, "priority", params.priority);
  setIf(qs, "responsibleUserId", params.responsibleUserId?.trim());
  if (params.includeCancelled) qs.set("includeCancelled", "true");
  if (params.includeSettledInDueRange) qs.set("includeSettledInDueRange", "true");
  const query = qs.toString();
  return query
    ? `${TREASURY_PAYABLES_PATH}?${query}`
    : TREASURY_PAYABLES_PATH;
}

export async function fetchTreasuryPayables(
  params: TreasuryPayablesListParams = {}
): Promise<TreasuryPayablesListPayload> {
  return fetchJsonOk<TreasuryPayablesListPayload>(buildListUrl(params), {
    credentials: "include",
    signal: params.signal,
  });
}

export async function fetchTreasuryPayable(
  titleId: string,
  signal?: AbortSignal
): Promise<TreasuryPayableListItemDto> {
  const res = await fetchJsonOk<{
    payable: TreasuryPayableListItemDto;
  }>(`${TREASURY_PAYABLES_PATH}/${encodeURIComponent(titleId)}`, {
    credentials: "include",
    signal,
  });
  return res.payable;
}

export async function programTreasuryPayablePayment(
  titleId: string,
  body: TreasuryPayableProgramPaymentInput
): Promise<TreasuryPayableProgramPaymentPayload> {
  return fetchJsonOk<TreasuryPayableProgramPaymentPayload>(
    `${TREASURY_PAYABLES_PATH}/${encodeURIComponent(titleId)}/program-payment`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export async function updateTreasuryPayableProgramPayment(
  titleId: string,
  body: TreasuryPayableProgramPaymentUpdateInput
): Promise<TreasuryPayableProgramPaymentPayload> {
  return fetchJsonOk<TreasuryPayableProgramPaymentPayload>(
    `${TREASURY_PAYABLES_PATH}/${encodeURIComponent(titleId)}/program-payment`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export async function cancelTreasuryPayableProgramPayment(
  titleId: string,
  body: TreasuryPayableProgramPaymentCancelInput
): Promise<{
  payable: TreasuryPayableListItemDto;
  impact: TreasuryPayableProgrammingImpactDto | null;
}> {
  const res = await fetchJsonOk<{
    payable: TreasuryPayableListItemDto;
    impact: TreasuryPayableProgrammingImpactDto | null;
  }>(
    `${TREASURY_PAYABLES_PATH}/${encodeURIComponent(titleId)}/program-payment/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res;
}

export async function holdTreasuryPayable(
  titleId: string,
  body: TreasuryPayableHoldInput
): Promise<TreasuryPayableListItemDto> {
  const res = await fetchJsonOk<{ payable: TreasuryPayableListItemDto }>(
    `${TREASURY_PAYABLES_PATH}/${encodeURIComponent(titleId)}/hold`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.payable;
}

export async function releaseHoldTreasuryPayable(
  titleId: string,
  body: TreasuryPayableHoldInput
): Promise<TreasuryPayableListItemDto> {
  const res = await fetchJsonOk<{ payable: TreasuryPayableListItemDto }>(
    `${TREASURY_PAYABLES_PATH}/${encodeURIComponent(titleId)}/release-hold`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.payable;
}
