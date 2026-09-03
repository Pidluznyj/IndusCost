/**
 * Domínio — leitura leve do saldo inicial/final de UMA conta em UMA data civil.
 *
 * Este módulo NÃO cria regra financeira nova: só reprojeta, para uma única
 * conta, exatamente o que os workspaces guiados já expõem por conta:
 *
 * - `opening.amount`      ≡ `currentOpeningBalance` (workspace de abertura)
 * - `opening.suggested`   ≡ `suggestedOpeningBalance` (mesma sugestão canônica)
 * - `opening.expectedVersion` ≡ `expectedVersion` do workspace de abertura
 * - `closing.amount`      ≡ `informedClosingBalance` (workspace de fechamento)
 * - `closing.expectedVersion` ≡ `expectedVersion` do workspace de fechamento
 *   (contador compartilhado da rotina: max(abertura, fechamento bancário))
 *
 * Sem CR/CP, sem preview, sem ledger, sem transferências, sem previsão: nada
 * disso participa da resposta “qual saldo já está gravado nesta conta/data?”.
 */

import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryAccountDailyBalanceDto,
  TreasuryAccountDailyBalanceRoutineKind,
} from "../contracts/treasuryDto.js";
import type { TreasuryMoneyString } from "../treasuryMoney.js";
import {
  parseTreasuryDailyRoutineSnapshotKey,
  resolveTreasuryDailyRoutineExpectedVersion,
  suggestTreasuryDailyOpeningBalance,
} from "./treasuryDailyAccountRoutineRules.js";

/** Snapshot bruto de rotina diária (origem MANUAL, não cancelado). */
export type TreasuryDailyRoutineSnapshotRow = {
  idempotencyKey: string;
  amount: TreasuryMoneyString;
};

export type TreasuryAccountDailyBalanceSeed = {
  accountId: string;
  accountCode: string;
  accountName: string;
  bank: string | null;
  isActive: boolean;
  civilDate: TreasuryCivilDate;
  /** Snapshots `daily-opening:<data>:v*` da conta, mais recentes primeiro. */
  openingSnapshots: readonly TreasuryDailyRoutineSnapshotRow[];
  /** Snapshots `daily-closing-bank:<data>:v*` da conta, mais recentes primeiro. */
  closingSnapshots: readonly TreasuryDailyRoutineSnapshotRow[];
  /** Último fechamento formal CLOSED anterior à data (sugestão de abertura). */
  previousClosedPosition: {
    closingId: string;
    civilDate: string;
    observedBalance: string;
  } | null;
};

/**
 * Resolve o saldo/versão vigentes de uma rotina a partir dos snapshots da
 * conta/data. Mesma leitura dos workspaces: percorre do mais recente para o
 * mais antigo e usa o primeiro cuja chave idempotente é válida para a rotina
 * e a data pedidas (chave inválida/de outra rotina é ignorada, não aborta).
 */
export function resolveTreasuryDailyRoutineBalance(input: {
  snapshots: readonly TreasuryDailyRoutineSnapshotRow[];
  civilDate: TreasuryCivilDate;
  kind: TreasuryAccountDailyBalanceRoutineKind;
}): { amount: TreasuryMoneyString; version: number } | null {
  for (const row of input.snapshots) {
    const parsed = parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey);
    if (!parsed) continue;
    if (parsed.kind !== input.kind) continue;
    if (parsed.civilDate !== input.civilDate) continue;
    return { amount: row.amount, version: parsed.version };
  }
  return null;
}

export function buildTreasuryAccountDailyBalanceDto(
  seed: TreasuryAccountDailyBalanceSeed
): TreasuryAccountDailyBalanceDto {
  const opening = resolveTreasuryDailyRoutineBalance({
    snapshots: seed.openingSnapshots,
    civilDate: seed.civilDate,
    kind: "opening",
  });
  const closingBank = resolveTreasuryDailyRoutineBalance({
    snapshots: seed.closingSnapshots,
    civilDate: seed.civilDate,
    kind: "closingBank",
  });

  const suggestion = suggestTreasuryDailyOpeningBalance({
    accountIsActive: seed.isActive,
    previousClosedPosition: seed.previousClosedPosition,
  });

  return {
    ok: true,
    accountId: seed.accountId,
    accountCode: seed.accountCode,
    accountName: seed.accountName,
    bank: seed.bank,
    isActive: seed.isActive,
    civilDate: seed.civilDate,
    opening: {
      exists: opening != null,
      amount: opening?.amount ?? null,
      suggestedBalance: suggestion.suggestedAmount,
      requiresManualInput: suggestion.requiresManualInput,
      expectedVersion: opening?.version ?? 0,
    },
    closing: {
      exists: closingBank != null,
      amount: closingBank?.amount ?? null,
      expectedVersion: resolveTreasuryDailyRoutineExpectedVersion({
        opening,
        closingBank,
      }),
    },
  };
}
