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
  target?: ExecutiveMetricValue;
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
  monthlyEvolution: DashboardChartPoint[];
  statusBreakdown: DashboardStatusBreakdownRow[];
  overdueOrders: {
    count: number;
    totalValue: ExecutiveMetricValue;
    formattedTotalValue: string;
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
  monthlyBilling: DashboardChartPoint[];
  recentInvoicedOrders: RecentInvoicedOrderRow[];
  topCustomers: BillingTopCustomerRow[];
};

export type ExecutiveDashboardPermissions = {
  salesOrders: boolean;
  billing: boolean;
};

export type ExecutiveDashboardSummary = {
  generatedAt: string;
  permissions: ExecutiveDashboardPermissions;
  tabs: {
    salesOrders: SalesOrdersDashboardTab | null;
    billing: BillingDashboardTab | null;
  };
  unavailableIndicators: string[];
};
