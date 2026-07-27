/**
 * Cliente HTTP de transferências internas (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_TRANSFERS_PATH,
  type TreasuryTransferCancelInput,
  type TreasuryTransferCreateInput,
  type TreasuryTransferDto,
  type TreasuryTransferTransitionInput,
  type TreasuryListResponse,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryTransfersListParams = {
  page?: number;
  pageSize?: number;
  companyCode?: string | null;
  status?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  from?: string | null;
  to?: string | null;
  signal?: AbortSignal;
};

export type TreasuryTransfersListPayload = {
  ok: true;
  items: TreasuryTransferDto[];
  pagination: TreasuryListResponse<TreasuryTransferDto>["pagination"];
  requestId?: string;
};

function buildListUrl(params: TreasuryTransfersListParams): string {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  if (params.companyCode?.trim()) qs.set("companyCode", params.companyCode.trim());
  if (params.status) qs.set("status", params.status);
  if (params.fromAccountId?.trim())
    qs.set("fromAccountId", params.fromAccountId.trim());
  if (params.toAccountId?.trim()) qs.set("toAccountId", params.toAccountId.trim());
  if (params.from?.trim()) qs.set("from", params.from.trim());
  if (params.to?.trim()) qs.set("to", params.to.trim());
  const query = qs.toString();
  return query ? `${TREASURY_TRANSFERS_PATH}?${query}` : TREASURY_TRANSFERS_PATH;
}

export async function fetchTreasuryTransfers(
  params: TreasuryTransfersListParams = {}
): Promise<TreasuryTransfersListPayload> {
  return fetchJsonOk<TreasuryTransfersListPayload>(buildListUrl(params), {
    credentials: "include",
    signal: params.signal,
  });
}

export async function createTreasuryTransfer(
  body: TreasuryTransferCreateInput
): Promise<{
  transfer: TreasuryTransferDto;
  projectionRecalc?: unknown;
}> {
  return fetchJsonOk(`${TREASURY_TRANSFERS_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postTransition(
  id: string,
  action: "schedule" | "send" | "receive" | "reconcile" | "cancel",
  body: TreasuryTransferTransitionInput | TreasuryTransferCancelInput
): Promise<{ transfer: TreasuryTransferDto }> {
  return fetchJsonOk(
    `${TREASURY_TRANSFERS_PATH}/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function scheduleTreasuryTransfer(
  id: string,
  body: TreasuryTransferTransitionInput
) {
  return postTransition(id, "schedule", body);
}

export function sendTreasuryTransfer(
  id: string,
  body: TreasuryTransferTransitionInput
) {
  return postTransition(id, "send", body);
}

export function receiveTreasuryTransfer(
  id: string,
  body: TreasuryTransferTransitionInput
) {
  return postTransition(id, "receive", body);
}

export function reconcileTreasuryTransfer(
  id: string,
  body: TreasuryTransferTransitionInput
) {
  return postTransition(id, "reconcile", body);
}

export function cancelTreasuryTransfer(
  id: string,
  body: TreasuryTransferCancelInput
) {
  return postTransition(id, "cancel", body);
}
