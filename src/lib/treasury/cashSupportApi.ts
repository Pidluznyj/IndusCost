/**
 * Cliente HTTP — Apoio ao Caixa (CS-007). Client-safe: sem Prisma/I/O.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_CASH_SUPPORT_PATH } from "@/src/lib/treasury/contracts/index.js";
import type { CashSupportReadModel } from "@/src/lib/treasury/contracts/cashSupportContracts.js";

export type CashSupportFetchParams = {
  civilDateFrom: string;
  civilDateTo: string;
  companyCode?: string | null;
  accountId?: string | null;
  direction?: "IN" | "OUT" | null;
  search?: string | null;
  onlyPending?: boolean;
  onlyWarnings?: boolean;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
};

export type CashSupportPayload = CashSupportReadModel & { requestId?: string };

export function buildCashSupportUrl(params: CashSupportFetchParams): string {
  const qs = new URLSearchParams();
  qs.set("civilDateFrom", params.civilDateFrom);
  qs.set("civilDateTo", params.civilDateTo);
  if (params.companyCode) qs.set("companyCode", params.companyCode);
  if (params.accountId) qs.set("accountId", params.accountId);
  if (params.direction) qs.set("direction", params.direction);
  if (params.search) qs.set("search", params.search);
  if (params.onlyPending) qs.set("onlyPending", "true");
  if (params.onlyWarnings) qs.set("onlyWarnings", "true");
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return `${TREASURY_CASH_SUPPORT_PATH}?${qs.toString()}`;
}

export async function fetchCashSupport(
  params: CashSupportFetchParams
): Promise<CashSupportPayload> {
  return fetchJsonOk<CashSupportPayload>(buildCashSupportUrl(params), {
    signal: params.signal,
  });
}
