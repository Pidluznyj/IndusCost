/**
 * Oportunidades e alertas comerciais — Inteligência do Cliente.
 */

import { CUSTOMER_INTELLIGENCE_INACTIVE_DAYS } from "@/src/lib/customerIntelligenceScoring.js";
import type {
  CustomerIntelligenceCommercialSummary,
  CustomerIntelligenceCrm,
  CustomerIntelligenceDataQuality,
  CustomerIntelligenceFinancial,
  CustomerIntelligenceOpportunity,
  CustomerIntelligenceOpportunityKind,
  CustomerIntelligenceProductMix,
  CustomerIntelligenceProfile,
  CustomerIntelligenceRepurchase,
  CustomerIntelligenceScoring,
} from "@/src/lib/customerIntelligenceTypes.js";

export const CUSTOMER_INTELLIGENCE_OPPORTUNITIES_LIMIT = 20;
export const CUSTOMER_INTELLIGENCE_MIX_CONCENTRATION_THRESHOLD = 70;

function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function severityBase(severity: CustomerIntelligenceOpportunity["severity"]): number {
  if (severity === "HIGH") return 80;
  if (severity === "MEDIUM") return 55;
  return 30;
}

export function computeOpportunityPriorityScore(input: {
  severity: CustomerIntelligenceOpportunity["severity"];
  type: CustomerIntelligenceOpportunity["type"];
  daysSinceLastOrder: number | null;
  overdueAmount: number;
  repurchaseStatus: CustomerIntelligenceRepurchase["status"];
}): number {
  let score = severityBase(input.severity);
  if (input.type === "RISK") score += 10;
  if (input.overdueAmount > 0) score += 15;
  if (input.repurchaseStatus === "ATRASADO") score += 12;
  if (input.repurchaseStatus === "PROXIMA") score += 8;
  if (
    input.daysSinceLastOrder != null &&
    input.daysSinceLastOrder > CUSTOMER_INTELLIGENCE_INACTIVE_DAYS
  ) {
    score += 10;
  }
  return clampPriority(score);
}

function makeOpportunity(
  partial: Omit<CustomerIntelligenceOpportunity, "priorityScore">,
  priorityInput: Parameters<typeof computeOpportunityPriorityScore>[0]
): CustomerIntelligenceOpportunity {
  return {
    ...partial,
    priorityScore: computeOpportunityPriorityScore(priorityInput),
  };
}

export function sortCustomerIntelligenceOpportunities(
  opportunities: CustomerIntelligenceOpportunity[]
): CustomerIntelligenceOpportunity[] {
  return [...opportunities].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
    const typeRank = { RISK: 3, OPPORTUNITY: 2, INFO: 1 } as const;
    const sev = severityRank[b.severity] - severityRank[a.severity];
    if (sev !== 0) return sev;
    return typeRank[b.type] - typeRank[a.type];
  });
}

