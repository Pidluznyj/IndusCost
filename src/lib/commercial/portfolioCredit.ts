/**
 * Apresentação da carteira. Usa a decisão oficial e o Score de Confiança.
 * Não autoriza venda e não relê título.
 */
import {
  classifyCommercialSaleTerms,
  type CommercialCreditDecision,
  type CommercialCreditDecisionStatus,
} from "./commercialCreditDecision.js";
import {
  CREDIT_CONFIDENCE_POLICY_VERSION,
  creditConfidenceFromEvidence,
  type CreditConfidenceResult,
} from "./creditConfidence.js";

export type PortfolioCreditReasonGroup =
  | "inadimplencia_propria"
  | "protesto"
  | "restricao_quod"
  | "risco_compartilhado"
  | "avaliacao_pendente"
  | "cadastro_incompleto"
  | "regular";

export type PortfolioCreditDecisionPublic = {
  customerStatus: CommercialCreditDecisionStatus | "LEITURA_INDISPONIVEL";
  decisionTitle: string;
  reason: string | null;
  reasonGroup: PortfolioCreditReasonGroup;
  reasonLabel: string;
  /** Motivos oficiais, inclusive falha complementar que não rebaixa um bloqueio. */
  reasons: string[];
  evaluatedAt: string;
  policyVersion: string;
  readFailed: boolean;
};

export function officialCreditDeniesTermSale(
  decision: { customerStatus?: string | null } | null | undefined
): boolean {
  return Boolean(decision?.customerStatus && decision.customerStatus !== "LIBERADO");
}

export function officialCreditSaleHint(decision: { decisionTitle: string; reasonLabel: string }): string {
  return `${decision.decisionTitle}. ${decision.reasonLabel}.`;
}

/** À vista não é concessão de prazo. Prazo e termo indefinido seguem o selo oficial. */
export function operationBlockedByOfficialCredit(input: {
  paymentTerms?: string | null;
  customerStatus?: string | null;
}): boolean {
  if (classifyCommercialSaleTerms(input.paymentTerms) === "CASH") return false;
  return officialCreditDeniesTermSale({ customerStatus: input.customerStatus });
}

export type PortfolioCreditPublic = {
  confidence: CreditConfidenceResult;
  decision: PortfolioCreditDecisionPublic;
};

const REASON_LABEL: Record<PortfolioCreditReasonGroup, string> = {
  inadimplencia_propria: "Inadimplência própria",
  protesto: "Protesto",
  restricao_quod: "Restrição QUOD",
  risco_compartilhado: "Risco compartilhado",
  avaliacao_pendente: "Avaliação pendente",
  cadastro_incompleto: "Cadastro incompleto",
  regular: "Sem restrição impeditiva",
};

export function portfolioCreditReasonGroup(reasons: readonly string[]): PortfolioCreditReasonGroup {
  if (reasons.some((reason) => reason === "INTERNAL_PROTEST" || reason === "EXTERNAL_PROTEST" || reason === "IEPTB_NATIONAL_PROTEST")) {
    return "protesto";
  }
  if (reasons.includes("OVERDUE_OPEN_BALANCE")) return "inadimplencia_propria";
  if (
    reasons.some((reason) =>
      ["RELATED_PARTY_DELINQUENT", "RELATED_PARTY_MARKET", "RELATED_PARTY_INCOMPLETE"].includes(reason)
    )
  ) {
    return "risco_compartilhado";
  }
  if (reasons.includes("QUOD_EXTERNAL_RESTRICTION") || reasons.includes("QUOD_INSUFFICIENT")) return "restricao_quod";
  if (
    reasons.some((reason) =>
      ["FINANCIAL_UNVERIFIED", "IEPTB_INSUFFICIENT", "EXTERNAL_PROTEST_REVIEW"].includes(reason)
    )
  ) {
    return "cadastro_incompleto";
  }
  if (reasons.includes("RELATED_PARTY_UNVERIFIED")) return "avaliacao_pendente";
  return "regular";
}

export function presentPortfolioCredit(decision: CommercialCreditDecision, now: Date = new Date()): PortfolioCreditPublic {
  const confidence = creditConfidenceFromEvidence(decision.evidence, now);
  const readFailed = decision.evidence.quodReadFailed || decision.evidence.ieptbReadFailed;
  const reasonGroup = portfolioCreditReasonGroup(decision.reasons);
  const blocked = decision.customerStatus === "BLOQUEADO" || decision.customerStatus === "BLOQUEIO_CRITICO";
  const decisionTitle = blocked
    ? "CRÉDITO BLOQUEADO"
    : decision.customerStatus === "EM_ANALISE"
      ? "CRÉDITO EM ANÁLISE"
      : "CRÉDITO LIBERADO";
  return {
    confidence,
    decision: {
      customerStatus: decision.customerStatus,
      decisionTitle,
      reason: decision.reason,
      reasonGroup,
      reasonLabel: REASON_LABEL[reasonGroup],
      reasons: [...decision.reasons],
      evaluatedAt: now.toISOString(),
      policyVersion: confidence.policyVersion,
      readFailed,
    },
  };
}

export function portfolioCreditReadFailed(now: Date = new Date()): PortfolioCreditPublic {
  const confidence = creditConfidenceFromEvidence(
    {
      cadastralScore: null,
      quodState: "UNAVAILABLE",
      quodConfirmedRestriction: false,
      ieptbState: "UNAVAILABLE",
      ieptbConfirmedProtest: false,
    },
    now
  );
  return {
    confidence,
    decision: {
      customerStatus: "LEITURA_INDISPONIVEL",
      decisionTitle: "CRÉDITO EM ANÁLISE",
      reason: "FINANCIAL_UNVERIFIED",
      reasonGroup: "avaliacao_pendente",
      reasonLabel: "Leitura indisponível",
      reasons: ["FINANCIAL_UNVERIFIED"],
      evaluatedAt: now.toISOString(),
      policyVersion: CREDIT_CONFIDENCE_POLICY_VERSION,
      readFailed: true,
    },
  };
}
