import {
  rowMatchesFinanceApQualityAlert,
  type FinanceApDataQualityAlertKey,
} from "./financeAccountsPayableDataQuality.js";
import {
  classifyFinanceApTitle,
  matchesFinanceApDashboardFilters,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
  resolveFinanceApDueDateBounds,
  roundMoney,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { filterOfficialApManagementTitles } from "./financeAccountsPayableRulesAdapter.js";
import { isFinanceApExcludedFromManagement } from "./financeInternalGroupExclusions.js";
import {
  isNomusApStaleForReports,
  resolveEffectiveNomusApReportSyncCutoff,
  type NomusApReportSyncCutoff,
} from "./financeNomusApReportFreshness.js";
import {
  computeFinanceApDaysOverdue,
  getAccountsPayableOperationalDueDate,
  isAccountsPayablePurchaseOrderSchedule,
} from "./financeAccountsPayableOperational.js";
import {
  filterApTitleRowsByLocalFilter,
  parseFinanceApTitlesLocalFilter,
  resolveFinanceApTitleExclusionReason,
  type FinanceApTitlesLocalFilter,
} from "./financeAccountsPayableTitlesLocalFilter.js";
import {
  matchesFinanceApHorizonEntityFilters,
} from "./financeHorizonAggregation.js";
import {
  isFinanceDashboardAgingBucketKey,
  isFinanceHorizonDrilldownBucketKey,
  parseFinanceAgingBucketParam,
  resolveFinanceAgingBucketMeta,
  rowMatchesFinanceDashboardAgingBucket,
  rowMatchesFinanceHorizonDrilldownBucket,
  type FinanceAgingBucketParam,
  type FinanceHorizonDrilldownBucketKey,
} from "./financeDashboardAgingBuckets.js";
import type { FinanceAgingBucketSelectionMeta } from "./financeDashboardAgingBuckets.js";
import type {
  FinanceTitlesBucketTotals,
} from "./financeAgingBucketDrilldownTypes.js";
import { isFinanceApOpen } from "./financeAccountsPayableDashboard.js";

export type FinanceApTitlesSortBy = "dueDate" | "balancePayable" | "externalId";
export type FinanceApTitlesSortDirection = "asc" | "desc";

export type FinanceApTitlesQuery = {
  page: number;
  limit: number;
  sortBy: FinanceApTitlesSortBy;
  sortDirection: FinanceApTitlesSortDirection;
  filters: FinanceApDashboardFilters;
  search?: string;
  overdueOnly?: boolean;
  qualityAlert?: FinanceApDataQualityAlertKey;
  localFilter: FinanceApTitlesLocalFilter;
  agingBucket?: FinanceAgingBucketParam;
};

export type FinanceApTitleListItem = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  sourceInvoiceId: number | null;
  documentNumber: string | null;
  dueDate: string | null;
  scheduleDate: string | null;
  operationalDueDate: string | null;
  settlementDate: string | null;
  paymentDate: string | null;
  amountPayable: number;
  amountPaid: number;
  balancePayable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  calculatedStatus: string;
  nomusStatus: boolean | null;
  daysOverdue: number;
  suspendPayment: boolean | null;
  type: number | null;
  exclusionReason: string | null;
  isPurchaseOrderSchedule: boolean;
  syncedAt: string;
  consolidatedSupplierName?: string;
  costCenterLabel?: string;
  classificationOriginLabel?: string;
  classificationStatusLabel?: string;
  isClassified?: boolean;
};

export type FinanceApTitlesPayload = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: FinanceApTitlesSortBy;
  sortDirection: FinanceApTitlesSortDirection;
  items: FinanceApTitleListItem[];
  selectedBucket?: FinanceAgingBucketSelectionMeta;
  bucketTotals?: FinanceTitlesBucketTotals;
};

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function parseFinanceApTitlesQuery(query: Record<string, unknown>): FinanceApTitlesQuery {
  const sortRaw = String(query.sortBy ?? "dueDate").trim();
  const sortBy: FinanceApTitlesSortBy =
    sortRaw === "balancePayable" || sortRaw === "externalId" ? sortRaw : "dueDate";
  const dirRaw = String(query.sortDirection ?? "asc").trim().toLowerCase();
  const sortDirection: FinanceApTitlesSortDirection = dirRaw === "desc" ? "desc" : "asc";
  const overdueOnly =
    String(query.overdueOnly ?? "")
      .trim()
      .toLowerCase() === "1" ||
    String(query.overdueOnly ?? "")
      .trim()
      .toLowerCase() === "true";

  const searchRaw = typeof query.search === "string" ? query.search.trim() : "";
  const qualityRaw = String(query.qualityAlert ?? "").trim();
  const qualityAlert = isFinanceApQualityAlertKey(qualityRaw) ? qualityRaw : undefined;
  return {
    page: parsePositiveInt(query.page, 1, 10_000),
    limit: parsePositiveInt(query.limit, 50, 200),
    sortBy,
    sortDirection,
    filters: parseFinanceApDashboardFilters(query),
    search: searchRaw || undefined,
    overdueOnly,
    qualityAlert,
    localFilter: parseFinanceApTitlesLocalFilter(query.localFilter),
    agingBucket: parseFinanceAgingBucketParam(query.agingBucket),
  };
}

