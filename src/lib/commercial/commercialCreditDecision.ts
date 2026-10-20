/**
 * Decisão de crédito comercial. Independente do score cadastral de CNPJ.
 *
 * A inadimplência vem do serviço que lê `NomusAccountsReceivable`. Este motor
 * não grava título, não copia saldo e não trata SUPER_ADMIN como exceção.
 * À vista não é prazo. Antecipado só segue com confirmação persistida.
 */

import type { CommercialDelinquencyAnalysis, CommercialDelinquencyStatus } from "./customerDelinquencyAnalysis.js";
import { parseGrantedPaymentTerm } from "@/src/lib/salesOrderGrantedPaymentTerm.js";

export const COMMERCIAL_CREDIT_EXCEPTION_SCOPES = [
  "OVERDUE",
  "INTERNAL_PROTEST",
  "EXTERNAL_PROTEST",
  "RELATED_PARTY",
  "UNVERIFIED",
  "QUOD_REVIEW",
] as const;

export type CommercialCreditExceptionScope = (typeof COMMERCIAL_CREDIT_EXCEPTION_SCOPES)[number];

/** Financeiro e Diretoria. O papel não substitui a chave explícita. */
export const COMMERCIAL_CREDIT_EXCEPTION_PERMISSIONS = [
  "commercial.credit.exception.grant",
  "commercial.credit.exception.grant.board",
] as const;

export const COMMERCIAL_CREDIT_EXCEPTION_MIN_JUSTIFICATION = 20;
export const COMMERCIAL_CREDIT_EXCEPTION_MAX_DAYS = 90;
export const COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT = 20;

export type CommercialCreditDecisionStatus =
  | "LIBERADO"
  | "EM_ANALISE"
  | "BLOQUEADO"
  | "BLOQUEIO_CRITICO";

export type CommercialSaleKind = "CASH" | "CREDIT_TERM" | "ADVANCE" | "UNSPECIFIED";

export type CommercialCreditEnforcement = "DRAFT" | "EXISTING_OBLIGATION" | "CREDIT_GRANT";

export type CommercialExternalProtestStatus =
  | "ABSENT"
  | "CONFIRMED_CURRENT"
  | "CLEARED"
  | "UNREADABLE";

export type ExternalProtestReviewKind = "NONE" | "CANCELLED" | "UNCONFIRMED" | "STALE" | "UNAVAILABLE";

export function applyExternalProtestConsultation(input: {
  stored: CommercialExternalProtestStatus;
  confirmedCurrent: boolean;
  review: ExternalProtestReviewKind;
}): { externalProtest: CommercialExternalProtestStatus; review: ExternalProtestReviewKind } {
  if (input.stored === "CONFIRMED_CURRENT" || input.confirmedCurrent) {
    return { externalProtest: "CONFIRMED_CURRENT", review: "NONE" };
  }
  if (input.review !== "NONE") return { externalProtest: "ABSENT", review: input.review };
  if (input.stored === "UNREADABLE") return { externalProtest: "UNREADABLE", review: "NONE" };
  return { externalProtest: "ABSENT", review: "NONE" };
}

export type CommercialCreditAdvanceConfirmation = {
  approved: boolean;
  confirmed: boolean;
  /** Corpo de requisição nunca confirma antecipação. */
  source: "PERSISTED" | "REQUEST_BODY";
};

