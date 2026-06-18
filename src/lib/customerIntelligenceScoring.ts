/**
 * Score de saúde comercial (0–100) — Inteligência do Cliente.
 * Determinístico, testável, sem NaN/Infinity.
 */

import type {
  CustomerIntelligenceCommercialClassification,
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceCrm,
  CustomerIntelligenceFinancial,
  CustomerIntelligenceHealthClassification,
  CustomerIntelligencePurchaseHistory,
  CustomerIntelligenceRepurchase,
  CustomerIntelligenceScoreCriterion,
  CustomerIntelligenceScoring,
} from "@/src/lib/customerIntelligenceTypes.js";

export const CUSTOMER_INTELLIGENCE_SCORE_WEIGHTS = {
  purchaseRecency: 20,
  purchaseFrequency: 15,
  revenue: 10,
  trend: 10,
  margin: 10,
  financial: 15,
  crm: 10,
  repurchase: 10,
} as const;

export const CUSTOMER_INTELLIGENCE_INACTIVE_DAYS = 365;
export const CUSTOMER_INTELLIGENCE_STRATEGIC_MIN_ORDERS = 5;
export const CUSTOMER_INTELLIGENCE_STRATEGIC_MIN_REVENUE = 100_000;
export const CUSTOMER_INTELLIGENCE_RECURRENT_MIN_ORDERS = 3;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function criterion(
  id: CustomerIntelligenceScoreCriterion["id"],
  label: string,
  weight: number,
  partialScore: number,
  evidence: string | null
): CustomerIntelligenceScoreCriterion {
  const safePartial = clampScore(partialScore);
  const earnedPoints = clampScore((safePartial / 100) * weight);
  return {
    id,
    label,
    weight,
    partialScore: safePartial,
    earnedPoints,
    maxPoints: weight,
    evidence,
  };
}

export function scorePurchaseRecency(daysSinceLastOrder: number | null): number {
  if (daysSinceLastOrder == null || !Number.isFinite(daysSinceLastOrder)) return 0;
  const days = Math.max(0, Math.floor(daysSinceLastOrder));
  if (days <= 30) return 100;
  if (days <= 90) return 80;
  if (days <= 180) return 60;
  if (days <= 365) return 40;
  if (days <= 730) return 20;
  return 5;
}

export function scorePurchaseFrequency(validOrdersCount: number): number {
  if (validOrdersCount <= 0) return 0;
  if (validOrdersCount === 1) return 30;
  if (validOrdersCount === 2) return 50;
  if (validOrdersCount <= 5) return 70;
  if (validOrdersCount <= 10) return 85;
  return 100;
}

export function scoreRevenue(revenue: number): number {
  if (!Number.isFinite(revenue) || revenue <= 0) return 0;
  if (revenue >= 500_000) return 100;
  if (revenue >= 100_000) return 90;
  if (revenue >= 50_000) return 75;
  if (revenue >= 10_000) return 60;
  return 40;
}

export function scoreTrend(
  growthStatus: CustomerIntelligencePurchaseHistory["analysis"]["growthStatus"]
): number {
  switch (growthStatus) {
    case "growth":
      return 100;
    case "stable":
      return 70;
    case "decline":
      return 30;
    case "sem_base":
    case "insufficient":
      return 50;
    default:
      return 50;
  }
}

export function scoreMargin(averageMarginPercent: number | null): number {
  if (averageMarginPercent == null || !Number.isFinite(averageMarginPercent)) return 50;
  if (averageMarginPercent < 0) return 10;
  if (averageMarginPercent >= 15) return 100;
  if (averageMarginPercent >= 10) return 80;
  if (averageMarginPercent >= 5) return 60;
  return 40;
}

export function scoreFinancial(financial: CustomerIntelligenceFinancial): number {
  if (!financial.linkedByCnpj) return 70;
  const overdue = financial.overdueAmount ?? 0;
  if (!Number.isFinite(overdue) || overdue <= 0) return 100;
  if (overdue >= 50_000) return 10;
  if (overdue >= 10_000) return 20;
  if (overdue >= 1_000) return 35;
  return 50;
}

