/**
 * Montagem da resposta de GET /api/crm/customers/:customerId/commercial-intelligence.
 * Base principal: Pedidos de Venda. Propostas apenas como bloco auxiliar de pré-venda.
 */

import {
  CRM_ORDER_FOLLOW_UP_NOTE,
  getSalesOrderNetValue,
  getSalesOrderIssueDate,
  getSalesOrderUpdatedAt,
  isOpenPortfolioSalesOrder,
  isPurchaseSalesOrder,
  isValidCommercialSalesOrder,
  resolveSalesOrderHasInvoicing,
  VALID_PURCHASE_ORDER_STATUSES,
} from "@/src/lib/crmCommercialOrderRules";
import { orderHasFollowUpAfterCutoff } from "@/src/lib/crmOrderFollowUp";
import { safeCommercialNumber } from "@/src/lib/customerCommercialSalesOrderView";

export const OPEN_NEGOTIATION_PROPOSAL_STATUSES = ["DRAFT", "ANALYSIS", "SENT"] as const;

export type CrmCommercialActivityRow = {
  contactDate: Date | null;
  createdAt: Date;
  salesOrderId?: string | null;
};

export type CrmCommercialOrderRow = {
  id: string;
  orderCode: string;
  issueDate: Date;
  updatedAt: Date;
  status: string;
  totalNetValue: unknown;
  responsible?: string | null;
  expectedDeliveryDate?: Date | null;
  nomusRawResponse?: unknown;
};

export type CrmNegotiationProposalRow = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  totalNetValue: unknown;
  createdAt: Date;
  updatedAt: Date;
  responsible: string | null;
};

export type CrmCommercialOrderLite = {
  id: string;
  orderCode: string;
  issueDate: string;
  updatedAt: string;
  status: string;
  totalNetValue: number;
  responsible: string | null;
  hasInvoicing: boolean;
};

export type CrmCommercialOrderNoFollowUp = {
  id: string;
  orderCode: string;
  status: string;
  totalNetValue: number;
  updatedAt: string;
  daysWithoutFollowUp: number;
};

export type CrmCommercialIntelSignal = {
  type: "RISK" | "OPPORTUNITY" | "INFO";
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  description: string;
};

export type CrmCommercialIntelResponse = {
  customer: {
    id: string;
    displayName: string;
    taxId: string | null;
  };
  summary: {
    hasPurchaseHistory: boolean;
    daysSinceLastPurchase: number | null;
    hasOpenOrders: boolean;
    hasOrderWithoutFollowUp: boolean;
    /** @deprecated Use hasOpenOrders. Mantido por compatibilidade; não alimenta sinais principais. */
    hasOpenProposals: boolean;
    /** @deprecated Use hasOrderWithoutFollowUp. */
    hasProposalWithoutFollowUp: boolean;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    nextSuggestedAction: string;
  };
  orders: {
    lastOrder: Omit<CrmCommercialOrderLite, "updatedAt" | "responsible" | "hasInvoicing"> | null;
    lastOrders: Array<{
      id: string;
      orderCode: string;
      issueDate: string;
      status: string;
      totalNetValue: number;
    }>;
    totalPurchasedLast12Months: number;
    ordersLast12MonthsCount: number;
  };
  openOrders: {
    lastOrder: CrmCommercialOrderLite | null;
    lastOpenOrder: CrmCommercialOrderLite | null;
    latestOrders: CrmCommercialOrderLite[];
    latestOpenOrders: CrmCommercialOrderLite[];
    openOrdersCount: number;
    openOrdersValue: number;
    ordersWithoutFollowUpCount: number;
    ordersWithoutFollowUp: CrmCommercialOrderNoFollowUp[];
    followUpNote: string;
  };
  /** Pré-venda auxiliar — não alimenta saúde, risco principal nem ação sugerida principal. */
  proposals?: {
    _deprecated: true;
    _note: string;
    negotiationCount: number;
    latestNegotiationProposals: Array<{
      id: string;
      number: number;
      title: string | null;
      status: string;
      totalNetValue: number;
      createdAt: string;
      updatedAt: string;
      responsible: string | null;
    }>;
  };
  signals: CrmCommercialIntelSignal[];
};

/**
 * @deprecated Use orderHasFollowUpAfterCutoff from crmOrderFollowUp.
 */
export function orderHasFollowUpAfterUpdate(
  orderIdOrCutoff: string | Date,
  orderCutoffOrActivities: Date | CrmCommercialActivityRow[],
  activitiesMaybe?: CrmCommercialActivityRow[]
): boolean {
  if (activitiesMaybe) {
    return orderHasFollowUpAfterCutoff(
      orderIdOrCutoff as string,
      orderCutoffOrActivities as Date,
      activitiesMaybe
    );
  }
  const cutoff = orderIdOrCutoff as Date;
  const activities = orderCutoffOrActivities as CrmCommercialActivityRow[];
  return orderHasFollowUpAfterCutoff("", cutoff, activities);
}

function orderFollowUpCutoff(order: CrmCommercialOrderRow): Date {
  return getSalesOrderUpdatedAt(order) ?? getSalesOrderIssueDate(order) ?? order.issueDate;
}

