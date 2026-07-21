import {
  classifyFinanceArReceivableOrigin,
  type FinanceArReceivableOrigin,
} from "./financeAccountsReceivableDeduplication.js";
import {
  rowMatchesFinanceArQualityAlert,
  type FinanceArDataQualityAlertKey,
} from "./financeAccountsReceivableDataQuality.js";
import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  isFinanceArAllowedInManagementReport,
  isFinanceArOpen,
  mapPrismaRowToFinanceArDashboardRow,
  parseFinanceArDashboardFilters,
  roundMoney,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { parseMoneyAmountInput } from "./moneyRangeFilter.js";
import {
  isFinanceArExcludedFromReports,
  resolveEffectiveNomusArReportSyncCutoff,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import {
  isFinanceDashboardAgingBucketKey,
  isFinanceHorizonDrilldownBucketKey,
  parseFinanceAgingBucketParam,
  resolveFinanceAgingBucketMeta,
  rowMatchesFinanceDashboardAgingBucket,
  rowMatchesFinanceHorizonDrilldownBucket,
  type FinanceAgingBucketParam,
} from "./financeDashboardAgingBuckets.js";
import type { FinanceAgingBucketSelectionMeta } from "./financeDashboardAgingBuckets.js";
import {
  filterArTitleRowsByLocalFilter,
  parseFinanceArTitlesLocalFilter,
  type FinanceArTitlesLocalFilter,
} from "./financeAccountsReceivableTitlesLocalFilter.js";
import {
  financeCustomerCnpjMatches,
  financeCustomerNameMatches,
  parseFinanceCustomerNameParam,
  parseNomusPersonIdCustomerParam,
} from "./financeAccountsReceivableCustomerMatch.js";

import type {
  FinanceTitlesBucketTotals,
} from "./financeAgingBucketDrilldownTypes.js";
import {
  buildFinanceArEffectiveTitles,
  computeFinanceArEffectiveTitlesSummary,
  filterFinanceArEffectiveTitlesByDashboardFilters,
  FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL,
  type FinanceArEffectiveLineKind,
  type FinanceArEffectiveOrderContext,
} from "./finance/financeAccountsReceivableEffectiveTitles.js";
import {
  extractFinanceArOrderCodeHint,
  filterFinanceArOperationalPortfolioRows,
} from "./finance/financeArOperationalPortfolio.js";

export { extractFinanceArOrderCodeHint } from "./finance/financeArOperationalPortfolio.js";

export type FinanceArTitlesOriginFilter = "all" | "withNfe" | "withoutNfe";
export type FinanceArTitlesDelayFilter = "all" | "overdue" | "upcoming" | "dueToday" | "settled";

export type {
  FinanceArEffectiveLineKind,
  FinanceArEffectiveOrderContext,
} from "./finance/financeAccountsReceivableEffectiveTitles.js";

export type FinanceArTitlesExtendedFilters = {
  issueDateFrom?: Date;
  issueDateTo?: Date;
  minValue?: number;
  maxValue?: number;
  document?: string;
  origin?: FinanceArTitlesOriginFilter;
  customerId?: number;
  customerName?: string;
  customerCnpj?: string;
  delaySituation?: FinanceArTitlesDelayFilter;
};

export type FinanceArTitlesSummary = {
  totalTitles: number;
  totalOriginalValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
  totalOverdueValue: number;
  totalDueValue: number;
  averageTicket: number;
};

export type FinanceArTitlesSortBy =
  | "dueDate"
  | "balanceReceivable"
  | "externalId"
  | "personName"
  | "competenceDate"
  | "calculatedStatus"
  | "amountReceivable"
  | "daysOverdue";
export type FinanceArTitlesSortDirection = "asc" | "desc";

export type FinanceArTitlesQuery = {
  page: number;
  limit: number;
  sortBy: FinanceArTitlesSortBy;
  sortDirection: FinanceArTitlesSortDirection;
  filters: FinanceArDashboardFilters;
  extended: FinanceArTitlesExtendedFilters;
  search?: string;
  overdueOnly?: boolean;
  qualityAlert?: FinanceArDataQualityAlertKey;
  localFilter: FinanceArTitlesLocalFilter;
  agingBucket?: FinanceAgingBucketParam;
};

export type FinanceArTitleListItem = {
  externalId: number;
  companyName: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  comments: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  competenceDate: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  calculatedStatus: string;
  nomusStatus: boolean | null;
  daysOverdue: number;
  suspendCollection: boolean | null;
  origin: FinanceArReceivableOrigin;
  syncedAt: string;
  /** FIN-08 — origem na agenda efetiva. */
  lineKind: FinanceArEffectiveLineKind;
  lineKindLabel: string;
  orderCode: string | null;
  salesOrderId: string | null;
};

export type BuildFinanceArTitlesPayloadOptions = {
  /** Agendas FIN-05 dos pedidos no contexto (cliente/pedido). */
  orderContexts?: FinanceArEffectiveOrderContext[];
};

export type FinanceArTitlesPayload = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: FinanceArTitlesSortBy;
  sortDirection: FinanceArTitlesSortDirection;
  summary: FinanceArTitlesSummary;
  items: FinanceArTitleListItem[];
  selectedBucket?: FinanceAgingBucketSelectionMeta;
  bucketTotals?: FinanceTitlesBucketTotals;
};

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function parseIsoDateParam(value: unknown): Date | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseOptionalNumber(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return undefined;
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Valor mínimo/máximo de filtro — zero ou negativo = sem filtro. Aceita pt-BR. */
function parseOptionalAmountFilter(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return undefined;
  const n = parseMoneyAmountInput(raw) ?? parseOptionalNumber(raw);
  if (n == null || n <= 0) return undefined;
  return n;
}

function parseOriginFilter(value: unknown): FinanceArTitlesOriginFilter {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "withnfe" || raw === "with_nfe" || raw === "withNfe") return "withNfe";
  if (raw === "withoutnfe" || raw === "without_nfe" || raw === "withoutNfe") return "withoutNfe";
  return "all";
}

