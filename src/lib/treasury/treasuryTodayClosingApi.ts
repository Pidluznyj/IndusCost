/**
 * Cliente HTTP — saldos finais guiados (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_TODAY_CLOSING_PATH,
  type TreasuryGuidedDailyClosingSaveResultDto,
  type TreasuryGuidedDailyClosingWorkspaceDto,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryTodayClosingSaveItem = {
  accountId: string;
  expectedVersion: number;
  amount: string;
  notes?: string | null;
};

export type TreasuryTodayClosingFetchParams = {
  date?: string | null;
  signal?: AbortSignal;
};

export type TreasuryTodayClosingWorkspacePayload =
  TreasuryGuidedDailyClosingWorkspaceDto & {
    requestId?: string;
  };

export type TreasuryTodayClosingSavePayload =
  TreasuryGuidedDailyClosingSaveResultDto & {
    requestId?: string;
  };

export function buildTreasuryTodayClosingUrl(
  params: TreasuryTodayClosingFetchParams = {}
): string {
  const qs = new URLSearchParams();
  if (params.date?.trim()) qs.set("date", params.date.trim());
  const q = qs.toString();
  return q ? `${TREASURY_TODAY_CLOSING_PATH}?${q}` : TREASURY_TODAY_CLOSING_PATH;
}

export async function fetchTreasuryTodayClosing(
  params: TreasuryTodayClosingFetchParams = {}
): Promise<TreasuryTodayClosingWorkspacePayload> {
  return fetchJsonOk<TreasuryTodayClosingWorkspacePayload>(
    buildTreasuryTodayClosingUrl(params),
    { signal: params.signal }
  );
}

export async function saveTreasuryTodayClosing(input: {
  civilDate?: string | null;
  items: TreasuryTodayClosingSaveItem[];
  signal?: AbortSignal;
}): Promise<TreasuryTodayClosingSavePayload> {
  return fetchJsonOk<TreasuryTodayClosingSavePayload>(
    TREASURY_TODAY_CLOSING_PATH,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        civilDate: input.civilDate,
        items: input.items,
      }),
      signal: input.signal,
    }
  );
}
