import type { ManagementStatusCardId } from "./salesOrderManagementStatus.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import { extractSalesOrderNfesFromNomusPayload } from "./salesOrderNomusNfeExtract.js";
import { startOfLocalDay } from "./salesOrderNomusRaw.js";

function computeAverageLinkedNfeSlaDays(
  contexts: Iterable<Pick<SalesOrderLinkedNfeContext, "daysToInvoice">>
): number | null {
  const values: number[] = [];
  for (const context of contexts) {
    if (context.daysToInvoice != null && Number.isFinite(context.daysToInvoice)) {
      values.push(context.daysToInvoice);
    }
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type SalesOrderFulfillmentKpis = {
  totalOrders: number;
  totalSoldValue: number;
  totalInvoicedValue: number;
  soldInvoicedGap: number;
  ordersWithNfe: number;
  ordersWithoutNfe: number;
  deliveredOnTime: number;
  deliveredLate: number;
  pendingOnTime: number;
  pendingLate: number;
  partialCount: number;
  withCutCount: number;
  needsReviewCount: number;
  averageSlaDays: number | null;
  onTimePercent: number | null;
  averageFulfilledPercent: number | null;
  averageInvoicedPercent: number | null;
};

export type SalesOrderFulfillmentChartPoint = {
  label: string;
  count: number;
  value: number;
};

export type SalesOrderFulfillmentCharts = {
  ordersByLogisticStatus: SalesOrderFulfillmentChartPoint[];
  valueByLogisticStatus: SalesOrderFulfillmentChartPoint[];
  onTimeVsLate: {
    onTime: number;
    late: number;
    pending: number;
    review: number;
  };
  slaByMonth: Array<{ month: string; avgSlaDays: number | null; count: number }>;
  slaBySeller: Array<{ seller: string; avgSlaDays: number | null; count: number }>;
  slaByCustomer: Array<{ customer: string; avgSlaDays: number | null; count: number }>;
  soldVsInvoicedByMonth: Array<{ month: string; sold: number; invoiced: number }>;
  topLateCustomers: SalesOrderFulfillmentChartPoint[];
  topLateSellers: SalesOrderFulfillmentChartPoint[];
  topPendingProducts: Array<{ product: string; count: number }>;
};

export type SalesOrderFulfillmentAuditRow = {
  orderId: string;
  orderCode: string;
  soldValue: number;
  invoicedValue: number;
  gap: number;
  reviewReasons: string[];
};

export type SalesOrderFulfillmentAudit = {
  totalOrdersInFilter: number;
  ordersWithNfeLink: number;
  ordersWithoutNfeLink: number;
  ordersWithRawNfesWithoutLink: number;
  ordersWithLinkWithoutNomusMatch: number;
  totalSoldValue: number;
  totalInvoicedValue: number;
  soldInvoicedGap: number;
  logisticStatusDistribution: Record<string, number>;
  topDivergenceOrders: SalesOrderFulfillmentAuditRow[];
  topReviewOrders: SalesOrderFulfillmentAuditRow[];
};

export type SalesOrderFulfillmentExtendedFilters = {
  deliveryYear?: number;
  deliveryMonth?: number;
  deliveryStartDate?: Date | null;
  deliveryEndDate?: Date | null;
  nfeYear?: number;
  nfeMonth?: number;
  nfeStartDate?: Date | null;
  nfeEndDate?: Date | null;
  invoiceCoverage?: "" | "0" | "partial" | "100" | "over100";
  needsDataReview?: boolean | null;
  invoiceNumber?: string;
  hasCut?: boolean | null;
  slaStatus?: "" | "on_time" | "late" | "pending" | "review";
  prazoFilter?: "" | "on_time" | "late" | "pending" | "review";
  fulfillmentFilter?: "" | "complete" | "partial" | "none";
};

export type SalesOrderManagementSortKey =
  | "number"
  | "customerName"
  | "sellerName"
  | "issueDate"
  | "expectedDeliveryDate"
  | "lastInvoiceDate"
  | "totalNetValue"
  | "invoicedValue"
  | "invoiceCoveragePercent"
  | "logisticStatusLabel"
  | "slaStatus"
  | "daysOverdue"
  | "slaDays";

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseRowDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfLocalDay(d);
}

function dateInRange(
  date: Date | null,
  start: Date | null | undefined,
  end: Date | null | undefined
): boolean {
  if (!date) return false;
  if (start && date.getTime() < start.getTime()) return false;
  if (end && date.getTime() > end.getTime()) return false;
  return true;
}

function buildDateWindow(
  year?: number,
  month?: number,
  start?: Date | null,
  end?: Date | null
): { start: Date | null; end: Date | null } {
  if (start || end) return { start: start ?? null, end: end ?? null };
  if (year == null) return { start: null, end: null };
  const s = new Date(year, (month ?? 1) - 1, 1);
  const e = month
    ? new Date(year, month, 0, 23, 59, 59, 999)
    : new Date(year, 11, 31, 23, 59, 59, 999);
  return { start: s, end: e };
}

export function matchesFulfillmentExtendedFilters(
  row: SalesOrderManagementRow,
  filters: SalesOrderFulfillmentExtendedFilters
): boolean {
  const deliveryWindow = buildDateWindow(
    filters.deliveryYear,
    filters.deliveryMonth,
    filters.deliveryStartDate,
    filters.deliveryEndDate
  );
  if (deliveryWindow.start || deliveryWindow.end) {
    const delivery = parseRowDate(row.expectedDeliveryDate);
    if (!dateInRange(delivery, deliveryWindow.start, deliveryWindow.end)) return false;
  }

  const nfeWindow = buildDateWindow(
    filters.nfeYear,
    filters.nfeMonth,
    filters.nfeStartDate,
    filters.nfeEndDate
  );
  if (nfeWindow.start || nfeWindow.end) {
    const nfeDate = parseRowDate(row.lastInvoiceDate);
    if (!dateInRange(nfeDate, nfeWindow.start, nfeWindow.end)) return false;
  }

  if (filters.invoiceNumber?.trim()) {
    const token = filters.invoiceNumber.trim().toLowerCase();
    const numbers = row.invoiceNumbers.map((n) => n.toLowerCase());
    if (!numbers.some((n) => n.includes(token))) return false;
  }

  if (filters.needsDataReview === true && !row.needsDataReview) return false;
  if (filters.needsDataReview === false && row.needsDataReview) return false;

  if (filters.hasCut === true && !row.hasCut) return false;
  if (filters.hasCut === false && row.hasCut) return false;

  if (filters.slaStatus && row.slaStatus !== filters.slaStatus) return false;

  if (filters.prazoFilter) {
    const card = row.logisticStatusCardId;
    if (filters.prazoFilter === "on_time" && card !== "deliveredOnTime" && card !== "onTimePending") {
      return false;
    }
    if (
      filters.prazoFilter === "late" &&
      card !== "deliveredLate" &&
      card !== "overduePending"
    ) {
      return false;
    }
    if (filters.prazoFilter === "pending" && card !== "onTimePending" && card !== "overduePending") {
      return false;
    }
    if (filters.prazoFilter === "review" && card !== "reviewData") return false;
  }

  if (filters.fulfillmentFilter) {
    if (filters.fulfillmentFilter === "complete" && row.completionStatus !== "complete") return false;
    if (filters.fulfillmentFilter === "partial") {
      const partialCompletion =
        row.completionStatus === "partial" || row.completionStatus === "with_cut";
      const partialInvoice =
        row.hasInvoice &&
        row.invoiceCoveragePercent != null &&
        row.invoiceCoveragePercent > 0 &&
        row.invoiceCoveragePercent < 99.99;
      if (!partialCompletion && !partialInvoice) return false;
    }
    if (
      filters.fulfillmentFilter === "none" &&
      row.hasInvoice &&
      (row.invoicedValue ?? 0) > 0
    ) {
      return false;
    }
  }

  if (filters.invoiceCoverage) {
    const pct = row.invoiceCoveragePercent;
    if (filters.invoiceCoverage === "0") {
      if (row.hasInvoice && (pct ?? 0) > 0) return false;
    } else if (filters.invoiceCoverage === "partial") {
      if (!(row.hasInvoice && pct != null && pct > 0 && pct < 99.99)) return false;
    } else if (filters.invoiceCoverage === "100") {
      if (!(pct != null && pct >= 99.99 && pct <= 100.01)) return false;
    } else if (filters.invoiceCoverage === "over100") {
      if (!(pct != null && pct > 100.01)) return false;
    }
  }

  return true;
}

export function buildFulfillmentKpis(rows: SalesOrderManagementRow[]): SalesOrderFulfillmentKpis {
  let totalSoldValue = 0;
  let totalInvoicedValue = 0;
  let ordersWithNfe = 0;
  let ordersWithoutNfe = 0;
  let deliveredOnTime = 0;
  let deliveredLate = 0;
  let pendingOnTime = 0;
  let pendingLate = 0;
  let partialCount = 0;
  let withCutCount = 0;
  let needsReviewCount = 0;
  let onTimeEligible = 0;
  let onTimeCount = 0;
  let fulfilledSum = 0;
  let fulfilledCount = 0;
  let invoicedPctSum = 0;
  let invoicedPctCount = 0;

  const slaContexts: SalesOrderLinkedNfeContext[] = [];

  for (const row of rows) {
    totalSoldValue += row.totalNetValue ?? 0;
    totalInvoicedValue += row.invoicedValue ?? 0;
    if (row.hasInvoice) ordersWithNfe += 1;
    else ordersWithoutNfe += 1;

    switch (row.logisticStatusCardId as ManagementStatusCardId) {
      case "deliveredOnTime":
        deliveredOnTime += 1;
        onTimeEligible += 1;
        onTimeCount += 1;
        break;
      case "deliveredLate":
        deliveredLate += 1;
        onTimeEligible += 1;
        break;
      case "onTimePending":
        pendingOnTime += 1;
        break;
      case "overduePending":
        pendingLate += 1;
        break;
      case "reviewData":
        needsReviewCount += 1;
        break;
      default:
        break;
    }

    if (row.completionStatus === "partial") partialCount += 1;
    if (row.completionStatus === "with_cut" || row.hasCut) withCutCount += 1;
    if (row.needsDataReview) needsReviewCount += 1;

    if (row.fulfilledPercent != null && Number.isFinite(row.fulfilledPercent)) {
      fulfilledSum += row.fulfilledPercent;
      fulfilledCount += 1;
    }
    if (row.invoiceCoveragePercent != null && Number.isFinite(row.invoiceCoveragePercent)) {
      invoicedPctSum += row.invoiceCoveragePercent;
      invoicedPctCount += 1;
    }

    if (row.slaDays != null) {
      slaContexts.push({
        source: row.linkedNfeSource ?? "linked",
        hasNfe: row.hasInvoice,
        nfeCount: row.nfeCount,
        nfeNumbers: row.invoiceNumbers,
        nfeKeys: [],
        nfeStatuses: [],
        nfeTipoOperacao: [],
        nfeLinks: [],
        firstNfeProcessingDate: null,
        lastNfeProcessingDate: parseRowDate(row.lastInvoiceDate),
        firstNfeIssueDate: null,
        lastNfeIssueDate: null,
        nfeTotalValue: row.invoicedValue ?? 0,
        invoiceCoveragePercent: row.invoiceCoveragePercent,
        isFullyInvoiced: false,
        isPartiallyInvoiced: false,
        isNotInvoiced: !row.hasInvoice,
        isOnTime: row.slaStatus === "on_time",
        isLate: row.slaStatus === "late",
        hasCut: row.hasCut,
        isComplete: row.completionStatus === "complete",
        hasValueDivergence: (row.invoiceCoveragePercent ?? 0) > 100.01,
        needsDataReview: row.needsDataReview,
        reviewReasons: row.reviewReasons,
        daysToInvoice: row.slaDays,
        daysLate: row.daysOverdue,
        slaStatus: row.slaStatus,
        slaDays: row.slaDays,
      });
    }
  }

  return {
    totalOrders: rows.length,
    totalSoldValue,
    totalInvoicedValue,
    soldInvoicedGap: totalSoldValue - totalInvoicedValue,
    ordersWithNfe,
    ordersWithoutNfe,
    deliveredOnTime,
    deliveredLate,
    pendingOnTime,
    pendingLate,
    partialCount,
    withCutCount,
    needsReviewCount,
    averageSlaDays: computeAverageLinkedNfeSlaDays(slaContexts),
    onTimePercent:
      onTimeEligible > 0 ? Math.round((onTimeCount / onTimeEligible) * 10000) / 100 : null,
    averageFulfilledPercent:
      fulfilledCount > 0 ? Math.round((fulfilledSum / fulfilledCount) * 100) / 100 : null,
    averageInvoicedPercent:
      invoicedPctCount > 0 ? Math.round((invoicedPctSum / invoicedPctCount) * 100) / 100 : null,
  };
}

function aggregateByKey(
  rows: SalesOrderManagementRow[],
  keyFn: (row: SalesOrderManagementRow) => string,
  valueFn: (row: SalesOrderManagementRow) => number,
  limit = 10
): SalesOrderFulfillmentChartPoint[] {
  const map = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const key = keyFn(row);
    const prev = map.get(key) ?? { count: 0, value: 0 };
    map.set(key, { count: prev.count + 1, value: prev.value + valueFn(row) });
  }
  return [...map.entries()]
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => b.value - a.value || b.count - a.count)
    .slice(0, limit);
}