function parseDelayFilter(value: unknown): FinanceArTitlesDelayFilter {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "overdue" || raw === "upcoming" || raw === "duetoday" || raw === "settled") {
    return raw === "duetoday" ? "dueToday" : (raw as FinanceArTitlesDelayFilter);
  }
  return "all";
}

export function parseFinanceArTitlesExtendedFilters(
  query: Record<string, unknown>
): FinanceArTitlesExtendedFilters {
  const issueDateFrom = parseIsoDateParam(query.issueDateFrom);
  const issueDateTo = parseIsoDateParam(query.issueDateTo);
  const minValue = parseOptionalAmountFilter(query.minValue);
  const maxValue = parseOptionalAmountFilter(query.maxValue);
  const document = typeof query.document === "string" ? query.document.trim() : undefined;
  const origin = parseOriginFilter(query.origin);
  const customerId = parseNomusPersonIdCustomerParam(query.customerId);
  const customerName = parseFinanceCustomerNameParam(query);
  const customerCnpjRaw =
    typeof query.customerCnpj === "string"
      ? query.customerCnpj.trim()
      : typeof query.personCnpj === "string" && customerName
        ? query.personCnpj.trim()
        : "";
  const customerCnpj = customerName && customerCnpjRaw ? customerCnpjRaw : undefined;
  const delaySituation = parseDelayFilter(query.delaySituation);
  return {
    issueDateFrom,
    issueDateTo,
    minValue,
    maxValue,
    document: document || undefined,
    origin: origin === "all" ? undefined : origin,
    customerId,
    customerName: customerName || undefined,
    customerCnpj,
    delaySituation: delaySituation === "all" ? undefined : delaySituation,
  };
}

