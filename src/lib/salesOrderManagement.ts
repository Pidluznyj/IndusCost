import type { Prisma } from "@prisma/client";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import {
  buildSalesOrderLifecycleSummary,
  type SalesOrderLifecycleInput,
} from "./salesOrderLifecycleStatus.js";
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import {
  mapLifecycleToManagementRow,
  type SalesOrderIntelligencePayload,
} from "./salesOrderIntelligence.js";
import type { SalesOrderOperationalStatus } from "./salesOrderLifecycleTypes.js";
import {
  buildManagementDashboardCards,
  buildManagementStatusCardMetrics,
  isManagementStatusCardId,
  type ManagementStatusCardId,
  type ManagementDashboardCard,
} from "./salesOrderManagementStatus.js";
import type {
  SalesOrderManagementCardAmounts,
  SalesOrderManagementCards,
  SalesOrderManagementMarginEconomics,
  SalesOrderManagementRow,
} from "./salesOrderManagementTypes.js";
import type { SalesOrderMarginStatusFilter } from "./salesOrderManagementMargin.js";
import {
  buildFulfillmentCharts,
  buildFulfillmentKpis,
  matchesFulfillmentExtendedFilters,
  parseFulfillmentExtendedFilters,
  sortManagementRowsByColumn,
  type SalesOrderFulfillmentCharts,
  type SalesOrderFulfillmentExtendedFilters,
  type SalesOrderFulfillmentKpis,
  type SalesOrderManagementSortKey,
} from "./salesOrderManagementFulfillment.js";
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
  /** "Todos os anos" explícito: ignora a janela de ano (sem filtro por ano). */
  allYears?: boolean;
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
  logisticStatus?: ManagementStatusCardId | "";
  startDate?: Date | null;
  endDate?: Date | null;
  status?: string;
  /** Busca inteligente (q): pedido/NF/cliente/vendedor/empresa/itens. */
  q?: string;
  sortBy?: SalesOrderManagementSortKey;
  sortDir?: "asc" | "desc";
  /** Filtro futuro de status margem (aplicado após cálculo no backend). */
  marginStatus?: SalesOrderMarginStatusFilter;
} & SalesOrderFulfillmentExtendedFilters;

export function parseSalesOrderManagementFilters(
  query: Record<string, unknown>,
  now: Date = new Date()
): SalesOrderManagementFilters {
  const yearRaw = query.year;
  const monthRaw = query.month;

  // "all" (ou "todos") explícito = todos os anos, sem filtro de ano.
  // Ausente/vazio/inválido = ano vigente (calculado dinamicamente, nunca hardcoded).
  const yearToken =
    typeof yearRaw === "string" ? yearRaw.trim().toLowerCase() : "";
  const allYears = yearToken === "all" || yearToken === "todos";

  const parsedYear =
    typeof yearRaw === "string" && yearRaw.trim()
      ? Number(yearRaw)
      : typeof yearRaw === "number"
        ? yearRaw
        : undefined;
  const year = allYears
    ? undefined
    : Number.isFinite(parsedYear)
      ? (parsedYear as number)
      : now.getFullYear();
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
    year,
    allYears: allYears ? true : undefined,
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
        : typeof query.logisticStatus === "string" && isManagementStatusCardId(query.logisticStatus)
          ? query.logisticStatus
          : "",
    logisticStatus:
      typeof query.logisticStatus === "string" && isManagementStatusCardId(query.logisticStatus)
        ? query.logisticStatus
        : typeof query.managementStatus === "string" && isManagementStatusCardId(query.managementStatus)
          ? query.managementStatus
          : "",
    status: typeof query.status === "string" ? query.status.trim() : undefined,
    q: typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined,
    sortBy:
      typeof query.sortBy === "string"
        ? (query.sortBy as SalesOrderManagementSortKey)
        : undefined,
    sortDir: query.sortDir === "asc" || query.sortDir === "desc" ? query.sortDir : undefined,
    marginStatus: parseSalesOrderMarginStatusFilter(query.marginStatus),
    ...parseFulfillmentExtendedFilters(query),
  };
}

const VALID_MARGIN_STATUS_FILTERS = new Set<SalesOrderMarginStatusFilter>([
  "",
  "OK",
  "PARTIAL",
  "SEM_CUSTO",
  "SEM_PRODUTO_VINCULADO",
  "MARGEM_NEGATIVA",
  "REVISAR_DADOS",
]);

