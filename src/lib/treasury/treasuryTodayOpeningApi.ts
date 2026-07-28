/**
 * Cliente HTTP — saldos iniciais guiados (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_TODAY_OPENING_PATH,
  type TreasuryDailyOpeningDiffJustificationCode,
  type TreasuryGuidedDailyOpeningSaveResultDto,
  type TreasuryGuidedDailyOpeningWorkspaceDto,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryTodayOpeningSaveItem = {
  accountId: string;
  expectedVersion: number;
  confirmSuggested?: boolean;
  amount?: string | null;
  notes?: string | null;
  justificationCode?: TreasuryDailyOpeningDiffJustificationCode | null;
  justificationDetail?: string | null;
};

export type TreasuryTodayOpeningFetchParams = {
  date?: string | null;
  signal?: AbortSignal;
};

export type TreasuryTodayOpeningWorkspacePayload =
  TreasuryGuidedDailyOpeningWorkspaceDto & {
    requestId?: string;
  };

export type TreasuryTodayOpeningSavePayload =
  TreasuryGuidedDailyOpeningSaveResultDto & {
    requestId?: string;
  };

export function buildTreasuryTodayOpeningUrl(
  params: TreasuryTodayOpeningFetchParams = {}
): string {
  const qs = new URLSearchParams();
  if (params.date?.trim()) qs.set("date", params.date.trim());
  const q = qs.toString();
  return q ? `${TREASURY_TODAY_OPENING_PATH}?${q}` : TREASURY_TODAY_OPENING_PATH;
}

export async function fetchTreasuryTodayOpening(
  params: TreasuryTodayOpeningFetchParams = {}
): Promise<TreasuryTodayOpeningWorkspacePayload> {
  return fetchJsonOk<TreasuryTodayOpeningWorkspacePayload>(
    buildTreasuryTodayOpeningUrl(params),
    { signal: params.signal }
  );
}

export async function saveTreasuryTodayOpening(input: {
  civilDate?: string | null;
  items: TreasuryTodayOpeningSaveItem[];
  signal?: AbortSignal;
}): Promise<TreasuryTodayOpeningSavePayload> {
  return fetchJsonOk<TreasuryTodayOpeningSavePayload>(
    TREASURY_TODAY_OPENING_PATH,
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