export function parseFinanceArTitlesQuery(query: Record<string, unknown>): FinanceArTitlesQuery {
  const sortRaw = String(query.sortBy ?? "dueDate").trim();
  const sortKeys: FinanceArTitlesSortBy[] = [
    "dueDate",
    "balanceReceivable",
    "externalId",
    "personName",
    "competenceDate",
    "calculatedStatus",
    "amountReceivable",
    "daysOverdue",
  ];
  const sortBy: FinanceArTitlesSortBy = sortKeys.includes(sortRaw as FinanceArTitlesSortBy)
    ? (sortRaw as FinanceArTitlesSortBy)
    : "dueDate";
  const dirRaw = String(query.sortDirection ?? "asc").trim().toLowerCase();
  const sortDirection: FinanceArTitlesSortDirection = dirRaw === "desc" ? "desc" : "asc";
  const overdueOnly =
    String(query.overdueOnly ?? "")
      .trim()
      .toLowerCase() === "1" ||
    String(query.overdueOnly ?? "")
      .trim()
      .toLowerCase() === "true";

  const searchRaw = typeof query.search === "string" ? query.search.trim() : "";
  const qualityRaw = String(query.qualityAlert ?? "").trim();
  const qualityAlert = isFinanceArQualityAlertKey(qualityRaw) ? qualityRaw : undefined;
  const localFilter = parseFinanceArTitlesLocalFilter(query.localFilter);
  const agingBucket = parseFinanceAgingBucketParam(query.agingBucket);
  return {
    page: parsePositiveInt(query.page, 1, 10_000),
    limit: parsePositiveInt(query.pageSize ?? query.limit, 50, 200),
    sortBy,
    sortDirection,
    filters: parseFinanceArDashboardFilters(query),
    extended: parseFinanceArTitlesExtendedFilters(query),
    search: searchRaw || undefined,
    overdueOnly,
    qualityAlert,
    localFilter,
    agingBucket,
  };
}

const QUALITY_ALERT_KEYS = new Set<FinanceArDataQualityAlertKey>([
  "missingPersonCnpj",
  "missingDueDate",
  "missingPaymentMethod",
  "negativeBalance",
  "receivedGreaterThanReceivable",
  "suspendedCollectionOpen",
  "overdueOver30Days",
  "overdueOver60Days",
  "overdueOver90Days",
]);

function isFinanceArQualityAlertKey(value: string): value is FinanceArDataQualityAlertKey {
  return QUALITY_ALERT_KEYS.has(value as FinanceArDataQualityAlertKey);
}

function rowMatchesSearch(row: FinanceArDashboardRow, search: string): boolean {
  const q = search.toLowerCase();
  if (String(row.externalId).includes(q)) return true;
  if ((row.personName ?? "").toLowerCase().includes(q)) return true;
  if ((row.personCnpj ?? "").toLowerCase().includes(q)) return true;
  if ((row.sourceInvoiceNumber ?? "").toLowerCase().includes(q)) return true;
  if (row.sourceInvoiceId != null && String(row.sourceInvoiceId).includes(q)) return true;
  if ((row.description ?? "").toLowerCase().includes(q)) return true;
  return false;
}

function rowMatchesDocument(row: FinanceArDashboardRow, document: string): boolean {
  const q = document.toLowerCase();
  if ((row.sourceInvoiceNumber ?? "").toLowerCase().includes(q)) return true;
  if (row.sourceInvoiceId != null && String(row.sourceInvoiceId).includes(q)) return true;
  if (String(row.externalId).includes(q)) return true;
  if ((row.description ?? "").toLowerCase().includes(q)) return true;
  return false;
}

function rowMatchesCustomerFilter(
  row: FinanceArDashboardRow,
  extended: FinanceArTitlesExtendedFilters
): boolean {
  if (extended.customerId != null) {
    return row.personId === extended.customerId;
  }
  if (!extended.customerName && !extended.customerCnpj) return true;

  const nameMatch = extended.customerName
    ? financeCustomerNameMatches(row.personName, extended.customerName)
    : false;
  const cnpjMatch = extended.customerCnpj
    ? financeCustomerCnpjMatches(row.personCnpj, extended.customerCnpj)
    : false;

  if (extended.customerName && extended.customerCnpj) {
    return nameMatch || cnpjMatch;
  }
  if (extended.customerName) return nameMatch;
  return cnpjMatch;
}

