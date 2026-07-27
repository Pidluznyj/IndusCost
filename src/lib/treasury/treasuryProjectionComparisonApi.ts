/**
 * Cliente HTTP — comparação de cenários de projeção (browser-safe).
 * Somente GET — não dispara recálculo.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_PROJECTIONS_COMPARE_PATH,
  type TreasuryProjectionComparisonDto,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryProjectionComparisonFetchParams = {
  companyCode: string;
  baseDate: string;
  endDate: string;
  accountIds?: string[] | null;
  consolidated?: boolean;
  signal?: AbortSignal;
};

export type TreasuryProjectionComparisonPayload =
  TreasuryProjectionComparisonDto & {
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

export function buildTreasuryProjectionCompareUrl(
  params: TreasuryProjectionComparisonFetchParams
): string {
  const qs = new URLSearchParams();
  setIf(qs, "companyCode", params.companyCode.trim());
  setIf(qs, "baseDate", params.baseDate.trim());
  setIf(qs, "endDate", params.endDate.trim());
  if (params.accountIds?.length) {
    qs.set("accountIds", params.accountIds.join(","));
  }
  if (params.consolidated != null) {
    qs.set("consolidated", params.consolidated ? "true" : "false");
  }
  const q = qs.toString();
  return q
    ? `${TREASURY_PROJECTIONS_COMPARE_PATH}?${q}`
    : TREASURY_PROJECTIONS_COMPARE_PATH;
}

export async function fetchTreasuryProjectionComparison(
  params: TreasuryProjectionComparisonFetchParams
): Promise<TreasuryProjectionComparisonPayload> {
  return fetchJsonOk<TreasuryProjectionComparisonPayload>(
    buildTreasuryProjectionCompareUrl(params),
    { signal: params.signal }
  );
}
