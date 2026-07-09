/**
 * Métricas oficiais da Gestão de Pedidos — agregação pura (sem Prisma).
 * Fonte de pedido: SalesOrder.totalNetValue; faturamento: NF vinculada; margem: motor oficial.
 */
import { computeTicketAverage } from "./salesOrderDashboardRules.js";
import {
  buildSalesOrderManagementMarginEconomics,
  type SalesOrderManagementMarginEconomics,
} from "./salesOrderManagementMargin.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";
import {
  buildFulfillmentCharts,
  buildFulfillmentKpis,
  type SalesOrderFulfillmentCharts,
  type SalesOrderFulfillmentKpis,
} from "./salesOrderManagementFulfillment.js";
import {
  buildBiLogisticDashboardCards,
  buildBiLogisticStatusCardMetrics,
  type ManagementDashboardCard,
} from "./salesOrderManagementStatus.js";
import {
  cardsToManagementSummary,
  type SalesOrderManagementCardAmounts,
  type SalesOrderManagementCards,
  type SalesOrderManagementRow,
  type SalesOrderManagementSummary,
} from "./salesOrderManagementTypes.js";
import {
  mapOfficialFinancePortfolioFromManagementRows,
  OFFICIAL_SO_RULES_SOURCE,
} from "./salesOrderRulesAdapter.js";
import { OFFICIAL_SM_RULES_SOURCE } from "./salesMarginRulesAdapter.js";
import { SALES_MARGIN_RULES_ENGINE_VERSION } from "./salesMarginRulesEngine.js";
import { SALES_ORDER_RULES_ENGINE_VERSION } from "./salesOrderRulesEngine.js";
import { resolveLastNomusSyncAt } from "./financeSalesOrdersExtendedMetrics.js";

export type SalesOrderManagementOfficialMetrics = {
  totalOrders: number;
  /** Σ SalesOrder.totalNetValue — valor vendido oficial do pedido. */
  soldAmount: number;
  averageTicket: number | null;
  /** Pedidos sem NF processada (hasInvoice). */
  openPortfolioCount: number;
  openPortfolioAmount: number;
  /** Pedidos com NF válida/vínculo fiscal. */
  invoicedOrdersCount: number;
  /** Σ valor do pedido (header) para pedidos com NF — referência comercial. */
  invoicedOrdersAmount: number;
  /** Σ NF vinculada (nfeTotalValue) — card de faturamento fiscal. */
  invoicedNfeAmount: number;
  soldInvoicedGap: number;
  onTimePercent: number | null;
  ordersWithNfe: number;
  ordersWithoutNfe: number;
};

export type SalesOrderManagementSourceAudit = {
  orderValueSource: "SalesOrder.totalNetValue";
  itemValueSource: "SalesOrderItem + Nomus pedido (motor de margem)";
  marginSource: typeof OFFICIAL_SM_RULES_SOURCE;
  ordersRulesSource: typeof OFFICIAL_SO_RULES_SOURCE;
  invoicedFiscalSource: "SalesOrderLinkedNfeContext.nfeTotalValue";
  sellerSource: "SalesOrder.externalSellerId + CommissionPerson";
  itemsWithoutCost: number;
  itemsWithoutProduct: number;
  itemsWithNegativeMargin: number;
  marginCoverageStatus: string | null;
  marginCoveragePercent: number | null;
  partialCoverageWarning: string | null;
  ordersEngineVersion: string;
  marginEngineVersion: string;
  filteredOrdersCount: number;
  lastNomusSyncAt: string | null;
  warnings: string[];
};

