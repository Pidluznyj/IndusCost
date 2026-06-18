export type SalesOrderItemNomusStatus =
  | "awaiting_release"
  | "released"
  | "fulfilled_with_cut"
  | "partially_fulfilled"
  | "fully_fulfilled"
  | "cancelled"
  | "partially_returned"
  | "fully_returned"
  | "shipped"
  | "delivered"
  | "unknown";

export type SalesOrderOperationalStatus =
  | "awaiting_release"
  | "released"
  | "in_progress"
  | "partially_fulfilled"
  | "fulfilled_with_cut"
  | "fully_fulfilled"
  | "partially_invoiced"
  | "fully_invoiced"
  | "shipped"
  | "delivered"
  | "partially_returned"
  | "fully_returned"
  | "cancelled"
  | "divergent"
  | "unknown";

export type SalesOrderBillingStatus =
  | "not_invoiced"
  | "partially_invoiced"
  | "fully_invoiced"
  | "invoiced_with_cut"
  | "unknown";

export type SalesOrderDeadlineStatus =
  | "on_time"
  | "due_today"
  | "overdue"
  | "invoiced_on_time"
  | "invoiced_late"
  | "invoiced_early"
  | "no_due_date"
  | "unknown";

export type SalesOrderCompletionStatus =
  | "complete"
  | "partial"
  | "with_cut"
  | "cancelled"
  | "returned"
  | "mixed"
  | "unknown";

export type SalesOrderRiskFlag =
  | "overdue_without_invoice"
  | "invoice_after_deadline"
  | "partial_fulfillment"
  | "cut_fulfillment"
  | "mixed_item_status"
  | "returned_items"
  | "missing_due_date"
  | "missing_invoice_link"
  | "unknown_item_status"
  | "missing_production_order"
  | "production_order_late";

export type SalesOrderLifecycleSummary = {
  salesOrderId: string;
  salesOrderNumber: string;
  originalStatus?: string | null;
  operationalStatus: SalesOrderOperationalStatus;
  billingStatus: SalesOrderBillingStatus;
  deadlineStatus: SalesOrderDeadlineStatus;
  completionStatus: SalesOrderCompletionStatus;
  executiveStatusLabel: string;
  executiveStatusPriority: number;
  issueDate?: string | null;
  expectedDeliveryDate?: string | null;
  firstInvoiceDate?: string | null;
  lastInvoiceDate?: string | null;
  deliveryDate?: string | null;
  daysUntilDue: number | null;
  daysOverdue: number | null;
  daysInvoiceEarlyOrLate: number | null;
  itemsCount: number;
  itemsAwaitingRelease: number;
  itemsReleased: number;
  itemsPartiallyFulfilled: number;
  itemsFullyFulfilled: number;
  itemsFulfilledWithCut: number;
  itemsCancelled: number;
  itemsReturned: number;
  itemsShipped: number;
  itemsDelivered: number;
  orderedQuantityTotal: number;
  fulfilledQuantityTotal: number | null;
  invoicedQuantityTotal: number | null;
  pendingQuantityTotal: number | null;
  fulfilledPercent: number | null;
  invoicedPercent: number | null;
  hasInvoice: boolean;
  invoiceNumbers: string[];
  hasLinkedProductionOrder: boolean;
  productionOrderLate: boolean;
  riskFlags: SalesOrderRiskFlag[];
  dataQuality: {
    warnings: string[];
    missingItemStatusCount: number;
    missingDueDate: boolean;
    missingInvoiceDate: boolean;
    missingProductionOrderLink: boolean;
    usedRawFallback: boolean;
  };
};

export type SalesOrderTimelineEventKey =
  | "created"
  | "released"
  | "production_order"
  | "production_started"
  | "production_finished"
  | "due_date"
  | "invoiced"
  | "shipped"
  | "delivered"
  | "returned"
  | "cancelled";

export type SalesOrderTimelineEventStatus =
  | "done"
  | "current"
  | "pending"
  | "late"
  | "warning";

export type SalesOrderTimelineEvent = {
  key: SalesOrderTimelineEventKey;
  label: string;
  date?: string | null;
  status: SalesOrderTimelineEventStatus;
  description?: string;
};