export function buildFulfillmentCharts(rows: SalesOrderManagementRow[]): SalesOrderFulfillmentCharts {
  const statusMap = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const label = row.logisticStatusLabel;
    const prev = statusMap.get(label) ?? { count: 0, value: 0 };
    statusMap.set(label, {
      count: prev.count + 1,
      value: prev.value + (row.totalNetValue ?? 0),
    });
  }
  const ordersByLogisticStatus = [...statusMap.entries()].map(([label, data]) => ({
    label,
    ...data,
  }));

  const onTimeVsLate = { onTime: 0, late: 0, pending: 0, review: 0 };
  for (const row of rows) {
    if (row.slaStatus === "on_time") onTimeVsLate.onTime += 1;
    else if (row.slaStatus === "late") onTimeVsLate.late += 1;
    else if (row.slaStatus === "review" || row.needsDataReview) onTimeVsLate.review += 1;
    else onTimeVsLate.pending += 1;
  }

  const slaMonthMap = new Map<string, { sum: number; count: number }>();
  const soldMonthMap = new Map<string, { sold: number; invoiced: number }>();
  for (const row of rows) {
    const issue = parseRowDate(row.issueDate);
    if (issue) {
      const mk = monthKey(issue);
      const soldPrev = soldMonthMap.get(mk) ?? { sold: 0, invoiced: 0 };
      soldMonthMap.set(mk, {
        sold: soldPrev.sold + (row.totalNetValue ?? 0),
        invoiced: soldPrev.invoiced + (row.invoicedValue ?? 0),
      });
    }
    if (row.slaDays != null) {
      const ref = parseRowDate(row.lastInvoiceDate) ?? issue;
      if (ref) {
        const mk = monthKey(ref);
        const prev = slaMonthMap.get(mk) ?? { sum: 0, count: 0 };
        slaMonthMap.set(mk, { sum: prev.sum + row.slaDays, count: prev.count + 1 });
      }
    }
  }

  const slaByMonth = [...slaMonthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      avgSlaDays: data.count > 0 ? Math.round((data.sum / data.count) * 10) / 10 : null,
      count: data.count,
    }));

  const slaBySellerMap = new Map<string, { sum: number; count: number }>();
  const slaByCustomerMap = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    if (row.slaDays == null) continue;
    const seller = row.sellerName?.trim() || "—";
    const customer = row.customerName?.trim() || "—";
    const sPrev = slaBySellerMap.get(seller) ?? { sum: 0, count: 0 };
    slaBySellerMap.set(seller, { sum: sPrev.sum + row.slaDays, count: sPrev.count + 1 });
    const cPrev = slaByCustomerMap.get(customer) ?? { sum: 0, count: 0 };
    slaByCustomerMap.set(customer, { sum: cPrev.sum + row.slaDays, count: cPrev.count + 1 });
  }

  const toSlaList = (map: Map<string, { sum: number; count: number }>) =>
    [...map.entries()]
      .map(([label, data]) => ({
        seller: label,
        customer: label,
        avgSlaDays: data.count > 0 ? Math.round((data.sum / data.count) * 10) / 10 : null,
        count: data.count,
      }))
      .sort((a, b) => (b.avgSlaDays ?? 0) - (a.avgSlaDays ?? 0))
      .slice(0, 10);

  const lateRows = rows.filter(
    (r) => r.logisticStatusCardId === "deliveredLate" || r.logisticStatusCardId === "overduePending"
  );

  return {
    ordersByLogisticStatus,
    valueByLogisticStatus: ordersByLogisticStatus,
    onTimeVsLate,
    slaByMonth,
    slaBySeller: toSlaList(slaBySellerMap).map(({ seller, avgSlaDays, count }) => ({
      seller,
      avgSlaDays,
      count,
    })),
    slaByCustomer: toSlaList(slaByCustomerMap).map(({ customer, avgSlaDays, count }) => ({
      customer,
      avgSlaDays,
      count,
    })),
    soldVsInvoicedByMonth: [...soldMonthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, sold: data.sold, invoiced: data.invoiced })),
    topLateCustomers: aggregateByKey(lateRows, (r) => r.customerName, (r) => r.totalNetValue ?? 0),
    topLateSellers: aggregateByKey(
      lateRows,
      (r) => r.sellerName?.trim() || "—",
      (r) => r.totalNetValue ?? 0
    ),
    topPendingProducts: [],
  };
}