export type CommercialCreditExceptionFact = {
  id: string;
  scope: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** Evidência do dossiê QUOD. O número do score não entra aqui e não altera a decisão. */
export type CommercialQuodEvidence = {
  state: "NOT_CONSULTED" | "VALID" | "STALE" | "FAILED" | "PARTIAL" | "UNAVAILABLE" | "IN_PROGRESS";
  confirmedRestriction: boolean;
  insufficient: boolean;
};

export type CommercialCreditDecision = {
  status: CommercialCreditDecisionStatus;
  /** Postura financeira depois da exceção e antes de separar à vista/antecipado. */
  customerStatus: CommercialCreditDecisionStatus;
  reason: string;
  reasons: string[];
  saleKind: CommercialSaleKind;
  allowed: boolean;
  appliedExceptionIds: string[];
  cadastralIgnored: true;
  evidence: {
    delinquencyStatus: CommercialDelinquencyStatus;
    delinquencyUnknownReason: string | null;
    externalProtest: CommercialExternalProtestStatus;
    externalProtestReview: ExternalProtestReviewKind;
    relatedParties: Array<{ customerId: string; status: CommercialDelinquencyStatus }>;
    cadastralScore: number | null;
    cadastralVerdict: string | null;
    quodState: CommercialQuodEvidence["state"];
    quodConfirmedRestriction: boolean;
  };
};

type Hold = {
  status: Exclude<CommercialCreditDecisionStatus, "LIBERADO">;
  reason: string;
  scope: CommercialCreditExceptionScope;
};

const STATUS_RANK: Record<CommercialCreditDecisionStatus, number> = {
  BLOQUEIO_CRITICO: 3,
  BLOQUEADO: 2,
  EM_ANALISE: 1,
  LIBERADO: 0,
};

const REASON_PRIORITY = [
  "INTERNAL_PROTEST",
  "OVERDUE_OPEN_BALANCE",
  "EXTERNAL_PROTEST",
  "FINANCIAL_UNVERIFIED",
  "EXTERNAL_PROTEST_REVIEW",
  "RELATED_PARTY_DELINQUENT",
  "RELATED_PARTY_UNVERIFIED",
  "QUOD_EXTERNAL_RESTRICTION",
  "QUOD_INSUFFICIENT",
] as const;

const MESSAGES: Record<string, string> = {
  REGULAR: "Cliente regular. A venda a prazo segue a política comercial.",
  EXCEPTION_APPLIED: "Exceção formal vigente no escopo autorizado.",
  OVERDUE_OPEN_BALANCE:
    "Venda a prazo bloqueada: há título com saldo em aberto e atraso de pelo menos um dia.",
  INTERNAL_PROTEST: "Bloqueio crítico: protesto interno pendente confirmado.",
  EXTERNAL_PROTEST: "Crédito bloqueado: protesto externo confirmado e vigente.",
  EXTERNAL_PROTEST_REVIEW:
    "Protesto externo exige revisão: consulta indisponível, desatualizada, cancelada ou não confirmada. Isso não significa ausência de protesto.",
  RELATED_PARTY_DELINQUENT:
    "Crédito em análise: vínculo societário com empresa inadimplente. A dívida não foi transferida.",
  RELATED_PARTY_UNVERIFIED: "Crédito em análise: vínculo societário sem verificação financeira.",
  FINANCIAL_UNVERIFIED:
    "Crédito não verificado: dados financeiros indisponíveis ou desatualizados. Exige análise antes da liberação.",
  QUOD_EXTERNAL_RESTRICTION:
    "Crédito em análise: evidência externa do dossiê exige decisão administrativa. O score externo não libera o cliente e não detalha o relatório.",
  QUOD_INSUFFICIENT:
    "Crédito em análise: a consulta externa não trouxe informação suficiente. Isso não significa cliente regular.",
  ADVANCE_NOT_CONFIRMED: "Pagamento antecipado só segue quando estiver aprovado e confirmado.",
  CASH_NOT_CREDIT: "À vista não é venda a prazo.",
  ADVANCE_CONFIRMED: "Pagamento antecipado aprovado e confirmado.",
};

export function commercialCreditReasonMessage(reason: string): string {
  return MESSAGES[reason] ?? "Decisão registrada pelo motor de crédito.";
}

export class CommercialCreditDeniedError extends Error {
  readonly code = "COMMERCIAL_CREDIT_DENIED";
  readonly httpStatus = 409;
  readonly status: CommercialCreditDecisionStatus;
  readonly reason: string;

  constructor(decision: CommercialCreditDecision) {
    super(MESSAGES[decision.reason] ?? "Crédito comercial não liberado.");
    this.name = "CommercialCreditDeniedError";
    this.status = decision.status;
    this.reason = decision.reason;
  }
}

export class CommercialCreditBypassError extends Error {
  readonly code = "COMMERCIAL_CREDIT_BYPASS";
  readonly httpStatus = 409;

  constructor(message = "Integração sem documento Nomus não pode gravar venda ou proposta sem a validação de crédito.") {
    super(message);
    this.name = "CommercialCreditBypassError";
  }
}

export class CommercialCreditExceptionError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code:
      | "EXCEPTION_FORBIDDEN"
      | "EXCEPTION_IMPLICIT_SUPER_ADMIN"
      | "EXCEPTION_ALREADY_ACTIVE"
      | "EXCEPTION_JUSTIFICATION"
      | "EXCEPTION_EXPIRY"
      | "EXCEPTION_SCOPE"
      | "EXCEPTION_CUSTOMER",
    message: string
  ) {
    super(message);
    this.name = "CommercialCreditExceptionError";
    this.httpStatus =
      code === "EXCEPTION_ALREADY_ACTIVE" ? 409 : code === "EXCEPTION_FORBIDDEN" || code === "EXCEPTION_IMPLICIT_SUPER_ADMIN" ? 403 : 400;
  }
}

