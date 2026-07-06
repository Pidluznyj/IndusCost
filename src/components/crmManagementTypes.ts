/** Tipos do GET /api/crm/management-dashboard (Fase 1I-B). */

export type ManagementBreakdownItem = {
  key: string;
  count: number;
};

export type ManagementDashboardSummary = {
  totalCustomers: number;
  customersWithContactLast30Days: number;
  customersWithoutContactLast30Days: number;
  customersWithoutContactLast60Days: number;
  customersWithoutContactLast90Days: number;
  customersWithoutValidPurchase: number;
  customersWithoutPurchase90Days: number;
  customersWithoutPurchase180Days: number;
  contactsLast7Days: number;
  contactsLast30Days: number;
  overdueFollowUps: number;
  upcomingFollowUpsNext7Days: number;
  upcomingFollowUpsNext30Days: number;
  openOrdersCount: number;
  openOrdersValue: number;
  ordersWithoutFollowUpCount: number;
  customersAtHighRisk: number;
};

export type ManagementRiskCustomer = {
  customerId: string;
  displayName: string;
  taxId: string;
  city: string | null;
  state: string | null;
  riskLevel: string;
  riskReasons: string[];
  daysSinceLastPurchase: number | null;
  daysSinceLastContact: number | null;
  openOrdersCount: number;
  openOrdersValue: number;
  nextFollowUpAt: string | null;
  relationshipLevel: string | null;
  commercialTemperature: string | null;
};

export type ManagementOpportunityCustomer = {
  customerId: string;
  displayName: string;
  taxId: string;
  daysSinceLastPurchase: number | null;
  daysSinceLastContact: number | null;
  totalPurchasedLast12Months: number;
  openOrdersCount: number;
  suggestedAction: string;
};

export type ManagementFollowUp = {
  activityId: string;
  customerId: string;
  displayName: string;
  nextActionAt: string;
  nextActionDescription: string | null;
  assignedTo: string | null;
  createdByName: string | null;
  daysOverdue?: number;
  daysUntil?: number;
};

export type ManagementOrderWithoutFollowUp = {
  salesOrderId: string;
  orderCode: string;
  customerId: string;
  displayName: string;
  status: string;
  totalNetValue: number;
  updatedAt: string;
  daysWithoutFollowUp: number;
  responsible: string | null;
};

export type ManagementTopCustomer = {
  customerId: string;
  displayName: string;
  taxId: string;
  totalPurchasedLast12Months: number;
  ordersCount: number;
  lastPurchaseAt: string | null;
  daysSinceLastContact: number | null;
};

export type ManagementDashboardResponse = {
  generatedAt: string;
  summary: ManagementDashboardSummary;
  riskCustomers: ManagementRiskCustomer[];
  opportunityCustomers: ManagementOpportunityCustomer[];
  overdueFollowUps: ManagementFollowUp[];
  upcomingFollowUps: ManagementFollowUp[];
  ordersWithoutFollowUp: ManagementOrderWithoutFollowUp[];
  topCustomersLast12Months: ManagementTopCustomer[];
  activityBreakdown: {
    periodDays: number;
    byChannel: ManagementBreakdownItem[];
    byReason: ManagementBreakdownItem[];
    byResponsible: ManagementBreakdownItem[];
  };
};
