import type {
  SalesOrderBillingStatus,
  SalesOrderCompletionStatus,
  SalesOrderDeadlineStatus,
  SalesOrderOperationalStatus,
  SalesOrderRiskFlag,
} from "./salesOrderLifecycleTypes.js";

import type {
  ManagementStatusCardId,
  ManagementCardReconciliation,
  ManagementDashboardCard,
} from "./salesOrderManagementStatus.js";

export type { ManagementDashboardCard } from "./salesOrderManagementStatus.js";

export type SalesOrderManagementCards = Record<ManagementStatusCardId, number>;

export type SalesOrderManagementCardAmounts = Record<ManagementStatusCardId, number>;

/** Resumo gerencial dos cards + reconciliação com o total do filtro. */
export type SalesOrderManagementSummary = {
  totalOrdersCount: number;
  totalNetValue: number;
  validPortfolioCount: number;
  validPortfolioValue: number;
  statusCardsTotalCount: number;
  statusCardsTotalValue: number;
  reconciliation: ManagementCardReconciliation;
  /** Pedidos exibidos no grid após filtro de card de status. */
  gridFilteredCount: number;
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
  options: {
    totalOrdersCount?: number;
    totalNetValue?: number;
    validPortfolioCount?: number;
    validPortfolioValue?: number;
    reconciliation?: ManagementCardReconciliation & {
      statusCardsTotalCount: number;
      statusCardsTotalValue: number;
    };
    gridFilteredCount?: number;
  } = {}
): SalesOrderManagementSummary {
  const totalOrdersCount = options.totalOrdersCount ?? 0;
  const reconciliation = options.reconciliation ?? {
    statusCardsTotalCount: sumCardCounts(cards),
    statusCardsTotalValue: 0,
    countMatches: true,
    valueMatches: true,
    countDifference: 0,
    valueDifference: 0,
  };
  return {
    totalOrdersCount,
    totalNetValue: options.totalNetValue ?? 0,
    validPortfolioCount: options.validPortfolioCount ?? totalOrdersCount - cards.cancelledOrReturned,
    validPortfolioValue: options.validPortfolioValue ?? 0,
    statusCardsTotalCount: reconciliation.statusCardsTotalCount,
    statusCardsTotalValue: reconciliation.statusCardsTotalValue,
    reconciliation,
    gridFilteredCount: options.gridFilteredCount ?? totalOrdersCount,
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

function sumCardCounts(cards: SalesOrderManagementCards): number {
  return (
    cards.overdueWithoutInvoice +
    cards.invoicedOnTime +
    cards.invoicedLate +
    cards.partialOrCut +
    cards.delivered +
    cards.cancelledOrReturned +
    cards.awaitingInProgress +
    cards.reviewUnknown
  );
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
