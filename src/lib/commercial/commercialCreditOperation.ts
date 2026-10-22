/**
 * Resumo operacional da decisão de crédito.
 * Não recalcula atraso, não copia título e não autoriza venda.
 */

import type { CommercialCreditDecision, CommercialCreditDecisionStatus } from "./commercialCreditDecision.js";
import type { CommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";

export const COMMERCIAL_CREDIT_PORTFOLIO_FILTERS = ["blocked", "pending_protest", "under_review"] as const;
export type CommercialCreditPortfolioFilter = (typeof COMMERCIAL_CREDIT_PORTFOLIO_FILTERS)[number];

export const COMMERCIAL_CREDIT_PORTFOLIO_FILTER_LABEL: Record<CommercialCreditPortfolioFilter, string> = {
  blocked: "Crédito bloqueado",
  pending_protest: "Protesto pendente",
  under_review: "Restrição em análise",
};

export const COMMERCIAL_CREDIT_PORTFOLIO_LIMIT = 40;

const SCOPE_LABEL: Record<string, string> = {
  OVERDUE: "Títulos vencidos",
  INTERNAL_PROTEST: "Protesto interno",
  EXTERNAL_PROTEST: "Protesto externo",
  RELATED_PARTY: "Vínculo societário",
  UNVERIFIED: "Situação não verificada",
};

export type CommercialCreditEvaluationDraft = {
  customerId: string;
  evaluatedAt: Date;
  evaluatedBy: string | null;
  status: CommercialCreditDecisionStatus;
  reason: string;
  enforcement: string;
  saleKind: string;
  allowed: boolean;
  sources: string;
  validUntil: Date | null;
  entityType: string | null;
  entityId: string | null;
};

export type CommercialCreditOperationSummary = {
  cadastralScoreLabel: string;
  cadastralVerdict: string | null;
  confidenceScoreLabel: string;
  confidenceNote: string | null;
  creditStatusLabel: string;
  statusCode: string | null;
  headline: string | null;
  overdueAmountLabel: string;
  overdueTitleCountLabel: string;
  internalProtestLabel: string;
  externalProtestLabel: string;
  corporateAlert: string | null;
  lastUpdatedLabel: string;
  exceptions: string[];
  evaluations: string[];
  visualOnly: true;
};

export function formatCommercialCreditException(input: {
  scope: string;
  expiresAt: Date;
  permission?: string | null;
}): string {
  const scope = SCOPE_LABEL[input.scope] ?? "Exceção autorizada";
  const until = input.expiresAt.toLocaleDateString("pt-BR");
  const permission = input.permission === "commercial.credit.exception.grant.board" ? "Diretoria" : "Financeiro";
  return `${scope} · ${permission} · válida até ${until}`;
}

export function commercialCreditEvaluationDraft(input: {
  customerId: string;
  decision: CommercialCreditDecision;
  evaluatedAt: Date;
  evaluatedBy: string | null;
  enforcement: string;
  validUntil?: Date | null;
  entityType?: string | null;
  entityId?: string | null;
}): CommercialCreditEvaluationDraft {
  return {
    customerId: input.customerId,
    evaluatedAt: input.evaluatedAt,
    evaluatedBy: input.evaluatedBy,
    status: input.decision.customerStatus,
    reason: input.decision.reason,
    enforcement: input.enforcement,
    saleKind: input.decision.saleKind,
    allowed: input.decision.allowed,
    sources: "Nomus AR, ocorrência de crédito, protesto externo, vínculo societário. Score cadastral ignorado.",
    validUntil: input.validUntil ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  };
}

export function presentCommercialCreditEvaluation(row: {
  evaluatedAt: Date | string;
  evaluatedBy: string | null;
  status: string;
  reason: string;
  sources: string;
  validUntil: Date | string | null;
  allowed: boolean;
}): string {
  const at = new Date(row.evaluatedAt);
  const when = Number.isNaN(at.getTime()) ? "data indisponível" : at.toLocaleString("pt-BR");
  const until = row.validUntil ? new Date(row.validUntil) : null;
  const validity =
    until && !Number.isNaN(until.getTime()) ? `válida até ${until.toLocaleDateString("pt-BR")}` : "sem exceção vigente";
  const actor = row.evaluatedBy ? `usuário ${row.evaluatedBy.slice(0, 8)}` : "usuário não identificado";
  const outcome = row.allowed ? "Autorizada" : "Recusada";
  return `${when} · ${actor} · ${outcome} · ${row.status} · ${row.reason} · ${row.sources} · ${validity}`;
}

export function buildCommercialCreditOperationSummary(
  view: CommercialCreditIntelligenceView,
  evaluations: readonly string[] = []
): CommercialCreditOperationSummary {
  const relation = view.corporateRelations[0];
  return {
    cadastralScoreLabel: view.cadastralScoreLabel,
    cadastralVerdict: view.cadastralVerdict,
    confidenceScoreLabel: view.confidenceScoreLabel,
    confidenceNote: view.confidenceNote,
    creditStatusLabel: view.situationLabel,
    statusCode: view.customerStatus,
    headline: view.headline,
    overdueAmountLabel: view.overdueAmountLabel,
    overdueTitleCountLabel: view.overdueTitleCountLabel,
    internalProtestLabel: view.internalProtestLabel,
    externalProtestLabel: view.externalProtestLabel,
    corporateAlert: relation
      ? `${relation.kindLabel} · ${relation.relatedCompany} · ${relation.creditStatusLabel}`
      : null,
    lastUpdatedLabel: view.lastSyncedAtLabel,
    exceptions: view.authorizedExceptions,
    evaluations: [...evaluations],
    visualOnly: true,
  };
}

export function matchesCommercialCreditPortfolioFilter(input: {
  filter: CommercialCreditPortfolioFilter;
  customerStatus: CommercialCreditDecisionStatus;
  confirmedPendingProtest: boolean;
  externalProtestConfirmed: boolean;
}): boolean {
  if (input.filter === "blocked") {
    return input.customerStatus === "BLOQUEADO" || input.customerStatus === "BLOQUEIO_CRITICO";
  }
  if (input.filter === "pending_protest") {
    return input.confirmedPendingProtest || input.externalProtestConfirmed;
  }
  return input.customerStatus === "EM_ANALISE";
}

export function readStoredCadastralScore(summary: unknown): { score: number | null; verdict: string | null } | null {
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return null;
  const root = summary as Record<string, unknown>;
  const score = typeof root.riskScore === "number" && Number.isFinite(root.riskScore) ? root.riskScore : null;
  const verdict = typeof root.riskVerdict === "string" && root.riskVerdict.trim() ? root.riskVerdict.trim() : null;
  if (score == null && verdict == null) return null;
  return { score, verdict };
}
