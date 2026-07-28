/**
 * Regras puras de lançamentos manuais no ledger local.
 * Não muta títulos oficiais Nomus; sem exclusão física.
 */

import type {
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerStatus,
} from "../contracts/treasuryEnums.js";
import { treasuryMoneyToCents } from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export function assertTreasuryManualLedgerAmountPositive(amount: string): void {
  if (treasuryMoneyToCents(amount) <= 0n) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor do lançamento deve ser positivo.",
      "amount"
    );
  }
}

export function assertTreasuryManualLedgerCreateable(input: {
  amount: string;
  nature: TreasuryLedgerNature;
}): void {
  assertTreasuryManualLedgerAmountPositive(input.amount);
  if (input.nature !== "MANUAL" && input.nature !== "ADJUSTMENT") {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "API de lançamento manual aceita apenas nature MANUAL ou ADJUSTMENT.",
      "nature"
    );
  }
}

export function oppositeTreasuryLedgerDirection(
  direction: TreasuryLedgerDirection
): TreasuryLedgerDirection {
  return direction === "DEBIT" ? "CREDIT" : "DEBIT";
}

export function assertTreasuryManualLedgerReversible(input: {
  status: TreasuryLedgerStatus;
  nature: TreasuryLedgerNature;
  expectedVersion: number;
  currentVersion: number;
}): void {
  if (input.status !== "ACTIVE") {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Somente lançamentos ACTIVE podem ser revertidos.",
      "status"
    );
  }
  if (input.nature === "REVERSAL") {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Lançamento de reversão não pode ser revertido novamente.",
      "nature"
    );
  }
  if (input.currentVersion !== input.expectedVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão do lançamento desatualizada. Recarregue e tente novamente.",
      "expectedVersion"
    );
  }
}

/** Garante que o lançamento não simula baixa oficial Nomus. */
export function assertTreasuryManualLedgerNotOfficialSettlement(input: {
  counterpartRef: string | null;
  memo: string | null;
}): void {
  const blob = `${input.counterpartRef ?? ""} ${input.memo ?? ""}`.toLowerCase();
  if (blob.includes("baixa nomus") || blob.includes("settlement-official")) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Lançamento manual não pode simular baixa oficial Nomus.",
      "memo"
    );
  }
}
