import type {
  SalesOrderBillingStatus,
  SalesOrderCompletionStatus,
  SalesOrderDeadlineStatus,
  SalesOrderOperationalStatus,
  SalesOrderRiskFlag,
} from "./salesOrderLifecycleTypes.js";

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

/** Alias com nomes do contrato gerencial (cards → summary). */
export type SalesOrderManagementSummary = {
  openOrdersCount: number;
  overdueWithoutInvoiceCount: number;
  invoicedOnTimeCount: number;
  invoicedLateCount: number;
  partiallyFulfilledCount: number;
  fulfilledWithCutCount: number;
  withoutProductionOrderCount: number;
  lateProductionOrderCount: number;
  deliveredCount: number;
  cancelledOrReturnedCount: number;
};

export function cardsToManagementSummary(
  cards: SalesOrderManagementCards
): SalesOrderManagementSummary {
  return {
    openOrdersCount: cards.openOrders,
    overdueWithoutInvoiceCount: cards.overdueWithoutInvoice,
    invoicedOnTimeCount: cards.invoicedOnTime,
    invoicedLateCount: cards.invoicedLate,
    partiallyFulfilledCount: cards.partialOrCut,
    fulfilledWithCutCount: cards.partialOrCut,
    withoutProductionOrderCount: cards.withoutProductionOrder,
    lateProductionOrderCount: cards.productionLate,
    deliveredCount: cards.delivered,
    cancelledOrReturnedCount: cards.cancelledOrReturned,
  };
}

export type SalesOrderManagementRow = {
  id: string;
  /** Número do pedido (alias de orderCode). */
  number: string;
  orderCode: string;
  customerName: string;
  customerTaxId?: string | null;
  issueDate?: string | null;
  expectedDeliveryDate?: string | null;
  totalNetValue: number;

  sellerName?: string | null;
  companyName?: string | null;
  responsible: string | null;

  executiveStatusLabel: string;
  operationalStatus: SalesOrderOperationalStatus;
  billingStatus: SalesOrderBillingStatus;
  deadlineStatus: SalesOrderDeadlineStatus;
  completionStatus: SalesOrderCompletionStatus;
  daysOverdue: number | null;

  hasInvoice: boolean;
  invoiceNumbers: string[];
  invoicedPercent: number | null;

  hasLinkedProductionOrder: boolean;
  productionOrderLate: boolean;
  productionOrderStatus?: string | null;
  productionOrderLabel?: string | null;

  fulfilledPercent: number | null;
  itemsCount: number;

  riskCount: number;
  highRiskCount: number;
  riskFlags: SalesOrderRiskFlag[];

  suggestedActionLabel?: string | null;
};

export function assertManagementRowFinite(row: SalesOrderManagementRow): boolean {
  const nums = [
    row.totalNetValue,
    row.invoicedPercent,
    row.fulfilledPercent,
    row.daysOverdue,
    row.riskCount,
    row.highRiskCount,
    row.itemsCount,
  ];
  return nums.every((n) => n == null || Number.isFinite(n));
}

export function getSalesOrderIntelligenceApiPath(orderId: string): string {
  return `/api/sales-orders/${orderId}/intelligence`;
}

export function getSalesOrderManagementApiPath(query = ""): string {
  return query ? `/api/sales-orders/management?${query}` : "/api/sales-orders/management";
}