export function classifyCommercialSaleTerms(paymentTerms: string | null | undefined): CommercialSaleKind {
  const parsed = parseGrantedPaymentTerm(paymentTerms);
  if (parsed.recognized && parsed.reason === "CASH") return "CASH";
  if (parsed.recognized && parsed.averageDays > 0) return "CREDIT_TERM";
  if (!parsed.recognized && parsed.reason === "AMBIGUOUS_WEIGHTS") return "ADVANCE";
  return "UNSPECIFIED";
}

export function commercialPaymentTermsText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Espelho Nomus de obrigação já existente. Sem id externo, a gravação seria
 * uma concessão nova e teria de passar pelo motor de crédito.
 */
export function assertExistingNomusObligationMirror(input: {
  sourceSystem: string | null | undefined;
  externalDocumentId: string | number | null | undefined;
}): void {
  const source = String(input.sourceSystem ?? "").trim().toUpperCase();
  const externalId = input.externalDocumentId;
  const hasExternal =
    (typeof externalId === "number" && Number.isInteger(externalId) && externalId > 0) ||
    (typeof externalId === "string" && externalId.trim().length > 0);
  if (source !== "NOMUS" || !hasExternal) {
    throw new CommercialCreditBypassError();
  }
}

export function resolveCommercialCreditExceptionPermission(actor: {
  role: string;
  assignedPermissions: readonly string[];
}): { ok: true; permission: string } | { ok: false; code: "EXCEPTION_FORBIDDEN" | "EXCEPTION_IMPLICIT_SUPER_ADMIN" } {
  const assigned = new Set(actor.assignedPermissions);
  const permission = COMMERCIAL_CREDIT_EXCEPTION_PERMISSIONS.find((key) => assigned.has(key));
  if (permission) return { ok: true, permission };
  if (actor.role === "SUPER_ADMIN") return { ok: false, code: "EXCEPTION_IMPLICIT_SUPER_ADMIN" };
  return { ok: false, code: "EXCEPTION_FORBIDDEN" };
}

export function validateCommercialCreditExceptionDraft(input: {
  customerId: string;
  scope: string;
  justification: string;
  expiresAt: Date;
  now: Date;
}): { ok: true } | { ok: false; code: "EXCEPTION_CUSTOMER" | "EXCEPTION_SCOPE" | "EXCEPTION_JUSTIFICATION" | "EXCEPTION_EXPIRY"; message: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.customerId)) {
    return { ok: false, code: "EXCEPTION_CUSTOMER", message: "Cliente da exceção é inválido." };
  }
  if (!COMMERCIAL_CREDIT_EXCEPTION_SCOPES.includes(input.scope as CommercialCreditExceptionScope)) {
    return { ok: false, code: "EXCEPTION_SCOPE", message: "Escopo da exceção é inválido." };
  }
  const justification = input.justification.trim();
  if (
    justification.length < COMMERCIAL_CREDIT_EXCEPTION_MIN_JUSTIFICATION ||
    justification.length > 2000
  ) {
    return {
      ok: false,
      code: "EXCEPTION_JUSTIFICATION",
      message: "A exceção exige justificativa objetiva.",
    };
  }
  const ttl = input.expiresAt.getTime() - input.now.getTime();
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > COMMERCIAL_CREDIT_EXCEPTION_MAX_DAYS * 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      code: "EXCEPTION_EXPIRY",
      message: "A exceção exige prazo de validade futuro, de no máximo 90 dias.",
    };
  }
  return { ok: true };
}

function isLiveException(row: CommercialCreditExceptionFact, now: Date): row is CommercialCreditExceptionFact & { scope: CommercialCreditExceptionScope } {
  return (
    row.revokedAt == null &&
    row.expiresAt.getTime() > now.getTime() &&
    COMMERCIAL_CREDIT_EXCEPTION_SCOPES.includes(row.scope as CommercialCreditExceptionScope)
  );
}

