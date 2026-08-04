/**
 * Cliente HTTP — GET /api/treasury/caixa/scenarios (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_CAIXA_SCENARIOS_PATH } from "@/src/lib/treasury/contracts/index.js";
import type {
  TreasuryScenarioComputationResult,
  TreasuryScenarioSummary,
} from "./domain/treasuryCaixaScenariosTypes.js";
import type { TreasuryScenarioPolicyDto } from "./contracts/treasuryScenarioPolicyContracts.js";

export type TreasuryCaixaScenariosFetchParams = {
  asOfCivilDate?: string | null;
  horizonDays?: number | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  signal?: AbortSignal;
};

export type TreasuryCaixaScenariosPayload = TreasuryScenarioComputationResult & {
  period: { year: number; month?: number; day?: number };
  dueDateFrom: string;
  dueDateTo: string;
  policy: TreasuryScenarioPolicyDto;
  accountIds: string[] | null;
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

export function buildTreasuryCaixaScenariosUrl(
  params: TreasuryCaixaScenariosFetchParams
): string {
  const qs = new URLSearchParams();
  setIf(qs, "asOfCivilDate", params.asOfCivilDate ?? null);
  setIf(qs, "horizonDays", params.horizonDays ?? null);
  setIf(qs, "year", params.year ?? null);
  setIf(qs, "month", params.month ?? null);
  setIf(qs, "day", params.day ?? null);
  const q = qs.toString();
  return q ? `${TREASURY_CAIXA_SCENARIOS_PATH}?${q}` : TREASURY_CAIXA_SCENARIOS_PATH;
}

export async function fetchTreasuryCaixaScenarios(
  params: TreasuryCaixaScenariosFetchParams
): Promise<TreasuryCaixaScenariosPayload> {
  return fetchJsonOk<TreasuryCaixaScenariosPayload>(
    buildTreasuryCaixaScenariosUrl(params),
    { signal: params.signal }
  );
}

export type { TreasuryScenarioSummary };
