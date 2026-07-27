/**
 * Regras puras — programação de pagamentos (CP).
 * Não altera vencimento oficial (`dueDate`) nem saldo Nomus.
 */

import type { OfficialPayableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryPayableProgrammingImpactDto } from "../contracts/treasuryPayableContracts.js";
import type { TreasuryPayableProgrammingStatus } from "../contracts/treasuryEnums.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export function isTreasuryPayableProgrammingStatus(
  value: string | null | undefined
): value is TreasuryPayableProgrammingStatus {
  return value === "PROGRAMMED" || value === "AUTHORIZED";
}

export function resolveTreasuryPayableProgrammingStatus(
  nextAction: string | null | undefined
): TreasuryPayableProgrammingStatus {
  return nextAction === "AUTHORIZED" ? "AUTHORIZED" : "PROGRAMMED";
}

export function hasActiveLocalPayableProgramming(
  complement: TreasuryTitleOperationalComplementRow | null
): boolean {
  if (!complement) return false;
  if (complement.status === "CANCELLED" || complement.cancelledAt) return false;
  return Boolean(complement.scheduledDate || complement.scheduledAmount);
}

export function assertPayableAllowsProgramming(
  official: OfficialPayableView,
  complement: TreasuryTitleOperationalComplementRow | null
): void {
  if (official.cancellation.isCancelledOrRemovedFromSource) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Título cancelado/ausente na origem não permite programação.",
      "titleId"
    );
  }
  if (complement?.status === "CANCELLED" || complement?.cancelledAt) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Complemento operacional cancelado não permite programação.",
      "titleId"
    );
  }
  const open = normalizeTreasuryMoneyString(official.openBalance ?? "0.00");
  if (compareTreasuryMoney(open, "0.00") <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Somente títulos com saldo em aberto permitem programação.",
      "openBalance"
    );
  }
}

export function assertPayableProgrammingVersionMatch(input: {
  expectedVersion: number;
  actualVersion: number | null;
}): void {
  const actual = input.actualVersion ?? 0;
  if (input.expectedVersion !== actual) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão do complemento desatualizada.",
      "expectedVersion"
    );
  }
}

/** Parcial permitido; acima do saldo aberto exige justificativa. */
export function assertPayableProgrammingAmountAllowed(input: {
  scheduledAmount: string;
  openBalance: string | null;
  justification?: string | null;
}): void {
  const amount = normalizeTreasuryMoneyString(input.scheduledAmount);
  if (compareTreasuryMoney(amount, "0.00") <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor programado deve ser maior que zero.",
      "scheduledAmount"
    );
  }
  const open = normalizeTreasuryMoneyString(input.openBalance ?? "0.00");
  if (compareTreasuryMoney(amount, open) <= 0) return;
  const justification = input.justification?.trim() ?? "";
  if (!justification) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Justificativa é obrigatória para programar valor acima do saldo em aberto.",
      "justification"
    );
  }
}

export function assertNoOfficialDueDateInProgrammingBody(
  body: Record<string, unknown>
): void {
  if (
    Object.prototype.hasOwnProperty.call(body, "dueDate") ||
    Object.prototype.hasOwnProperty.call(body, "vencimento") ||
    Object.prototype.hasOwnProperty.call(body, "officialDueDate")
  ) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Vencimento oficial não pode ser alterado pela Tesouraria.",
      "dueDate"
    );
  }
}

export function computeTreasuryPayableProgrammingImpact(input: {
  accountId: string;
  accountBalanceBefore: string;
  consolidatedBalanceBefore: string;
  scheduledAmount: string;
  accountIncludedInConsolidated: boolean;
}): TreasuryPayableProgrammingImpactDto {
  const scheduledAmount = normalizeTreasuryMoneyString(input.scheduledAmount);
  const accountBalanceBefore = normalizeTreasuryMoneyString(
    input.accountBalanceBefore
  );
  const consolidatedBalanceBefore = normalizeTreasuryMoneyString(
    input.consolidatedBalanceBefore
  );
  const accountBalanceAfter = addTreasuryMoney(
    accountBalanceBefore,
    negateTreasuryMoney(scheduledAmount)
  );
  const consolidatedBalanceAfter = input.accountIncludedInConsolidated
    ? addTreasuryMoney(
        consolidatedBalanceBefore,
        negateTreasuryMoney(scheduledAmount)
      )
    : consolidatedBalanceBefore;

  const createsNegativeAccountBalance =
    compareTreasuryMoney(accountBalanceAfter, "0.00") < 0;
  const createsNegativeConsolidatedBalance =
    compareTreasuryMoney(consolidatedBalanceAfter, "0.00") < 0;

  const alerts: string[] = [];
  if (createsNegativeAccountBalance) {
    alerts.push(
      "Programação projetaria saldo negativo na conta pagadora."
    );
  }
  if (createsNegativeConsolidatedBalance) {
    alerts.push(
      "Programação projetaria saldo negativo no consolidado."
    );
  }

  return {
    accountId: input.accountId,
    accountBalanceBefore,
    accountBalanceAfter,
    consolidatedBalanceBefore,
    consolidatedBalanceAfter,
    scheduledAmount,
    accountIncludedInConsolidated: input.accountIncludedInConsolidated,
    createsNegativeAccountBalance,
    createsNegativeConsolidatedBalance,
    alerts,
  };
}
