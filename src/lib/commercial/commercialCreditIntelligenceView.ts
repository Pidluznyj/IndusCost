/**
 * Apresentação da decisão de crédito para a consulta CNPJ.
 * Não relê título e não recalcula atraso: só nomeia o que o motor já decidiu.
 */

import { commercialCreditReasonMessage } from "./commercialCreditDecision.js";
import type {
  CommercialCreditDecision,
  CommercialCreditDecisionStatus,
  CommercialExternalProtestStatus,
  CommercialIeptbEvidence,
  CommercialQuodEvidence,
} from "./commercialCreditDecision.js";
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";
import {
  EXTERNAL_PROTEST_NOT_CONSULTED_DETAIL,
  type ExternalProtestCreditFact,
} from "./externalProtest/externalProtestProvider.js";
import type { CorporateRelationView } from "./corporateRelation.server.js";

export const INTELLIGENCE_FACT_STATES = [
  "NOT_CONSULTED",
  "NOT_APPLICABLE",
  "UNAVAILABLE",
  "CLEAR",
  "FOUND",
] as const;

export type IntelligenceFactState = (typeof INTELLIGENCE_FACT_STATES)[number];

export const INTELLIGENCE_FACT_LABEL: Record<IntelligenceFactState, string> = {
  NOT_CONSULTED: "Não consultado",
  NOT_APPLICABLE: "Não aplicável",
  UNAVAILABLE: "Indisponível",
  CLEAR: "Sem ocorrência",
  FOUND: "Ocorrência encontrada",
};

/**
 * Estado executivo da decisão de crédito para o cabeçalho da Consulta CNPJ.
 * Deriva do customerStatus do motor; não cria código novo de status.
 */
export type CreditDecisionState =
  | "BLOQUEIO_CRITICO"
  | "BLOQUEADO"
  | "EM_ANALISE"
  | "LIBERADO"
  | "NAO_DETERMINADO";

export type CreditDecisionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";

export type CreditDecisionReason = {
  code: string;
  label: string;
  description: string;
  origin: string;
  severity: CreditDecisionSeverity;
};

export const CREDIT_DECISION_PRESENTATION: Record<
  CreditDecisionState,
  { title: string; description: string; tone: "critical" | "blocked" | "review" | "released" | "undetermined" }
> = {
  BLOQUEIO_CRITICO: {
    title: "BLOQUEIO CRÍTICO DE CRÉDITO",
    description: "Venda a prazo bloqueada por ocorrência crítica. Respeite o fluxo de exceção vigente.",
    tone: "critical",
  },
  BLOQUEADO: {
    title: "CRÉDITO BLOQUEADO",
    description: "Venda a prazo não autorizada. Consulte os motivos e o fluxo de liberação.",
    tone: "blocked",
  },
  EM_ANALISE: {
    title: "CRÉDITO EM ANÁLISE",
    description: "A venda a prazo depende de decisão autorizada.",
    tone: "review",
  },
  LIBERADO: {
    title: "CRÉDITO LIBERADO",
    description: "Venda a prazo permitida conforme condições e limites vigentes.",
    tone: "released",
  },
  NAO_DETERMINADO: {
    title: "CRÉDITO NÃO DETERMINADO",
    description:
      "Não foi possível confirmar as condições de crédito. É necessária análise antes da venda a prazo.",
    tone: "undetermined",
  },
};