function parseSalesOrderMarginStatusFilter(
  raw: unknown
): SalesOrderMarginStatusFilter {
  if (typeof raw !== "string") return "";
  const token = raw.trim();
  return VALID_MARGIN_STATUS_FILTERS.has(token as SalesOrderMarginStatusFilter)
    ? (token as SalesOrderMarginStatusFilter)
    : "";
}

export function buildSalesOrderManagementWhere(
  filters: SalesOrderManagementFilters
): Prisma.SalesOrderWhereInput {
  let startDate = filters.startDate ?? null;
  let endDate = filters.endDate ?? null;
  // allYears = sem janela de ano. Caso contrário, a janela usa SalesOrder.issueDate
  // (pedido vendido), nunca data de NF-e.
  if (!filters.allYears && filters.year != null) {
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
    q: filters.q,
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
  const logisticFilter = filters.logisticStatus || filters.managementStatus;
  if (logisticFilter && row.logisticStatusCardId !== logisticFilter) {
    return false;
  }
  if (!matchesFulfillmentExtendedFilters(row, filters)) return false;
  return true;
}

function omitManagementStatusFilter(
  filters: SalesOrderManagementFilters
): SalesOrderManagementFilters {
  return { ...filters, managementStatus: "", logisticStatus: "" };
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
  rows: Array<
    Pick<SalesOrderManagementRow, "totalNetValue"> & {
      logisticStatusCardId: SalesOrderManagementRow["logisticStatusCardId"];
    }
  >
): SalesOrderManagementCards {
  return buildManagementStatusCardMetrics(
    rows.map((row) => ({
      logisticStatusCardId: row.logisticStatusCardId,
      totalNetValue: row.totalNetValue,
    }))
  ).counts;
}

export function buildSalesOrderManagementCardAmounts(
  rows: Array<
    Pick<SalesOrderManagementRow, "totalNetValue"> & {
      logisticStatusCardId: SalesOrderManagementRow["logisticStatusCardId"];
    }
  >
): SalesOrderManagementCardAmounts {
  return buildManagementStatusCardMetrics(
    rows.map((row) => ({
      logisticStatusCardId: row.logisticStatusCardId,
      totalNetValue: row.totalNetValue,
    }))
  ).amounts;
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
  referenceDate = new Date(),
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>
): {
  rows: SalesOrderManagementRow[];
  cards: SalesOrderManagementCards;
  cardAmounts: SalesOrderManagementCardAmounts;
  dashboardCards: ManagementDashboardCard[];
  summary: SalesOrderManagementSummary;
  fulfillmentKpis: SalesOrderFulfillmentKpis;
  fulfillmentCharts: SalesOrderFulfillmentCharts;
} {
  const computed = orders.map((order) => {
    const linkedNfeContext = linkedNfeContextMap?.get(order.id) ?? null;
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      originalStatus: order.status,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      totalNetValue: order.totalNetValue,
      nomusRawResponse: order.nomusRawResponse,
      linkedNfeContext,
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
      { items, referenceDate, linkedNfeContext }
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
  const dashboard = buildManagementDashboardCards(cardRows);
  let filteredRows: SalesOrderManagementRow[] = filtered.map((f) => f.row);
  if (filters.sortBy) {
    filteredRows = sortManagementRowsByColumn(filteredRows, filters.sortBy, filters.sortDir ?? "desc");
  } else {
    filteredRows = sortManagementRowsByRisk(filteredRows);
  }

  return {
    rows: filteredRows,
    cards,
    cardAmounts,
    dashboardCards: dashboard.cards,
    summary: cardsToManagementSummary(cards, {
      totalOrdersCount: dashboard.totalOrders,
      totalNetValue: dashboard.totalNetValue,
      validPortfolioCount: dashboard.validPortfolioCount,
      validPortfolioValue: dashboard.validPortfolioValue,
      reconciliation: dashboard.reconciliation,
      gridFilteredCount: filteredRows.length,
    }),
    fulfillmentKpis: buildFulfillmentKpis(filteredRows),
    fulfillmentCharts: buildFulfillmentCharts(filteredRows),
  };
}

export type SalesOrderManagementResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  cards: SalesOrderManagementCards;
  cardAmounts?: SalesOrderManagementCardAmounts;
  dashboardCards?: ManagementDashboardCard[];
  summary?: SalesOrderManagementSummary;
  fulfillmentKpis?: SalesOrderFulfillmentKpis;
  fulfillmentCharts?: SalesOrderFulfillmentCharts;
  marginEconomics?: SalesOrderManagementMarginEconomics;
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
