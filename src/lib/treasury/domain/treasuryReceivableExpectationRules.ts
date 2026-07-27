/**
 * Regras puras — alteração de expectativa operacional de CR.
 * Nunca toca vencimento oficial (`dueDate`).
 */

import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export type TreasuryReceivableExpectationPatch = {
  expectedDate?: string | null;
  plannedAccountId?: string | null;
  responsibleUserId?: string | null;
  priority?: string | null;
  nextAction?: string | null;
  reason?: string | null;
  notes?: string | null;
  expectedVersion: number;
};

export function assertReceivableNotCancelledForExpectation(
  official: OfficialReceivableView,
  complement: TreasuryTitleOperationalComplementRow | null
): void {
  if (official.cancellation.isCancelledOrRemovedFromSource) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Título cancelado/ausente na origem não permite alterar expectativa.",
      "titleId"
    );
  }
  if (
    complement?.status === "CANCELLED" ||
    complement?.cancelledAt != null
  ) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Complemento operacional cancelado não permite alterar expectativa.",
      "titleId"
    );
  }
}

export function assertReceivableHasOpenBalanceForExpectation(
  official: OfficialReceivableView
): void {
  const open = Number(official.openBalance ?? 0);
  if (!Number.isFinite(open) || open <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Somente títulos com saldo em aberto podem ter expectativa alterada.",
      "openBalance"
    );
  }
}

/** Justificativa obrigatória quando a data esperada muda. */
export function assertExpectationDateChangeJustified(input: {
  previousExpectedDate: string | null;
  nextExpectedDate: string | null | undefined;
  reason: string | null | undefined;
}): void {
  if (input.nextExpectedDate === undefined) return;
  const prev = input.previousExpectedDate ?? null;
  const next = input.nextExpectedDate ?? null;
  if (prev === next) return;
  const reason = input.reason?.trim() ?? "";
  if (!reason) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Motivo/justificativa é obrigatório ao alterar a data esperada.",
      "reason"
    );
  }
}

export function assertExpectationVersionMatch(input: {
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

/** Garante que o payload não tente mutar vencimento oficial. */
export function assertNoOfficialDueDateMutation(
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
