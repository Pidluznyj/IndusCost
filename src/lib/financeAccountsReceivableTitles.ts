import {
  rowMatchesFinanceArQualityAlert,
  type FinanceArDataQualityAlertKey,
} from "./financeAccountsReceivableDataQuality.js";
import {
  filterArTitleRowsByLocalFilter,
  parseFinanceArTitlesLocalFilter,
  type FinanceArTitlesLocalFilter,
} from "./financeAccountsReceivableTitlesLocalFilter.js";
import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  isFinanceArAllowedInManagementReport,
  isFinanceArOpen,
  mapPrismaRowToFinanceArDashboardRow,
  parseFinanceArDashboardFilters,
  roundMoney,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { filterFinanceArManagementReportRows } from "./financeAccountsReceivableManagement.js";
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
import type {
  FinanceTitlesBucketTotals,
} from "./financeAgingBucketDrilldownTypes.js";

export type FinanceArTitlesSortBy = "dueDate" | "balanceReceivable" | "externalId";
export type FinanceArTitlesSortDirection = "asc" | "desc";

export type FinanceArTitlesQuery = {
  page: number;
  limit: number;
  sortBy: FinanceArTitlesSortBy;
  sortDirection: FinanceArTitlesSortDirection;
  filters: FinanceArDashboardFilters;
  search?: string;
  overdueOnly?: boolean;
  qualityAlert?: FinanceArDataQualityAlertKey;
  localFilter: FinanceArTitlesLocalFilter;
  agingBucket?: FinanceAgingBucketParam;
};

export type FinanceArTitleListItem = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
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
  syncedAt: string;
};

export type FinanceArTitlesPayload = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: FinanceArTitlesSortBy;
  sortDirection: FinanceArTitlesSortDirection;
  items: FinanceArTitleListItem[];
  selectedBucket?: FinanceAgingBucketSelectionMeta;
  bucketTotals?: FinanceTitlesBucketTotals;
};

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function parseFinanceArTitlesQuery(query: Record<string, unknown>): FinanceArTitlesQuery {
  const sortRaw = String(query.sortBy ?? "dueDate").trim();
  const sortBy: FinanceArTitlesSortBy =
    sortRaw === "balanceReceivable" || sortRaw === "externalId" ? sortRaw : "dueDate";
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
    limit: parsePositiveInt(query.limit, 50, 200),
    sortBy,
    sortDirection,
    filters: parseFinanceArDashboardFilters(query),
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

function compareTitles(
  a: FinanceArTitleListItem,
  b: FinanceArTitleListItem,
  sortBy: FinanceArTitlesSortBy,
  direction: FinanceArTitlesSortDirection
): number {
  let cmp = 0;
  if (sortBy === "externalId") {
    cmp = a.externalId - b.externalId;
  } else if (sortBy === "balanceReceivable") {
    cmp = a.balanceReceivable - b.balanceReceivable;
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
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
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
    syncedAt: row.syncedAt.toISOString(),
  };
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

export function buildFinanceArTitlesPayload(
  rows: FinanceArDashboardRow[],
  query: FinanceArTitlesQuery,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArTitlesPayload {
  const isHorizonDrilldown =
    query.agingBucket != null && isFinanceHorizonDrilldownBucketKey(query.agingBucket);

  let filtered: FinanceArDashboardRow[];
  if (isHorizonDrilldown) {
    filtered = rows.filter((row) =>
      rowMatchesArAgingBucketDrilldown(row, query.agingBucket!, referenceDate, syncCutoff)
    );
  } else {
    filtered = filterFinanceArManagementReportRows(rows, query.filters, referenceDate, syncCutoff);

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

  if (query.qualityAlert) {
    filtered = filtered.filter((row) =>
      rowMatchesFinanceArQualityAlert(row, query.qualityAlert!, referenceDate)
    );
  }

  const mapped = filtered.map((row) => mapRowToTitleListItem(row, referenceDate));
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
  personName: true,
  personCnpj: true,
  description: true,
  dueDate: true,
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
} as const;

export function mapPrismaRowToFinanceArTitleRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  dueDate: Date | null;
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
}): FinanceArDashboardRow {
  const base = mapPrismaRowToFinanceArDashboardRow(row);
  return {
    ...base,
    description: row.description,
    nomusStatus: row.status,
  };
}
