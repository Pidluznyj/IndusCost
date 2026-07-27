/**
 * Cliente HTTP — agenda financeira da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_AGENDA_PATH,
  type TreasuryAgendaDto,
  type TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryAgendaFetchParams = {
  companyCode: string;
  baseDate: string;
  endDate: string;
  scenario?: TreasuryProjectionLayer | string | null;
  accountIds?: string[] | null;
  consolidated?: boolean;
  includeDayDetail?: boolean;
  signal?: AbortSignal;
};

export type TreasuryAgendaPayload = TreasuryAgendaDto & {
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

export function buildTreasuryAgendaUrl(
  params: TreasuryAgendaFetchParams
): string {
  const qs = new URLSearchParams();
  setIf(qs, "companyCode", params.companyCode.trim());
  setIf(qs, "baseDate", params.baseDate.trim());
  setIf(qs, "endDate", params.endDate.trim());
  setIf(qs, "scenario", params.scenario?.toString().trim());
  if (params.accountIds?.length) {
    qs.set("accountIds", params.accountIds.join(","));
  }
  if (params.consolidated != null) {
    qs.set("consolidated", params.consolidated ? "true" : "false");
  }
  if (params.includeDayDetail != null) {
    qs.set("includeDayDetail", params.includeDayDetail ? "true" : "false");
  }
  const q = qs.toString();
  return q ? `${TREASURY_AGENDA_PATH}?${q}` : TREASURY_AGENDA_PATH;
}

export async function fetchTreasuryAgenda(
  params: TreasuryAgendaFetchParams
): Promise<TreasuryAgendaPayload> {
  return fetchJsonOk<TreasuryAgendaPayload>(buildTreasuryAgendaUrl(params), {
    signal: params.signal,
  });
}