export function scoreCrm(crm: CustomerIntelligenceCrm): number {
  if (crm.relationshipStatus === "sem_historico") return 50;
  if (crm.overdueTasksCount > 0) return 25;
  if (crm.relationshipStatus === "tarefa_vencida") return 30;
  if (crm.relationshipStatus === "sem_contato_recente") return 40;
  if (crm.relationshipStatus === "reativacao") return 45;
  if (crm.daysSinceLastContact != null && crm.daysSinceLastContact <= 90) return 100;
  if (crm.lastContactAt != null) return 70;
  return 50;
}

export function scoreRepurchase(repurchase: CustomerIntelligenceRepurchase): number {
  switch (repurchase.status) {
    case "DENTRO_JANELA":
    case "PROXIMA":
      return 100;
    case "ATRASADO":
      return 25;
    case "INSUFICIENTE":
      return 50;
    default:
      return 50;
  }
}

export function resolveHealthClassification(input: {
  score: number;
  validOrdersCount: number;
  daysSinceLastOrder: number | null;
  repurchaseStatus: CustomerIntelligenceRepurchase["status"];
  hasOverdueFinancial: boolean;
  overdueTasksCount: number;
}): CustomerIntelligenceHealthClassification {
  if (
    input.validOrdersCount === 0 ||
    (input.validOrdersCount === 1 && input.repurchaseStatus === "INSUFICIENTE")
  ) {
    return "historico_insuficiente";
  }

  if (
    input.daysSinceLastOrder != null &&
    input.daysSinceLastOrder > CUSTOMER_INTELLIGENCE_INACTIVE_DAYS &&
    input.score < 55
  ) {
    return "inativo";
  }

  if (
    input.score < 40 ||
    input.hasOverdueFinancial ||
    (input.overdueTasksCount > 0 && input.score < 50)
  ) {
    return "risco";
  }

  if (input.score < 60) return "atencao";
  if (input.score < 80) return "saudavel";
  return "excelente";
}

export function resolveCommercialClassification(input: {
  validOrdersCount: number;
  revenue: number;
  daysSinceLastOrder: number | null;
  financialStatus: CustomerIntelligenceFinancial["financialStatus"];
  overdueAmount: number;
  crmRelationshipStatus: CustomerIntelligenceCrm["relationshipStatus"];
  repurchaseStatus: CustomerIntelligenceRepurchase["status"];
  hasActionableOpportunity: boolean;
}): CustomerIntelligenceCommercialClassification {
  if (input.validOrdersCount === 0) return "historico_insuficiente";
  if (input.financialStatus === "overdue" && input.overdueAmount > 0) {
    return "risco_financeiro";
  }
  if (
    input.crmRelationshipStatus === "reativacao" ||
    (input.daysSinceLastOrder != null && input.daysSinceLastOrder > 90)
  ) {
    return "reativacao";
  }
  if (
    input.validOrdersCount >= CUSTOMER_INTELLIGENCE_STRATEGIC_MIN_ORDERS &&
    input.revenue >= CUSTOMER_INTELLIGENCE_STRATEGIC_MIN_REVENUE
  ) {
    return "cliente_estrategico";
  }
  if (
    input.validOrdersCount >= CUSTOMER_INTELLIGENCE_RECURRENT_MIN_ORDERS &&
    (input.daysSinceLastOrder == null || input.daysSinceLastOrder <= 180)
  ) {
    return "cliente_recorrente";
  }
  if (input.hasActionableOpportunity || input.repurchaseStatus === "PROXIMA") {
    return "oportunidade";
  }
  if (input.revenue < 10_000 && input.validOrdersCount <= 2) {
    return "baixo_potencial";
  }
  return "cliente_recorrente";
}

