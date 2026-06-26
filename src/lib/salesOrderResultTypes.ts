import type { SalesOrderMarginStatus } from "./salesOrderMarginTypes.js";

export type SalesOrderResultFilters = {
  year: number;
  month?: number;
  customerId?: string;
  productId?: string;
  sellerId?: string;
  companyId?: string;
  asOfDate: string;
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
  sales: "official-sales-order-engine";
  margin: "official-sales-order-margin-engine";
  cost: "official-product-cost-engine";
  tax: "official-tax-rule-engine";
  projection: "official-sales-order-dashboard-rules";
};

export type SalesOrderResultDashboardPayload = {
  filters: SalesOrderResultFilters;
  totals: SalesOrderResultTotals;
  monthlyMargin: SalesOrderResultMonthlyRow[];
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
