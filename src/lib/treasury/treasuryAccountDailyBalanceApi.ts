/**
 * Cliente HTTP — saldo inicial/final do dia de UMA conta (browser-safe).
 *
 * Alternativa leve aos workspaces `/today/opening` e `/today/closing` quando a
 * tela edita uma única conta: uma conta, uma data, dois valores e as versões
 * de optimistic lock.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  buildTreasuryAccountDailyBalancePath,
  type TreasuryAccountDailyBalanceDto,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryAccountDailyBalanceFetchParams = {
  accountId: string;
  date?: string | null;
  signal?: AbortSignal;
};

export type TreasuryAccountDailyBalancePayload =
  TreasuryAccountDailyBalanceDto & {
    requestId?: string;
  };

export function buildTreasuryAccountDailyBalanceUrl(
  params: TreasuryAccountDailyBalanceFetchParams
): string {
  const base = buildTreasuryAccountDailyBalancePath(params.accountId);
  const qs = new URLSearchParams();
  if (params.date?.trim()) qs.set("date", params.date.trim());
  const q = qs.toString();
  return q ? `${base}?${q}` : base;
}

export async function fetchTreasuryAccountDailyBalance(
  params: TreasuryAccountDailyBalanceFetchParams
): Promise<TreasuryAccountDailyBalancePayload> {
  return fetchJsonOk<TreasuryAccountDailyBalancePayload>(
    buildTreasuryAccountDailyBalanceUrl(params),
    { signal: params.signal }
  );
}
