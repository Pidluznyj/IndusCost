/**
 * Cliente HTTP — CR/CP do Fluxo Gerencial agrupados por conta.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_PREDICTIVE_CRCP_BY_ACCOUNT_PATH } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryCrCpByAccountBoardDto } from "@/src/lib/treasury/domain/treasuryPredictiveCrCpByAccountRules.js";

export type TreasuryPredictiveCrCpByAccountFetchParams = {
  companyCode: string;
  fromDate: string;
  toDate: string;
  signal?: AbortSignal;
};

export type TreasuryPredictiveCrCpByAccountPayload =
  TreasuryCrCpByAccountBoardDto & {
    requestId?: string;
  };

export function buildTreasuryPredictiveCrCpByAccountUrl(
  params: TreasuryPredictiveCrCpByAccountFetchParams
): string {
  const qs = new URLSearchParams();
  qs.set("companyCode", params.companyCode.trim());
  qs.set("fromDate", params.fromDate.trim());
  qs.set("toDate", params.toDate.trim());
  return `${TREASURY_PREDICTIVE_CRCP_BY_ACCOUNT_PATH}?${qs.toString()}`;
}

export async function fetchTreasuryPredictiveCrCpByAccount(
  params: TreasuryPredictiveCrCpByAccountFetchParams
): Promise<TreasuryPredictiveCrCpByAccountPayload> {
  return fetchJsonOk<TreasuryPredictiveCrCpByAccountPayload>(
    buildTreasuryPredictiveCrCpByAccountUrl(params),
    { signal: params.signal }
  );
}
