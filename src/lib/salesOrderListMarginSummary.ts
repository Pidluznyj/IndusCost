/**
 * Tipos do resumo de margem geral ponderada — listagem de Pedidos de Venda.
 */
import type {
  SalesOrderMarginCostCoverageStatus,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import type { SalesMarginTaxMode } from "./salesMarginRulesEngine.types.js";
import {
  EMPTY_SALES_ORDER_LIST_COST_BREAKDOWN,
  type SalesOrderListCostBreakdown,
} from "./salesOrderListCostBreakdown.js";

/** Série mensal da margem comercial (mesmo motor/ponderação do card). */
export type SalesOrderListMonthlyCommercialMarginRow = {
  month: number;
  monthLabel: string;
  salesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number | null;
  ordersCount: number;
  coveredNetValue: number;
  totalNetValue: number;
  isPartial: boolean;
  coveredOrders: number;
  totalEligibleOrders: number;
};

export type SalesOrderListMarginSummary = {
  totalOrdersCount: number;
  totalMarginValue: number;
  totalMarginPercentage: number | null;
  totalManagerialNetRevenue: number;
  grossSalesAmount: number;
  taxAmount: number;
  totalCost: number;
  /** Discriminação MP/HH/HM/impostos do filtro (hover do card de custo). */
  costBreakdown: SalesOrderListCostBreakdown;
  marginCoverage: SalesOrderMarginCostCoverageStatus;
  itemsWithoutCost: number;
  ordersWithoutFullMargin: number;
  taxMode: SalesMarginTaxMode;
  taxRuleName: string | null;
  taxRate: number | null;
  /** false quando cobertura NONE — card exibe indisponível */
  available: boolean;
  tooltipSummary: SalesOrderMarginSummaryPayload;
  /**
   * Margem comercial % mês a mês — população anual canônica (sem filtros da tela),
   * Σ margem ÷ Σ líquido coberto por mês de emissão.
   */
  monthlyCommercialMargin: SalesOrderListMonthlyCommercialMarginRow[];
};

export const EMPTY_SALES_ORDER_LIST_MARGIN_SUMMARY: SalesOrderListMarginSummary = {
  totalOrdersCount: 0,
  totalMarginValue: 0,
  totalMarginPercentage: null,
  totalManagerialNetRevenue: 0,
  grossSalesAmount: 0,
  taxAmount: 0,
  totalCost: 0,
  costBreakdown: { ...EMPTY_SALES_ORDER_LIST_COST_BREAKDOWN },
  marginCoverage: "NONE",
  itemsWithoutCost: 0,
  ordersWithoutFullMargin: 0,
  taxMode: "deductFromGross",
  taxRuleName: null,
  taxRate: null,
  available: false,
  monthlyCommercialMargin: [],
  tooltipSummary: {
    netRevenue: 0,
    totalCost: 0,
    marginValue: 0,
    marginPercent: null,
    markup: null,
    itemsCount: 0,
    validItemsCount: 0,
    ignoredItemsCount: 0,
    hasMissingCost: true,
    hasMissingProduct: false,
    hasNegativeMargin: false,
    hasInvalidRevenue: false,
    status: "SEM_CUSTO",
    statusLabel: "Sem custo",
    statusSeverity: "warning",
    costCoverageStatus: "NONE",
    itemsTotal: 0,
    itemsWithCost: 0,
    itemsWithoutCost: 0,
    totalSalesRevenueInScope: 0,
    marginRevenueCovered: 0,
    marginRevenueUncovered: 0,
    marginCoveragePercent: 0,
  },
};
