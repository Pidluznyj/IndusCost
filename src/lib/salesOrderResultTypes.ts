import type { SalesOrderMarginStatus } from "./salesOrderMarginTypes.js";

export type SalesOrderResultFilters = {
  year: number;
  month?: number;
  customerId?: string;
  productId?: string;
  /** @deprecated Preferir sellerKey — mantido para compat. */
  sellerId?: string;
  companyId?: string;
  asOfDate: string;
  /** Filtros alinhados à listagem oficial de Pedidos. */
  status?: string;
  sellerKey?: string;
  hasInvoice?: string;
  receivableStatus?: string;
  q?: string;
  startDate?: string;
  endDate?: string;
  minNetValue?: string;
  maxNetValue?: string;
};

export type SalesOrderResultTotals = {
  salesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number | null;
  averageUnitMargin: number | null;
  ordersCount: number;
  itemsCount: number;
  totalQuantity: number;
  missingCostCount: number;
  missingProductCount: number;
  negativeMarginCount: number;
  taxPercentApplied: number;
  taxSourceLabel: string;
};

export type SalesOrderResultMonthlyRow = {
  month: number;
  monthLabel: string;
  salesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number | null;
  ordersCount: number;
};

/** Comparativo YoY de valor vendido (issueDate) — 12 meses. */
export type SalesOrderResultMonthlySalesComparisonRow = {
  month: number;
  monthLabel: string;
  currentYearAmount: number;
  previousYearAmount: number;
};

export type SalesOrderResultRealizedVsProjectedRow = {
  month: number;
  monthLabel: string;
  realizedAmount: number;
  projectedAmount: number | null;
  targetAmount: number | null;
  isRealized: boolean;
  isCurrentMonth: boolean;
  isFuture: boolean;
};

export type SalesOrderResultProjection = {
  currentMonthRealized: number;
  currentMonthProjected: number | null;
  yearRealized: number;
  yearProjected: number | null;
  yearTarget: number | null;
  projectedAchievementPercent: number | null;
  averageBusinessDaySales: number | null;
  averageBusinessDaySalesYtd: number | null;
  elapsedBusinessDays: number;
  remainingBusinessDays: number;
  totalBusinessDaysInMonth: number;
  totalBusinessDaysInYearElapsed: number;
};

export type SalesOrderResultWarnings = {
  missingCostCount: number;
  missingProductCount: number;
  negativeMarginCount: number;
};

export type SalesOrderResultSource = {
  sales: string;
  margin: string;
  cost: string;
  tax: string;
  projection: string;
};

export type SalesOrderResultDashboardPayload = {
  filters: SalesOrderResultFilters;
  totals: SalesOrderResultTotals;
  /** Margem gerencial oficial (custo versionado) — aba Resultado. */
  monthlyMargin: SalesOrderResultMonthlyRow[];
  /**
   * Margem comercial (mesmo motor/ponderação do card MARGEM COMERCIAL).
   * Usada no gráfico da listagem Comercial > Pedidos.
   */
  monthlyCommercialMargin: SalesOrderResultMonthlyRow[];
  /** Valor vendido mês a mês: ano filtrado vs ano anterior (OP-02 / mesma listagem). */
  monthlySalesComparison: SalesOrderResultMonthlySalesComparisonRow[];
  realizedVsProjected: SalesOrderResultRealizedVsProjectedRow[];
  projection: SalesOrderResultProjection;
  warnings: SalesOrderResultWarnings;
  source: SalesOrderResultSource;
};

export type SalesOrderResultItemInput = {
  salesOrderItemId: string;
  orderId: string;
  issueMonth: number;
  productId: string | null;
  quantity: number;
  marginStatus: SalesOrderMarginStatus;
  salesAmount: number;
  costAmount: number;
  taxPercent: number;
};
