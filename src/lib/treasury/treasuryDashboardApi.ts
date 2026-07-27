/**
 * Cliente HTTP — dashboard diário da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_DASHBOARD_PATH,
  type TreasuryDashboardDto,
  type TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryDashboardFetchParams = {
  date?: string | null;
  accountIds?: string[] | null;
  scenario?: TreasuryProjectionLayer | string | null;
  signal?: AbortSignal;
};

export type TreasuryDashboardPayload = TreasuryDashboardDto & {
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

export function buildTreasuryDashboardUrl(
  params: TreasuryDashboardFetchParams
): string {
  const qs = new URLSearchParams();
  setIf(qs, "date", params.date?.trim());
  setIf(qs, "scenario", params.scenario?.trim());
  if (params.accountIds?.length) {
    qs.set("accountIds", params.accountIds.join(","));
  }
  const q = qs.toString();
  return q ? `${TREASURY_DASHBOARD_PATH}?${q}` : TREASURY_DASHBOARD_PATH;
}

export async function fetchTreasuryDashboard(
  params: TreasuryDashboardFetchParams = {}
): Promise<TreasuryDashboardPayload> {
  return fetchJsonOk<TreasuryDashboardPayload>(
    buildTreasuryDashboardUrl(params),
    { signal: params.signal }
  );
}
