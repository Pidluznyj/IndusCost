/** Tipos do dashboard gerencial (GET /api/dashboard/executive-summary). */

export type ExecutiveMetricValue = number | null;

export type ExecutiveSectionBase = {
  available: boolean;
  unavailableReason?: string;
  source?: string;
};

export type DashboardMetricCard = {
  id: string;
  label: string;
  value: ExecutiveMetricValue;
  formatted: string;
  compactFormatted?: string;
  hint?: string;
};

export type DashboardTargetBlock = {
  actual: ExecutiveMetricValue;
  previousPeriod: ExecutiveMetricValue;
  target: ExecutiveMetricValue;
  gap: ExecutiveMetricValue;
  achievementPercent: ExecutiveMetricValue;
  formatted: {
    actual: string;
    previousPeriod: string;
    target: string;
    gap: string;
    achievementPercent: string;
  };
};

export type DashboardChartPoint = {
  month: number;
  label: string;
  currentYear: ExecutiveMetricValue;
  previousYear: ExecutiveMetricValue;
  twoYearsAgo?: ExecutiveMetricValue | null;
  target?: ExecutiveMetricValue;
};

/** Série mensal enriquecida para gráficos barra + linha e tooltips executivos. */
export type DashboardMonthlySeriesPoint = {
  month: number;
  monthLabel: string;
  periodLabel: string;
  previousYearValue: number;
  currentYearValue: ExecutiveMetricValue;
  targetValue: number;
  projectedValue: ExecutiveMetricValue;
  achievementPercent: ExecutiveMetricValue;
  differenceToTarget: ExecutiveMetricValue;
};

export type DashboardChartSeriesConfig = {
  kind: "salesOrders" | "billing";
  selectedYear: number;
  previousYear: number;
  ytdMonthLimit: number;
  targetAsLine: true;
  labels: {
    previousYearBar: string;
    currentYearBar: string;
    targetLine: string;
    projectedLine?: string;
  };
  colors: {
    previousYearBar: string;
    currentYearBar: string;
    targetLine: string;
    projectedLine?: string;
  };
};

export type DashboardCumulativeChartPoint = {
  month: number;
  label: string;
  currentYear: ExecutiveMetricValue;
  previousYear: ExecutiveMetricValue;
  twoYearsAgo?: ExecutiveMetricValue | null;
};

export type DashboardStatusBreakdownRow = {
  status: string;
  label: string;
  count: number;
  value: ExecutiveMetricValue;
};

export type OverdueOrderRow = {
  orderId: string;
  orderCode: string;
  customerName: string;
  issueDate: string;
  expectedDeliveryDate: string;
  daysOverdue: number;
  totalNetValue: ExecutiveMetricValue;
  status: string;
  statusLabel: string;
};

export type RecentInvoicedOrderRow = {
  orderId: string;
  orderCode: string;
  customerName: string;
  invoiceDate: string;
  totalNetValue: ExecutiveMetricValue;
  invoiceStatus: string | null;
};

export type BillingProjectionBlock = {
  dailyAverage: ExecutiveMetricValue;
  projectedMonth: ExecutiveMetricValue;
  projectedYear: ExecutiveMetricValue;
  workdaysElapsed: number;
  workdaysInMonth: number;
  workdaysInYear: number;
  ytdDailyAverageHint: string;
  formatted: {
    dailyAverage: string;
    projectedMonth: string;
    projectedYear: string;
  };
};

export type BillingYearComparison = {
  yearToDateCurrent: ExecutiveMetricValue;
  yearToDatePrevious: ExecutiveMetricValue;
  previousYearTotal: ExecutiveMetricValue;
  annualTarget: ExecutiveMetricValue;
  formatted: {
    yearToDateCurrent: string;
    yearToDatePrevious: string;
    previousYearTotal: string;
    annualTarget: string;
  };
};

export type BillingRealizedVsProjected = {
  realized: ExecutiveMetricValue;
  projected: ExecutiveMetricValue;
  target: ExecutiveMetricValue;
  formatted: {
    realized: string;
    projected: string;
    target: string;
  };
};

export type BillingTopCustomerRow = {
  customerId: string;
  customerName: string;
  orderCount: number;
  totalNetValue: ExecutiveMetricValue;
};

export type SalesOrdersDashboardTab = ExecutiveSectionBase & {
  periodLabel: string;
  yearLabel: number;
  summaryCards: DashboardMetricCard[];
  target: DashboardTargetBlock;
  monthlySeries: DashboardMonthlySeriesPoint[];
  chartSeries: DashboardChartSeriesConfig;
  statusBreakdown: DashboardStatusBreakdownRow[];
  overdueOrders: {
    count: number;
    totalValue: ExecutiveMetricValue;
    formattedTotalValue: string;
    description: string;
    selectedYear: number;
    items: OverdueOrderRow[];
  };
  /** Status logístico dedicado não existe no schema — usar statusBreakdown. */
  logisticsBreakdown: DashboardStatusBreakdownRow[] | null;
};

export type BillingDashboardTab = ExecutiveSectionBase & {
  periodLabel: string;
  yearLabel: number;
  summaryCards: DashboardMetricCard[];
  target: DashboardTargetBlock;
  projection: BillingProjectionBlock;
  yearComparison: BillingYearComparison;
  realizedVsProjected: BillingRealizedVsProjected;
  monthlySeries: DashboardMonthlySeriesPoint[];
  chartSeries: DashboardChartSeriesConfig;
  cumulativeBilling: DashboardCumulativeChartPoint[];
  recentInvoicedOrders: RecentInvoicedOrderRow[];
  topCustomers: BillingTopCustomerRow[];
  intercompanyExclusionApplied: boolean;
  marketBillingNote: string;
};

export type ExecutiveDashboardPermissions = {
  salesOrders: boolean;
  billing: boolean;
};

export type ExecutiveDashboardSummary = {
  generatedAt: string;
  selectedYear: number;
  previousYear: number;
  permissions: ExecutiveDashboardPermissions;
  tabs: {
    salesOrders: SalesOrdersDashboardTab | null;
    billing: BillingDashboardTab | null;
  };
  unavailableIndicators: string[];
};
