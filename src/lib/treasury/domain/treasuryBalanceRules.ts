/**
 * Regras puras de snapshots de saldo (Decimal string, sem Prisma).
 */

import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export type TreasuryBalanceComponentsInput = {
  availableBalance: string;
  blockedBalance?: string | null;
  investmentsBalance?: string | null;
  usedLimit?: string | null;
};

/**
 * Componentes calculados e expostos separadamente no DTO/API.
 *
 * - operationalAvailable = disponível livre (persistido em availableBalance)
 * - blocked / investments / usedLimit = componentes persistidos
 * - observed = available + blocked + investments (posição observada total)
 */
export type TreasuryBalanceSnapshotAmounts = {
  observedBalance: TreasuryMoneyString;
  operationalAvailableBalance: TreasuryMoneyString;
  blockedBalance: TreasuryMoneyString;
  investmentsBalance: TreasuryMoneyString;
  usedLimit: TreasuryMoneyString;
};

export function normalizeTreasuryBalanceComponents(
  input: TreasuryBalanceComponentsInput
): {
  availableBalance: TreasuryMoneyString;
  blockedBalance: TreasuryMoneyString;
  investmentsBalance: TreasuryMoneyString;
  usedLimit: TreasuryMoneyString;
} {
  try {
    return {
      availableBalance: normalizeTreasuryMoneyString(input.availableBalance),
      blockedBalance: normalizeTreasuryMoneyString(
        input.blockedBalance ?? "0"
      ),
      investmentsBalance: normalizeTreasuryMoneyString(
        input.investmentsBalance ?? "0"
      ),
      usedLimit: normalizeTreasuryMoneyString(input.usedLimit ?? "0"),
    };
  } catch {
    throw new TreasuryDomainError(
      "INVALID_MONEY",
      "Componente de saldo inválido (use string decimal com até 2 casas)."
    );
  }
}

export function computeTreasuryBalanceSnapshotAmounts(
  input: TreasuryBalanceComponentsInput
): TreasuryBalanceSnapshotAmounts {
  const parts = normalizeTreasuryBalanceComponents(input);
  const observedBalance = addTreasuryMoney(
    addTreasuryMoney(parts.availableBalance, parts.blockedBalance),
    parts.investmentsBalance
  );
  return {
    observedBalance,
    operationalAvailableBalance: parts.availableBalance,
    blockedBalance: parts.blockedBalance,
    investmentsBalance: parts.investmentsBalance,
    usedLimit: parts.usedLimit,
  };
}

export function assertTreasuryIdempotencyKey(value: string | null | undefined): string {
  const key = value?.trim() ?? "";
  if (!key) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Idempotency-Key é obrigatório para criar snapshot de saldo.",
      "idempotencyKey"
    );
  }
  if (key.length > 128) {
    throw new TreasuryDomainError(
      "PAYLOAD_TOO_LARGE",
      "Idempotency-Key excede 128 caracteres.",
      "idempotencyKey"
    );
  }
  return key;
}
