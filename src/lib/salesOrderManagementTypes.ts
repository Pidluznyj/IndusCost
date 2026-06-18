import type { SalesOrderCompletionStatus, SalesOrderDeadlineStatus, SalesOrderOperationalStatus } from "./salesOrderLifecycleTypes.js";

export type SalesOrderManagementCards = {
  openOrders: number;
  overdueWithoutInvoice: number;
  invoicedOnTime: number;
  invoicedLate: number;
  partialOrCut: number;
  withoutProductionOrder: number;
  productionLate: number;
  delivered: number;
  cancelledOrReturned: number;
};

export type SalesOrderManagementRow = {
  id: string;
  orderCode: string;
  customerName: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  totalNetValue: number;
  responsible: string | null;
  executiveStatusLabel: string;
  deadlineStatus: SalesOrderDeadlineStatus;
  daysOverdue: number | null;
  hasInvoice: boolean;
  invoiceNumbers: string[];
  hasLinkedProductionOrder: boolean;
  productionOrderLate: boolean;
  completionStatus: SalesOrderCompletionStatus;
  fulfilledPercent: number | null;
  invoicedPercent: number | null;
  riskCount: number;
  topSuggestedAction: string | null;
  operationalStatus: SalesOrderOperationalStatus;
};

export function getSalesOrderIntelligenceApiPath(orderId: string): string {
  return `/api/sales-orders/${orderId}/intelligence`;
}

export function getSalesOrderManagementApiPath(query = ""): string {
  return query ? `/api/sales-orders/management?${query}` : "/api/sales-orders/management";
}