const QUALITY_ALERT_KEYS = new Set<FinanceApDataQualityAlertKey>([
  "missingPersonCnpj",
  "missingDueDate",
  "missingPaymentMethod",
  "negativeBalance",
  "paidGreaterThanPayable",
  "suspendedPaymentOpen",
  "overdueOver30Days",
  "overdueOver60Days",
  "overdueOver90Days",
]);

function isFinanceApQualityAlertKey(value: string): value is FinanceApDataQualityAlertKey {
  return QUALITY_ALERT_KEYS.has(value as FinanceApDataQualityAlertKey);
}

function rowMatchesSearch(row: FinanceApDashboardRow, search: string): boolean {
  const q = search.toLowerCase();
  if (String(row.externalId).includes(q)) return true;
  if ((row.personName ?? "").toLowerCase().includes(q)) return true;
  if ((row.personCnpj ?? "").toLowerCase().includes(q)) return true;
  if ((row.documentNumber ?? "").toLowerCase().includes(q)) return true;
  if (row.sourceInvoiceId != null && String(row.sourceInvoiceId).includes(q)) return true;
  if ((row.description ?? "").toLowerCase().includes(q)) return true;
  return false;
}

function compareTitles(
  a: FinanceApTitleListItem,
  b: FinanceApTitleListItem,
  sortBy: FinanceApTitlesSortBy,
  direction: FinanceApTitlesSortDirection
): number {
  let cmp = 0;
  if (sortBy === "externalId") {
    cmp = a.externalId - b.externalId;
  } else if (sortBy === "balancePayable") {
    cmp = a.balancePayable - b.balancePayable;
  } else {
    const ad = a.operationalDueDate
      ? new Date(a.operationalDueDate).getTime()
      : a.dueDate
        ? new Date(a.dueDate).getTime()
        : Number.POSITIVE_INFINITY;
    const bd = b.operationalDueDate
      ? new Date(b.operationalDueDate).getTime()
      : b.dueDate
        ? new Date(b.dueDate).getTime()
        : Number.POSITIVE_INFINITY;
    cmp = ad - bd;
  }
  return direction === "desc" ? -cmp : cmp;
}

export function mapRowToTitleListItem(
  row: FinanceApDashboardRow,
  referenceDate: Date = new Date()
): FinanceApTitleListItem {
  return {
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description,
    sourceInvoiceId: row.sourceInvoiceId,
    documentNumber: row.documentNumber,
    dueDate: row.dueDate?.toISOString() ?? null,
    scheduleDate: row.scheduleDate?.toISOString() ?? null,
    operationalDueDate: getAccountsPayableOperationalDueDate(row)?.toISOString() ?? null,
    settlementDate: row.settlementDate?.toISOString() ?? null,
    paymentDate: row.paymentDate?.toISOString() ?? null,
    amountPayable: roundMoney(row.amountPayable),
    amountPaid: roundMoney(row.amountPaid),
    balancePayable: roundMoney(row.balancePayable),
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    calculatedStatus: classifyFinanceApTitle(row, referenceDate),
    nomusStatus: row.nomusStatus,
    daysOverdue: computeFinanceApDaysOverdue(row, referenceDate),
    suspendPayment: row.suspendPayment,
    type: row.type ?? null,
    exclusionReason: resolveFinanceApTitleExclusionReason(row),
    isPurchaseOrderSchedule: isAccountsPayablePurchaseOrderSchedule(row),
    syncedAt: row.syncedAt.toISOString(),
  };
}

