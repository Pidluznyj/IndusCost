import type { DashboardChartSeriesConfig, SalesOrdersDashboardTab } from "./executiveDashboardTypes.js";
import type { BiLogisticStatusCardId } from "./salesOrderLogisticStatus.js";

export type FinanceSalesOrdersInvoiceStatus = "all" | "with_invoice" | "without_invoice";

export type FinanceSalesOrdersDashboardFilters = {
  year: number;
  month: number | null;
  company: string | null;
  customerId: string | null;
  customerSearch: string | null;
  sellerName: string | null;
  status: string | null;
  invoiceStatus: FinanceSalesOrdersInvoiceStatus;
  logisticStatus: BiLogisticStatusCardId | null;
};

export type FinanceSalesOrdersDashboardSummary = {
  selectedYear: number;
  selectedMonth: number | null;

  /** Valor total de pedidos no período filtrado (issueDate). */
  totalOrdersAmount: number;

  monthSalesAmount: number;
  monthSalesPreviousYearAmount: number;
  monthSalesGrowthAmount: number;
  monthSalesGrowthPercent: number | null;

  ytdSalesAmount: number;
  previousYtdSalesAmount: number;
  ytdGrowthAmount: number;
  ytdGrowthPercent: number | null;

  monthTargetAmount: number | null;
  yearTargetAmount: number | null;
  monthTargetConfigured: boolean;

  monthAchievementPercent: number | null;
  yearAchievementPercent: number | null;

  monthProjectedAmount: number | null;
  yearProjectedAmount: number | null;

  projectedMonthAchievementPercent: number | null;
  projectedYearAchievementPercent: number | null;

  /** Média diária: dias úteis decorridos no YTD (seg–sex, sem feriados). */
  dailyAverageAmount: number | null;
  orderCount: number;
  itemCount: number;
  averageTicketAmount: number | null;

  openPortfolioAmount: number;
  openPortfolioCount: number;

  invoicedOrdersAmount: number;
  invoicedOrdersCount: number;

  notInvoicedOrdersAmount: number;
  notInvoicedOrdersCount: number;

  overdueOpenOrdersAmount: number;
  overdueOpenOrdersCount: number;

  /** Margem consolidada do período (pedidos com issueDate no filtro). */
  marginPortfolio?: import("./salesOrderMarginTypes.js").SalesOrderMarginSummaryPayload;
};

export type FinanceSalesOrdersMonthlyComparisonRow = {
  month: number;
  monthLabel: string;
  currentYearAmount: number;
  previousYearAmount: number;
  differenceAmount: number;
  growthPercent: number | null;
};

export type FinanceSalesOrdersRealizedProjectedRow = {
  month: number;
  monthLabel: string;
  realizedAmount: number | null;
  projectedAmount: number | null;
  targetAmount: number | null;
  previousYearAmount: number | null;
};

export type FinanceSalesOrdersTopCustomerRow = {
  customerId: string | null;
  customerName: string;
  amount: number;
  orderCount: number;
  averageTicketAmount: number | null;
  sharePercent: number | null;
};

export type FinanceSalesOrdersTopSellerRow = {
  sellerName: string;
  amount: number;
  orderCount: number;
  averageTicketAmount: number | null;
  sharePercent: number | null;
};

export type FinanceSalesOrdersStatusBreakdownRow = {
  status: string;
  label: string;
  amount: number;
  orderCount: number;
};

export type FinanceSalesOrdersManufacturingStatusBreakdownRow = {
  code: string;
  label: string;
  amount: number;
  orderCount: number;
};

export type FinanceSalesOrdersLogisticStatusBreakdownRow = {
  cardId: BiLogisticStatusCardId;
  label: string;
  amount: number;
  orderCount: number;
  sharePercent: number | null;
  hint: string;
};