function rowMatchesExtendedFilters(
  row: FinanceArDashboardRow,
  extended: FinanceArTitlesExtendedFilters,
  referenceDate: Date
): boolean {
  if (!rowMatchesCustomerFilter(row, extended)) return false;

  if (extended.issueDateFrom) {
    const from = startOfLocalDay(extended.issueDateFrom);
    if (!row.competenceDate || startOfLocalDay(row.competenceDate).getTime() < from.getTime()) return false;
  }
  if (extended.issueDateTo) {
    const to = startOfLocalDay(extended.issueDateTo);
    if (!row.competenceDate || startOfLocalDay(row.competenceDate).getTime() > to.getTime()) return false;
  }

  const value = row.amountReceivable;
  if (extended.minValue != null && value < extended.minValue) return false;
  if (extended.maxValue != null && value > extended.maxValue) return false;

  if (extended.document && !rowMatchesDocument(row, extended.document)) return false;

  if (extended.origin === "withNfe" && classifyFinanceArReceivableOrigin(row) !== "WITH_NFE") {
    return false;
  }
  if (extended.origin === "withoutNfe" && classifyFinanceArReceivableOrigin(row) !== "WITHOUT_NFE") {
    return false;
  }

  if (extended.delaySituation) {
    const status = classifyFinanceArTitle(row, referenceDate);
    if (extended.delaySituation === "settled" && status !== "settled") return false;
    if (extended.delaySituation === "overdue" && status !== "overdue") return false;
    if (extended.delaySituation === "dueToday" && status !== "dueToday") return false;
    if (extended.delaySituation === "upcoming" && status !== "upcoming") return false;
  }

  return true;
}

export function computeFinanceArTitlesSummary(
  items: FinanceArTitleListItem[],
  referenceDate: Date = new Date()
): FinanceArTitlesSummary {
  let totalOriginalValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
  let totalOverdueValue = 0;
  let totalDueValue = 0;
  for (const item of items) {
    totalOriginalValue += item.amountReceivable;
    totalReceivedValue += item.amountReceived;
    totalOpenValue += item.balanceReceivable;
    const status = item.calculatedStatus;
    if (status === "overdue") totalOverdueValue += item.balanceReceivable;
    if (status === "upcoming" || status === "dueToday") totalDueValue += item.balanceReceivable;
  }
  const totalTitles = items.length;
  return {
    totalTitles,
    totalOriginalValue: roundMoney(totalOriginalValue),
    totalReceivedValue: roundMoney(totalReceivedValue),
    totalOpenValue: roundMoney(totalOpenValue),
    totalOverdueValue: roundMoney(totalOverdueValue),
    totalDueValue: roundMoney(totalDueValue),
    averageTicket: totalTitles > 0 ? roundMoney(totalOriginalValue / totalTitles) : 0,
  };
}

function compareTitles(
  a: FinanceArTitleListItem,
  b: FinanceArTitleListItem,
  sortBy: FinanceArTitlesSortBy,
  direction: FinanceArTitlesSortDirection
): number {
  let cmp = 0;
  if (sortBy === "externalId") {
    cmp = a.externalId - b.externalId;
  } else if (sortBy === "balanceReceivable" || sortBy === "amountReceivable") {
    const key = sortBy === "amountReceivable" ? "amountReceivable" : "balanceReceivable";
    cmp = a[key] - b[key];
  } else if (sortBy === "personName") {
    cmp = (a.personName ?? "").localeCompare(b.personName ?? "", "pt-BR");
  } else if (sortBy === "calculatedStatus") {
    cmp = a.calculatedStatus.localeCompare(b.calculatedStatus, "pt-BR");
  } else if (sortBy === "daysOverdue") {
    cmp = a.daysOverdue - b.daysOverdue;
  } else if (sortBy === "competenceDate") {
    const ad = a.competenceDate ? new Date(a.competenceDate).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.competenceDate ? new Date(b.competenceDate).getTime() : Number.POSITIVE_INFINITY;
    cmp = ad - bd;
  } else {
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    cmp = ad - bd;
  }
  return direction === "desc" ? -cmp : cmp;
}

export function mapRowToTitleListItem(
  row: FinanceArDashboardRow,
  referenceDate: Date = new Date()
): FinanceArTitleListItem {
  return {
    externalId: row.externalId,
    companyName: row.companyName,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description,
    comments: row.comments,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    competenceDate: row.competenceDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    settlementDate: row.settlementDate?.toISOString() ?? null,
    amountReceivable: roundMoney(row.amountReceivable),
    amountReceived: roundMoney(row.amountReceived),
    balanceReceivable: roundMoney(row.balanceReceivable),
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    calculatedStatus: classifyFinanceArTitle(row, referenceDate),
    nomusStatus: row.nomusStatus,
    daysOverdue: computeDaysOverdue(row.dueDate, referenceDate),
    suspendCollection: row.suspendCollection,
    origin: classifyFinanceArReceivableOrigin(row),
    syncedAt: row.syncedAt.toISOString(),
    lineKind: "CR_REAL",
    lineKindLabel: FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL.CR_REAL,
    orderCode: null,
    salesOrderId: null,
  };
}

