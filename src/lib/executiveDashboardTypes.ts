/** Tipos do dashboard executivo consolidado (GET /api/dashboard/executive-summary). */

export type ExecutiveMetricValue = number | null;

export type ExecutiveSectionBase = {
  available: boolean;
  unavailableReason?: string;
  source?: string;
};

export type ExecutiveOverview = ExecutiveSectionBase & {
  alertCount: number;
  kpis: Array<{
    id: string;
    label: string;
    value: ExecutiveMetricValue;
    formatted: string;
    hint?: string;
    href?: string;
  }>;
};

export type ExecutiveCommercial = ExecutiveSectionBase & {
  periodLabel: string;
  ordersThisMonth: ExecutiveMetricValue;
  ordersNetThisMonth: ExecutiveMetricValue;
  ticketAvgThisMonth: ExecutiveMetricValue;
  openOrdersCount: ExecutiveMetricValue;
  sentToNomusCount: ExecutiveMetricValue;
  proposalsOpen: ExecutiveMetricValue;
  proposalsApproved: ExecutiveMetricValue;
  proposalsRejected: ExecutiveMetricValue;
  pipelineOpenNet: ExecutiveMetricValue;
  previousMonthOrders: ExecutiveMetricValue | null;
  previousMonthNet: ExecutiveMetricValue | null;
};

export type ExecutiveCustomers = ExecutiveSectionBase & {
  totalCustomers: ExecutiveMetricValue;
  activeCustomers: ExecutiveMetricValue;
  incompleteRegistration: ExecutiveMetricValue;
  newLast30Days: ExecutiveMetricValue;
  cnpjLookupsLast30Days: ExecutiveMetricValue;
  overdueFollowUps: ExecutiveMetricValue | null;
};

export type ExecutiveProducts = ExecutiveSectionBase & {
  activeProducts: ExecutiveMetricValue;
  withProductBom: ExecutiveMetricValue;
  withPricing: ExecutiveMetricValue;
  manufacturedProducts: ExecutiveMetricValue;
};

export type ExecutiveNomus = ExecutiveSectionBase & {
  lastSyncAt: string | null;
  hasReport: boolean;
  blocked: ExecutiveMetricValue;
  applied: ExecutiveMetricValue;
  noChanges: ExecutiveMetricValue;
  pendingReview: ExecutiveMetricValue;
  errors: ExecutiveMetricValue;
  emptyMessage: string | null;
};

export type ExecutiveFleet = ExecutiveSectionBase & {
  totalVehicles: ExecutiveMetricValue;
  vehiclesAvailable: ExecutiveMetricValue;
  inUse: ExecutiveMetricValue;
  maintenance: ExecutiveMetricValue;
  blocked: ExecutiveMetricValue;
  openMaintenances: ExecutiveMetricValue;
  maintenanceOverdue: ExecutiveMetricValue;
  reservationsToday: ExecutiveMetricValue;
  documentsExpired: ExecutiveMetricValue;
};

export type ExecutivePeople = ExecutiveSectionBase & {
  activeEmployees: ExecutiveMetricValue;
};

export type ExecutiveAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  href?: string;
  count?: number;
};

export type ExecutiveQuickLink = {
  id: string;
  label: string;
  href: string;
  moduleId: string;
};

export type ExecutiveDashboardSummary = {
  generatedAt: string;
  overview: ExecutiveOverview;
  commercial: ExecutiveCommercial;
  customers: ExecutiveCustomers;
  products: ExecutiveProducts;
  nomus: ExecutiveNomus;
  fleet: ExecutiveFleet;
  people: ExecutivePeople;
  alerts: ExecutiveAlert[];
  quickLinks: ExecutiveQuickLink[];
  /** Bloco industrial legado (mesmo motor /api/dashboard) — opcional. */
  industrialLegacyAvailable: boolean;
};
