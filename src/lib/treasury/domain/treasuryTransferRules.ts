/**
 * Regras puras de transferências internas (sem Prisma / sem I/O).
 */

import type { TreasuryTransferStatus } from "../contracts/treasuryEnums.js";
import { treasuryMoneyToCents } from "../treasuryMoney.js";
import { assertTreasuryTransferAccountsDistinct } from "./treasuryAccountRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export type TreasuryTransferTransition =
  | "schedule"
  | "send"
  | "receive"
  | "reconcile"
  | "cancel";

const ALLOWED: Record<
  TreasuryTransferStatus,
  readonly TreasuryTransferTransition[]
> = {
  FORECAST: ["schedule", "send", "cancel"],
  SCHEDULED: ["send", "cancel"],
  SENT: ["receive", "cancel"],
  RECEIVED: ["reconcile", "cancel"],
  RECONCILED: [],
  CANCELLED: [],
};

export function assertTreasuryTransferAmountPositive(amount: string): void {
  if (treasuryMoneyToCents(amount) <= 0n) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor da transferência deve ser positivo.",
      "amount"
    );
  }
}

export function assertTreasuryTransferCreateable(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
}): void {
  assertTreasuryTransferAccountsDistinct(
    input.fromAccountId,
    input.toAccountId
  );
  assertTreasuryTransferAmountPositive(input.amount);
}

export function assertTreasuryTransferTransitionAllowed(
  status: TreasuryTransferStatus,
  transition: TreasuryTransferTransition
): void {
  if (!ALLOWED[status].includes(transition)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Transição "${transition}" não permitida a partir de ${status}.`,
      "status"
    );
  }
}

export function assertTreasuryTransferCancellable(
  status: TreasuryTransferStatus
): void {
  assertTreasuryTransferTransitionAllowed(status, "cancel");
}

export function assertTreasuryTransferVersionMatch(
  currentVersion: number,
  expectedVersion: number
): void {
  if (currentVersion !== expectedVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão da transferência desatualizada. Recarregue e tente novamente.",
      "expectedVersion"
    );
  }
}

/** Recurso em trânsito: enviada e ainda não recebida. */
export function isTreasuryTransferFundsInTransit(
  status: TreasuryTransferStatus
): boolean {
  return status === "SENT";
}

export function nextStatusAfterTransition(
  transition: Exclude<TreasuryTransferTransition, "cancel">
): TreasuryTransferStatus {
  switch (transition) {
    case "schedule":
      return "SCHEDULED";
    case "send":
      return "SENT";
    case "receive":
      return "RECEIVED";
    case "reconcile":
      return "RECONCILED";
  }
}

/**
 * Datas das pernas na projeção.
 * SENT sem recebimento → entrada ausente (em trânsito).
 */
export function resolveTreasuryTransferProjectionLegs(input: {
  status: TreasuryTransferStatus;
  civilDate: string;
  sentCivilDate?: string | null;
  receivedCivilDate?: string | null;
}): {
  isCancelled: boolean;
  outCivilDate: string | null;
  inCivilDate: string | null;
  outRealized: boolean;
  inRealized: boolean;
  fundsInTransit: boolean;
} {
  if (input.status === "CANCELLED") {
    return {
      isCancelled: true,
      outCivilDate: null,
      inCivilDate: null,
      outRealized: false,
      inRealized: false,
      fundsInTransit: false,
    };
  }

  const outCivilDate =
    input.status === "SENT" ||
    input.status === "RECEIVED" ||
    input.status === "RECONCILED"
      ? (input.sentCivilDate ?? input.civilDate)
      : input.civilDate;

  let inCivilDate: string | null =
    input.status === "FORECAST" || input.status === "SCHEDULED"
      ? input.civilDate
      : input.status === "SENT"
        ? null
        : (input.receivedCivilDate ?? input.civilDate);

  const outRealized =
    input.status === "SENT" ||
    input.status === "RECEIVED" ||
    input.status === "RECONCILED";
  const inRealized =
    input.status === "RECEIVED" || input.status === "RECONCILED";

  return {
    isCancelled: false,
    outCivilDate,
    inCivilDate,
    outRealized,
    inRealized,
    fundsInTransit: isTreasuryTransferFundsInTransit(input.status),
  };
}