export type SalesOrderManagementMetricsBundle = {
  activeRows: SalesOrderManagementRow[];
  cards: SalesOrderManagementCards;
  cardAmounts: SalesOrderManagementCardAmounts;
  dashboardCards: ManagementDashboardCard[];
  summary: SalesOrderManagementSummary;
  fulfillmentKpis: SalesOrderFulfillmentKpis;
  fulfillmentCharts: SalesOrderFulfillmentCharts;
  marginEconomics: SalesOrderManagementMarginEconomics;
  officialMetrics: SalesOrderManagementOfficialMetrics;
  sourceAudit: SalesOrderManagementSourceAudit;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function buildSalesOrderManagementSourceAudit(input: {
  activeRows: SalesOrderManagementRow[];
  marginEconomics: SalesOrderManagementMarginEconomics;
  lastNomusSyncAt?: string | null;
  warnings?: string[];
}): SalesOrderManagementSourceAudit {
  const consolidated = marginEconomics.consolidated;
  const itemCounts = marginEconomics.itemCounts;
  const warnings = [...(input.warnings ?? [])];

  let partialCoverageWarning: string | null = null;
  if (consolidated?.costCoverageStatus === "PARTIAL") {
    partialCoverageWarning = `Margem parcial: ${consolidated.marginCoveragePercent ?? 0}% da receita vendida com custo resolvido.`;
    warnings.push(partialCoverageWarning);
  } else if (consolidated?.costCoverageStatus === "NONE") {
    partialCoverageWarning = "Nenhuma linha com custo de produção resolvido no filtro.";
    warnings.push(partialCoverageWarning);
  }

  return {
    orderValueSource: "SalesOrder.totalNetValue",
    itemValueSource: "SalesOrderItem + Nomus pedido (motor de margem)",
    marginSource: OFFICIAL_SM_RULES_SOURCE,
    ordersRulesSource: OFFICIAL_SO_RULES_SOURCE,
    invoicedFiscalSource: "SalesOrderLinkedNfeContext.nfeTotalValue",
    sellerSource: "SalesOrder.externalSellerId + CommissionPerson",
    itemsWithoutCost: itemCounts.itemsWithoutCost,
    itemsWithoutProduct: itemCounts.itemsWithoutProduct,
    itemsWithNegativeMargin: itemCounts.itemsWithNegativeMargin,
    marginCoverageStatus: consolidated?.costCoverageStatus ?? null,
    marginCoveragePercent: consolidated?.marginCoveragePercent ?? null,
    partialCoverageWarning,
    ordersEngineVersion: SALES_ORDER_RULES_ENGINE_VERSION,
    marginEngineVersion: SALES_MARGIN_RULES_ENGINE_VERSION,
    filteredOrdersCount: input.activeRows.length,
    lastNomusSyncAt: input.lastNomusSyncAt ?? null,
    warnings,
  };
}

export function buildOfficialManagementMetricsBundle(
  activeRows: SalesOrderManagementRow[],
  itemResultsByOrderId: Map<string, SalesOrderMarginItemResult[]>,
  options?: {
    lastNomusSyncAt?: string | null;
    warnings?: string[];
  }
): SalesOrderManagementMetricsBundle {
  const fulfillmentKpis = buildFulfillmentKpis(activeRows);
  const fulfillmentCharts = buildFulfillmentCharts(activeRows);
  const portfolio = mapOfficialFinancePortfolioFromManagementRows(activeRows);
  const dashboard = buildBiLogisticDashboardCards(
    activeRows.map((row) => ({
      logisticStatusCardId: row.logisticStatusCardId,
      totalNetValue: row.totalNetValue,
    }))
  );
  const statusMetrics = buildBiLogisticStatusCardMetrics(
    activeRows.map((row) => ({
      logisticStatusCardId: row.logisticStatusCardId,
      totalNetValue: row.totalNetValue,
    }))
  );

  const marginEconomics = buildSalesOrderManagementMarginEconomics(
    activeRows,
    itemResultsByOrderId
  );

  const soldAmount = roundMoney(fulfillmentKpis.totalSoldValue);
  const officialMetrics: SalesOrderManagementOfficialMetrics = {
    totalOrders: activeRows.length,
    soldAmount,
    averageTicket: computeTicketAverage(soldAmount, activeRows.length),
    openPortfolioCount: portfolio.open.count,
    openPortfolioAmount: portfolio.open.net,
    invoicedOrdersCount: portfolio.invoiced.count,
    invoicedOrdersAmount: portfolio.invoiced.net,
    invoicedNfeAmount: roundMoney(fulfillmentKpis.totalInvoicedValue),
    soldInvoicedGap: roundMoney(fulfillmentKpis.soldInvoicedGap),
    onTimePercent: fulfillmentKpis.onTimePercent,
    ordersWithNfe: fulfillmentKpis.ordersWithNfe,
    ordersWithoutNfe: fulfillmentKpis.ordersWithoutNfe,
  };

  const summary = cardsToManagementSummary(statusMetrics.counts, {
    totalOrdersCount: dashboard.totalOrders,
    totalNetValue: dashboard.totalNetValue,
    validPortfolioCount: dashboard.validPortfolioCount,
    validPortfolioValue: dashboard.validPortfolioValue,
    reconciliation: dashboard.reconciliation,
    gridFilteredCount: activeRows.length,
  });

  const sourceAudit = buildSalesOrderManagementSourceAudit({
    activeRows,
    marginEconomics,
    lastNomusSyncAt: options?.lastNomusSyncAt ?? null,
    warnings: options?.warnings,
  });

  return {
    activeRows,
    cards: statusMetrics.counts,
    cardAmounts: statusMetrics.amounts,
    dashboardCards: dashboard.cards,
    summary,
    fulfillmentKpis,
    fulfillmentCharts,
    marginEconomics,
    officialMetrics,
    sourceAudit,
  };
}

/** Última atualização Nomus no escopo (updatedAt / sentToNomusAt dos pedidos). */
export function resolveManagementScopeLastNomusSyncAt(
  orders: Array<{ updatedAt?: Date | null; sentToNomusAt?: Date | null }>
): string | null {
  return resolveLastNomusSyncAt(
    orders.map((order) => ({
      updatedAt: order.updatedAt ?? null,
      sentToNomusAt: order.sentToNomusAt ?? null,
    }))
  );
}
