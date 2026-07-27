/**
 * Regras puras de exceções da Tesouraria (sem Prisma / sem I/O).
 */

import type { TreasuryExceptionStatus } from "../contracts/treasuryEnums.js";
import { TREASURY_OPEN_EXCEPTION_STATUSES } from "../contracts/treasuryEnums.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export function isTreasuryExceptionOpenCause(
  status: TreasuryExceptionStatus
): boolean {
  return (TREASURY_OPEN_EXCEPTION_STATUSES as readonly string[]).includes(
    status
  );
}

export function assertTreasuryExceptionVersionMatch(
  currentVersion: number,
  expectedVersion: number
): void {
  if (currentVersion !== expectedVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão da exceção desatualizada. Recarregue e tente novamente.",
      "expectedVersion"
    );
  }
}

export function assertTreasuryExceptionCanTransition(
  status: TreasuryExceptionStatus,
  action: "acknowledge" | "resolve" | "ignore" | "cancel"
): void {
  if (!isTreasuryExceptionOpenCause(status)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Exceção ${status} não admite ${action}.`,
      "status"
    );
  }
}

/**
 * Próxima recorrência ao re-detectar a mesma causa.
 * Nunca zera — preserva e incrementa.
 */
export function nextTreasuryExceptionRecurrence(
  currentRecurrence: number
): number {
  const n = Number.isFinite(currentRecurrence) ? Math.trunc(currentRecurrence) : 0;
  return Math.max(1, n) + 1;
}

export type TreasuryExceptionUpsertDecision =
  | { kind: "create" }
  | {
      kind: "update_open";
      nextRecurrence: number;
      keepStatus: TreasuryExceptionStatus;
    }
  | { kind: "reopen"; nextRecurrence: number };

/**
 * Idempotência: mesma causa aberta → update; fechada → reopen; ausente → create.
 */
export function decideTreasuryExceptionUpsert(
  existingStatus: TreasuryExceptionStatus | null,
  existingRecurrence: number | null
): TreasuryExceptionUpsertDecision {
  if (existingStatus == null) return { kind: "create" };
  if (isTreasuryExceptionOpenCause(existingStatus)) {
    return {
      kind: "update_open",
      nextRecurrence: nextTreasuryExceptionRecurrence(
        existingRecurrence ?? 1
      ),
      keepStatus: existingStatus,
    };
  }
  return {
    kind: "reopen",
    nextRecurrence: nextTreasuryExceptionRecurrence(existingRecurrence ?? 1),
  };
}
