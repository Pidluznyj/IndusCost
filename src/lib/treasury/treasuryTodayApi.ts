/**
 * Cliente HTTP — Tesouraria de hoje (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_TODAY_PATH,
  type TreasuryGuidedTodayDto,
  type TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryTodayFetchParams = {
  date?: string | null;
  accountIds?: string[] | null;
  scenario?: TreasuryProjectionLayer | string | null;
  signal?: AbortSignal;
};

export type TreasuryTodayPayload = TreasuryGuidedTodayDto & {
  requestId?: string;
};

function setIf(
  qs: URLSearchParams,
  key: string,
  value: string | number | null | undefined
) {
  if (value == null || value === "") return;
  qs.set(key, String(value));
}

export function buildTreasuryTodayUrl(
  params: TreasuryTodayFetchParams = {}
): string {
  const qs = new URLSearchParams();
  setIf(qs, "date", params.date?.trim());
  setIf(qs, "scenario", params.scenario?.trim());
  if (params.accountIds?.length) {
    qs.set("accountIds", params.accountIds.join(","));
  }
  const q = qs.toString();
  return q ? `${TREASURY_TODAY_PATH}?${q}` : TREASURY_TODAY_PATH;
}

export async function fetchTreasuryToday(
  params: TreasuryTodayFetchParams = {}
): Promise<TreasuryTodayPayload> {
  return fetchJsonOk<TreasuryTodayPayload>(buildTreasuryTodayUrl(params), {
    signal: params.signal,
  });
}