/**
 * Referência do título para PDF/Excel/grid:
 * NF/documento quando existir; senão número do Pedido de venda
 * (evita linha sem referência em residual/pré-NF).
 */
export function resolveFinanceArTitleDocumentReference(
  row: Pick<
    FinanceArTitleListItem,
    "sourceInvoiceNumber" | "sourceInvoiceId" | "orderCode" | "description"
  >
): string | null {
  const invoiceNumber = row.sourceInvoiceNumber?.trim();
  if (invoiceNumber) return invoiceNumber;
  if (row.sourceInvoiceId != null) return String(row.sourceInvoiceId);

  const orderCode =
    row.orderCode?.trim() || extractFinanceArOrderCodeHint(row.description);
  if (!orderCode) return null;
  if (/^(pedido|pd)\b/i.test(orderCode)) return orderCode;
  return `Pedido ${orderCode}`;
}

export function isFinanceArHorizonTitlesQuery(query: Pick<FinanceArTitlesQuery, "agingBucket">): boolean {
  return query.agingBucket != null && isFinanceHorizonDrilldownBucketKey(query.agingBucket);
}

function rowMatchesArAgingBucketDrilldown(
  row: FinanceArDashboardRow,
  bucketKey: FinanceAgingBucketParam,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): boolean {
  if (row.suspendCollection === true) return false;
  if (!isFinanceArOpen(row)) return false;
  if (!row.dueDate) return false;
  if (!Number.isFinite(row.balanceReceivable) || row.balanceReceivable <= 0) return false;

  if (isFinanceDashboardAgingBucketKey(bucketKey)) {
    return rowMatchesFinanceDashboardAgingBucket(row.dueDate, bucketKey, referenceDate);
  }

  if (!isFinanceHorizonDrilldownBucketKey(bucketKey)) return false;
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff([row], syncCutoff);
  if (isFinanceArExcludedFromReports(row, effectiveCutoff)) return false;
  if (!isFinanceArAllowedInManagementReport(row, referenceDate)) return false;
  return rowMatchesFinanceHorizonDrilldownBucket(row.dueDate, bucketKey, referenceDate);
}

/** Filtros Prisma para títulos — evita personName literal quando há filtro de cliente estendido. */
export function financeArTitlesPrismaFilters(
  query: Pick<FinanceArTitlesQuery, "filters" | "extended">
): FinanceArDashboardFilters {
  const filters = { ...query.filters };
  if (query.extended.customerId != null || query.extended.customerName) {
    filters.personName = undefined;
    filters.personCnpj = undefined;
  }
  return filters;
}

