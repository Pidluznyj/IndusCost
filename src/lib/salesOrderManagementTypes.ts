import type {
  SalesOrderBillingStatus,
  SalesOrderCompletionStatus,
  SalesOrderDeadlineStatus,
  SalesOrderOperationalStatus,
  SalesOrderRiskFlag,
} from "./salesOrderLifecycleTypes.js";

import type {
  ManagementStatusCardId,
} from "./salesOrderManagementStatus.js";

export type SalesOrderManagementCards = Record<ManagementStatusCardId, number>;

export type SalesOrderManagementCardAmounts = Record<ManagementStatusCardId, number>;

/** Alias com nomes do contrato gerencial (cards → summary). */
export type SalesOrderManagementSummary = {
  totalOrdersCount: number;
  /** Pedidos não cancelados/devolvidos no filtro — informativo, não é status exclusivo. */
  validPortfolioCount: number;
  overdueWithoutInvoiceCount: number;
  invoicedOnTimeCount: number;
  invoicedLateCount: number;
  partiallyFulfilledCount: number;
  fulfilledWithCutCount: number;
  deliveredCount: number;
  cancelledOrReturnedCount: number;
  awaitingInProgressCount: number;
  reviewUnknownCount: number;
};

export function cardsToManagementSummary(
  cards: SalesOrderManagementCards,
  totalOrdersCount = 0
): SalesOrderManagementSummary {
  return {
    totalOrdersCount,
    validPortfolioCount: totalOrdersCount - cards.cancelledOrReturned,
    overdueWithoutInvoiceCount: cards.overdueWithoutInvoice,
    invoicedOnTimeCount: cards.invoicedOnTime,
    invoicedLateCount: cards.invoicedLate,
    partiallyFulfilledCount: cards.partialOrCut,
    fulfilledWithCutCount: cards.partialOrCut,
    deliveredCount: cards.delivered,
    cancelledOrReturnedCount: cards.cancelledOrReturned,
    awaitingInProgressCount: cards.awaitingInProgress,
    reviewUnknownCount: cards.reviewUnknown,
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
