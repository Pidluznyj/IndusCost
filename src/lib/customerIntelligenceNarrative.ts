/**
 * Narrativa executiva — Inteligência do Cliente.
 */

import type {
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceFinancial,
  CustomerIntelligenceOpportunity,
  CustomerIntelligenceProfile,
  CustomerIntelligenceRepurchase,
} from "@/src/lib/customerIntelligenceTypes.js";

export function buildCustomerIntelligenceExecutiveNarrative(input: {
  customer: CustomerIntelligenceProfile;
  commercialSummary: CustomerIntelligenceCommercialSummary;
  repurchase: CustomerIntelligenceRepurchase;
  financial: CustomerIntelligenceFinancial;
  opportunities: CustomerIntelligenceOpportunity[];
}): string[] {
  const lines: string[] = [];
  const name = input.customer.name;

  if (input.commercialSummary.validOrdersCount === 0) {
    lines.push(
      `${name} ainda não possui pedidos de venda válidos no período/filtros aplicados.`
    );
    return lines;
  }

  lines.push(
    `${name} registrou ${input.commercialSummary.validOrdersCount} pedido(s) válido(s) com receita líquida de R$ ${input.commercialSummary.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`
  );

  if (input.commercialSummary.averageTicket != null) {
    lines.push(
      `Ticket médio: R$ ${input.commercialSummary.averageTicket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`
    );
  }

  if (input.commercialSummary.openPortfolioAmount > 0) {
    lines.push(
      `Carteira comercial em aberto: R$ ${input.commercialSummary.openPortfolioAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} aguardando faturamento/conclusão.`
    );
  }

  if (input.repurchase.status === "ATRASADO") {
    lines.push("Janela de recompra em atraso — priorizar contato comercial.");
  } else if (input.repurchase.status === "PROXIMA") {
    lines.push("Cliente próximo da janela típica de novo pedido.");
  } else if (input.repurchase.status === "INSUFICIENTE") {
    lines.push("Histórico insuficiente para estimar recompra com confiança.");
  }

  if (input.financial.linkedByCnpj) {
    if ((input.financial.overdueAmount ?? 0) > 0) {
      lines.push(
        `Inadimplência financeira (AR): R$ ${(input.financial.overdueAmount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em ${input.financial.overdueTitlesCount ?? 0} título(s).`
      );
    } else if ((input.financial.receivableOpenAmount ?? 0) > 0) {
      lines.push(
        `Carteira financeira em aberto (AR): R$ ${(input.financial.receivableOpenAmount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`
      );
    }
  }

  const highRisk = input.opportunities.filter(
    (o) => o.type === "RISK" && o.severity === "HIGH"
  );
  if (highRisk.length > 0) {
    lines.push(`Alerta: ${highRisk[0]!.title}.`);
  }

  return lines.slice(0, 8);
}