const CREDIT_REASON_CATALOG: Record<string, Omit<CreditDecisionReason, "code">> = {
  INTERNAL_PROTEST: {
    label: "Protesto interno confirmado",
    description: "Protesto interno pendente confirmado. Exige regularização antes da venda a prazo.",
    origin: "Contas a Receber — Nomus",
    severity: "CRITICAL",
  },
  OVERDUE_OPEN_BALANCE: {
    label: "Títulos vencidos em aberto",
    description: "Há título com saldo em aberto e atraso de pelo menos um dia.",
    origin: "Contas a Receber — Nomus",
    severity: "HIGH",
  },
  EXTERNAL_PROTEST: {
    label: "Protesto externo confirmado",
    description: "Protesto externo confirmado e vigente no registro interno.",
    origin: "Registro interno de protesto externo",
    severity: "HIGH",
  },
  EXTERNAL_PROTEST_REVIEW: {
    label: "Protesto externo exige revisão",
    description:
      "Consulta de protesto externo indisponível, desatualizada, cancelada ou não confirmada. Não significa ausência de protesto.",
    origin: "Consulta de protesto externo",
    severity: "MEDIUM",
  },
  FINANCIAL_UNVERIFIED: {
    label: "Dados financeiros não verificados",
    description: "Dados financeiros indisponíveis ou desatualizados. Exige análise antes da liberação.",
    origin: "Sincronização Nomus",
    severity: "MEDIUM",
  },
  RELATED_PARTY_DELINQUENT: {
    label: "Vínculo societário inadimplente",
    description: "Vínculo societário com empresa inadimplente. A dívida não foi transferida.",
    origin: "Vínculo societário",
    severity: "MEDIUM",
  },
  RELATED_PARTY_UNVERIFIED: {
    label: "Vínculo societário sem verificação",
    description: "Vínculo societário sem verificação financeira.",
    origin: "Vínculo societário",
    severity: "MEDIUM",
  },
  QUOD_EXTERNAL_RESTRICTION: {
    label: "Evidência externa do dossiê QUOD",
    description:
      "Evidência externa do dossiê exige decisão administrativa. O score externo não libera o cliente.",
    origin: "Dossiê QUOD — Direct Data",
    severity: "MEDIUM",
  },
  QUOD_INSUFFICIENT: {
    label: "Consulta externa insuficiente",
    description: "A consulta externa não trouxe informação suficiente. Não significa cliente regular.",
    origin: "Dossiê QUOD — Direct Data",
    severity: "INFO",
  },
  IEPTB_NATIONAL_PROTEST: {
    label: "Protesto nacional IEPTB",
    description:
      "Protesto nacional confirmado na consulta IEPTB. Exige decisão administrativa. Não substitui o protesto interno Nomus.",
    origin: "Protestos Nacional — IEPTB Online",
    severity: "MEDIUM",
  },
  IEPTB_INSUFFICIENT: {
    label: "Consulta nacional de protestos insuficiente",
    description: "A consulta IEPTB não trouxe informação suficiente. Não significa ausência de protesto.",
    origin: "Protestos Nacional — IEPTB Online",
    severity: "INFO",
  },
};

export function describeCreditDecisionReasons(reasons: readonly string[]): CreditDecisionReason[] {
  const seen = new Set<string>();
  const out: CreditDecisionReason[] = [];
  for (const code of reasons) {
    const entry = CREDIT_REASON_CATALOG[code];
    if (!entry || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, ...entry });
  }
  return out;
}

/** Formata ISO para "20/10/2026 às 12:03" sem alterar o timestamp armazenado. */
export function formatCreditDateTime(iso: string | null | undefined): string {
  if (!iso) return INTELLIGENCE_FACT_LABEL.NOT_CONSULTED;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return INTELLIGENCE_FACT_LABEL.UNAVAILABLE;
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
}

export const BCB_CNPJ_NO_QUERY_DETAIL =
  "Não aplicável. Nenhuma consulta ao Banco Central foi realizada: não há cadastro empresarial por CNPJ neste escopo.";

export type CnpjSourceFactInput = {
  id: string;
  label: string;
  status: string;
  message?: string;
};

export function presentCnpjSourceFact(source: CnpjSourceFactInput): {
  label: string;
  state: IntelligenceFactState;
  stateLabel: string;
  detail: string;
} {
  if (source.status === "not_applicable") {
    return {
      label: source.label,
      state: "NOT_APPLICABLE",
      stateLabel: INTELLIGENCE_FACT_LABEL.NOT_APPLICABLE,
      detail: source.id === "bcb" ? BCB_CNPJ_NO_QUERY_DETAIL : source.message || "Fonte não aplicável. Nenhuma consulta foi realizada.",
    };
  }
  if (!source.status) {
    return {
      label: source.label,
      state: "NOT_CONSULTED",
      stateLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
      detail: "Fonte ainda não consultada.",
    };
  }
  if (source.status === "not_found") {
    return {
      label: source.label,
      state: "CLEAR",
      stateLabel: INTELLIGENCE_FACT_LABEL.CLEAR,
      detail: "Consulta realizada nesta fonte cadastral, sem ocorrência.",
    };
  }
  if (source.status === "ok") {
    return {
      label: source.label,
      state: "CLEAR",
      stateLabel: "Consultada",
      detail: "Fonte cadastral consultada. O resultado não autoriza crédito.",
    };
  }
  return {
    label: source.label,
    state: "UNAVAILABLE",
    stateLabel: INTELLIGENCE_FACT_LABEL.UNAVAILABLE,
    detail: source.message?.trim() || "Fonte indisponível nesta consulta.",
  };
}

export type CreditOverdueTitleView = {
  id: string;
  documentLabel: string;
  descriptionLabel: string;
  dueDateLabel: string;
  daysOverdueLabel: string;
  amountLabel: string;
  protested: boolean;
};

