/**
 * Regras puras — contestações (CR).
 * Contestação não altera openBalance/dueDate oficiais do Nomus.
 */

import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryDisputeStatus } from "../contracts/treasuryEnums.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export function assertReceivableAllowsDispute(
  official: OfficialReceivableView
): void {
  if (official.cancellation.isCancelledOrRemovedFromSource) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Título cancelado/ausente não permite contestação.",
      "titleId"
    );
  }
}

/**
 * Body de criação/atualização não pode carregar mutação de saldo/vencimento oficiais.
 */
export function assertDisputeDoesNotMutateOfficialTitleFields(
  body: Record<string, unknown>
): void {
  for (const key of [
    "openBalance",
    "balanceReceivable",
    "officialDueDate",
    "vencimento",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Contestação não altera saldo ou vencimento oficial do título.",
        key
      );
    }
  }
}

export function assertDisputeAmountAllowed(input: {
  amountDisputed: string | null | undefined;
  openBalance: string | null;
}): void {
  if (input.amountDisputed == null || input.amountDisputed === "") return;
  const disputed = normalizeTreasuryMoneyString(input.amountDisputed);
  if (compareTreasuryMoney(disputed, "0.00") <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor contestado deve ser maior que zero.",
      "amountDisputed"
    );
  }
  const open = normalizeTreasuryMoneyString(input.openBalance ?? "0.00");
  if (compareTreasuryMoney(disputed, open) > 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor contestado não pode exceder o saldo em aberto oficial.",
      "amountDisputed"
    );
  }
}

export function assertDisputeStatusTransition(input: {
  from: TreasuryDisputeStatus;
  to: TreasuryDisputeStatus;
}): void {
  if (input.from === input.to) return;
  if (input.from === "CANCELLED") {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Contestação cancelada é terminal.",
      "status"
    );
  }
  if (input.from === "RESOLVED" && input.to === "OPEN") {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Contestação resolvida não pode reabrir para OPEN.",
      "status"
    );
  }
  if (input.from === "OPEN" && (input.to === "RESOLVED" || input.to === "CANCELLED")) {
    return;
  }
  if (input.from === "RESOLVED" && input.to === "CANCELLED") {
    return;
  }
  throw new TreasuryDomainError(
    "VALIDATION_ERROR",
    `Transição de contestação inválida: ${input.from} → ${input.to}.`,
    "status"
  );
}