export function buildCustomerIntelligenceScoring(input: {
  commercialSummary: CustomerIntelligenceCommercialSummary;
  history: CustomerIntelligencePurchaseHistory;
  repurchase: CustomerIntelligenceRepurchase;
  financial: CustomerIntelligenceFinancial;
  crm: CustomerIntelligenceCrm;
}): CustomerIntelligenceScoring {
  const weights = CUSTOMER_INTELLIGENCE_SCORE_WEIGHTS;
  const { commercialSummary, history, repurchase, financial, crm } = input;

  const recencyDays = commercialSummary.daysSinceLastOrder;
  const recencyPartial = scorePurchaseRecency(recencyDays);
  const frequencyPartial = scorePurchaseFrequency(commercialSummary.validOrdersCount);
  const revenuePartial = scoreRevenue(commercialSummary.revenue);
  const trendPartial = scoreTrend(history.analysis.growthStatus);
  const marginPartial = scoreMargin(commercialSummary.averageMarginPercent);
  const financialPartial = scoreFinancial(financial);
  const crmPartial = scoreCrm(crm);
  const repurchasePartial = scoreRepurchase(repurchase);

  const criteria: CustomerIntelligenceScoreCriterion[] = [
    criterion(
      "purchase_recency",
      "Recência de compra",
      weights.purchaseRecency,
      recencyPartial,
      recencyDays != null ? `${recencyDays} dia(s) desde a última compra` : "Sem compra registrada"
    ),
    criterion(
      "purchase_frequency",
      "Frequência de compras",
      weights.purchaseFrequency,
      frequencyPartial,
      `${commercialSummary.validOrdersCount} pedido(s) válido(s) no filtro`
    ),
    criterion(
      "revenue",
      "Receita no filtro",
      weights.revenue,
      revenuePartial,
      `Receita líquida R$ ${commercialSummary.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    ),
    criterion(
      "trend",
      "Tendência de receita",
      weights.trend,
      trendPartial,
      history.analysis.trendReading
    ),
    criterion(
      "margin",
      "Margem média",
      weights.margin,
      marginPartial,
      commercialSummary.averageMarginPercent != null
        ? `Margem média ${commercialSummary.averageMarginPercent.toFixed(1)}%`
        : "Margem indisponível"
    ),
    criterion(
      "financial",
      "Situação financeira (AR)",
      weights.financial,
      financialPartial,
      financial.linkedByCnpj
        ? financial.overdueAmount != null && financial.overdueAmount > 0
          ? `Inadimplência R$ ${financial.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : "Sem saldo vencido vinculado"
        : "Financeiro não vinculado por CNPJ"
    ),
    criterion(
      "crm",
      "Relacionamento (CRM)",
      weights.crm,
      crmPartial,
      crm.lastContactAt
        ? `Último contato há ${crm.daysSinceLastContact ?? "—"} dia(s); status ${crm.relationshipStatus}`
        : `Status CRM: ${crm.relationshipStatus}`
    ),
    criterion(
      "repurchase",
      "Janela de recompra",
      weights.repurchase,
      repurchasePartial,
      repurchase.detail
    ),
  ];

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const earned = criteria.reduce((acc, c) => acc + c.earnedPoints, 0);
  const score = clampScore(totalWeight > 0 ? (earned / totalWeight) * 100 : 0);

  const hasOverdueFinancial = (financial.overdueAmount ?? 0) > 0;
  const healthClassification = resolveHealthClassification({
    score,
    validOrdersCount: commercialSummary.validOrdersCount,
    daysSinceLastOrder: commercialSummary.daysSinceLastOrder,
    repurchaseStatus: repurchase.status,
    hasOverdueFinancial,
    overdueTasksCount: crm.overdueTasksCount,
  });

  const commercialClassification = resolveCommercialClassification({
    validOrdersCount: commercialSummary.validOrdersCount,
    revenue: commercialSummary.revenue,
    daysSinceLastOrder: commercialSummary.daysSinceLastOrder,
    financialStatus: financial.financialStatus,
    overdueAmount: financial.overdueAmount ?? 0,
    crmRelationshipStatus: crm.relationshipStatus,
    repurchaseStatus: repurchase.status,
    hasActionableOpportunity: false,
  });

  const summary = buildScoringSummary(score, healthClassification, commercialClassification);

  return {
    score,
    healthClassification,
    commercialClassification,
    criteria,
    summary,
  };
}

function buildScoringSummary(
  score: number,
  health: CustomerIntelligenceHealthClassification,
  commercial: CustomerIntelligenceCommercialClassification
): string {
  return `Score ${score}/100 — saúde ${health.replace(/_/g, " ")}; classificação ${commercial.replace(/_/g, " ")}.`;
}

/** Reavalia classificação comercial após oportunidades calculadas. */
export function applyCommercialClassificationFromOpportunities(
  scoring: CustomerIntelligenceScoring,
  input: Parameters<typeof resolveCommercialClassification>[0]
): CustomerIntelligenceScoring {
  const commercialClassification = resolveCommercialClassification(input);
  return {
    ...scoring,
    commercialClassification,
    summary: buildScoringSummary(scoring.score, scoring.healthClassification, commercialClassification),
  };
}
