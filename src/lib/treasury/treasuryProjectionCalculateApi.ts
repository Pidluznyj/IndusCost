/**
 * Client API — cálculo on-demand de projeção.
 */

import { TREASURY_PROJECTIONS_PATH } from "./contracts/treasuryContracts.js";
import type { TreasuryProjectionLayer } from "./contracts/treasuryEnums.js";

export type TreasuryProjectionCalculateInput = {
  companyCode: string;
  baseDate: string;
  endDate: string;
  scenario?: TreasuryProjectionLayer;
  accountIds?: string[] | null;
  consolidated?: boolean;
  includeDayDetail?: boolean;
};

export type TreasuryProjectionCalculateResult = {
  id: string;
  status: string;
  scenario: string;
  algorithmVersion: string;
  sourceVersion: string;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error =
      typeof body.error === "string"
        ? body.error
        : `Erro HTTP ${res.status}`;
    const err = new Error(error) as Error & {
      status?: number;
      code?: string;
    };
    err.status = res.status;
    if (typeof body.code === "string") err.code = body.code;
    throw err;
  }
  return body;
}

export async function calculateTreasuryProjection(
  input: TreasuryProjectionCalculateInput
): Promise<TreasuryProjectionCalculateResult> {
  const res = await fetch(`${TREASURY_PROJECTIONS_PATH}/calculate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyCode: input.companyCode,
      baseDate: input.baseDate,
      endDate: input.endDate,
      scenario: input.scenario ?? "PROBABLE",
      accountIds: input.accountIds ?? null,
      consolidated: input.consolidated ?? true,
      includeDayDetail: input.includeDayDetail ?? false,
    }),
  });
  const body = await parseJson(res);
  return {
    id: String(body.id ?? ""),
    status: String(body.status ?? ""),
    scenario: String(body.scenario ?? input.scenario ?? "PROBABLE"),
    algorithmVersion: String(body.algorithmVersion ?? ""),
    sourceVersion: String(body.sourceVersion ?? ""),
  };
}
