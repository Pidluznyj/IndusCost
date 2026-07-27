/**
 * Regras puras — resolução da data civil de cada movimento na projeção.
 * Fuso de referência: America/Sao_Paulo.
 * Títulos vencidos sem previsão NUNCA caem automaticamente em "hoje".
 */

import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import { isTreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryPayableProgrammingStatus,
  TreasuryProjectionLayer,
  TreasuryPromiseStatus,
} from "../contracts/treasuryEnums.js";
import {
  TREASURY_ACTIVE_PROMISE_STATUSES,
  TREASURY_PAYABLE_PROGRAMMING_STATUSES,
} from "../contracts/treasuryEnums.js";
import { compareCivilDates } from "@/src/lib/financeCivilDate.js";

export const TREASURY_MOVEMENT_DATE_TIMEZONE = "America/Sao_Paulo" as const;

export type TreasuryMovementDateSource =
  | "DUE_DATE"
  | "ACTIVE_PROMISE"
  | "EXPECTED_DATE"
  | "CONFIRMED_DATE"
  | "SCHEDULED_DATE"
  | "AUTHORIZED_SCHEDULE"
  | "PROGRAMMED_SCHEDULE"
  | "REALIZED_DATE"
  | "MANUAL_DATE"
  | "UNRELIABLE"
  | "MISSING";

export type TreasuryMovementDateResolution = {
  /** Data civil resolvida (YYYY-MM-DD) ou null se não confiável / ausente. */
  resolvedDate: TreasuryCivilDate | null;
  source: TreasuryMovementDateSource;
  /** false quando vencido sem previsão ou sem confirmação no cenário. */
  reliable: boolean;
  /** Pode entrar na projeção do dia resolvido (nunca força "hoje"). */
  includeInProjection: boolean;
  detail: string;
};

export type TreasuryReceivableMovementDateInput = {
  dueDate: string | null | undefined;
  expectedDate?: string | null;
  confirmedDate?: string | null;
  realizedDate?: string | null;
  /** Promessa ativa (ACTIVE / PARTIALLY_FULFILLED). */
  activePromiseDate?: string | null;
  activePromiseStatus?: TreasuryPromiseStatus | string | null;
  /** Data manual explícita (cenário MANUAL). */
  manualDate?: string | null;
};

export type TreasuryPayableMovementDateInput = {
  dueDate: string | null | undefined;
  expectedDate?: string | null;
  confirmedDate?: string | null;
  scheduledDate?: string | null;
  realizedDate?: string | null;
  programmingStatus?: TreasuryPayableProgrammingStatus | string | null;
  manualDate?: string | null;
};

function asCivil(value: string | null | undefined): TreasuryCivilDate | null {
  if (value == null || value === "") return null;
  const trimmed = value.trim();
  if (!isTreasuryCivilDate(trimmed)) return null;
  return trimmed;
}

/**
 * Converte instante UTC → data civil em America/Sao_Paulo.
 * Cobre a virada de dia (UTC ainda "ontem/amanhã", SP já/ainda no dia local).
 */
export function toTreasuryCivilDateInSaoPaulo(
  instant: Date
): TreasuryCivilDate {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error("Instante inválido para data civil America/Sao_Paulo.");
  }
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: TREASURY_MOVEMENT_DATE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  if (!isTreasuryCivilDate(formatted)) {
    throw new Error(`Falha ao derivar civil date SP: ${formatted}`);
  }
  return formatted;
}

export function isActiveTreasuryPromiseStatus(
  status: string | null | undefined
): boolean {
  if (!status) return false;
  return (TREASURY_ACTIVE_PROMISE_STATUSES as readonly string[]).includes(
    status
  );
}

export function isConfirmedPayableProgrammingStatus(
  status: string | null | undefined
): boolean {
  if (!status) return false;
  return (TREASURY_PAYABLE_PROGRAMMING_STATUSES as readonly string[]).includes(
    status
  );
}

/** Vencido em relação ao asOf civil (dueDate < asOf). */
export function isTreasuryCivilDateOverdue(
  dueDate: string | null | undefined,
  asOfCivilDate: TreasuryCivilDate
): boolean {
  const due = asCivil(dueDate);
  if (!due) return false;
  return compareCivilDates(due, asOfCivilDate) < 0;
}

function resolution(input: {
  resolvedDate: TreasuryCivilDate | null;
  source: TreasuryMovementDateSource;
  reliable: boolean;
  includeInProjection: boolean;
  detail: string;
}): TreasuryMovementDateResolution {
  return input;
}

