import type { Prisma } from "@prisma/client";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import {
  buildSalesOrderLifecycleSummary,
  type SalesOrderLifecycleInput,
} from "./salesOrderLifecycleStatus.js";
import {
  mapLifecycleToManagementRow,
  type SalesOrderIntelligencePayload,
} from "./salesOrderIntelligence.js";
import type { SalesOrderOperationalStatus } from "./salesOrderLifecycleTypes.js";
import {
  buildManagementStatusCardMetrics,
  isManagementStatusCardId,
  resolveManagementStatusCardId,
  type ManagementStatusCardId,
} from "./salesOrderManagementStatus.js";
import type {
  SalesOrderManagementCardAmounts,
  SalesOrderManagementCards,
  SalesOrderManagementRow,
} from "./salesOrderManagementTypes.js";
import { cardsToManagementSummary, type SalesOrderManagementSummary } from "./salesOrderManagementTypes.js";

export type {
  SalesOrderManagementCards,
  SalesOrderManagementRow,
} from "./salesOrderManagementTypes.js";
export {
  getSalesOrderIntelligenceApiPath,
  getSalesOrderManagementApiPath,
  cardsToManagementSummary,
} from "./salesOrderManagementTypes.js";
export type { SalesOrderManagementSummary } from "./salesOrderManagementTypes.js";

export type SalesOrderManagementFilters = {
  year?: number;
  month?: number;
  customerId?: string;
  responsible?: string;
  companyIssuer?: string;
  operationalStatus?: SalesOrderOperationalStatus | "";
  deadlineStatus?: string;
  billingStatus?: string;
  hasInvoice?: boolean | null;
  hasProductionOrder?: boolean | null;
  productionLate?: boolean | null;
  completionStatus?: string;
  withRisk?: boolean | null;
  overdueOnly?: boolean | null;
  invoiceAfterDeadline?: boolean | null;
  partialOrCut?: boolean | null;
  noProductionOrder?: boolean | null;
  managementStatus?: ManagementStatusCardId | "";
  startDate?: Date | null;
  endDate?: Date | null;
  status?: string;
};

export function parseSalesOrderManagementFilters(
  query: Record<string, unknown>
): SalesOrderManagementFilters {
  const yearRaw = query.year;
  const monthRaw = query.month;
  const year =
    typeof yearRaw === "string" && yearRaw.trim()
      ? Number(yearRaw)
      : typeof yearRaw === "number"
        ? yearRaw
        : undefined;
  const month =
    typeof monthRaw === "string" && monthRaw.trim()
      ? Number(monthRaw)
      : typeof monthRaw === "number"
        ? monthRaw
        : undefined;

  const bool = (key: string): boolean | null => {
    const v = query[key];
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return null;
  };

  return {
    year: Number.isFinite(year) ? year : undefined,
    month: Number.isFinite(month) ? month : undefined,
    customerId: typeof query.customerId === "string" ? query.customerId.trim() : undefined,
    responsible: typeof query.responsible === "string" ? query.responsible.trim() : undefined,
    companyIssuer:
      typeof query.companyIssuer === "string" ? query.companyIssuer.trim() : undefined,
    operationalStatus:
      typeof query.operationalStatus === "string"
        ? (query.operationalStatus as SalesOrderOperationalStatus)
        : "",
    deadlineStatus:
      typeof query.deadlineStatus === "string" ? query.deadlineStatus.trim() : undefined,
    billingStatus:
      typeof query.billingStatus === "string" ? query.billingStatus.trim() : undefined,
    hasInvoice: bool("hasInvoice"),
    hasProductionOrder: bool("hasProductionOrder"),
    productionLate: bool("productionLate"),
    completionStatus:
      typeof query.completionStatus === "string" ? query.completionStatus.trim() : undefined,
    withRisk: bool("withRisk"),
    overdueOnly: bool("overdueOnly"),
    invoiceAfterDeadline: bool("invoiceAfterDeadline"),
    partialOrCut: bool("partialOrCut"),
    noProductionOrder: bool("noProductionOrder"),
    managementStatus:
      typeof query.managementStatus === "string" && isManagementStatusCardId(query.managementStatus)
        ? query.managementStatus
        : "",
    status: typeof query.status === "string" ? query.status.trim() : undefined,
  };
}

export function buildSalesOrderManagementWhere(
  filters: SalesOrderManagementFilters
): Prisma.SalesOrderWhereInput {
  let startDate = filters.startDate ?? null;
  let endDate = filters.endDate ?? null;
  if (filters.year != null) {
    startDate = new Date(filters.year, (filters.month ?? 1) - 1, 1);
    endDate = filters.month
      ? new Date(filters.year, filters.month, 0, 23, 59, 59, 999)
      : new Date(filters.year, 11, 31, 23, 59, 59, 999);
  }

  const base = buildSalesOrderListWhere({
    status: filters.status,
    customerId: filters.customerId,
    responsible: filters.responsible,
    startDate,
    endDate,
  });

  if (filters.companyIssuer) {
    return {
      ...base,
      companyIssuer: { contains: filters.companyIssuer, mode: "insensitive" },
    };
  }
  return base;
}