export type FinanceSalesOrdersCriticalOrderRow = {
  orderId: string;
  orderCode: string;
  customerName: string;
  sellerName: string;
  amount: number;
  logisticStatusLabel: string;
  logisticStatusCardId: BiLogisticStatusCardId;
  hasProcessedInvoice: boolean;
  expectedDeliveryDate: string | null;
  reasons: Array<"overdue_pending" | "high_open_portfolio" | "without_invoice" | "review_data">;
  marginSummary?: import("./salesOrderMarginTypes.js").SalesOrderMarginSummaryPayload;
};

export type FinanceSalesOrdersOpenPortfolioEvolutionRow = {
  month: number;
  monthLabel: string;
  openAmount: number;
  openCount: number;
  issuedAmount: number;
};

export type FinanceSalesOrdersPortfolioBreakdown = {
  notInvoicedAmount: number;
  notInvoicedCount: number;
  invoicedAmount: number;
  invoicedCount: number;
  overdueAmount: number;
  overdueCount: number;
  onTimeOpenAmount: number;
  onTimeOpenCount: number;
};

/** Fonte canônica do dashboard Financeiro > Pedidos (paridade Comercial OP-02). */
export const FINANCE_SALES_ORDERS_DATA_SOURCE =
  "op02-sales-order-operational-engine" as const;

export type FinanceSalesOrdersDataQuality = {
  warnings: string[];
  source: typeof FINANCE_SALES_ORDERS_DATA_SOURCE | "SalesOrder/SalesOrderItem";
  excludedCancelledOrdersCount: number;
  excludedErrorOrdersCount: number;
  missingIssueDateCount: number;
  missingCustomerCount: number;
  targetConfigured: boolean;
  targetDerived: boolean;
  targetRule: string;
  lastNomusSyncAt: string | null;
  calculationRules: string[];
  openPortfolioEvolutionNote: string;
};

export type FinanceSalesOrdersDashboardPayload = {
  generatedAt: string;
  filters: FinanceSalesOrdersDashboardFilters;
  summary: FinanceSalesOrdersDashboardSummary;
  monthlyComparison: FinanceSalesOrdersMonthlyComparisonRow[];
  realizedProjected: FinanceSalesOrdersRealizedProjectedRow[];
  topCustomers: FinanceSalesOrdersTopCustomerRow[];
  topSellers: FinanceSalesOrdersTopSellerRow[];
  statusBreakdown: FinanceSalesOrdersStatusBreakdownRow[];
  manufacturingStatusBreakdown: FinanceSalesOrdersManufacturingStatusBreakdownRow[];
  logisticStatusBreakdown: FinanceSalesOrdersLogisticStatusBreakdownRow[];
  criticalOrders: FinanceSalesOrdersCriticalOrderRow[];
  openPortfolioEvolution: FinanceSalesOrdersOpenPortfolioEvolutionRow[];
  portfolioBreakdown: FinanceSalesOrdersPortfolioBreakdown;
  chartSeries: DashboardChartSeriesConfig;
  tab: SalesOrdersDashboardTab;
  dataQuality: FinanceSalesOrdersDataQuality;
};

export const FINANCE_SALES_ORDERS_MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export const FINANCE_SALES_ORDERS_CALCULATION_RULES = [
  "População: mesmo where operacional da listagem Comercial (OP-02 / resolveSalesOrderListWhere).",
  "Pedidos / valor / itens / ticket: Σ SalesOrder.totalNetValue e totalItems na população filtrada (paridade Comercial).",
  "CANCELLED fora; ERROR permanece (paridade Comercial). Presença Nomus quando flag ativa.",
  "Faturado / carteira: vínculo oficial SalesOrderNfeLink (NF válida com data de processamento).",
  "Status logístico BI: regra Power BI (DataPlanejada vs DataReal / status item 1–3).",
  "Média diária: valor YTD filtrado ÷ dias úteis decorridos (seg–sex, sem feriados).",
  "Status fabricação: código Nomus 1–6 por item mais pendente do pedido.",
] as const;
