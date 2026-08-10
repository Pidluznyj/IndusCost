/**
 * Orquestração client-safe — confirma match / cria ledger a partir do OFX.
 * Reusa APIs existentes; sem auto-match; sem mutação Nomus.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_LEDGER_ENTRIES_PATH,
  todayTreasuryCivilDateInSaoPaulo,
  type TreasuryLedgerEntryDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  mapTreasurySimpleOfxUnidentifiedToAllocationKind,
  resolveTreasurySimpleOfxLedgerDirection,
  type TreasurySimpleOfxUnidentifiedOption,
} from "./domain/treasurySimpleOfxInvestigationRules.js";
import {
  acceptTreasuryReconciliation,
  unmatchTreasuryReconciliation,
} from "./treasuryReconciliationApi.js";

export async function confirmTreasurySimpleOfxTitleMatch(input: {
  companyCode: string;
  accountId: string;
  bankMovementId: string;
  amount: string;
  matchedCivilDate: string;
  allocations: {
    officialTitleId: string;
    nomusExternalId?: number | null;
    nomusSide: "RECEIVABLE" | "PAYABLE";
    amount: string;
    openBalance?: string | null;
  }[];
  justification?: string | null;
}): Promise<void> {
  await acceptTreasuryReconciliation({
    companyCode: input.companyCode,
    accountId: input.accountId,
    matchedCivilDate: input.matchedCivilDate,
    justification:
      input.justification ?? "Correspondência confirmada no assistente simples",
    movements: [
      { bankMovementId: input.bankMovementId, amount: input.amount },
    ],
    allocations: input.allocations.map(a => ({
      kind: "TITLE",
      amount: a.amount,
      officialTitleId: a.officialTitleId,
      nomusExternalId: a.nomusExternalId ?? null,
      nomusSide: a.nomusSide,
      openBalance: a.openBalance ?? null,
      memo: "Título confirmado pelo usuário",
    })),
  });
}

export async function createTreasurySimpleOfxManualFromMovement(input: {
  companyCode: string;
  accountId: string;
  bankMovementId: string;
  amount: string;
  movementDirection: "DEBIT" | "CREDIT" | string;
  postedCivilDate: string;
  option: TreasurySimpleOfxUnidentifiedOption;
  memo?: string | null;
}): Promise<{ ledgerEntryId: string }> {
  const kind = mapTreasurySimpleOfxUnidentifiedToAllocationKind(input.option);
  const direction = resolveTreasurySimpleOfxLedgerDirection(
    input.option,
    input.movementDirection
  );
  const memo =
    input.memo?.trim() ||
    `OFX ${input.bankMovementId} — lançamento confirmado pelo usuário`;

  const created = await fetchJsonOk<{
    ok: true;
    entry: TreasuryLedgerEntryDto;
  }>(TREASURY_LEDGER_ENTRIES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: input.accountId,
      civilDate: input.postedCivilDate || todayTreasuryCivilDateInSaoPaulo(),
      amount: input.amount,
      direction,
      nature: "MANUAL",
      memo,
      counterpartRef: `ofx:${input.bankMovementId}`,
    }),
  });

  await acceptTreasuryReconciliation({
    companyCode: input.companyCode,
    accountId: input.accountId,
    matchedCivilDate:
      input.postedCivilDate || todayTreasuryCivilDateInSaoPaulo(),
    justification: `Lançamento manual a partir do OFX (${input.option})`,
    movements: [
      { bankMovementId: input.bankMovementId, amount: input.amount },
    ],
    allocations: [
      {
        kind,
        amount: input.amount,
        ledgerEntryId: created.entry.id,
        memo,
      },
    ],
  });

  return { ledgerEntryId: created.entry.id };
}

export async function undoTreasurySimpleOfxMatch(input: {
  matchId: string;
  expectedVersion: number;
  reason?: string | null;
}): Promise<void> {
  await unmatchTreasuryReconciliation({
    matchId: input.matchId,
    expectedVersion: input.expectedVersion,
    reason:
      input.reason?.trim() ||
      "Desfazer correspondência no assistente simples",
  });
}
