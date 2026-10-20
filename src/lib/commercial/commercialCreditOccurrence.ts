/**
 * Ocorrência de crédito do cliente.
 * Referencia o título oficial pelo id externo. Não copia saldo nem baixa.
 * Encaminhamento não é protesto confirmado.
 */

export const COMMERCIAL_CREDIT_OCCURRENCE_KINDS = [
  "PROTEST_FORWARDED",
  "PROTEST_CONFIRMED",
  "PROTEST_WITHDRAWN",
  "NEGOTIATION",
  "DISPUTE",
  "REGULARIZATION",
  "OTHER_RESTRICTION",
] as const;

export type CommercialCreditOccurrenceKind = (typeof COMMERCIAL_CREDIT_OCCURRENCE_KINDS)[number];

export const COMMERCIAL_CREDIT_OCCURRENCE_STATUSES = ["OPEN", "CONFIRMED_PENDING", "CLOSED"] as const;

export type CommercialCreditOccurrenceStatus = (typeof COMMERCIAL_CREDIT_OCCURRENCE_STATUSES)[number];

export const COMMERCIAL_CREDIT_OCCURRENCE_ORIGINS = ["MANUAL", "NOMUS"] as const;

export type CommercialCreditOccurrenceOrigin = (typeof COMMERCIAL_CREDIT_OCCURRENCE_ORIGINS)[number];

export const COMMERCIAL_CREDIT_OCCURRENCE_MIN_JUSTIFICATION = 20;

export const COMMERCIAL_CREDIT_OCCURRENCE_KIND_LABEL: Record<CommercialCreditOccurrenceKind, string> = {
  PROTEST_FORWARDED: "Título encaminhado para protesto",
  PROTEST_CONFIRMED: "Protesto confirmado",
  PROTEST_WITHDRAWN: "Protesto cancelado ou retirado",
  NEGOTIATION: "Negociação",
  DISPUTE: "Contestação",
  REGULARIZATION: "Regularização",
  OTHER_RESTRICTION: "Outra restrição relevante",
};

export const COMMERCIAL_CREDIT_OCCURRENCE_STATUS_LABEL: Record<CommercialCreditOccurrenceStatus, string> = {
  OPEN: "Em aberto",
  CONFIRMED_PENDING: "Confirmado e pendente",
  CLOSED: "Encerrado",
};

export const COMMERCIAL_CREDIT_OCCURRENCE_ORIGIN_LABEL: Record<CommercialCreditOccurrenceOrigin, string> = {
  MANUAL: "Financeiro",
  NOMUS: "Nomus",
};

const TITLE_KINDS = new Set<CommercialCreditOccurrenceKind>([
  "PROTEST_FORWARDED",
  "PROTEST_CONFIRMED",
  "PROTEST_WITHDRAWN",
  "REGULARIZATION",
]);

const EVIDENCE_KINDS = new Set<CommercialCreditOccurrenceKind>(["PROTEST_WITHDRAWN", "REGULARIZATION"]);

const CLOSING_KINDS = new Set<CommercialCreditOccurrenceKind>(["PROTEST_WITHDRAWN", "REGULARIZATION"]);

export type CommercialCreditOccurrenceFact = {
  kind: string;
  status: string;
  titleExternalId: number | null;
  closedAt: Date | string | null;
};

export type CommercialCreditOccurrenceView = {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  origin: string;
  originLabel: string;
  occurredAt: string;
  occurredAtLabel: string;
  titleReference: string | null;
  responsibleUserId: string;
  justification: string;
  closedAt: string | null;
  evidenceFileNames: string[];
  blocksCredit: boolean;
};

export function isCommercialCreditOccurrenceKind(value: string): value is CommercialCreditOccurrenceKind {
  return (COMMERCIAL_CREDIT_OCCURRENCE_KINDS as readonly string[]).includes(value);
}

export function occurrenceRequiresTitle(kind: CommercialCreditOccurrenceKind): boolean {
  return TITLE_KINDS.has(kind);
}

export function occurrenceRequiresEvidence(kind: CommercialCreditOccurrenceKind): boolean {
  return EVIDENCE_KINDS.has(kind);
}

export function occurrenceClosesProtest(kind: CommercialCreditOccurrenceKind): boolean {
  return CLOSING_KINDS.has(kind);
}

export function initialOccurrenceStatus(kind: CommercialCreditOccurrenceKind): CommercialCreditOccurrenceStatus {
  if (kind === "PROTEST_CONFIRMED") return "CONFIRMED_PENDING";
  if (occurrenceClosesProtest(kind)) return "CLOSED";
  return "OPEN";
}

/** Somente protesto confirmado e ainda não encerrado bloqueia como crítico. */
export function occurrenceBlocksCredit(row: {
  kind: string;
  status: string;
  closedAt: Date | string | null;
}): boolean {
  return row.kind === "PROTEST_CONFIRMED" && row.status === "CONFIRMED_PENDING" && row.closedAt == null;
}

export function activeOccurrenceDedupeKey(
  customerId: string,
  titleExternalId: number | null,
  kind: CommercialCreditOccurrenceKind
): string {
  return `ACTIVE:${customerId}:${titleExternalId ?? "CUSTOMER"}:${kind}`;
}

export function nomusProtestDedupeKey(customerId: string, titleExternalId: number): string {
  return `NOMUS:${customerId}:${titleExternalId}:PROTEST_CONFIRMED`;
}

