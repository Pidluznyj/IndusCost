/**
 * Cliente HTTP — aba "Caixa" da Tesouraria.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_CAIXA_PATH } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryCaixaBoardDto } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";

export type TreasuryCaixaFetchParams = {
  year: number;
  month?: number;
  day?: number;
  signal?: AbortSignal;
};

export type TreasuryCaixaPayload = TreasuryCaixaBoardDto & {
  requestId?: string;
};

export function buildTreasuryCaixaUrl(params: TreasuryCaixaFetchParams): string {
  const qs = new URLSearchParams();
  qs.set("year", String(params.year));
  if (params.month != null) qs.set("month", String(params.month));
  if (params.day != null) qs.set("day", String(params.day));
  return `${TREASURY_CAIXA_PATH}?${qs.toString()}`;
}

export async function fetchTreasuryCaixa(
  params: TreasuryCaixaFetchParams
): Promise<TreasuryCaixaPayload> {
  return fetchJsonOk<TreasuryCaixaPayload>(buildTreasuryCaixaUrl(params), {
    signal: params.signal,
  });
}
