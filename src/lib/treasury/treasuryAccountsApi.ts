/**
 * Cliente HTTP das contas financeiras da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_ACCOUNTS_PATH,
  type TreasuryCreateAccountInput,
  type TreasuryDeactivateAccountInput,
  type TreasuryFinancialAccountAccessDto,
  type TreasuryFinancialAccountDto,
  type TreasuryListResponse,
  type TreasuryPutAccountAccessInput,
  type TreasuryReactivateAccountInput,
  type TreasuryUpdateAccountInput,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryAccountsListParams = {
  page?: number;
  pageSize?: number;
  search?: string | null;
  isActive?: boolean | null;
  companyCode?: string | null;
  accountType?: string | null;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  signal?: AbortSignal;
};

export type TreasuryAccountsListPayload =
  TreasuryListResponse<TreasuryFinancialAccountDto> & {
    requestId?: string;
  };

function buildListUrl(params: TreasuryAccountsListParams): string {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.companyCode?.trim()) qs.set("companyCode", params.companyCode.trim());
  if (params.accountType) qs.set("accountType", params.accountType);
  if (params.isActive === true) qs.set("isActive", "true");
  if (params.isActive === false) qs.set("isActive", "false");
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDirection) qs.set("sortDirection", params.sortDirection);
  const query = qs.toString();
  return query ? `${TREASURY_ACCOUNTS_PATH}?${query}` : TREASURY_ACCOUNTS_PATH;
}

export async function fetchTreasuryAccounts(
  params: TreasuryAccountsListParams = {}
): Promise<TreasuryAccountsListPayload> {
  return fetchJsonOk<TreasuryAccountsListPayload>(buildListUrl(params), {
    credentials: "include",
    signal: params.signal,
  });
}

export async function fetchTreasuryAccount(
  id: string,
  signal?: AbortSignal
): Promise<TreasuryFinancialAccountDto> {
  const res = await fetchJsonOk<{ account: TreasuryFinancialAccountDto }>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(id)}`,
    { credentials: "include", signal }
  );
  return res.account;
}

export async function createTreasuryAccount(
  body: TreasuryCreateAccountInput
): Promise<TreasuryFinancialAccountDto> {
  const res = await fetchJsonOk<{ account: TreasuryFinancialAccountDto }>(
    TREASURY_ACCOUNTS_PATH,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.account;
}

export async function updateTreasuryAccount(
  id: string,
  body: TreasuryUpdateAccountInput
): Promise<TreasuryFinancialAccountDto> {
  const res = await fetchJsonOk<{ account: TreasuryFinancialAccountDto }>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.account;
}

export async function deactivateTreasuryAccount(
  id: string,
  body: TreasuryDeactivateAccountInput
): Promise<TreasuryFinancialAccountDto> {
  const res = await fetchJsonOk<{ account: TreasuryFinancialAccountDto }>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(id)}/deactivate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.account;
}

export async function reactivateTreasuryAccount(
  id: string,
  body: TreasuryReactivateAccountInput
): Promise<TreasuryFinancialAccountDto> {
  const res = await fetchJsonOk<{ account: TreasuryFinancialAccountDto }>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(id)}/reactivate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.account;
}

export async function fetchTreasuryAccountAccess(
  accountId: string,
  signal?: AbortSignal
): Promise<TreasuryFinancialAccountAccessDto[]> {
  const res = await fetchJsonOk<{
    access: TreasuryFinancialAccountAccessDto[];
  }>(`${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/access`, {
    credentials: "include",
    signal,
  });
  return res.access;
}

export async function putTreasuryAccountAccess(
  accountId: string,
  body: TreasuryPutAccountAccessInput
): Promise<TreasuryFinancialAccountAccessDto> {
  const res = await fetchJsonOk<{ access: TreasuryFinancialAccountAccessDto }>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/access`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.access;
}