function mapOrderLite(
  row: CrmCommercialOrderRow
): Omit<CrmCommercialOrderLite, "updatedAt" | "responsible" | "hasInvoicing"> {
  return {
    id: row.id,
    orderCode: row.orderCode,
    issueDate: row.issueDate.toISOString(),
    status: row.status,
    totalNetValue: getSalesOrderNetValue(row),
  };
}

function mapOrderIntel(row: CrmCommercialOrderRow): CrmCommercialOrderLite {
  return {
    ...mapOrderLite(row),
    updatedAt: (getSalesOrderUpdatedAt(row) ?? row.issueDate).toISOString(),
    responsible: row.responsible ?? null,
    hasInvoicing: resolveSalesOrderHasInvoicing(row),
  };
}

function daysSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

export function buildCrmCommercialIntelligenceResponse(input: {
  customer: { id: string; companyName: string; tradeName: string | null; taxId: string | null };
  activities: CrmCommercialActivityRow[];
  salesOrders: CrmCommercialOrderRow[];
  negotiationProposals?: CrmNegotiationProposalRow[];
  now?: Date;
}): CrmCommercialIntelResponse {
  const now = input.now ?? new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setUTCDate(twelveMonthsAgo.getUTCDate() - 365);

  const displayName =
    (input.customer.tradeName && input.customer.tradeName.trim()) || input.customer.companyName;

  const purchaseOrders = input.salesOrders
    .filter((o) => isPurchaseSalesOrder(o))
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());

  const metricsOrders = input.salesOrders.filter((o) => isValidCommercialSalesOrder(o));

  const openPortfolioRows = metricsOrders
    .filter((o) => isOpenPortfolioSalesOrder(o))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const latestOrders = [...metricsOrders]
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
    .slice(0, 5)
    .map(mapOrderIntel);

  const latestOpenOrders = openPortfolioRows.slice(0, 5).map(mapOrderIntel);

  const openOrdersCount = openPortfolioRows.length;
  const openOrdersValue = openPortfolioRows.reduce((acc, o) => acc + getSalesOrderNetValue(o), 0);

  const withoutFollowUpAll = openPortfolioRows.filter(
    (o) => !orderHasFollowUpAfterCutoff(o.id, orderFollowUpCutoff(o), input.activities)
  );
  const ordersWithoutFollowUp = [...withoutFollowUpAll]
    .map((o) => {
      const cutoff = orderFollowUpCutoff(o);
      return {
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        totalNetValue: getSalesOrderNetValue(o),
        updatedAt: cutoff.toISOString(),
        daysWithoutFollowUp: daysSince(cutoff, now),
      };
    })
    .sort((a, b) => b.daysWithoutFollowUp - a.daysWithoutFollowUp)
    .slice(0, 5);

  const ordersWithoutFollowUpCount = withoutFollowUpAll.length;

  const lastPurchaseRow = purchaseOrders[0] ?? null;
  const lastOrder = lastPurchaseRow ? mapOrderLite(lastPurchaseRow) : null;

  const daysSinceLastPurchase = lastPurchaseRow
    ? daysSince(lastPurchaseRow.issueDate, now)
    : null;

  const orders12m = purchaseOrders.filter((o) => o.issueDate >= twelveMonthsAgo);
  const totalPurchasedLast12Months = orders12m.reduce(
    (acc, o) => acc + getSalesOrderNetValue(o),
    0
  );

  const prior12Start = new Date(twelveMonthsAgo);
  prior12Start.setUTCDate(prior12Start.getUTCDate() - 365);
  const prior12m = purchaseOrders.filter(
    (o) => o.issueDate >= prior12Start && o.issueDate < twelveMonthsAgo
  );
  const prior12mTotal = prior12m.reduce((acc, o) => acc + getSalesOrderNetValue(o), 0);
  const hasSalesDrop =
    prior12m.length >= 1 &&
    orders12m.length >= 1 &&
    prior12mTotal > 0 &&
    totalPurchasedLast12Months < prior12mTotal * 0.7;

  const sortedByIssue = [...metricsOrders].sort(
    (a, b) => a.issueDate.getTime() - b.issueDate.getTime()
  );
  let hasRepurchaseWindow = false;
  if (sortedByIssue.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < sortedByIssue.length; i++) {
      intervals.push(
        daysSince(sortedByIssue[i - 1]!.issueDate, sortedByIssue[i]!.issueDate)
      );
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const lastIssue = sortedByIssue[sortedByIssue.length - 1]!.issueDate;
    const daysSinceLast = daysSince(lastIssue, now);
    if (median > 0 && daysSinceLast > median * 1.15) {
      hasRepurchaseWindow = true;
    }
  }

  const hasPurchaseHistory = lastOrder !== null;
  const hasOpenOrders = openOrdersCount > 0;
  const hasOrderWithoutFollowUp = ordersWithoutFollowUpCount > 0;
  const hasRecentOrder = daysSinceLastPurchase !== null && daysSinceLastPurchase <= 30;

  let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (hasOrderWithoutFollowUp || (daysSinceLastPurchase !== null && daysSinceLastPurchase > 90)) {
    riskLevel = "HIGH";
  } else if (!hasPurchaseHistory || hasOpenOrders) {
    riskLevel = "MEDIUM";
  }

  let nextSuggestedAction = "Manter acompanhamento comercial.";
  if (hasOrderWithoutFollowUp) {
    nextSuggestedAction = "Fazer follow-up do pedido em carteira.";
  } else if (hasOpenOrders) {
    nextSuggestedAction = "Acompanhar pedido em carteira.";
  } else if (daysSinceLastPurchase !== null && daysSinceLastPurchase > 90) {
    nextSuggestedAction = "Retomar cliente sem pedido recente.";
  } else if (hasRepurchaseWindow) {
    nextSuggestedAction = "Validar recompra provável com o cliente.";
  } else if (hasRecentOrder) {
    nextSuggestedAction = "Realizar pós-venda e identificar nova oportunidade.";
  }

  const signals: CrmCommercialIntelSignal[] = [];

  if (!hasPurchaseHistory) {
    signals.push({
      type: "INFO",
      severity: "MEDIUM",
      title: "Sem histórico de compra",
      description: "Cliente ainda não possui pedido válido registrado no IndusCost.",
    });
  }
  if (daysSinceLastPurchase !== null && daysSinceLastPurchase > 90) {
    signals.push({
      type: "RISK",
      severity: "HIGH",
      title: "Cliente sem compra há mais de 90 dias",
      description: "Priorizar contato comercial para entender recorrência ou reativação.",
    });
  }
  if (hasOpenOrders) {
    signals.push({
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Pedidos em carteira",
      description: `${openOrdersCount} pedido(s) em carteira aberta (R$ ${openOrdersValue.toFixed(0)}) aguardando faturamento ou conclusão.`,
    });
  }
  if (hasOrderWithoutFollowUp) {
    signals.push({
      type: "RISK",
      severity: "HIGH",
      title: "Pedido em carteira sem follow-up",
      description:
        "Existe pedido em carteira sem contato comercial registrado após a última atualização.",
    });
  }
  if (hasRecentOrder) {
    signals.push({
      type: "OPPORTUNITY",
      severity: "LOW",
      title: "Compra recente",
      description: "Cliente comprou recentemente; pode ser bom para pós-venda ou venda complementar.",
    });
  }
  if (hasSalesDrop) {
    signals.push({
      type: "RISK",
      severity: "MEDIUM",
      title: "Queda de volume de pedidos",
      description:
        "Volume de pedidos nos últimos 12 meses caiu em relação ao período anterior — revisar demanda.",
    });
  }
  if (hasRepurchaseWindow) {
    signals.push({
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Janela de recompra",
      description: "Tempo desde o último pedido acima do intervalo típico — priorizar contato.",
    });
  }

  const negotiation = (input.negotiationProposals ?? []).filter((p) =>
    (OPEN_NEGOTIATION_PROPOSAL_STATUSES as readonly string[]).includes(p.status)
  );

  const lastOpenOrderRow = openPortfolioRows[0] ?? null;
  const lastMetricsRow = metricsOrders.sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())[0] ?? null;

  return {
    customer: {
      id: input.customer.id,
      displayName,
      taxId: input.customer.taxId,
    },
    summary: {
      hasPurchaseHistory,
      daysSinceLastPurchase,
      hasOpenOrders,
      hasOrderWithoutFollowUp,
      hasOpenProposals: false,
      hasProposalWithoutFollowUp: false,
      riskLevel,
      nextSuggestedAction,
    },
    orders: {
      lastOrder,
      lastOrders: purchaseOrders.slice(0, 5).map(mapOrderLite),
      totalPurchasedLast12Months: safeCommercialNumber(totalPurchasedLast12Months),
      ordersLast12MonthsCount: orders12m.length,
    },
    openOrders: {
      lastOrder: lastMetricsRow ? mapOrderIntel(lastMetricsRow) : null,
      lastOpenOrder: lastOpenOrderRow ? mapOrderIntel(lastOpenOrderRow) : null,
      latestOrders,
      latestOpenOrders,
      openOrdersCount,
      openOrdersValue: safeCommercialNumber(openOrdersValue),
      ordersWithoutFollowUpCount,
      ordersWithoutFollowUp,
      followUpNote: CRM_ORDER_FOLLOW_UP_NOTE,
    },
    proposals:
      negotiation.length > 0
        ? {
            _deprecated: true,
            _note: "Pré-venda auxiliar. Não alimenta pipeline principal, saúde comercial nem risco.",
            negotiationCount: negotiation.length,
            latestNegotiationProposals: negotiation.slice(0, 5).map((p) => ({
              id: p.id,
              number: p.number,
              title: p.title,
              status: p.status,
              totalNetValue: getSalesOrderNetValue({ totalNetValue: p.totalNetValue }),
              createdAt: p.createdAt.toISOString(),
              updatedAt: p.updatedAt.toISOString(),
              responsible: p.responsible,
            })),
          }
        : undefined,
    signals,
  };
}

export { VALID_PURCHASE_ORDER_STATUSES };
