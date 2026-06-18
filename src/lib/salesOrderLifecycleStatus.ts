import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import { isCancelledSalesOrderStatus, isOverdueSalesOrder } from "./salesOrderDashboardRules.js";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import type {
  SalesOrderBillingStatus,
  SalesOrderCompletionStatus,
  SalesOrderDeadlineStatus,
  SalesOrderItemNomusStatus,
  SalesOrderLifecycleSummary,
  SalesOrderOperationalStatus,
  SalesOrderRiskFlag,
} from "./salesOrderLifecycleTypes.js";
import {
  diffCalendarDays,
  extractNomusProductionOrders,
  extractNomusRawItems,
  extractNomusRawNfes,
  formatYmdLocal,
  matchRawItemToDbItem,
  normalizeSalesOrderItemNomusStatus,
  parseNomusBrOrIsoDate,
  resolveItemFulfilledQuantity,
  resolveItemInvoicedQuantity,
  safeRatio,
  startOfLocalDay,
} from "./salesOrderNomusRaw.js";

export { normalizeSalesOrderItemNomusStatus };

export type SalesOrderLifecycleItemInput = {
  id: string;
  externalProductId?: number | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity: unknown;
};

export type SalesOrderLifecycleInput = {
  salesOrderId: string;
  salesOrderNumber: string;
  originalStatus: string;
  issueDate?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
  nomusRawResponse?: unknown;
  items: SalesOrderLifecycleItemInput[];
  referenceDate?: Date;
  requiresProduction?: boolean;
};

export type EnrichedLifecycleItem = {
  id: string;
  productCode: string;
  productName: string;
  originalStatus: string | null;
  normalizedStatus: SalesOrderItemNomusStatus;
  orderedQuantity: number;
  fulfilledQuantity: number | null;
  invoicedQuantity: number | null;
  pendingQuantity: number | null;
  hasCut: boolean;
  isCancelled: boolean;
  isReturned: boolean;
  linkedProductionOrderNumbers: string[];
};