export type CommercialCreditIntelligenceView = {
  consulted: boolean;
  customerStatus: CommercialCreditDecisionStatus | null;
  headline: "CRÉDITO BLOQUEADO" | null;
  /** Estado executivo para o cabeçalho de decisão (A–E). */
  decisionState: CreditDecisionState;
  decisionTitle: string;
  decisionDescription: string;
  decisionTone: "critical" | "blocked" | "review" | "released" | "undetermined";
  decisionReasons: CreditDecisionReason[];
  decisionEvaluatedAtLabel: string;
  quodState: CommercialQuodEvidence["state"];
  quodConfirmedRestriction: boolean;
  ieptbState: CommercialIeptbEvidence["state"];
  ieptbConfirmedProtest: boolean;
  situationLabel: string;
  reason: string | null;
  cadastralAuthorizesCredit: false;
  financialDetailsVisible: boolean;
  financialDetailsRestricted: boolean;
  overdueAmountLabel: string;
  overdueTitleCountLabel: string;
  maxDaysOverdueLabel: string;
  overdueTitles: CreditOverdueTitleView[];
  internalProtest: IntelligenceFactState;
  internalProtestLabel: string;
  externalProtest: IntelligenceFactState;
  externalProtestLabel: string;
  externalProtestDetail: string;
  bcbState: "NOT_APPLICABLE";
  bcbLabel: string;
  bcbDetail: string;
  lastSyncedAtLabel: string;
  syncState: IntelligenceFactState;
  blockReason: string | null;
  evidenceOrigin: string;
  occurrenceLines: string[];
  corporateRelations: CorporateRelationView[];
  cadastralScoreLabel: string;
  cadastralVerdict: string | null;
  authorizedExceptions: string[];
};

const EVIDENCE_ORIGIN =
  "Contas a Receber sincronizadas do Nomus (NomusAccountsReceivable). Protesto externo: registro interno, sem bureau inventado. O score cadastral não entra na decisão.";

function creditDecisionState(status: CommercialCreditDecisionStatus): CreditDecisionState {
  switch (status) {
    case "BLOQUEIO_CRITICO":
      return "BLOQUEIO_CRITICO";
    case "BLOQUEADO":
      return "BLOQUEADO";
    case "EM_ANALISE":
      return "EM_ANALISE";
    case "LIBERADO":
      return "LIBERADO";
  }
}

function situationLabel(status: CommercialCreditDecisionStatus): string {
  switch (status) {
    case "LIBERADO":
      return "Liberado";
    case "EM_ANALISE":
      return "Em análise";
    case "BLOQUEADO":
      return "Bloqueado";
    case "BLOQUEIO_CRITICO":
      return "Bloqueio crítico";
  }
}

function moneyLabel(value: number | null, reveal: boolean, consulted: boolean, unavailable: boolean, clear: boolean): string {
  if (!consulted) return INTELLIGENCE_FACT_LABEL.NOT_CONSULTED;
  if (!reveal) return "Restrito";
  if (unavailable || value == null) return INTELLIGENCE_FACT_LABEL.UNAVAILABLE;
  if (clear && value === 0) return INTELLIGENCE_FACT_LABEL.CLEAR;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function countLabel(value: number | null, reveal: boolean, consulted: boolean, unavailable: boolean, clear: boolean): string {
  if (!consulted) return INTELLIGENCE_FACT_LABEL.NOT_CONSULTED;
  if (!reveal) return "Restrito";
  if (unavailable || value == null) return INTELLIGENCE_FACT_LABEL.UNAVAILABLE;
  if (clear && value === 0) return INTELLIGENCE_FACT_LABEL.CLEAR;
  return String(value);
}

function formatOverdueDueDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR");
}

function presentOverdueTitles(
  delinquency: CommercialDelinquencyAnalysis,
  reveal: boolean,
  unavailable: boolean
): CreditOverdueTitleView[] {
  if (!reveal || unavailable) return [];
  return (delinquency.overdueTitles ?? []).map((title) => ({
    id: String(title.externalId),
    documentLabel: title.sourceInvoiceNumber?.trim() || `#${title.externalId}`,
    descriptionLabel: title.description?.trim() || "—",
    dueDateLabel: formatOverdueDueDate(title.dueDate),
    daysOverdueLabel: daysLabel(title.daysOverdue, true, true, false, false),
    amountLabel: moneyLabel(title.balanceReceivable, true, true, false, false),
    protested: title.protested,
  }));
}