function unreliable(
  detail: string,
  source: TreasuryMovementDateSource = "UNRELIABLE"
): TreasuryMovementDateResolution {
  return resolution({
    resolvedDate: null,
    source,
    reliable: false,
    includeInProjection: false,
    detail,
  });
}

/**
 * Recebível — CONTRACTUAL: vencimento original.
 */
export function resolveReceivableContractualDate(
  input: TreasuryReceivableMovementDateInput
): TreasuryMovementDateResolution {
  const due = asCivil(input.dueDate);
  if (!due) {
    return unreliable("Recebível contratual sem vencimento original.", "MISSING");
  }
  return resolution({
    resolvedDate: due,
    source: "DUE_DATE",
    reliable: true,
    includeInProjection: true,
    detail: "Cenário CONTRACTUAL usa vencimento original.",
  });
}

/**
 * Recebível — PROBABLE:
 * 1) promessa ativa; 2) data esperada; 3) vencimento se ainda não vencido;
 * 4) sem data confiável se vencido e sem previsão.
 * Nunca mapeia vencido sem previsão para "hoje".
 */
export function resolveReceivableProbableDate(
  input: TreasuryReceivableMovementDateInput,
  asOfCivilDate: TreasuryCivilDate
): TreasuryMovementDateResolution {
  const promiseDate = asCivil(input.activePromiseDate);
  if (
    promiseDate &&
    isActiveTreasuryPromiseStatus(input.activePromiseStatus ?? "ACTIVE")
  ) {
    return resolution({
      resolvedDate: promiseDate,
      source: "ACTIVE_PROMISE",
      reliable: true,
      includeInProjection: true,
      detail: "Promessa ativa define a data provável.",
    });
  }

  const expected = asCivil(input.expectedDate);
  if (expected) {
    return resolution({
      resolvedDate: expected,
      source: "EXPECTED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Data esperada operacional define a data provável.",
    });
  }

  const due = asCivil(input.dueDate);
  if (due && !isTreasuryCivilDateOverdue(due, asOfCivilDate)) {
    return resolution({
      resolvedDate: due,
      source: "DUE_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Vencimento ainda não vencido usado no cenário provável.",
    });
  }

  if (due && isTreasuryCivilDateOverdue(due, asOfCivilDate)) {
    return unreliable(
      "Recebível vencido sem promessa/data esperada — não entra automaticamente em hoje."
    );
  }

  return unreliable(
    "Recebível sem data confiável no cenário provável.",
    "MISSING"
  );
}

/**
 * Recebível — CONFIRMED: somente confirmação válida ou realização.
 */
export function resolveReceivableConfirmedDate(
  input: TreasuryReceivableMovementDateInput
): TreasuryMovementDateResolution {
  const realized = asCivil(input.realizedDate);
  if (realized) {
    return resolution({
      resolvedDate: realized,
      source: "REALIZED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Realização oficial confirma a data.",
    });
  }
  const confirmed = asCivil(input.confirmedDate);
  if (confirmed) {
    return resolution({
      resolvedDate: confirmed,
      source: "CONFIRMED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Confirmação operacional válida.",
    });
  }
  return unreliable(
    "Recebível confirmado exige confirmação válida ou realização."
  );
}

/**
 * Pagável — CONTRACTUAL: vencimento original.
 */
export function resolvePayableContractualDate(
  input: TreasuryPayableMovementDateInput
): TreasuryMovementDateResolution {
  const due = asCivil(input.dueDate);
  if (!due) {
    return unreliable("Pagável contratual sem vencimento original.", "MISSING");
  }
  return resolution({
    resolvedDate: due,
    source: "DUE_DATE",
    reliable: true,
    includeInProjection: true,
    detail: "Cenário CONTRACTUAL usa vencimento original.",
  });
}

/**
 * Pagável — PROBABLE: 1) programada; 2) esperada; 3) vencimento.
 */
export function resolvePayableProbableDate(
  input: TreasuryPayableMovementDateInput
): TreasuryMovementDateResolution {
  const scheduled = asCivil(input.scheduledDate);
  if (scheduled) {
    return resolution({
      resolvedDate: scheduled,
      source: "SCHEDULED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Data programada define o pagável provável.",
    });
  }
  const expected = asCivil(input.expectedDate);
  if (expected) {
    return resolution({
      resolvedDate: expected,
      source: "EXPECTED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Data esperada define o pagável provável.",
    });
  }
  const due = asCivil(input.dueDate);
  if (due) {
    return resolution({
      resolvedDate: due,
      source: "DUE_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Vencimento original como fallback do pagável provável.",
    });
  }
  return unreliable("Pagável sem data no cenário provável.", "MISSING");
}