const EXECUTIVE_LABELS: Record<SalesOrderOperationalStatus, { label: string; priority: number }> = {
  cancelled: { label: "Cancelado", priority: 100 },
  divergent: { label: "Divergente", priority: 95 },
  fully_returned: { label: "Devolvido", priority: 90 },
  partially_returned: { label: "Devolvido parcial", priority: 85 },
  fulfilled_with_cut: { label: "Atendido com corte", priority: 80 },
  partially_fulfilled: { label: "Atendido parcial", priority: 75 },
  delivered: { label: "Entregue", priority: 70 },
  shipped: { label: "Enviado", priority: 65 },
  fully_invoiced: { label: "Faturado total", priority: 60 },
  partially_invoiced: { label: "Faturado parcial", priority: 55 },
  fully_fulfilled: { label: "Atendido total", priority: 50 },
  in_progress: { label: "Em andamento", priority: 45 },
  released: { label: "Liberado", priority: 40 },
  awaiting_release: { label: "Aguardando liberação", priority: 35 },
  unknown: { label: "Status desconhecido", priority: 10 },
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveInvoiceDates(nfes: ReturnType<typeof extractNomusRawNfes>) {
  const dates: Date[] = [];
  for (const nfe of nfes) {
    const d =
      parseNomusBrOrIsoDate(nfe.dataProcessamento) ??
      parseNomusBrOrIsoDate(nfe.dataEmissao);
    if (d) dates.push(d);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return {
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    numbers: nfes
      .map((n) => n.numero)
      .filter((n): n is string => !!n?.trim()),
  };
}

function enrichItems(
  input: SalesOrderLifecycleInput,
  rawItems: ReturnType<typeof extractNomusRawItems>,
  productionOrders: ReturnType<typeof extractNomusProductionOrders>,
  hasInvoice: boolean
): EnrichedLifecycleItem[] {
  return input.items.map((item) => {
    const raw = matchRawItemToDbItem(rawItems, item);
    const ordered = Math.max(0, decimalToNumber(item.quantity) ?? 0);
    const originalStatus = raw?.status ?? null;
    const normalizedStatus = normalizeSalesOrderItemNomusStatus(originalStatus);
    const fulfilledQuantity = resolveItemFulfilledQuantity(ordered, raw, normalizedStatus);
    const invoicedQuantity = resolveItemInvoicedQuantity(
      ordered,
      fulfilledQuantity,
      raw,
      hasInvoice
    );
    const pendingQuantity =
      fulfilledQuantity != null ? Math.max(0, ordered - fulfilledQuantity) : null;
    const linkedProductionOrderNumbers = productionOrders
      .filter((op) => {
        const code = op.productCode?.trim().toLowerCase();
        const sku = item.skuSnapshot?.trim().toLowerCase();
        return code && sku && code === sku;
      })
      .map((op) => op.number ?? op.id ?? "")
      .filter(Boolean);

    return {
      id: item.id,
      productCode: item.skuSnapshot ?? "—",
      productName: item.productNameSnapshot ?? "—",
      originalStatus,
      normalizedStatus,
      orderedQuantity: ordered,
      fulfilledQuantity,
      invoicedQuantity,
      pendingQuantity,
      hasCut: normalizedStatus === "fulfilled_with_cut",
      isCancelled: normalizedStatus === "cancelled",
      isReturned:
        normalizedStatus === "partially_returned" ||
        normalizedStatus === "fully_returned",
      linkedProductionOrderNumbers,
    };
  });
}

function deriveBillingStatus(
  hasInvoice: boolean,
  invoicedTotal: number | null,
  orderedTotal: number,
  hasCut: boolean
): SalesOrderBillingStatus {
  if (!hasInvoice && (invoicedTotal ?? 0) <= 0) return "not_invoiced";
  if (invoicedTotal == null) return hasInvoice ? "partially_invoiced" : "unknown";
  if (hasCut && invoicedTotal > 0) return "invoiced_with_cut";
  if (invoicedTotal <= 0) return "not_invoiced";
  if (orderedTotal > 0 && invoicedTotal + 1e-6 >= orderedTotal) return "fully_invoiced";
  if (invoicedTotal > 0) return "partially_invoiced";
  return "unknown";
}

function deriveDeadlineStatus(input: {
  expectedDeliveryDate: Date | null;
  firstInvoiceDate: Date | null;
  referenceDate: Date;
  hasInvoice: boolean;
  isCancelled: boolean;
}): SalesOrderDeadlineStatus {
  if (input.isCancelled) return "unknown";
  if (!input.expectedDeliveryDate) return "no_due_date";
  const due = startOfLocalDay(input.expectedDeliveryDate);
  const today = startOfLocalDay(input.referenceDate);
  const diff = diffCalendarDays(today, due);
  if (input.hasInvoice && input.firstInvoiceDate) {
    const inv = startOfLocalDay(input.firstInvoiceDate);
    const invoiceDiff = diffCalendarDays(inv, due);
    if (invoiceDiff > 0) return "invoiced_early";
    if (invoiceDiff === 0) return "invoiced_on_time";
    return "invoiced_late";
  }
  if (diff > 0) return "on_time";
  if (diff === 0) return "due_today";
  return "overdue";
}

function deriveCompletionStatus(items: EnrichedLifecycleItem[]): SalesOrderCompletionStatus {
  if (items.length === 0) return "unknown";
  if (items.every((i) => i.isCancelled)) return "cancelled";
  if (items.every((i) => i.isReturned)) return "returned";
  if (items.some((i) => i.hasCut)) return "with_cut";
  const active = items.filter((i) => !i.isCancelled && !i.isReturned);
  if (active.length === 0) return "mixed";
  const allComplete = active.every(
    (i) =>
      i.normalizedStatus === "fully_fulfilled" ||
      i.normalizedStatus === "delivered" ||
      i.normalizedStatus === "shipped"
  );
  const anyPartial = active.some(
    (i) =>
      i.normalizedStatus === "partially_fulfilled" ||
      (i.fulfilledQuantity != null &&
        i.fulfilledQuantity > 0 &&
        i.fulfilledQuantity + 1e-6 < i.orderedQuantity)
  );
  if (allComplete) return "complete";
  if (anyPartial) return "partial";
  const mixedStatuses = new Set(active.map((i) => i.normalizedStatus));
  if (mixedStatuses.size > 1) return "mixed";
  return "unknown";
}

function deriveOperationalStatus(input: {
  originalStatus: string;
  items: EnrichedLifecycleItem[];
  billingStatus: SalesOrderBillingStatus;
  completionStatus: SalesOrderCompletionStatus;
  deadlineStatus: SalesOrderDeadlineStatus;
}): SalesOrderOperationalStatus {
  if (isCancelledSalesOrderStatus(input.originalStatus)) return "cancelled";
  if (input.completionStatus === "returned") {
    return input.items.every((i) => i.normalizedStatus === "fully_returned")
      ? "fully_returned"
      : "partially_returned";
  }
  if (input.completionStatus === "with_cut") return "fulfilled_with_cut";
  if (input.completionStatus === "partial") return "partially_fulfilled";
  if (input.items.some((i) => i.normalizedStatus === "delivered")) return "delivered";
  if (input.items.some((i) => i.normalizedStatus === "shipped")) return "shipped";
  if (input.billingStatus === "fully_invoiced" || input.billingStatus === "invoiced_with_cut") {
    return "fully_invoiced";
  }
  if (input.billingStatus === "partially_invoiced") return "partially_invoiced";
  if (input.completionStatus === "complete") return "fully_fulfilled";
  if (input.items.every((i) => i.normalizedStatus === "awaiting_release")) {
    return "awaiting_release";
  }
  if (input.items.some((i) => i.normalizedStatus === "unknown")) return "divergent";
  if (
    input.items.some(
      (i) =>
        i.normalizedStatus === "released" ||
        i.normalizedStatus === "partially_fulfilled" ||
        i.normalizedStatus === "fully_fulfilled"
    )
  ) {
    return input.deadlineStatus === "overdue" ? "in_progress" : "released";
  }
  return "unknown";
}

function buildRiskFlags(input: {
  items: EnrichedLifecycleItem[];
  deadlineStatus: SalesOrderDeadlineStatus;
  hasInvoice: boolean;
  expectedDeliveryDate: Date | null;
  referenceDate: Date;
  originalStatus: string;
  hasLinkedProductionOrder: boolean;
  productionOrderLate: boolean;
  requiresProduction: boolean;
}): SalesOrderRiskFlag[] {
  const flags: SalesOrderRiskFlag[] = [];
  if (isCancelledSalesOrderStatus(input.originalStatus)) return flags;

  if (
    !input.hasInvoice &&
    input.expectedDeliveryDate &&
    isOverdueSalesOrder({
      status: input.originalStatus,
      expectedDeliveryDate: input.expectedDeliveryDate,
      today: input.referenceDate,
      hasNfeDataProcessamento: false,
    })
  ) {
    flags.push("overdue_without_invoice");
  }
  if (input.deadlineStatus === "invoiced_late") flags.push("invoice_after_deadline");
  if (input.items.some((i) => i.normalizedStatus === "partially_fulfilled")) {
    flags.push("partial_fulfillment");
  }
  if (input.items.some((i) => i.hasCut)) flags.push("cut_fulfillment");
  const statuses = new Set(input.items.map((i) => i.normalizedStatus));
  if (statuses.size > 1 && !statuses.has("unknown")) flags.push("mixed_item_status");
  if (input.items.some((i) => i.isReturned)) flags.push("returned_items");
  if (!input.expectedDeliveryDate) flags.push("missing_due_date");
  if (!input.hasInvoice && input.items.some((i) => i.normalizedStatus === "delivered")) {
    flags.push("missing_invoice_link");
  }
  if (input.items.some((i) => i.normalizedStatus === "unknown")) {
    flags.push("unknown_item_status");
  }
  if (input.requiresProduction && !input.hasLinkedProductionOrder) {
    flags.push("missing_production_order");
  }
  if (input.productionOrderLate) flags.push("production_order_late");
  return [...new Set(flags)];
}

export function buildSalesOrderLifecycleSummary(
  input: SalesOrderLifecycleInput
): { lifecycle: SalesOrderLifecycleSummary; items: EnrichedLifecycleItem[] } {
  const referenceDate = input.referenceDate ?? new Date();
  const rawItems = extractNomusRawItems(input.nomusRawResponse);
  const nfes = extractNomusRawNfes(input.nomusRawResponse);
  const productionOrders = extractNomusProductionOrders(input.nomusRawResponse);
  const hasInvoice = salesOrderHasInvoicing(input.nomusRawResponse);
  const invoiceMeta = resolveInvoiceDates(nfes);
  const issueDate = toDate(input.issueDate);
  const expectedDeliveryDate = toDate(input.expectedDeliveryDate);
  const items = enrichItems(input, rawItems, productionOrders, hasInvoice);

  const warnings: string[] = [];
  const usedRawFallback = rawItems.length > 0;
  let missingItemStatusCount = 0;
  for (const item of items) {
    if (!item.originalStatus) missingItemStatusCount += 1;
    if (item.normalizedStatus === "unknown" && item.originalStatus) {
      warnings.push(`Status de item não mapeado: ${item.originalStatus}`);
    }
  }
  if (rawItems.length === 0 && input.items.length > 0) {
    warnings.push("Status de itens indisponível — nomusRawResponse sem itensPedido.");
  }
  if (productionOrders.length === 0) {
    warnings.push("OP não sincronizada para este pedido.");
  }

  const orderedQuantityTotal = items.reduce((s, i) => s + i.orderedQuantity, 0);
  const fulfilledKnown = items.every((i) => i.fulfilledQuantity != null);
  const invoicedKnown = items.every((i) => i.invoicedQuantity != null);
  const fulfilledQuantityTotal = fulfilledKnown
    ? items.reduce((s, i) => s + (i.fulfilledQuantity ?? 0), 0)
    : null;
  const invoicedQuantityTotal = invoicedKnown
    ? items.reduce((s, i) => s + (i.invoicedQuantity ?? 0), 0)
    : null;
  const pendingQuantityTotal =
    fulfilledQuantityTotal != null
      ? Math.max(0, orderedQuantityTotal - fulfilledQuantityTotal)
      : null;

  const hasCut = items.some((i) => i.hasCut);
  const billingStatus = deriveBillingStatus(
    hasInvoice,
    invoicedQuantityTotal,
    orderedQuantityTotal,
    hasCut
  );
  const isCancelled = isCancelledSalesOrderStatus(input.originalStatus);
  const deadlineStatus = deriveDeadlineStatus({
    expectedDeliveryDate,
    firstInvoiceDate: invoiceMeta.first,
    referenceDate,
    hasInvoice,
    isCancelled,
  });
  const completionStatus = deriveCompletionStatus(items);
  const operationalStatus = deriveOperationalStatus({
    originalStatus: input.originalStatus,
    items,
    billingStatus,
    completionStatus,
    deadlineStatus,
  });

  let executive = EXECUTIVE_LABELS[operationalStatus];
  if (deadlineStatus === "overdue" && !hasInvoice && !isCancelled) {
    executive = { label: "Atrasado sem NF", priority: 88 };
  } else if (deadlineStatus === "invoiced_late") {
    executive = { label: "Faturado com atraso", priority: 82 };
  } else if (deadlineStatus === "invoiced_on_time" && billingStatus === "fully_invoiced") {
    executive = { label: "Faturado total no prazo", priority: 62 };
  }

  const productionOrderLate = productionOrders.some((op) => {
    const due = parseNomusBrOrIsoDate(op.dueDate);
    if (!due) return false;
    const finished = parseNomusBrOrIsoDate(op.finishedAt);
    if (finished) return diffCalendarDays(due, finished) < 0;
    return diffCalendarDays(referenceDate, due) > 0;
  });

  const riskFlags = buildRiskFlags({
    items,
    deadlineStatus,
    hasInvoice,
    expectedDeliveryDate,
    referenceDate,
    originalStatus: input.originalStatus,
    hasLinkedProductionOrder: productionOrders.length > 0,
    productionOrderLate,
    requiresProduction: input.requiresProduction ?? true,
  });

  const daysUntilDue =
    expectedDeliveryDate != null
      ? diffCalendarDays(referenceDate, expectedDeliveryDate)
      : null;
  const daysOverdue =
    expectedDeliveryDate != null && daysUntilDue != null && daysUntilDue < 0
      ? Math.abs(daysUntilDue)
      : null;
  const daysInvoiceEarlyOrLate =
    expectedDeliveryDate && invoiceMeta.first
      ? diffCalendarDays(invoiceMeta.first, expectedDeliveryDate)
      : null;

  const lifecycle: SalesOrderLifecycleSummary = {
    salesOrderId: input.salesOrderId,
    salesOrderNumber: input.salesOrderNumber,
    originalStatus: input.originalStatus,
    operationalStatus,
    billingStatus,
    deadlineStatus,
    completionStatus,
    executiveStatusLabel: executive.label,
    executiveStatusPriority: executive.priority,
    issueDate: issueDate ? formatYmdLocal(issueDate) : null,
    expectedDeliveryDate: expectedDeliveryDate
      ? formatYmdLocal(expectedDeliveryDate)
      : null,
    firstInvoiceDate: invoiceMeta.first ? formatYmdLocal(invoiceMeta.first) : null,
    lastInvoiceDate: invoiceMeta.last ? formatYmdLocal(invoiceMeta.last) : null,
    deliveryDate: null,
    daysUntilDue,
    daysOverdue,
    daysInvoiceEarlyOrLate,
    itemsCount: items.length,
    itemsAwaitingRelease: items.filter((i) => i.normalizedStatus === "awaiting_release").length,
    itemsReleased: items.filter((i) => i.normalizedStatus === "released").length,
    itemsPartiallyFulfilled: items.filter((i) => i.normalizedStatus === "partially_fulfilled")
      .length,
    itemsFullyFulfilled: items.filter((i) => i.normalizedStatus === "fully_fulfilled").length,
    itemsFulfilledWithCut: items.filter((i) => i.normalizedStatus === "fulfilled_with_cut").length,
    itemsCancelled: items.filter((i) => i.normalizedStatus === "cancelled").length,
    itemsReturned: items.filter(
      (i) =>
        i.normalizedStatus === "partially_returned" ||
        i.normalizedStatus === "fully_returned"
    ).length,
    itemsShipped: items.filter((i) => i.normalizedStatus === "shipped").length,
    itemsDelivered: items.filter((i) => i.normalizedStatus === "delivered").length,
    orderedQuantityTotal,
    fulfilledQuantityTotal,
    invoicedQuantityTotal,
    pendingQuantityTotal,
    fulfilledPercent: safeRatio(fulfilledQuantityTotal, orderedQuantityTotal),
    invoicedPercent: safeRatio(invoicedQuantityTotal, orderedQuantityTotal),
    hasInvoice,
    invoiceNumbers: invoiceMeta.numbers,
    hasLinkedProductionOrder: productionOrders.length > 0,
    productionOrderLate,
    riskFlags,
    dataQuality: {
      warnings,
      missingItemStatusCount,
      missingDueDate: !expectedDeliveryDate,
      missingInvoiceDate: hasInvoice && !invoiceMeta.first,
      missingProductionOrderLink: productionOrders.length === 0,
      usedRawFallback,
    },
  };

  return { lifecycle, items };
}

export function countItemsByNormalizedStatus(
  items: EnrichedLifecycleItem[],
  status: SalesOrderItemNomusStatus
): number {
  return items.filter((i) => i.normalizedStatus === status).length;
}
