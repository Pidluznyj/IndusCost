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

/**
 * Valida hash do preview no momento do fechamento.
 * Fonte mudou → CONFLICT (HTTP 409).
 */
export function assertTreasuryDailyClosingPreviewHashMatch(
  previewSourceHash: string,
  submittedSourceHash: string
): void {
  if (previewSourceHash.trim() !== submittedSourceHash.trim()) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Hash da fonte divergente do preview. Recarregue o preview e tente novamente.",
      "sourceHash"
    );
  }
}

export type TreasuryDailyClosingCaveatInput = {
  code: string;
  message: string;
};

/**
 * Valida se o preview permite fechar e se as ressalvas cobrem pendências exigidas.
 */
export function assertTreasuryDailyClosingReadyToClose(input: {
  canCloseWithCaveats: boolean;
  canCloseWithoutCaveats: boolean;
  absoluteBlockCodes: string[];
  requiredCaveatCodes: string[];
  caveats: TreasuryDailyClosingCaveatInput[];
}): void {
  if (input.absoluteBlockCodes.includes("DAY_ALREADY_CLOSED")) {
    throw new TreasuryDomainError(
      "DAY_CLOSED",
      "Dia já fechado. Reabra para criar nova versão.",
      "status"
    );
  }
  if (!input.canCloseWithCaveats || input.absoluteBlockCodes.length > 0) {
    throw new TreasuryDomainError(
      "CONFLICT",
      `Fechamento bloqueado: ${input.absoluteBlockCodes.join(", ") || "bloqueios absolutos"}.`,
      "absoluteBlocks"
    );
  }
  if (input.canCloseWithoutCaveats) return;
  if (input.requiredCaveatCodes.length === 0) return;

  const provided = new Set(
    input.caveats.map((c) => c.code.trim()).filter(Boolean)
  );
  const missing = input.requiredCaveatCodes.filter((c) => !provided.has(c));
  if (missing.length > 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Ressalvas obrigatórias ausentes: ${missing.join(", ")}.`,
      "caveats"
    );
  }
  for (const c of input.caveats) {
    if (!c.message?.trim()) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Cada ressalva exige mensagem.",
        "caveats"
      );
    }
  }
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