export function buildCustomerIntelligenceOpportunities(input: {
  customer: CustomerIntelligenceProfile;
  commercialSummary: CustomerIntelligenceCommercialSummary;
  products: CustomerIntelligenceProductMix;
  repurchase: CustomerIntelligenceRepurchase;
  financial: CustomerIntelligenceFinancial;
  crm: CustomerIntelligenceCrm;
  dataQuality: CustomerIntelligenceDataQuality;
  scoring: CustomerIntelligenceScoring;
}): CustomerIntelligenceOpportunity[] {
  const priorityBase = {
    daysSinceLastOrder: input.commercialSummary.daysSinceLastOrder,
    overdueAmount: input.financial.overdueAmount ?? 0,
    repurchaseStatus: input.repurchase.status,
  };

  const opportunities: CustomerIntelligenceOpportunity[] = [];

  const push = (partial: Omit<CustomerIntelligenceOpportunity, "priorityScore">) => {
    opportunities.push(
      makeOpportunity(partial, {
        ...priorityBase,
        severity: partial.severity,
        type: partial.type,
      })
    );
  };

  if (input.commercialSummary.validOrdersCount === 0) {
    push({
      kind: "atualizar_cadastro",
      type: "INFO",
      severity: "MEDIUM",
      title: "Sem pedidos válidos no filtro",
      description: "Não há compras válidas para interpretar saúde comercial neste escopo.",
      suggestedAction: "Validar cadastro, filtros aplicados e histórico de pedidos de venda.",
      evidence: ["Nenhum pedido válido no filtro atual."],
      relatedProduct: null,
    });
    return sortCustomerIntelligenceOpportunities(opportunities);
  }

  const days = input.commercialSummary.daysSinceLastOrder;
  if (days != null && days > CUSTOMER_INTELLIGENCE_INACTIVE_DAYS) {
    push({
      kind: "recuperar_cliente_inativo",
      type: "OPPORTUNITY",
      severity: days > 730 ? "HIGH" : "MEDIUM",
      title: "Recuperar cliente inativo",
      description: `Cliente sem compra há ${days} dias — priorizar plano de reativação.`,
      suggestedAction: "Montar abordagem de reativação com histórico de produtos e contato comercial.",
      evidence: [`Última compra há ${days} dia(s).`],
      relatedProduct: null,
    });
    push({
      kind: "reativar_cliente",
      type: "OPPORTUNITY",
      severity: "HIGH",
      title: "Reativar cliente",
      description: "Relacionamento comercial esfriou; retomar contato antes de nova proposta.",
      suggestedAction: "Registrar contato no CRM e oferecer mix com base no histórico.",
      evidence: [`${days} dia(s) sem compra.`],
      relatedProduct: null,
    });
  } else if (days != null && days > 90) {
    push({
      kind: "reativar_cliente",
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Reativar relacionamento",
      description: `Cliente sem compra há ${days} dias.`,
      suggestedAction: "Agendar contato comercial para entender demanda atual.",
      evidence: [`Última compra há ${days} dia(s).`],
      relatedProduct: null,
    });
  }

  if (input.repurchase.status === "PROXIMA") {
    push({
      kind: "ligar_antes_recompra",
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Ligar antes da recompra provável",
      description:
        input.repurchase.detail ??
        "Cliente se aproxima da janela típica de novo pedido.",
      suggestedAction: "Antecipar contato comercial antes da data estimada de recompra.",
      evidence: [
        input.repurchase.estimatedNextPurchaseDate
          ? `Recompra estimada: ${input.repurchase.estimatedNextPurchaseDate}`
          : "Janela de recompra próxima.",
      ],
      relatedProduct: null,
    });
  } else if (input.repurchase.status === "ATRASADO") {
    push({
      kind: "ligar_antes_recompra",
      type: "OPPORTUNITY",
      severity: "HIGH",
      title: "Recompra em atraso",
      description: input.repurchase.detail ?? "Priorizar contato para novo pedido.",
      suggestedAction: "Contatar cliente para entender motivo do atraso e retomar ciclo de compra.",
      evidence: [
        input.repurchase.daysOverExpected != null
          ? `${input.repurchase.daysOverExpected} dia(s) além do esperado`
          : "Status de recompra: ATRASADO",
      ],
      relatedProduct: null,
    });
  }

  if ((input.financial.overdueAmount ?? 0) > 0) {
    push({
      kind: "acionar_cobranca",
      type: "RISK",
      severity: "HIGH",
      title: "Inadimplência financeira",
      description: `Saldo vencido (AR): R$ ${(input.financial.overdueAmount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`,
      suggestedAction: "Alinhar cobrança com financeiro antes de nova negociação comercial.",
      evidence: [
        `${input.financial.overdueTitlesCount ?? 0} título(s) vencido(s).`,
        input.financial.maxDaysOverdue != null
          ? `Máximo ${input.financial.maxDaysOverdue} dia(s) de atraso.`
          : "Títulos vencidos vinculados ao CNPJ.",
      ],
      relatedProduct: null,
    });
  }

  if (input.crm.overdueTasksCount > 0) {
    push({
      kind: "agendar_follow_up",
      type: "RISK",
      severity: "HIGH",
      title: "Follow-up CRM vencido",
      description: `${input.crm.overdueTasksCount} tarefa(s) comercial(is) vencida(s).`,
      suggestedAction: "Executar ou replanejar follow-ups pendentes no CRM Comercial.",
      evidence: [
        input.crm.nextTaskAt ? `Próxima tarefa: ${input.crm.nextTaskAt}` : "Tarefas abertas sem replanejamento.",
      ],
      relatedProduct: null,
    });
  } else if (input.crm.openTasksCount === 0 && input.crm.relationshipStatus !== "sem_historico") {
    push({
      kind: "agendar_follow_up",
      type: "INFO",
      severity: "LOW",
      title: "Sem follow-up agendado",
      description: "Não há tarefa comercial aberta com próxima ação.",
      suggestedAction: "Agendar próximo contato no CRM após interação comercial.",
      evidence: ["Nenhuma tarefa aberta com nextActionAt."],
      relatedProduct: null,
    });
  }

  const leading = input.commercialSummary.leadingProduct;
  if (leading) {
    push({
      kind: "ofertar_produto_lider",
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Ofertar produto líder",
      description: `${leading.sku} — ${leading.name} concentra receita relevante no cliente.`,
      suggestedAction: "Propor recompra ou ampliação de volume do produto líder.",
      evidence: [`Receita do produto: R$ ${leading.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`],
      relatedProduct: {
        productId: leading.productId,
        sku: leading.sku,
        name: leading.name,
      },
    });
  }

  for (const product of input.products.abandonedProducts.slice(0, 3)) {
    push({
      kind: "ofertar_produto_abandonado",
      type: "OPPORTUNITY",
      severity: product.confidence === "high" ? "MEDIUM" : "LOW",
      title: "Ofertar produto abandonado",
      description: `${product.productCode} — ${product.productName} sem recompra recente.`,
      suggestedAction: "Retomar oferta do produto com histórico de compra anterior.",
      evidence: [
        product.daysSinceLastPurchase != null
          ? `${product.daysSinceLastPurchase} dia(s) desde a última compra do item.`
          : "Produto classificado como abandonado no mix.",
      ],
      relatedProduct: {
        productId: product.productId,
        sku: product.productCode,
        name: product.productName,
      },
    });
  }

  const top3Share = input.products.concentration.top3RevenueSharePercent;
  if (
    top3Share != null &&
    top3Share >= CUSTOMER_INTELLIGENCE_MIX_CONCENTRATION_THRESHOLD &&
    input.products.concentration.distinctProductsCount >= 2
  ) {
    push({
      kind: "ampliar_mix",
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Ampliar mix de produtos",
      description: `Receita concentrada em poucos produtos (top 3 = ${top3Share.toFixed(1)}%).`,
      suggestedAction: "Apresentar produtos complementares ou substitutos para diversificar receita.",
      evidence: [
        `${input.products.concentration.distinctProductsCount} produto(s) distinto(s) no histórico.`,
        `Top 3 concentram ${top3Share.toFixed(1)}% da receita.`,
      ],
      relatedProduct: null,
    });
  } else if (
    input.products.concentration.distinctProductsCount > 0 &&
    input.products.concentration.distinctProductsCount <= 2
  ) {
    push({
      kind: "ampliar_mix",
      type: "OPPORTUNITY",
      severity: "LOW",
      title: "Mix baixo — ampliar portfólio",
      description: `Apenas ${input.products.concentration.distinctProductsCount} produto(s) distinto(s) no filtro.`,
      suggestedAction: "Explorar cross-sell com base no perfil de compra.",
      evidence: ["Baixa diversidade de SKUs no histórico filtrado."],
      relatedProduct: null,
    });
  }

  if (
    input.commercialSummary.averageMarginPercent != null &&
    input.commercialSummary.averageMarginPercent < 5
  ) {
    push({
      kind: "revisar_margem",
      type: "RISK",
      severity: input.commercialSummary.averageMarginPercent < 0 ? "HIGH" : "MEDIUM",
      title: "Revisar margem comercial",
      description: `Margem média ${input.commercialSummary.averageMarginPercent.toFixed(1)}% no filtro.`,
      suggestedAction: "Revisar precificação, descontos ou mix antes de nova proposta.",
      evidence: ["Margem média abaixo do patamar saudável (5%)."],
      relatedProduct: null,
    });
  }

  if (input.dataQuality.missingFields.length > 0) {
    push({
      kind: "atualizar_cadastro",
      type: "INFO",
      severity: "LOW",
      title: "Atualizar cadastro",
      description: `Campos ausentes: ${input.dataQuality.missingFields.join(", ")}.`,
      suggestedAction: "Completar cadastro do cliente para melhorar qualidade da inteligência.",
      evidence: input.dataQuality.missingFields.map((f) => `Campo ausente: ${f}`),
      relatedProduct: null,
    });
  }

  for (const productOpp of input.products.productOpportunities.slice(0, 3)) {
    const kind: CustomerIntelligenceOpportunityKind =
      productOpp.kind === "offer_again"
        ? "ofertar_produto_abandonado"
        : productOpp.kind === "low_mix" || productOpp.kind === "concentrated_revenue"
          ? "ampliar_mix"
          : "ofertar_produto_lider";

    if (opportunities.some((o) => o.title === productOpp.title)) continue;

    push({
      kind,
      type: "OPPORTUNITY",
      severity: productOpp.severity,
      title: productOpp.title,
      description: productOpp.description,
      suggestedAction: "Executar ação comercial alinhada ao mix de produtos.",
      evidence: [productOpp.description],
      relatedProduct:
        productOpp.productId && productOpp.productCode && productOpp.productName
          ? {
              productId: productOpp.productId,
              sku: productOpp.productCode,
              name: productOpp.productName,
            }
          : null,
    });
  }

  return sortCustomerIntelligenceOpportunities(opportunities).slice(
    0,
    CUSTOMER_INTELLIGENCE_OPPORTUNITIES_LIMIT
  );
}

export function hasActionableCommercialOpportunity(
  opportunities: CustomerIntelligenceOpportunity[]
): boolean {
  return opportunities.some(
    (o) => o.type === "OPPORTUNITY" && o.priorityScore >= 50 && o.kind !== "atualizar_cadastro"
  );
}