function daysLabel(value: number | null, reveal: boolean, consulted: boolean, unavailable: boolean, clear: boolean): string {
  if (!consulted) return INTELLIGENCE_FACT_LABEL.NOT_CONSULTED;
  if (!reveal) return "Restrito";
  if (unavailable || value == null) return INTELLIGENCE_FACT_LABEL.UNAVAILABLE;
  if (clear && value === 0) return INTELLIGENCE_FACT_LABEL.CLEAR;
  return value === 1 ? "1 dia" : `${value} dias`;
}

function syncLabel(iso: string | null, consulted: boolean, unavailable: boolean): { label: string; state: IntelligenceFactState } {
  if (!consulted) return { label: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED, state: "NOT_CONSULTED" };
  if (unavailable || !iso) return { label: INTELLIGENCE_FACT_LABEL.UNAVAILABLE, state: "UNAVAILABLE" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: INTELLIGENCE_FACT_LABEL.UNAVAILABLE, state: "UNAVAILABLE" };
  return { label: date.toLocaleString("pt-BR"), state: "CLEAR" };
}

function internalProtestState(
  delinquency: CommercialDelinquencyAnalysis | null,
  decision: { reason: string; reasons: readonly string[] } | null
): IntelligenceFactState {
  if (!delinquency) return "NOT_CONSULTED";
  const formal = decision?.reason === "INTERNAL_PROTEST" || (decision?.reasons ?? []).includes("INTERNAL_PROTEST");
  if (formal || delinquency.status === "PROTESTED" || delinquency.evidence.protestedTitleIds.length > 0) return "FOUND";
  if (delinquency.status === "UNKNOWN" || delinquency.evidence.protestReading === "UNRECOGNIZED") return "UNAVAILABLE";
  return "CLEAR";
}

function externalProtestState(
  status: CommercialExternalProtestStatus | null,
  consultation?: ExternalProtestCreditFact | null
): {
  state: IntelligenceFactState;
  detail: string;
} {
  if (status === "CONFIRMED_CURRENT" || consultation?.confirmedCurrent) {
    return { state: "FOUND", detail: "Protesto externo confirmado e vigente." };
  }
  if (consultation?.reliableClear && status !== "UNREADABLE") {
    return { state: "CLEAR", detail: "Consulta vigente sem protesto confirmado." };
  }
  if (consultation?.review === "CANCELLED") {
    return {
      state: "UNAVAILABLE",
      detail: "Protesto externo cancelado ou retirado na última consulta. Exige revisão antes da venda a prazo.",
    };
  }
  if (consultation?.review === "UNCONFIRMED") {
    return { state: "UNAVAILABLE", detail: "Ocorrência externa não confirmada. Exige revisão antes da venda a prazo." };
  }
  if (consultation?.review === "STALE") {
    return {
      state: "UNAVAILABLE",
      detail: "Consulta de protesto externo desatualizada. O resultado antigo não libera a venda a prazo.",
    };
  }
  if (consultation?.review === "UNAVAILABLE" || status === "UNREADABLE") {
    return {
      state: "UNAVAILABLE",
      detail: "Consulta de protesto externo indisponível ou ilegível. A falha não significa ausência de protesto.",
    };
  }
  if (status == null || !consultation || !consultation.enabled) {
    return { state: "NOT_CONSULTED", detail: EXTERNAL_PROTEST_NOT_CONSULTED_DETAIL };
  }
  return { state: "NOT_CONSULTED", detail: EXTERNAL_PROTEST_NOT_CONSULTED_DETAIL };
}

export function notConsultedCommercialCreditView(): CommercialCreditIntelligenceView {
  return {
    consulted: false,
    customerStatus: null,
    headline: null,
    decisionState: "NAO_DETERMINADO",
    decisionTitle: CREDIT_DECISION_PRESENTATION.NAO_DETERMINADO.title,
    decisionDescription: CREDIT_DECISION_PRESENTATION.NAO_DETERMINADO.description,
    decisionTone: CREDIT_DECISION_PRESENTATION.NAO_DETERMINADO.tone,
    decisionReasons: [],
    decisionEvaluatedAtLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    quodState: "NOT_CONSULTED",
    quodConfirmedRestriction: false,
    ieptbState: "NOT_CONSULTED",
    ieptbConfirmedProtest: false,
    situationLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    reason: null,
    cadastralAuthorizesCredit: false,
    financialDetailsVisible: false,
    financialDetailsRestricted: false,
    overdueAmountLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    overdueTitleCountLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    maxDaysOverdueLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    overdueTitles: [],
    internalProtest: "NOT_CONSULTED",
    internalProtestLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    externalProtest: "NOT_CONSULTED",
    externalProtestLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    externalProtestDetail: EXTERNAL_PROTEST_NOT_CONSULTED_DETAIL,
    bcbState: "NOT_APPLICABLE",
    bcbLabel: INTELLIGENCE_FACT_LABEL.NOT_APPLICABLE,
    bcbDetail: BCB_CNPJ_NO_QUERY_DETAIL,
    lastSyncedAtLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    syncState: "NOT_CONSULTED",
    blockReason: null,
    evidenceOrigin: EVIDENCE_ORIGIN,
    occurrenceLines: [],
    corporateRelations: [],
    cadastralScoreLabel: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
    cadastralVerdict: null,
    authorizedExceptions: [],
  };
}