/**
 * Pagável — CONFIRMED: realizado; ou programado/autorizado com data; ou confirmação.
 * Ordem: realização → AUTHORIZED+agenda → PROGRAMMED+agenda → confirmedDate.
 */
export function resolvePayableConfirmedDate(
  input: TreasuryPayableMovementDateInput
): TreasuryMovementDateResolution {
  const realized = asCivil(input.realizedDate);
  if (realized) {
    return resolution({
      resolvedDate: realized,
      source: "REALIZED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Pagamento realizado confirma a data.",
    });
  }

  const scheduled = asCivil(input.scheduledDate);
  const status = input.programmingStatus ?? null;
  if (scheduled && status === "AUTHORIZED") {
    return resolution({
      resolvedDate: scheduled,
      source: "AUTHORIZED_SCHEDULE",
      reliable: true,
      includeInProjection: true,
      detail: "Programação AUTHORIZED com data agenda.",
    });
  }
  if (scheduled && status === "PROGRAMMED") {
    return resolution({
      resolvedDate: scheduled,
      source: "PROGRAMMED_SCHEDULE",
      reliable: true,
      includeInProjection: true,
      detail: "Programação PROGRAMMED com data agenda.",
    });
  }
  // Status confirmado sem label explícito, mas scheduled presente + status reconhecido
  if (scheduled && isConfirmedPayableProgrammingStatus(status)) {
    return resolution({
      resolvedDate: scheduled,
      source: "SCHEDULED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Programação confirmada com data agenda.",
    });
  }

  const confirmed = asCivil(input.confirmedDate);
  if (confirmed) {
    return resolution({
      resolvedDate: confirmed,
      source: "CONFIRMED_DATE",
      reliable: true,
      includeInProjection: true,
      detail: "Confirmação operacional do pagável.",
    });
  }

  return unreliable(
    "Pagável confirmado exige realização, programação AUTHORIZED/PROGRAMMED ou confirmação."
  );
}

function resolveManualDate(
  manualDate: string | null | undefined,
  sideLabel: string
): TreasuryMovementDateResolution {
  const manual = asCivil(manualDate);
  if (!manual) {
    return unreliable(
      `${sideLabel} no cenário MANUAL exige data manual explícita.`,
      "MISSING"
    );
  }
  return resolution({
    resolvedDate: manual,
    source: "MANUAL_DATE",
    reliable: true,
    includeInProjection: true,
    detail: "Data manual explícita do cenário MANUAL.",
  });
}

export function resolveReceivableMovementDate(input: {
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  movement: TreasuryReceivableMovementDateInput;
}): TreasuryMovementDateResolution {
  switch (input.scenario) {
    case "CONTRACTUAL":
      return resolveReceivableContractualDate(input.movement);
    case "PROBABLE":
      return resolveReceivableProbableDate(
        input.movement,
        input.asOfCivilDate
      );
    case "CONFIRMED":
      return resolveReceivableConfirmedDate(input.movement);
    case "MANUAL":
      return resolveManualDate(input.movement.manualDate, "Recebível");
    default:
      return unreliable(`Cenário desconhecido: ${input.scenario as string}`);
  }
}

export function resolvePayableMovementDate(input: {
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  movement: TreasuryPayableMovementDateInput;
}): TreasuryMovementDateResolution {
  switch (input.scenario) {
    case "CONTRACTUAL":
      return resolvePayableContractualDate(input.movement);
    case "PROBABLE":
      return resolvePayableProbableDate(input.movement);
    case "CONFIRMED":
      return resolvePayableConfirmedDate(input.movement);
    case "MANUAL":
      return resolveManualDate(input.movement.manualDate, "Pagável");
    default:
      return unreliable(`Cenário desconhecido: ${input.scenario as string}`);
  }
}

export function resolveTreasuryMovementDate(input: {
  side: "AR" | "AP";
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  receivable?: TreasuryReceivableMovementDateInput;
  payable?: TreasuryPayableMovementDateInput;
}): TreasuryMovementDateResolution {
  if (input.side === "AR") {
    return resolveReceivableMovementDate({
      scenario: input.scenario,
      asOfCivilDate: input.asOfCivilDate,
      movement: input.receivable ?? { dueDate: null },
    });
  }
  return resolvePayableMovementDate({
    scenario: input.scenario,
    asOfCivilDate: input.asOfCivilDate,
    movement: input.payable ?? { dueDate: null },
  });
}

/**
 * Helper: asOf civil a partir de instante (testes de virada de data).
 */
export function resolveAsOfCivilDateFromInstant(
  instant: Date
): TreasuryCivilDate {
  return toTreasuryCivilDateInSaoPaulo(instant);
}