function filterRowsForTitlesGrid(
  rows: FinanceApDashboardRow[],
  query: FinanceApTitlesQuery,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceApDashboardRow[] {
  const includeExcluded =
    query.localFilter === "excluded" || query.localFilter === "purchaseOrder";

  if (!includeExcluded) {
    const filtered = filterOfficialApManagementTitles(rows, query.filters, referenceDate, syncCutoff);
    return filterApTitleRowsByLocalFilter(filtered, query.localFilter, referenceDate);
  }

  const { empty } = resolveFinanceApDueDateBounds(query.filters);
  if (empty) return [];

  const effectiveCutoff = resolveEffectiveNomusApReportSyncCutoff(rows, syncCutoff);
  let filtered = rows.filter(
    (row) =>
      matchesFinanceApDashboardFilters(row, query.filters, referenceDate) &&
      !isNomusApStaleForReports(row, effectiveCutoff) &&
      isFinanceApExcludedFromManagement(row)
  );

  return filterApTitleRowsByLocalFilter(filtered, query.localFilter, referenceDate);
}

function rowMatchesApAgingBucketDrilldown(
  row: FinanceApDashboardRow,
  bucketKey: FinanceAgingBucketParam,
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null,
  horizonMode = false
): boolean {
  if (row.suspendPayment === true) return false;
  if (!isFinanceApOpen(row)) return false;
  const operationalDueDate = getAccountsPayableOperationalDueDate(row);
  if (!operationalDueDate) return false;
  const balance = row.balancePayable;
  if (!Number.isFinite(balance) || balance <= 0) return false;

  if (horizonMode) {
    if (!matchesFinanceApHorizonEntityFilters(row, filters, referenceDate)) return false;
    return rowMatchesFinanceHorizonDrilldownBucket(
      operationalDueDate,
      bucketKey as FinanceHorizonDrilldownBucketKey,
      referenceDate
    );
  }

  if (isFinanceDashboardAgingBucketKey(bucketKey)) {
    return rowMatchesFinanceDashboardAgingBucket(operationalDueDate, bucketKey, referenceDate);
  }

  return false;
}

export function buildFinanceApTitlesPayload(
  rows: FinanceApDashboardRow[],
  query: FinanceApTitlesQuery,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceApTitlesPayload {
  const isHorizonDrilldown =
    query.agingBucket != null && isFinanceHorizonDrilldownBucketKey(query.agingBucket);

  let filtered: FinanceApDashboardRow[];
  if (isHorizonDrilldown) {
    filtered = rows.filter((row) =>
      rowMatchesApAgingBucketDrilldown(
        row,
        query.agingBucket!,
        query.filters,
        referenceDate,
        syncCutoff,
        true
      )
    );
  } else {
    filtered = filterRowsForTitlesGrid(rows, query, referenceDate, syncCutoff);

    if (query.overdueOnly) {
      filtered = filtered.filter(
        (row) => classifyFinanceApTitle(row, referenceDate) === "overdue"
      );
    }

    if (query.agingBucket) {
      filtered = filtered.filter((row) =>
        rowMatchesApAgingBucketDrilldown(
          row,
          query.agingBucket!,
          query.filters,
          referenceDate,
          syncCutoff,
          false
        )
      );
    }
  }

  if (query.search) {
    filtered = filtered.filter((row) => rowMatchesSearch(row, query.search!));
  }

  if (query.qualityAlert) {
    filtered = filtered.filter((row) =>
      rowMatchesFinanceApQualityAlert(row, query.qualityAlert!, referenceDate)
    );
  }

  const mapped = filtered.map((row) => mapRowToTitleListItem(row, referenceDate));
  mapped.sort((a, b) => compareTitles(a, b, query.sortBy, query.sortDirection));

  const bucketTotals: FinanceTitlesBucketTotals | undefined = query.agingBucket
    ? {
        openBalanceAmount: roundMoney(
          mapped.reduce((sum, item) => sum + item.balancePayable, 0)
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

export const FINANCE_AP_TITLE_SELECT = {
  externalId: true,
  companyName: true,
  personName: true,
  personCnpj: true,
  description: true,
  dueDate: true,
  scheduleDate: true,
  type: true,
  settlementDate: true,
  paymentDate: true,
  amountPayable: true,
  amountPaid: true,
  balancePayable: true,
  paymentMethodName: true,
  bankAccountName: true,
  sourceInvoiceId: true,
  documentNumber: true,
  suspendPayment: true,
  status: true,
  syncedAt: true,
} as const;

export function mapPrismaRowToFinanceApTitleRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  dueDate: Date | null;
  scheduleDate?: Date | null;
  type?: number | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  amountPayable: import("@prisma/client").Prisma.Decimal | null;
  amountPaid: import("@prisma/client").Prisma.Decimal | null;
  balancePayable: import("@prisma/client").Prisma.Decimal | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  documentNumber: string | null;
  suspendPayment: boolean | null;
  status: boolean | null;
  syncedAt: Date;
}): FinanceApDashboardRow {
  const base = mapPrismaRowToFinanceApDashboardRow(row);
  return {
    ...base,
    description: row.description,
    nomusStatus: row.status,
  };
}
