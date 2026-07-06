/**
 * Narrativa executiva — Inteligência do Cliente.
 */

import {
  COMMERCIAL_CLASSIFICATION_LABEL_PT,
  HEALTH_CLASSIFICATION_LABEL_PT,
} from "@/src/lib/customerIntelligenceNavigation.js";
import type {
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceCrm,
  CustomerIntelligenceFinancial,
  CustomerIntelligenceOpportunity,
  CustomerIntelligenceProductMix,
  CustomerIntelligenceProfile,
  CustomerIntelligenceRepurchase,
  CustomerIntelligenceScoring,
} from "@/src/lib/customerIntelligenceTypes.js";

export function buildCustomerIntelligenceExecutiveNarrative(input: {
  customer: CustomerIntelligenceProfile;
  commercialSummary: CustomerIntelligenceCommercialSummary;
  repurchase: CustomerIntelligenceRepurchase;
  financial: CustomerIntelligenceFinancial;
  crm: CustomerIntelligenceCrm;
  products: CustomerIntelligenceProductMix;
  scoring: CustomerIntelligenceScoring;
  opportunities: CustomerIntelligenceOpportunity[];
}): string[] {
  const lines: string[] = [];
  const name = input.customer.name;

  if (input.commercialSummary.validOrdersCount === 0) {
    lines.push(
      `${name} ainda não possui pedidos de venda válidos no período/filtros aplicados.`
    );
    lines.push("Histórico insuficiente para previsão de recompra e score comercial pleno.");
    return lines;
  }

  lines.push(
    `Score de saúde comercial: ${input.scoring.score}/100 (${HEALTH_CLASSIFICATION_LABEL_PT[input.scoring.healthClassification]}).`
  );

  lines.push(
    `Classificação: ${COMMERCIAL_CLASSIFICATION_LABEL_PT[input.scoring.commercialClassification]}.`
  );

  const days = input.commercialSummary.daysSinceLastOrder;
  if (days != null && days > 365) {
    lines.push(`Cliente sem compra há ${days} dias; recomendado plano de reativação.`);
  } else if (days != null) {
    lines.push(
      `${name} registrou ${input.commercialSummary.validOrdersCount} pedido(s) válido(s) com receita líquida de R$ ${input.commercialSummary.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}; última compra há ${days} dia(s).`
    );
  } else {
    lines.push(
      `${name} registrou ${input.commercialSummary.validOrdersCount} pedido(s) válido(s) com receita líquida de R$ ${input.commercialSummary.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`
    );
  }

  const top3Share = input.products.concentration.top3RevenueSharePercent;
  if (
    top3Share != null &&
    top3Share >= 70 &&
    input.products.concentration.distinctProductsCount >= 2
  ) {
    lines.push(
      `Receita concentrada em ${Math.min(3, input.products.concentration.distinctProductsCount)} produtos; oportunidade de ampliar mix.`
    );
  }

  if (input.repurchase.status === "ATRASADO") {
    lines.push("Janela de recompra em atraso — priorizar contato comercial.");
  } else if (input.repurchase.status === "PROXIMA") {
    lines.push("Cliente próximo da janela típica de novo pedido.");
  } else if (input.repurchase.status === "INSUFICIENTE") {
    lines.push("Histórico insuficiente para previsão de recompra.");
  }

  if (input.financial.linkedByCnpj && (input.financial.overdueAmount ?? 0) > 0) {
    lines.push(
      `Cliente possui valor vencido; alinhar cobrança antes de nova negociação (R$ ${(input.financial.overdueAmount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).`
    );
  }

  if (input.crm.overdueTasksCount > 0) {
    lines.push(
      `${input.crm.overdueTasksCount} tarefa(s) CRM vencida(s) — executar follow-up pendente.`
    );
  }

  const topAction = input.opportunities[0];
  if (topAction && topAction.type === "OPPORTUNITY") {
    lines.push(`Próxima ação sugerida: ${topAction.suggestedAction}`);
  } else if (topAction && topAction.type === "RISK") {
    lines.push(`Alerta prioritário: ${topAction.title}.`);
  }

  if (lines.length < 3 && input.commercialSummary.averageTicket != null) {
    lines.push(
      `Ticket médio: R$ ${input.commercialSummary.averageTicket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`
    );
  }

  return dedupeLines(lines).slice(0, 10);
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Garante ao menos uma linha útil quando há pedidos válidos. */
export function ensureNarrativeNotEmpty(
  narrative: string[],
  fallback: string
): string[] {
  if (narrative.length > 0) return narrative;
  return [fallback];
}