export function buildFinanceArTitlesPayload(
  rows: FinanceArDashboardRow[],
  query: FinanceArTitlesQuery,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null,
  options?: BuildFinanceArTitlesPayloadOptions
): FinanceArTitlesPayload {
  const isHorizonDrilldown = isFinanceArHorizonTitlesQuery(query);

  let filtered: FinanceArDashboardRow[];
  if (isHorizonDrilldown) {
    filtered = rows.filter((row) =>
      rowMatchesArAgingBucketDrilldown(row, query.agingBucket!, referenceDate, syncCutoff)
    );
  } else {
    filtered = filterFinanceArOperationalPortfolioRows(
      rows,
      query.filters,
      referenceDate,
      syncCutoff
    );

    const effectiveLocalFilter =
      query.localFilter !== "all"
        ? query.localFilter
        : query.overdueOnly
          ? "overdue"
          : "all";
    filtered = filterArTitleRowsByLocalFilter(filtered, effectiveLocalFilter, referenceDate);

    if (query.agingBucket) {
      filtered = filtered.filter((row) =>
        rowMatchesArAgingBucketDrilldown(row, query.agingBucket!, referenceDate, syncCutoff)
      );
    }
  }

  if (query.search) {
    filtered = filtered.filter((row) => rowMatchesSearch(row, query.search!));
  }

  filtered = filtered.filter((row) =>
    rowMatchesExtendedFilters(row, query.extended ?? {}, referenceDate)
  );

  if (query.qualityAlert) {
    filtered = filtered.filter((row) =>
      rowMatchesFinanceArQualityAlert(row, query.qualityAlert!, referenceDate)
    );
  }

  const orderContexts = options?.orderContexts ?? [];
  const orderCodeHint =
    extractFinanceArOrderCodeHint(query.search, query.extended?.document) ?? undefined;

  let mapped: FinanceArTitleListItem[];
  let summary: FinanceArTitlesSummary;

  if (orderContexts.length > 0 || orderCodeHint) {
    // FIN-08 — agenda efetiva no contexto Pedido/cliente.
    // Quando há hint de Pedido mas ainda sem contexts, filtra CR por Pedido
    // e marca lineKind; contexts vazios não inventam residual.
  // Residual/Doc/CR da agenda não podem burlar status/ano/mês do grid.
    // Pedidos cancelados/ausentes não geram contexts — sem previsão inventada.
    const effective = buildFinanceArEffectiveTitles({
      nomusRows: filtered,
      orderContexts,
      orderCode: orderCodeHint,
      customerPersonId: query.extended?.customerId,
      customerName: query.extended?.customerName,
      customerCnpj: query.extended?.customerCnpj,
      referenceDate,
    });
    // Se o usuário buscou um Pedido excluído (cancelado/ausente) e não há
    // contexts operacionais, não lista CR órfão nem inventa previsão.
    if (orderCodeHint && orderContexts.length === 0) {
      mapped = [];
      summary = computeFinanceArTitlesSummary([], referenceDate);
    } else {
      const effectiveFiltered = filterFinanceArEffectiveTitlesByDashboardFilters(
        effective.items,
        query.filters,
        referenceDate
      );
      mapped = effectiveFiltered;
      summary = computeFinanceArEffectiveTitlesSummary(effectiveFiltered);
    }
  } else {
    mapped = filtered.map((row) => mapRowToTitleListItem(row, referenceDate));
    summary = computeFinanceArTitlesSummary(mapped, referenceDate);
  }

  mapped.sort((a, b) => compareTitles(a, b, query.sortBy, query.sortDirection));

  const bucketTotals: FinanceTitlesBucketTotals | undefined = query.agingBucket
    ? {
        openBalanceAmount: roundMoney(
          mapped.reduce((sum, item) => sum + item.balanceReceivable, 0)
        ),
        titlesCount: mapped.length,
      }
    : undefined;

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.limit;
  const items = mapped.slice(start, start + query.limit);

  return {
    page,
    limit: query.limit,
    total,
    totalPages,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    summary,
    items,
    selectedBucket: query.agingBucket
      ? resolveFinanceAgingBucketMeta(query.agingBucket)
      : undefined,
    bucketTotals,
  };
}

export const FINANCE_AR_TITLE_SELECT = {
  externalId: true,
  companyName: true,
  personId: true,
  personName: true,
  personCnpj: true,
  description: true,
  comments: true,
  dueDate: true,
  competenceDate: true,
  settlementDate: true,
  amountReceivable: true,
  amountReceived: true,
  balanceReceivable: true,
  paymentMethodName: true,
  bankAccountName: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  suspendCollection: true,
  status: true,
  syncedAt: true,
  sourcePresenceStatus: true,
} as const;

export function mapPrismaRowToFinanceArTitleRow(row: {
  externalId: number;
  companyName: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  comments: string | null;
  dueDate: Date | null;
  competenceDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: import("@prisma/client").Prisma.Decimal | null;
  amountReceived: import("@prisma/client").Prisma.Decimal | null;
  balanceReceivable: import("@prisma/client").Prisma.Decimal | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendCollection: boolean | null;
  status: boolean | null;
  syncedAt: Date;
  sourcePresenceStatus?: string | null;
}): FinanceArDashboardRow {
  const base = mapPrismaRowToFinanceArDashboardRow(row);
  return {
    ...base,
    description: row.description,
    comments: row.comments,
    nomusStatus: row.status,
  };
}
