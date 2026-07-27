/**
 * Regras puras — promessas de pagamento da Tesouraria.
 * Nunca toca vencimento oficial (`dueDate`).
 */

import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryPromiseStatus } from "../contracts/treasuryEnums.js";
import { TREASURY_ACTIVE_PROMISE_STATUSES } from "../contracts/treasuryEnums.js";
import type { TreasuryPaymentPromiseRow } from "../mappers/treasuryPaymentPromiseMappers.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export function assertNoOfficialDueDateInPromiseBody(
  body: Record<string, unknown>
): void {
  if (
    Object.prototype.hasOwnProperty.call(body, "dueDate") ||
    Object.prototype.hasOwnProperty.call(body, "vencimento") ||
    Object.prototype.hasOwnProperty.call(body, "officialDueDate")
  ) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Promessa não pode alterar o vencimento oficial.",
      "dueDate"
    );
  }
}

export function assertReceivableAllowsPromise(
  official: OfficialReceivableView
): void {
  if (official.cancellation.isCancelledOrRemovedFromSource) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Título cancelado/ausente na origem não permite promessa.",
      "titleId"
    );
  }
  const open = Number(official.openBalance ?? 0);
  if (!Number.isFinite(open) || open <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Somente títulos com saldo em aberto permitem promessa.",
      "openBalance"
    );
  }
}

/** Promessa parcial é permitida; acima do saldo exige confirmação + justificativa. */
export function assertPromiseAmountAllowed(input: {
  promisedAmount: string;
  openBalance: string | null;
  confirmAboveBalance?: boolean;
  justification?: string | null;
}): void {
  const promised = normalizeTreasuryMoneyString(input.promisedAmount);
  if (compareTreasuryMoney(promised, "0.00") <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor prometido deve ser maior que zero.",
      "promisedAmount"
    );
  }
  const open = normalizeTreasuryMoneyString(input.openBalance ?? "0.00");
  if (compareTreasuryMoney(promised, open) <= 0) return;
  if (!input.confirmAboveBalance) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Promessa acima do saldo em aberto exige confirmação explícita.",
      "confirmAboveBalance"
    );
  }
  const justification = input.justification?.trim() ?? "";
  if (!justification) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Justificativa é obrigatória para promessa acima do saldo.",
      "justification"
    );
  }
}

export function assertPromiseVersionMatch(input: {
  expectedVersion: number;
  actualVersion: number;
}): void {
  if (input.expectedVersion !== input.actualVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão da promessa desatualizada.",
      "expectedVersion"
    );
  }
}

export function assertPromiseCancellable(
  row: TreasuryPaymentPromiseRow
): void {
  if (row.status === "CANCELLED" || row.cancelledAt) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Promessa já está cancelada.",
      "promiseId"
    );
  }
  if (row.status === "FULFILLED") {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Promessa cumprida não pode ser cancelada.",
      "promiseId"
    );
  }
}

export function assertPromiseFulfillable(
  row: TreasuryPaymentPromiseRow
): void {
  if (
    row.status === "CANCELLED" ||
    row.status === "EXPIRED" ||
    row.status === "BROKEN" ||
    row.cancelledAt
  ) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Promessa neste status não pode ser cumprida.",
      "promiseId"
    );
  }
  if (row.status === "FULFILLED") {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Promessa já está cumprida.",
      "promiseId"
    );
  }
}

export function isActivePromiseStatus(status: TreasuryPromiseStatus): boolean {
  return (TREASURY_ACTIVE_PROMISE_STATUSES as readonly string[]).includes(
    status
  );
}

export function shouldExpirePromise(input: {
  status: TreasuryPromiseStatus;
  promisedDate: string;
  fulfilledAmount: string;
  promisedAmount: string;
  todayCivilDate: string;
}): boolean {
  if (!isActivePromiseStatus(input.status)) return false;
  if (compareTreasuryMoney(input.fulfilledAmount, input.promisedAmount) >= 0) {
    return false;
  }
  return input.promisedDate < input.todayCivilDate;
}

export function resolveFulfillmentStatus(input: {
  promisedAmount: string;
  nextFulfilledAmount: string;
}): TreasuryPromiseStatus {
  const promised = normalizeTreasuryMoneyString(input.promisedAmount);
  const fulfilled = normalizeTreasuryMoneyString(input.nextFulfilledAmount);
  if (compareTreasuryMoney(fulfilled, "0.00") < 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor cumprido não pode ser negativo.",
      "fulfilledAmount"
    );
  }
  if (compareTreasuryMoney(fulfilled, promised) >= 0) return "FULFILLED";
  if (compareTreasuryMoney(fulfilled, "0.00") > 0) return "PARTIALLY_FULFILLED";
  return "ACTIVE";
}

export function resolveNextFulfilledAmount(input: {
  currentFulfilled: string;
  incrementOrTotal: string | null | undefined;
  promisedAmount: string;
  mode: "set" | "add";
}): string {
  const promised = normalizeTreasuryMoneyString(input.promisedAmount);
  if (input.incrementOrTotal == null || input.incrementOrTotal === "") {
    return promised;
  }
  const value = normalizeTreasuryMoneyString(input.incrementOrTotal);
  if (input.mode === "set") {
    if (compareTreasuryMoney(value, promised) > 0) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Valor cumprido não pode exceder o valor prometido.",
        "fulfilledAmount"
      );
    }
    return value;
  }
  // add mode unused for now — mark-fulfilled uses set or full
  return value;
}