function matchesManagementFilters(
  row: SalesOrderManagementRow,
  lifecycle: ReturnType<typeof buildSalesOrderLifecycleSummary>["lifecycle"],
  filters: SalesOrderManagementFilters
): boolean {
  if (filters.operationalStatus && lifecycle.operationalStatus !== filters.operationalStatus) {
    return false;
  }
  if (filters.deadlineStatus && lifecycle.deadlineStatus !== filters.deadlineStatus) return false;
  if (filters.billingStatus && lifecycle.billingStatus !== filters.billingStatus) return false;
  if (filters.completionStatus && lifecycle.completionStatus !== filters.completionStatus) {
    return false;
  }
  if (filters.hasInvoice === true && !lifecycle.hasInvoice) return false;
  if (filters.hasInvoice === false && lifecycle.hasInvoice) return false;
  if (filters.hasProductionOrder === true && !lifecycle.hasLinkedProductionOrder) return false;
  if (filters.hasProductionOrder === false && lifecycle.hasLinkedProductionOrder) return false;
  if (filters.productionLate === true && !lifecycle.productionOrderLate) return false;
  if (filters.withRisk === true && lifecycle.riskFlags.length === 0) return false;
  if (filters.overdueOnly === true && lifecycle.deadlineStatus !== "overdue") return false;
  if (filters.invoiceAfterDeadline === true && lifecycle.deadlineStatus !== "invoiced_late") {
    return false;
  }
  if (
    filters.partialOrCut === true &&
    lifecycle.completionStatus !== "partial" &&
    lifecycle.completionStatus !== "with_cut"
  ) {
    return false;
  }
  if (filters.noProductionOrder === true && lifecycle.hasLinkedProductionOrder) return false;
  if (
    filters.managementStatus &&
    resolveManagementStatusCardId(row.executiveStatusLabel) !== filters.managementStatus
  ) {
    return false;
  }
  return true;
}

function omitManagementStatusFilter(
  filters: SalesOrderManagementFilters
): SalesOrderManagementFilters {
  return { ...filters, managementStatus: "" };
}

export function sortManagementRowsByRisk(rows: SalesOrderManagementRow[]): SalesOrderManagementRow[] {
  return [...rows].sort((a, b) => {
    if (b.highRiskCount !== a.highRiskCount) return b.highRiskCount - a.highRiskCount;
    if (b.riskCount !== a.riskCount) return b.riskCount - a.riskCount;
    const overdueA = a.daysOverdue ?? 0;
    const overdueB = b.daysOverdue ?? 0;
    if (overdueB !== overdueA) return overdueB - overdueA;
    return (b.totalNetValue ?? 0) - (a.totalNetValue ?? 0);
  });
}

export function buildSalesOrderManagementCards(
  rows: Array<Pick<SalesOrderManagementRow, "executiveStatusLabel" | "totalNetValue">>
): SalesOrderManagementCards {
  return buildManagementStatusCardMetrics(rows).counts;
}

export function buildSalesOrderManagementCardAmounts(
  rows: Array<Pick<SalesOrderManagementRow, "executiveStatusLabel" | "totalNetValue">>
): SalesOrderManagementCardAmounts {
  return buildManagementStatusCardMetrics(rows).amounts;
}

export function buildManagementRowsFromOrders(
  orders: Array<{
    id: string;
    orderCode: string;
    status: string;
    issueDate: Date;
    expectedDeliveryDate: Date | null;
    totalNetValue: unknown;
    responsible: string | null;
    nomusRawResponse: unknown;
    companyIssuer?: string | null;
    Customer?: { companyName?: string | null; tradeName?: string | null; taxId?: string | null };
    items: SalesOrderLifecycleInput["items"];
  }>,
  filters: SalesOrderManagementFilters,
  referenceDate = new Date()
): {
  rows: SalesOrderManagementRow[];
  cards: SalesOrderManagementCards;
  cardAmounts: SalesOrderManagementCardAmounts;
  summary: SalesOrderManagementSummary;
} {
  const computed = orders.map((order) => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      originalStatus: order.status,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
      items: order.items,
      referenceDate,
    });
    const row = mapLifecycleToManagementRow(
      {
        id: order.id,
        orderCode: order.orderCode,
        issueDate: order.issueDate.toISOString(),
        expectedDeliveryDate: order.expectedDeliveryDate?.toISOString() ?? null,
        totalNetValue: order.totalNetValue,
        responsible: order.responsible,
        companyIssuer: order.companyIssuer,
        nomusRawResponse: order.nomusRawResponse,
        itemsCount: order.items.length,
        Customer: order.Customer,
      },
      lifecycle,
      { items, referenceDate }
    );
    return { row, lifecycle };
  });

  const baseFilters = omitManagementStatusFilter(filters);
  const baseFiltered = computed.filter(({ row, lifecycle }) =>
    matchesManagementFilters(row, lifecycle, baseFilters)
  );
  const filtered = baseFiltered.filter(({ row, lifecycle }) =>
    matchesManagementFilters(row, lifecycle, filters)
  );

  const cardRows = baseFiltered.map((f) => f.row);
  const cards = buildSalesOrderManagementCards(cardRows);
  const cardAmounts = buildSalesOrderManagementCardAmounts(cardRows);

  return {
    rows: sortManagementRowsByRisk(filtered.map((f) => f.row)),
    cards,
    cardAmounts,
    summary: cardsToManagementSummary(cards, filtered.length),
  };
}

export type SalesOrderManagementResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  cards: SalesOrderManagementCards;
  cardAmounts?: SalesOrderManagementCardAmounts;
  summary?: SalesOrderManagementSummary;
  rows: SalesOrderManagementRow[];
};

export function assertManagementResponseShape(
  payload: SalesOrderIntelligencePayload | SalesOrderManagementResponse
): boolean {
  if ("lifecycle" in payload && "timeline" in payload) {
    return Number.isFinite(payload.order.totalNetValue);
  }
  if ("cards" in payload && "rows" in payload) {
    return Object.values(payload.cards).every((v) => Number.isFinite(v));
  }
  return false;
}