function pushHold(holds: Hold[], hold: Hold) {
  if (!holds.some((row) => row.reason === hold.reason && row.scope === hold.scope)) holds.push(hold);
}

function customerHolds(input: {
  customerId: string;
  delinquency: CommercialDelinquencyAnalysis;
  externalProtest: CommercialExternalProtestStatus;
  relatedParties: ReadonlyArray<{ customerId: string; delinquency: CommercialDelinquencyAnalysis }>;
  relatedPartyOverflow: boolean;
  confirmedPendingProtest?: boolean;
  suppressedProtestTitleIds?: readonly number[];
  externalProtestReview?: ExternalProtestReviewKind;
  quod?: CommercialQuodEvidence | null;
}): Hold[] {
  const holds: Hold[] = [];
  const delinquency = input.delinquency;
  if (delinquency.status === "UNKNOWN") {
    pushHold(holds, { status: "EM_ANALISE", reason: "FINANCIAL_UNVERIFIED", scope: "UNVERIFIED" });
  }
  const suppressed = new Set(input.suppressedProtestTitleIds ?? []);
  const openProtested = delinquency.evidence.protestedTitleIds.filter((id) => !suppressed.has(id));
  if (openProtested.length > 0 || input.confirmedPendingProtest === true) {
    pushHold(holds, { status: "BLOQUEIO_CRITICO", reason: "INTERNAL_PROTEST", scope: "INTERNAL_PROTEST" });
  }
  if (delinquency.status === "OVERDUE" || (delinquency.overdueTitleCount ?? 0) > 0) {
    pushHold(holds, { status: "BLOQUEADO", reason: "OVERDUE_OPEN_BALANCE", scope: "OVERDUE" });
  }
  if (input.externalProtest === "CONFIRMED_CURRENT") {
    pushHold(holds, { status: "BLOQUEADO", reason: "EXTERNAL_PROTEST", scope: "EXTERNAL_PROTEST" });
  } else if (input.externalProtest === "UNREADABLE") {
    pushHold(holds, { status: "EM_ANALISE", reason: "FINANCIAL_UNVERIFIED", scope: "UNVERIFIED" });
  }
  if (input.externalProtestReview && input.externalProtestReview !== "NONE") {
    pushHold(holds, { status: "EM_ANALISE", reason: "EXTERNAL_PROTEST_REVIEW", scope: "UNVERIFIED" });
  }
  for (const related of input.relatedParties) {
    if (related.customerId === input.customerId) continue;
    if (related.delinquency.status === "OVERDUE" || related.delinquency.status === "PROTESTED") {
      pushHold(holds, { status: "EM_ANALISE", reason: "RELATED_PARTY_DELINQUENT", scope: "RELATED_PARTY" });
    } else if (related.delinquency.status === "UNKNOWN") {
      pushHold(holds, { status: "EM_ANALISE", reason: "RELATED_PARTY_UNVERIFIED", scope: "RELATED_PARTY" });
    }
  }
  if (input.relatedPartyOverflow) {
    pushHold(holds, { status: "EM_ANALISE", reason: "RELATED_PARTY_UNVERIFIED", scope: "RELATED_PARTY" });
  }
  const quod = input.quod;
  if (quod && (quod.state === "VALID" || quod.state === "STALE" || quod.state === "PARTIAL")) {
    if (quod.confirmedRestriction) {
      pushHold(holds, { status: "EM_ANALISE", reason: "QUOD_EXTERNAL_RESTRICTION", scope: "QUOD_REVIEW" });
    } else if (quod.state === "VALID" && quod.insufficient) {
      pushHold(holds, { status: "EM_ANALISE", reason: "QUOD_INSUFFICIENT", scope: "QUOD_REVIEW" });
    }
  }
  return holds;
}

function postureFromHolds(holds: Hold[]): { status: CommercialCreditDecisionStatus; reason: string; reasons: string[] } {
  if (holds.length === 0) return { status: "LIBERADO", reason: "REGULAR", reasons: ["REGULAR"] };
  const top = Math.max(...holds.map((hold) => STATUS_RANK[hold.status]));
  const winners = holds.filter((hold) => STATUS_RANK[hold.status] === top);
  const reason =
    REASON_PRIORITY.find((item) => winners.some((hold) => hold.reason === item)) ?? winners[0]!.reason;
  const status = winners.find((hold) => hold.reason === reason)?.status ?? winners[0]!.status;
  return {
    status,
    reason,
    reasons: [...new Set(holds.map((hold) => hold.reason))],
  };
}

