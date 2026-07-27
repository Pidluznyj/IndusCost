/**
 * Regras puras de fechamento diário / reabertura (sem Prisma / sem I/O).
 * Fechamentos CLOSED/REOPENED são imutáveis; reabertura cria nova versão.
 */

import type { TreasuryClosingStatus } from "../contracts/treasuryEnums.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export type TreasuryDailyClosingIdentity = {
  id: string;
  companyCode: string;
  civilDate: string;
  version: number;
  status: TreasuryClosingStatus;
  sourceHash: string;
};

export function isTreasuryDailyClosingMutable(
  status: TreasuryClosingStatus
): boolean {
  return status === "OPEN";
}

export function assertTreasuryDailyClosingMutable(
  status: TreasuryClosingStatus,
  action: "update" | "delete" | "mutate_children" = "update"
): void {
  if (!isTreasuryDailyClosingMutable(status)) {
    throw new TreasuryDomainError(
      "CONFLICT",
      `Fechamento ${status} é imutável e não admite ${action}. Reabra para criar nova versão.`,
      "status"
    );
  }
}

export function assertTreasuryDailyClosingCanClose(
  status: TreasuryClosingStatus
): void {
  if (status !== "OPEN") {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Somente fechamento OPEN pode ser encerrado (CLOSED).",
      "status"
    );
  }
}

export function assertTreasuryDailyClosingCanReopen(
  status: TreasuryClosingStatus
): void {
  if (status !== "CLOSED") {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Somente fechamento CLOSED pode ser reaberto. A versão anterior permanece preservada.",
      "status"
    );
  }
}

export function assertTreasuryDailyClosingReopenReason(reason: string): void {
  if (!reason || !reason.trim()) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Motivo da reabertura é obrigatório.",
      "reason"
    );
  }
}

export type TreasuryDailyClosingReopenPlan = {
  previousClosingId: string;
  previousStatus: "REOPENED";
  nextVersion: number;
  newStatus: "OPEN";
  companyCode: string;
  civilDate: string;
  inheritSourceHash: string;
  reason: string;
};

/**
 * Planeja reabertura: versão anterior → REOPENED; nova versão OPEN = version+1.
 * Não altera o payload da versão anterior.
 */
export function planTreasuryDailyClosingReopen(input: {
  current: TreasuryDailyClosingIdentity;
  reason: string;
}): TreasuryDailyClosingReopenPlan {
  assertTreasuryDailyClosingCanReopen(input.current.status);
  assertTreasuryDailyClosingReopenReason(input.reason);
  if (input.current.version < 1) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Versão do fechamento inválida.",
      "version"
    );
  }
  return {
    previousClosingId: input.current.id,
    previousStatus: "REOPENED",
    nextVersion: input.current.version + 1,
    newStatus: "OPEN",
    companyCode: input.current.companyCode,
    civilDate: input.current.civilDate,
    inheritSourceHash: input.current.sourceHash,
    reason: input.reason.trim(),
  };
}

/** Campos financeiros do cabeçalho que nunca mudam após CLOSE (exceto via nova versão). */
export const TREASURY_DAILY_CLOSING_IMMUTABLE_PAYLOAD_FIELDS = [
  "companyCode",
  "civilDate",
  "version",
  "sourceHash",
  "contentHash",
  "openingBalance",
  "realizedInflows",
  "realizedOutflows",
  "pendenciesAmount",
  "closingBalance",
  "observedBalance",
  "reconciledBalance",
  "differenceAmount",
  "exceptionsCount",
  "exceptionsAmount",
  "caveatsCount",
  "previousClosingId",
  "createdByUserId",
  "closedByUserId",
  "closedAt",
] as const;