export function buildCommercialCreditIntelligenceView(input: {
  decision: CommercialCreditDecision;
  delinquency: CommercialDelinquencyAnalysis;
  externalProtest: CommercialExternalProtestStatus;
  revealFinancial: boolean;
  occurrenceLines?: readonly string[];
  externalProtestConsultation?: ExternalProtestCreditFact | null;
  corporateRelations?: readonly CorporateRelationView[];
  authorizedExceptions?: readonly string[];
}): CommercialCreditIntelligenceView {
  const status = input.decision.customerStatus;
  const unavailable = input.delinquency.status === "UNKNOWN";
  const clearBook = !unavailable && (input.delinquency.overdueTitleCount ?? 0) === 0 && status !== "BLOQUEADO" && status !== "BLOQUEIO_CRITICO";
  const blocked = status === "BLOQUEADO" || status === "BLOQUEIO_CRITICO";
  const protest = internalProtestState(input.delinquency, input.decision);
  const external = externalProtestState(input.externalProtest, input.externalProtestConsultation);
  const sync = syncLabel(input.delinquency.lastSyncedAt, true, unavailable && input.delinquency.lastSyncedAt == null);
  const reason = commercialCreditReasonMessage(input.decision.reason);
  const decisionState = creditDecisionState(status);
  const presentation = CREDIT_DECISION_PRESENTATION[decisionState];
  return {
    consulted: true,
    customerStatus: status,
    headline: blocked ? "CRÉDITO BLOQUEADO" : null,
    decisionState,
    decisionTitle: presentation.title,
    decisionDescription: presentation.description,
    decisionTone: presentation.tone,
    decisionReasons: describeCreditDecisionReasons(input.decision.reasons),
    decisionEvaluatedAtLabel: formatCreditDateTime(input.delinquency.lastSyncedAt),
    quodState: input.decision.evidence.quodState,
    quodConfirmedRestriction: input.decision.evidence.quodConfirmedRestriction === true,
    ieptbState: input.decision.evidence.ieptbState,
    ieptbConfirmedProtest: input.decision.evidence.ieptbConfirmedProtest === true,
    situationLabel: unavailable && status === "EM_ANALISE" ? "Não verificado" : situationLabel(status),
    reason,
    cadastralAuthorizesCredit: false,
    financialDetailsVisible: input.revealFinancial && !unavailable,
    financialDetailsRestricted: !input.revealFinancial,
    overdueAmountLabel: moneyLabel(input.delinquency.overdueAmount, input.revealFinancial, true, unavailable, clearBook),
    overdueTitleCountLabel: countLabel(input.delinquency.overdueTitleCount, input.revealFinancial, true, unavailable, clearBook),
    maxDaysOverdueLabel: daysLabel(input.delinquency.maxDaysOverdue, input.revealFinancial, true, unavailable, clearBook),
    overdueTitles: presentOverdueTitles(input.delinquency, input.revealFinancial, unavailable),
    internalProtest: protest,
    internalProtestLabel: INTELLIGENCE_FACT_LABEL[protest],
    externalProtest: external.state,
    externalProtestLabel: INTELLIGENCE_FACT_LABEL[external.state],
    externalProtestDetail: external.detail,
    bcbState: "NOT_APPLICABLE",
    bcbLabel: INTELLIGENCE_FACT_LABEL.NOT_APPLICABLE,
    bcbDetail: BCB_CNPJ_NO_QUERY_DETAIL,
    lastSyncedAtLabel: sync.label,
    syncState: sync.state,
    blockReason: blocked || status === "EM_ANALISE" ? reason : null,
    evidenceOrigin: EVIDENCE_ORIGIN,
    occurrenceLines: [...(input.occurrenceLines ?? [])],
    corporateRelations: [...(input.corporateRelations ?? [])],
    cadastralScoreLabel:
      input.decision.evidence.cadastralScore == null
        ? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED
        : `${input.decision.evidence.cadastralScore}/100`,
    cadastralVerdict: input.decision.evidence.cadastralVerdict,
    authorizedExceptions: [...(input.authorizedExceptions ?? [])],
  };
}
