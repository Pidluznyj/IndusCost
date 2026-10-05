/**
 * Satisfação — action points (plano de ação por ponto de atenção). Camada PURA.
 *
 * Um ponto de atenção é uma nota crítica (<= 2) numa resposta enviada. Depois
 * que a pesquisa é encerrada, cada ponto de atenção pode receber UM action
 * point: quem responde, o que será feito e até quando.
 */

import {
  normalizeText,
  SatisfactionContractError,
  type SatisfactionCampaignStatusValue,
} from "./satisfactionContracts.js";

export const SATISFACTION_ACTION_POINT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
] as const;
export type SatisfactionActionPointStatusValue =
  (typeof SATISFACTION_ACTION_POINT_STATUSES)[number];

export const SATISFACTION_ACTION_POINT_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type SatisfactionActionPointPriorityValue =
  (typeof SATISFACTION_ACTION_POINT_PRIORITIES)[number];

export const SATISFACTION_ACTION_POINT_STATUS_LABELS: Readonly<
  Record<SatisfactionActionPointStatusValue, string>
> = Object.freeze({
  OPEN: "Aberto",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluído",
  CANCELLED: "Cancelado",
});

export const SATISFACTION_ACTION_POINT_PRIORITY_LABELS: Readonly<
  Record<SatisfactionActionPointPriorityValue, string>
> = Object.freeze({
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
});

export const SATISFACTION_ACTION_POINT_LIMITS = Object.freeze({
  actionPlan: 4000,
  rootCause: 2000,
  resultNotes: 4000,
});

/** Action points só existem depois que a pesquisa foi encerrada. */
export function canManageActionPoints(status: SatisfactionCampaignStatusValue): boolean {
  return status === "CLOSED" || status === "ARCHIVED";
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "AAAA-MM-DD" → Date em meia-noite UTC (coluna DATE). Rejeita data inexistente. */
export function parseDateOnly(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const match = DATE_ONLY.exec(raw.trim());
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw.trim() ? parsed : null;
}

export function formatDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Hoje no fuso da operação, como "AAAA-MM-DD". */
export function todayDateOnly(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Atrasado = prazo vencido e ainda não concluído/cancelado. */
export function isActionPointOverdue(
  input: { status: SatisfactionActionPointStatusValue; dueDate: string | null },
  today: string
): boolean {
  if (!input.dueDate) return false;
  if (input.status === "DONE" || input.status === "CANCELLED") return false;
  return input.dueDate < today;
}

export type SatisfactionActionPointInput = {
  responsibleUserId: string;
  priority: SatisfactionActionPointPriorityValue;
  status: SatisfactionActionPointStatusValue;
  rootCause: string | null;
  actionPlan: string;
  dueDate: Date;
  resultNotes: string | null;
  customerFeedbackAt: Date | null;
};

export function parseActionPointInput(body: unknown): SatisfactionActionPointInput {
  const raw = (body ?? {}) as Record<string, unknown>;

  const responsibleUserId = normalizeText(raw.responsibleUserId, 64);
  if (!responsibleUserId || !UUID.test(responsibleUserId)) {
    throw new SatisfactionContractError("Selecione o responsável pelo action point.", {
      field: "responsibleUserId",
    });
  }

  const actionPlan = normalizeText(raw.actionPlan, SATISFACTION_ACTION_POINT_LIMITS.actionPlan);
  if (!actionPlan) {
    throw new SatisfactionContractError("Descreva o plano de ação.", { field: "actionPlan" });
  }

  const dueDate = parseDateOnly(raw.dueDate);
  if (!dueDate) {
    throw new SatisfactionContractError("Informe uma data limite válida.", {
      field: "dueDate",
      code: "INVALID_DATE",
    });
  }

  const priorityRaw = String(raw.priority ?? "MEDIUM").toUpperCase();
  if (!(SATISFACTION_ACTION_POINT_PRIORITIES as readonly string[]).includes(priorityRaw)) {
    throw new SatisfactionContractError("Prioridade inválida.", { field: "priority" });
  }

  const statusRaw = String(raw.status ?? "OPEN").toUpperCase();
  if (!(SATISFACTION_ACTION_POINT_STATUSES as readonly string[]).includes(statusRaw)) {
    throw new SatisfactionContractError("Situação inválida.", { field: "status" });
  }

  const resultNotes = normalizeText(
    raw.resultNotes,
    SATISFACTION_ACTION_POINT_LIMITS.resultNotes
  );
  // Concluir sem dizer o que foi feito não fecha o ciclo com o cliente.
  if (statusRaw === "DONE" && !resultNotes) {
    throw new SatisfactionContractError(
      "Para concluir, registre o resultado da ação realizada.",
      { field: "resultNotes" }
    );
  }

  let customerFeedbackAt: Date | null = null;
  if (raw.customerFeedbackAt != null && String(raw.customerFeedbackAt).trim() !== "") {
    customerFeedbackAt = parseDateOnly(raw.customerFeedbackAt);
    if (!customerFeedbackAt) {
      throw new SatisfactionContractError("Data de retorno ao cliente inválida.", {
        field: "customerFeedbackAt",
        code: "INVALID_DATE",
      });
    }
  }

  return {
    responsibleUserId,
    priority: priorityRaw as SatisfactionActionPointPriorityValue,
    status: statusRaw as SatisfactionActionPointStatusValue,
    rootCause: normalizeText(raw.rootCause, SATISFACTION_ACTION_POINT_LIMITS.rootCause),
    actionPlan,
    dueDate,
    resultNotes,
    customerFeedbackAt,
  };
}
