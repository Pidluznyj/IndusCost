/**
 * Client API — conciliações bancárias (accept / unmatch / reverse / listagem).
 */

import {
  TREASURY_RECONCILIATIONS_PATH,
  TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE,
  todayTreasuryCivilDateInSaoPaulo,
} from "./contracts/treasuryContracts.js";
import type { TreasuryReconciliationMatchDto } from "./contracts/treasuryDto.js";

export { TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE };

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
      field?: string;
    };
    err.status = res.status;
    if (typeof body.code === "string") err.code = body.code;
    if (typeof body.field === "string") err.field = body.field;
    throw err;
  }
  return body;
}

export async function fetchTreasuryActiveReconciliationsByMovement(
  bankMovementId: string
): Promise<TreasuryReconciliationMatchDto[]> {
  const qs = new URLSearchParams({ bankMovementId });
  const res = await fetch(`${TREASURY_RECONCILIATIONS_PATH}?${qs.toString()}`, {
    credentials: "include",
  });
  const body = await parseJson(res);
  return (body.items as TreasuryReconciliationMatchDto[]) ?? [];
}

export async function acceptTreasuryReconciliation(input: {
  companyCode: string;
  accountId: string;
  matchedCivilDate?: string;
  justification?: string | null;
  /** Duplo clique com a mesma chave devolve o match anterior (CASH-SUPPORT-P0-CONCURRENCY-001). */
  idempotencyKey?: string | null;
  movements: Array<{ bankMovementId: string; amount: string }>;
  allocations: Array<{
    kind: string;
    amount: string;
    memo?: string | null;
    nomusSide?: string | null;
    officialTitleId?: string | null;
    nomusExternalId?: number | null;
    openBalance?: string | null;
    transferId?: string | null;
    transferGroupId?: string | null;
    ledgerEntryId?: string | null;
    differenceCode?: string | null;
  }>;
}): Promise<{
  match: TreasuryReconciliationMatchDto;
  projectionRecalc: unknown;
}> {
  const res = await fetch(TREASURY_RECONCILIATIONS_PATH, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyCode: input.companyCode,
      accountId: input.accountId,
      matchedCivilDate:
        input.matchedCivilDate ?? todayTreasuryCivilDateInSaoPaulo(),
      justification: input.justification ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      movements: input.movements,
      allocations: input.allocations,
    }),
  });
  const body = await parseJson(res);
  return {
    match: body.match as TreasuryReconciliationMatchDto,
    projectionRecalc: body.projectionRecalc,
  };
}

export async function unmatchTreasuryReconciliation(input: {
  matchId: string;
  expectedVersion: number;
  reason: string;
}): Promise<{
  match: TreasuryReconciliationMatchDto;
  projectionRecalc: unknown;
}> {
  const res = await fetch(
    `${TREASURY_RECONCILIATIONS_PATH}/${encodeURIComponent(input.matchId)}/unmatch`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    }
  );
  const body = await parseJson(res);
  return {
    match: body.match as TreasuryReconciliationMatchDto,
    projectionRecalc: body.projectionRecalc,
  };
}

export async function reverseTreasuryReconciliation(input: {
  matchId: string;
  expectedVersion: number;
  reason: string;
  confirmPhrase: string;
}): Promise<{
  match: TreasuryReconciliationMatchDto;
  projectionRecalc: unknown;
  postClosing: unknown;
}> {
  const res = await fetch(
    `${TREASURY_RECONCILIATIONS_PATH}/${encodeURIComponent(input.matchId)}/reverse`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        confirmPhrase: input.confirmPhrase,
      }),
    }
  );
  const body = await parseJson(res);
  return {
    match: body.match as TreasuryReconciliationMatchDto,
    projectionRecalc: body.projectionRecalc,
    postClosing: body.postClosing ?? null,
  };
}