export function buildFulfillmentAudit(input: {
  rows: SalesOrderManagementRow[];
  linkCountsByOrderId: Map<string, number>;
  rawNfeCountsByOrderId: Map<string, number>;
  unmatchedLinkCountsByOrderId: Map<string, number>;
}): SalesOrderFulfillmentAudit {
  const logisticStatusDistribution: Record<string, number> = {};
  let ordersWithNfeLink = 0;
  let ordersWithoutNfeLink = 0;
  let ordersWithRawNfesWithoutLink = 0;
  let ordersWithLinkWithoutNomusMatch = 0;
  let totalSoldValue = 0;
  let totalInvoicedValue = 0;

  for (const row of input.rows) {
    logisticStatusDistribution[row.logisticStatusLabel] =
      (logisticStatusDistribution[row.logisticStatusLabel] ?? 0) + 1;
    totalSoldValue += row.totalNetValue ?? 0;
    totalInvoicedValue += row.invoicedValue ?? 0;

    const linkCount = input.linkCountsByOrderId.get(row.id) ?? 0;
    const rawCount = input.rawNfeCountsByOrderId.get(row.id) ?? 0;
    const unmatched = input.unmatchedLinkCountsByOrderId.get(row.id) ?? 0;

    if (linkCount > 0) ordersWithNfeLink += 1;
    else ordersWithoutNfeLink += 1;
    if (rawCount > 0 && linkCount === 0) ordersWithRawNfesWithoutLink += 1;
    if (unmatched > 0) ordersWithLinkWithoutNomusMatch += 1;
  }

  const divergenceRows: SalesOrderFulfillmentAuditRow[] = input.rows
    .map((row) => ({
      orderId: row.id,
      orderCode: row.orderCode,
      soldValue: row.totalNetValue ?? 0,
      invoicedValue: row.invoicedValue ?? 0,
      gap: (row.totalNetValue ?? 0) - (row.invoicedValue ?? 0),
      reviewReasons: row.reviewReasons,
    }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 20);

  const reviewRows: SalesOrderFulfillmentAuditRow[] = input.rows
    .filter((row) => row.needsDataReview)
    .map((row) => ({
      orderId: row.id,
      orderCode: row.orderCode,
      soldValue: row.totalNetValue ?? 0,
      invoicedValue: row.invoicedValue ?? 0,
      gap: (row.totalNetValue ?? 0) - (row.invoicedValue ?? 0),
      reviewReasons: row.reviewReasons,
    }))
    .slice(0, 20);

  return {
    totalOrdersInFilter: input.rows.length,
    ordersWithNfeLink,
    ordersWithoutNfeLink,
    ordersWithRawNfesWithoutLink,
    ordersWithLinkWithoutNomusMatch,
    totalSoldValue,
    totalInvoicedValue,
    soldInvoicedGap: totalSoldValue - totalInvoicedValue,
    logisticStatusDistribution,
    topDivergenceOrders: divergenceRows,
    topReviewOrders: reviewRows,
  };
}

export function countRawNfesInPayload(nomusRawResponse: unknown): number {
  return extractSalesOrderNfesFromNomusPayload(nomusRawResponse).length;
}

export function sortManagementRowsByColumn(
  rows: SalesOrderManagementRow[],
  sortKey: SalesOrderManagementSortKey,
  direction: "asc" | "desc"
): SalesOrderManagementRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey as keyof SalesOrderManagementRow];
    const bv = b[sortKey as keyof SalesOrderManagementRow];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv), "pt-BR") * factor;
  });
}