export function decideCommercialCredit(input: {
  customerId: string;
  enforcement: CommercialCreditEnforcement;
  paymentTerms: string | null | undefined;
  delinquency: CommercialDelinquencyAnalysis;
  externalProtest?: CommercialExternalProtestStatus;
  relatedParties?: ReadonlyArray<{ customerId: string; delinquency: CommercialDelinquencyAnalysis }>;
  relatedPartyOverflow?: boolean;
  exceptions?: readonly CommercialCreditExceptionFact[];
  /** Protesto confirmado ainda não regularizado, inclusive depois da baixa do título. */
  confirmedPendingProtest?: boolean;
  suppressedProtestTitleIds?: readonly number[];
  externalProtestReview?: ExternalProtestReviewKind;
  advanceConfirmation?: CommercialCreditAdvanceConfirmation | null;
  cadastral?: { score: number | null; verdict: string | null } | null;
  /** Score numérico do provedor é ignorado de propósito. */
  quod?: CommercialQuodEvidence | null;
  now: Date;
}): CommercialCreditDecision {
  const externalProtest = input.externalProtest ?? "ABSENT";
  const relatedParties = input.relatedParties ?? [];
  const holds = customerHolds({
    customerId: input.customerId,
    delinquency: input.delinquency,
    externalProtest,
    relatedParties,
    relatedPartyOverflow: input.relatedPartyOverflow === true,
    confirmedPendingProtest: input.confirmedPendingProtest,
    suppressedProtestTitleIds: input.suppressedProtestTitleIds,
    externalProtestReview: input.externalProtestReview,
    quod: input.quod,
  });
  const live = (input.exceptions ?? []).filter((row) => isLiveException(row, input.now));
  const applied = live.filter((row) => holds.some((hold) => hold.scope === row.scope));
  const covered = new Set(applied.map((row) => row.scope));
  const remaining = holds.filter((hold) => !covered.has(hold.scope));
  const posture = postureFromHolds(remaining);
  const customerStatus = posture.status;
  const saleKind = classifyCommercialSaleTerms(input.paymentTerms);
  let status = customerStatus;
  let reason = posture.reason;
  let reasons = posture.reasons;
  let allowed = customerStatus === "LIBERADO";

  if (saleKind === "CASH") {
    status = "LIBERADO";
    reason = "CASH_NOT_CREDIT";
    reasons = [...reasons, "CASH_NOT_CREDIT"];
    allowed = true;
  } else if (saleKind === "ADVANCE") {
    const advance = input.advanceConfirmation;
    const confirmed = advance?.source === "PERSISTED" && advance.approved === true && advance.confirmed === true;
    if (!confirmed) {
      status = "EM_ANALISE";
      reason = "ADVANCE_NOT_CONFIRMED";
      reasons = [...reasons, "ADVANCE_NOT_CONFIRMED"];
      allowed = false;
    } else {
      status = "LIBERADO";
      reason = "ADVANCE_CONFIRMED";
      reasons = [...reasons, "ADVANCE_CONFIRMED"];
      allowed = true;
    }
  }

  if (input.enforcement === "DRAFT" || input.enforcement === "EXISTING_OBLIGATION") {
    allowed = true;
  }

  if (customerStatus === "LIBERADO" && applied.length > 0 && saleKind !== "CASH" && saleKind !== "ADVANCE") {
    reason = "EXCEPTION_APPLIED";
  }

  return {
    status,
    customerStatus,
    reason,
    reasons,
    saleKind,
    allowed,
    appliedExceptionIds: applied.map((row) => row.id),
    cadastralIgnored: true,
    evidence: {
      delinquencyStatus: input.delinquency.status,
      delinquencyUnknownReason: input.delinquency.unknownReason,
      externalProtest,
      externalProtestReview: input.externalProtestReview ?? "NONE",
      relatedParties: relatedParties
        .filter((related) => related.customerId !== input.customerId)
        .map((related) => ({ customerId: related.customerId, status: related.delinquency.status })),
      cadastralScore: input.cadastral?.score ?? null,
      cadastralVerdict: input.cadastral?.verdict ?? null,
      quodState: input.quod?.state ?? "NOT_CONSULTED",
      quodConfirmedRestriction: input.quod?.confirmedRestriction === true,
    },
  };
}