export function suppressedProtestTitleIds(occurrences: readonly CommercialCreditOccurrenceFact[]): number[] {
  const ids = new Set<number>();
  for (const row of occurrences) {
    if (row.closedAt == null) continue;
    if (row.kind !== "PROTEST_WITHDRAWN" && row.kind !== "REGULARIZATION") continue;
    if (row.titleExternalId != null) ids.add(row.titleExternalId);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Protesto confirmado pendente: ocorrência formal ou flag explícita do Nomus
 * que ainda não teve retirada ou regularização. A baixa do título não entra aqui.
 */
export function resolveConfirmedPendingProtest(input: {
  occurrences: readonly CommercialCreditOccurrenceFact[];
  openProtestedTitleIds: readonly number[];
  settledProtestedTitleIds: readonly number[];
}): { confirmedPending: boolean; suppressedTitleIds: number[] } {
  const suppressedTitleIds = suppressedProtestTitleIds(input.occurrences);
  const covered = new Set(suppressedTitleIds);
  const stored = input.occurrences.some((row) => occurrenceBlocksCredit(row));
  const nomus = [...input.openProtestedTitleIds, ...input.settledProtestedTitleIds].some((id) => !covered.has(id));
  return { confirmedPending: stored || nomus, suppressedTitleIds };
}

export function validateOccurrenceDraft(input: {
  kind: string;
  justification: string;
  titleExternalId: number | null;
  evidenceCount: number;
  occurredAt: Date;
  now: Date;
}):
  | {
      ok: true;
      kind: CommercialCreditOccurrenceKind;
      justification: string;
      titleExternalId: number | null;
      occurredAt: Date;
    }
  | { ok: false; code: string; message: string } {
  if (!isCommercialCreditOccurrenceKind(input.kind)) {
    return { ok: false, code: "OCCURRENCE_KIND", message: "Tipo de ocorrência inválido." };
  }
  const justification = input.justification.trim();
  if (justification.length < COMMERCIAL_CREDIT_OCCURRENCE_MIN_JUSTIFICATION || justification.length > 2000) {
    return {
      ok: false,
      code: "OCCURRENCE_JUSTIFICATION",
      message: "A ocorrência exige justificativa objetiva.",
    };
  }
  if (Number.isNaN(input.occurredAt.getTime())) {
    return { ok: false, code: "OCCURRENCE_DATE", message: "Data da ocorrência inválida." };
  }
  if (input.occurredAt.getTime() > input.now.getTime() + 24 * 60 * 60 * 1000) {
    return { ok: false, code: "OCCURRENCE_DATE", message: "A data da ocorrência não pode estar no futuro." };
  }
  const title = input.titleExternalId;
  if (occurrenceRequiresTitle(input.kind)) {
    if (title == null || !Number.isInteger(title) || title <= 0) {
      return {
        ok: false,
        code: "OCCURRENCE_TITLE",
        message: "Informe o título oficial vinculado a esta ocorrência.",
      };
    }
  } else if (title != null && (!Number.isInteger(title) || title <= 0)) {
    return { ok: false, code: "OCCURRENCE_TITLE", message: "Referência de título inválida." };
  }
  if (occurrenceRequiresEvidence(input.kind) && input.evidenceCount < 1) {
    return {
      ok: false,
      code: "OCCURRENCE_EVIDENCE",
      message: "Regularização e retirada de protesto exigem comprovação documental.",
    };
  }
  return {
    ok: true,
    kind: input.kind,
    justification,
    titleExternalId: title != null && title > 0 ? title : null,
    occurredAt: input.occurredAt,
  };
}

export function presentCommercialCreditOccurrence(row: {
  id: string;
  kind: string;
  status: string;
  origin: string;
  occurredAt: Date | string;
  titleExternalId: number | null;
  responsibleUserId: string;
  justification: string;
  closedAt: Date | string | null;
  evidenceFileNames?: readonly string[];
}): CommercialCreditOccurrenceView {
  const occurred = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt);
  const closed = row.closedAt == null ? null : row.closedAt instanceof Date ? row.closedAt : new Date(row.closedAt);
  const kindLabel = isCommercialCreditOccurrenceKind(row.kind)
    ? COMMERCIAL_CREDIT_OCCURRENCE_KIND_LABEL[row.kind]
    : row.kind;
  const statusLabel = (COMMERCIAL_CREDIT_OCCURRENCE_STATUSES as readonly string[]).includes(row.status)
    ? COMMERCIAL_CREDIT_OCCURRENCE_STATUS_LABEL[row.status as CommercialCreditOccurrenceStatus]
    : row.status;
  const originLabel = (COMMERCIAL_CREDIT_OCCURRENCE_ORIGINS as readonly string[]).includes(row.origin)
    ? COMMERCIAL_CREDIT_OCCURRENCE_ORIGIN_LABEL[row.origin as CommercialCreditOccurrenceOrigin]
    : row.origin;
  return {
    id: row.id,
    kind: row.kind,
    kindLabel,
    status: row.status,
    statusLabel,
    origin: row.origin,
    originLabel,
    occurredAt: occurred.toISOString(),
    occurredAtLabel: Number.isNaN(occurred.getTime()) ? "Data indisponível" : occurred.toLocaleDateString("pt-BR"),
    titleReference: row.titleExternalId != null ? `Título ${row.titleExternalId}` : null,
    responsibleUserId: row.responsibleUserId,
    justification: row.justification,
    closedAt: closed && !Number.isNaN(closed.getTime()) ? closed.toISOString() : null,
    evidenceFileNames: [...(row.evidenceFileNames ?? [])],
    blocksCredit: occurrenceBlocksCredit(row),
  };
}

export function occurrenceHistoryLine(view: CommercialCreditOccurrenceView): string {
  const title = view.titleReference ? ` · ${view.titleReference}` : "";
  return `${view.occurredAtLabel} — ${view.kindLabel} (${view.statusLabel}, ${view.originLabel})${title}. ${view.justification}`;
}