export function parseFulfillmentExtendedFilters(
  query: Record<string, unknown>
): SalesOrderFulfillmentExtendedFilters {
  const num = (key: string): number | undefined => {
    const v = query[key];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (key: string): boolean | null => {
    const v = query[key];
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return null;
  };

  return {
    deliveryYear: num("deliveryYear"),
    deliveryMonth: num("deliveryMonth"),
    nfeYear: num("nfeYear"),
    nfeMonth: num("nfeMonth"),
    invoiceCoverage:
      typeof query.invoiceCoverage === "string"
        ? (query.invoiceCoverage as SalesOrderFulfillmentExtendedFilters["invoiceCoverage"])
        : "",
    needsDataReview: bool("needsDataReview"),
    invoiceNumber: typeof query.invoiceNumber === "string" ? query.invoiceNumber.trim() : undefined,
    hasCut: bool("hasCut"),
    slaStatus:
      typeof query.slaStatus === "string"
        ? (query.slaStatus as SalesOrderFulfillmentExtendedFilters["slaStatus"])
        : "",
    prazoFilter:
      typeof query.prazoFilter === "string"
        ? (query.prazoFilter as SalesOrderFulfillmentExtendedFilters["prazoFilter"])
        : "",
    fulfillmentFilter:
      typeof query.fulfillmentFilter === "string"
        ? (query.fulfillmentFilter as SalesOrderFulfillmentExtendedFilters["fulfillmentFilter"])
        : "",
  };
}
