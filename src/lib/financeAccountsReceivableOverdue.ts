import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  hasFinanceArSourceInvoice,
  parseFinanceArDashboardFilters,
  roundMoney,
  safeRatio,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
  FinanceArFilterParseError,
} from "./financeAccountsReceivableDashboard.js";
import { filterFinanceArManagementReportRows } from "./financeAccountsReceivableManagement.js";
import {
  filterOfficialArOverdueTitles,
  isOfficialArOverdueTitle,
  sumOfficialArOverdueAmount,
} from "./financeAccountsReceivableRulesEngine.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import {
  FINANCE_AR_OVERDUE_AGING_BUCKETS,
  type FinanceArOverdueAgingBucket,
  type FinanceArOverdueAgingBucketKey,
  type FinanceArOverdueCustomerRankingRow,
  type FinanceArOverdueFilters,
  type FinanceArOverduePayload,
  type FinanceArOverdueSortBy,
  type FinanceArOverdueSummary,
  type FinanceArOverdueTitleRow,
} from "./financeAccountsReceivableOverdueTypes.js";

export class FinanceArOverdueFilterParseError extends FinanceArFilterParseError {
  constructor(message: string) {
    super(message);
    this.name = "FinanceArOverdueFilterParseError";
  }
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new FinanceArOverdueFilterParseError("Valor numérico inválido.");
  }
  return n;
}

function parseAgingBucket(value: unknown): FinanceArOverdueAgingBucketKey | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const found = FINANCE_AR_OVERDUE_AGING_BUCKETS.find((b) => b.key === raw);
  if (!found) {
    throw new FinanceArOverdueFilterParseError("Faixa de atraso inválida.");
  }
  return found.key;
}

function parseSortBy(value: unknown): FinanceArOverdueSortBy {
  const raw = String(value ?? "overdueAmount").trim();
  if (
    raw === "daysOverdue" ||
    raw === "customer" ||
    raw === "dueDate" ||
    raw === "titlesCount"
  ) {
    return raw;
  }
  return "overdueAmount";
}

export function parseFinanceArOverdueFilters(
  query: Record<string, unknown>
): FinanceArOverdueFilters {
  const base = parseFinanceArDashboardFilters(query);
  const sortRaw = String(query.sortDirection ?? "desc").trim().toLowerCase();
  const page = parseOptionalPositiveInt(query.page) ?? 1;
  const limitRaw = parseOptionalPositiveInt(query.limit) ?? 100;
  const limit = Math.min(Math.max(limitRaw, 1), 5000);
  return {
    ...base,
    agingBucket: parseAgingBucket(query.agingBucket),
    minDaysOverdue: parseOptionalPositiveInt(query.minDaysOverdue),
    minOpenBalance: parseOptionalPositiveInt(query.minOpenBalance),
    minOverdueTitlesPerCustomer: parseOptionalPositiveInt(query.minOverdueTitlesPerCustomer),
    sortBy: parseSortBy(query.sortBy),
    sortDirection: sortRaw === "asc" ? "asc" : "desc",
    page,
    limit,
  };
}

/** Regra oficial de atrasado gerencial — delegada ao motor. */
export const isFinanceArOverdueRow = isOfficialArOverdueTitle;

/** @deprecated Use {@link isFinanceArOverdueRow}. */
export const isFinanceArOverdueOpenTitle = isOfficialArOverdueTitle;

export function resolveOverdueAgingKey(daysOverdue: number): FinanceArOverdueAgingBucketKey {
  if (daysOverdue <= 7) return "overdue1to7";
  if (daysOverdue <= 15) return "overdue8to15";
  if (daysOverdue <= 30) return "overdue16to30";
  if (daysOverdue <= 60) return "overdue31to60";
  if (daysOverdue <= 90) return "overdue61to90";
  return "overdue90plus";
}

function resolveArSourceLabel(row: FinanceArDashboardRow): string {
  if (hasFinanceArSourceInvoice(row)) return "Com NF";
  return "Sem NF / pré-faturamento";
}

export function resolveOverdueAgingLabel(daysOverdue: number): string {
  const key = resolveOverdueAgingKey(daysOverdue);
  return FINANCE_AR_OVERDUE_AGING_BUCKETS.find((b) => b.key === key)?.label ?? "—";
}

function mapTitleRow(row: FinanceArDashboardRow, referenceDate: Date): FinanceArOverdueTitleRow {
  const days = computeDaysOverdue(row.dueDate, referenceDate);
  return {
    id: String(row.externalId),
    externalId: row.externalId,
    customerName: row.personName?.trim() || "—",
    customerDocument: row.personCnpj?.trim() || undefined,
    documentNumber: row.sourceInvoiceNumber?.trim() || String(row.externalId),
    nfeNumber: row.sourceInvoiceNumber?.trim() || undefined,
    salesOrderNumber: row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : undefined,
    dueDate: row.dueDate!.toISOString(),
    daysOverdue: days,
    agingLabel: resolveOverdueAgingLabel(days),
    amountReceivable: roundMoney(row.amountReceivable),
    amountReceived: roundMoney(row.amountReceived),
    balanceReceivable: roundMoney(row.balanceReceivable),
    paymentMethodName: row.paymentMethodName?.trim() || undefined,
    companyName: row.companyName?.trim() || undefined,
    status: classifyFinanceArTitle(row, referenceDate),
    sourceLabel: resolveArSourceLabel(row),
    description: row.description?.trim() || undefined,
  };
}

function matchesOverdueSpecificFilters(
  row: FinanceArDashboardRow,
  daysOverdue: number,
  filters: FinanceArOverdueFilters
): boolean {
  if (filters.minDaysOverdue != null && daysOverdue < filters.minDaysOverdue) return false;
  if (filters.minOpenBalance != null && row.balanceReceivable < filters.minOpenBalance) {
    return false;
  }
  if (filters.agingBucket != null && resolveOverdueAgingKey(daysOverdue) !== filters.agingBucket) {
    return false;
  }
  return true;
}

function buildAppliedFiltersRecord(
  filters: FinanceArOverdueFilters
): Record<string, string | number | undefined> {
  return {
    companyName: filters.companyName,
    personName: filters.personName,
    personCnpj: filters.personCnpj,
    status: filters.status,
    year: filters.year,
    month: filters.month,
    dueDateFrom: filters.dueDateFrom?.toISOString(),
    dueDateTo: filters.dueDateTo?.toISOString(),
    paymentMethodName: filters.paymentMethodName,
    bankAccountName: filters.bankAccountName,
    invoiceIssued: filters.invoiceIssued,
    agingBucket: filters.agingBucket,
    minDaysOverdue: filters.minDaysOverdue,
    minOpenBalance: filters.minOpenBalance,
    minOverdueTitlesPerCustomer: filters.minOverdueTitlesPerCustomer,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
  };
}

function buildSummary(rows: FinanceArOverdueTitleRow[]): FinanceArOverdueSummary {
  let totalOverdueAmount = 0;
  let weightedDays = 0;
  let maxDaysOverdue = 0;
  let over30Amount = 0;
  let over60Amount = 0;
  let over90Amount = 0;
  const customers = new Set<string>();

  for (const row of rows) {
    totalOverdueAmount += row.balanceReceivable;
    weightedDays += row.daysOverdue * row.balanceReceivable;
    if (row.daysOverdue > maxDaysOverdue) maxDaysOverdue = row.daysOverdue;
    if (row.daysOverdue > 30) over30Amount += row.balanceReceivable;
    if (row.daysOverdue > 60) over60Amount += row.balanceReceivable;
    if (row.daysOverdue > 90) over90Amount += row.balanceReceivable;
    customers.add(`${row.customerDocument ?? ""}|${row.customerName}`);
  }

  const totalRounded = roundMoney(totalOverdueAmount);
  const avgDays =
    totalRounded > 0 ? roundMoney(weightedDays / totalRounded) : null;

  let topCustomer: FinanceArOverdueSummary["topOverdueCustomer"] = null;
  if (rows.length > 0) {
    const byCustomer = new Map<string, { name: string; document?: string; amount: number }>();
    for (const row of rows) {
      const key = `${row.customerDocument ?? ""}|${row.customerName}`;
      const existing = byCustomer.get(key);
      if (existing) {
        existing.amount += row.balanceReceivable;
      } else {
        byCustomer.set(key, {
          name: row.customerName,
          document: row.customerDocument,
          amount: row.balanceReceivable,
        });
      }
    }
    const sorted = [...byCustomer.values()].sort((a, b) => b.amount - a.amount);
    const top = sorted[0];
    if (top) {
      topCustomer = {
        name: top.name,
        document: top.document,
        amount: roundMoney(top.amount),
      };
    }
  }

  return {
    totalOverdueAmount: totalRounded,
    overdueTitlesCount: rows.length,
    overdueCustomersCount: customers.size,
    averageDaysOverdue: avgDays,
    maxDaysOverdue: rows.length > 0 ? maxDaysOverdue : null,
    over30Amount: roundMoney(over30Amount),
    over60Amount: roundMoney(over60Amount),
    over90Amount: roundMoney(over90Amount),
    topOverdueCustomer: topCustomer,
  };
}

function buildAgingBuckets(rows: FinanceArOverdueTitleRow[]): FinanceArOverdueAgingBucket[] {
  const total = rows.reduce((s, r) => s + r.balanceReceivable, 0);
  const acc = new Map<FinanceArOverdueAgingBucketKey, { count: number; amount: number }>();
  for (const def of FINANCE_AR_OVERDUE_AGING_BUCKETS) {
    acc.set(def.key, { count: 0, amount: 0 });
  }
  for (const row of rows) {
    const key = resolveOverdueAgingKey(row.daysOverdue);
    const bucket = acc.get(key)!;
    bucket.count += 1;
    bucket.amount += row.balanceReceivable;
  }
  return FINANCE_AR_OVERDUE_AGING_BUCKETS.map((def) => {
    const data = acc.get(def.key)!;
    const amount = roundMoney(data.amount);
    return {
      bucket: def.label,
      key: def.key,
      minDays: def.minDays,
      maxDays: def.maxDays,
      titlesCount: data.count,
      amount,
      percent: roundMoney(safeRatio(amount, total) * 100),
    };
  });
}

function buildCustomerRanking(rows: FinanceArOverdueTitleRow[]): FinanceArOverdueCustomerRankingRow[] {
  const total = rows.reduce((s, r) => s + r.balanceReceivable, 0);
  const acc = new Map<
    string,
    {
      customerName: string;
      customerDocument?: string;
      titlesCount: number;
      overdueAmount: number;
      oldestDueDate: string | null;
      maxDaysOverdue: number;
      weightedDays: number;
    }
  >();

  for (const row of rows) {
    const key = `${row.customerDocument ?? ""}|${row.customerName}`;
    const existing = acc.get(key);
    if (existing) {
      existing.titlesCount += 1;
      existing.overdueAmount += row.balanceReceivable;
      existing.weightedDays += row.daysOverdue * row.balanceReceivable;
      if (row.daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = row.daysOverdue;
      if (
        !existing.oldestDueDate ||
        new Date(row.dueDate).getTime() < new Date(existing.oldestDueDate).getTime()
      ) {
        existing.oldestDueDate = row.dueDate;
      }
    } else {
      acc.set(key, {
        customerName: row.customerName,
        customerDocument: row.customerDocument,
        titlesCount: 1,
        overdueAmount: row.balanceReceivable,
        oldestDueDate: row.dueDate,
        maxDaysOverdue: row.daysOverdue,
        weightedDays: row.daysOverdue * row.balanceReceivable,
      });
    }
  }

  const sorted = [...acc.values()].sort((a, b) => b.overdueAmount - a.overdueAmount);
  return sorted.map((row, index) => {
    const amount = roundMoney(row.overdueAmount);
    return {
      rank: index + 1,
      customerName: row.customerName,
      customerDocument: row.customerDocument,
      titlesCount: row.titlesCount,
      overdueAmount: amount,
      oldestDueDate: row.oldestDueDate,
      maxDaysOverdue: row.maxDaysOverdue,
      averageDaysOverdue:
        amount > 0 ? roundMoney(row.weightedDays / amount) : null,
      percentOfTotal: roundMoney(safeRatio(amount, total) * 100),
    };
  });
}

function sortOverdueTitles(
  rows: FinanceArOverdueTitleRow[],
  sortBy: FinanceArOverdueSortBy,
  direction: "asc" | "desc"
): FinanceArOverdueTitleRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "daysOverdue":
        return factor * (a.daysOverdue - b.daysOverdue) || factor * (b.balanceReceivable - a.balanceReceivable);
      case "customer":
        return (
          factor * a.customerName.localeCompare(b.customerName, "pt-BR") ||
          factor * (b.balanceReceivable - a.balanceReceivable)
        );
      case "dueDate":
        return (
          factor * (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()) ||
          factor * (b.balanceReceivable - a.balanceReceivable)
        );
      case "titlesCount":
      case "overdueAmount":
      default:
        return factor * (b.balanceReceivable - a.balanceReceivable) || factor * (b.daysOverdue - a.daysOverdue);
    }
  });
}

export function buildFinanceAccountsReceivableOverdueRows(
  rows: FinanceArDashboardRow[],
  filters: FinanceArOverdueFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArOverdueTitleRow[] {
  const baseFilters: FinanceArDashboardFilters = { ...filters, status: "all" };
  const scoped = filterFinanceArManagementReportRows(rows, baseFilters, referenceDate, syncCutoff);
  const overdueRows: FinanceArOverdueTitleRow[] = [];

  for (const row of scoped) {
    if (!isFinanceArOverdueRow(row, referenceDate)) continue;
    const days = computeDaysOverdue(row.dueDate, referenceDate);
    if (!matchesOverdueSpecificFilters(row, days, filters)) continue;
    overdueRows.push(mapTitleRow(row, referenceDate));
  }

  return overdueRows;
}

export function buildFinanceArOverduePayload(
  rows: FinanceArDashboardRow[],
  filters: FinanceArOverdueFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null,
  options?: { paginate?: boolean }
): FinanceArOverduePayload {
  const paginate = options?.paginate !== false;
  let overdueRows = buildFinanceAccountsReceivableOverdueRows(
    rows,
    filters,
    referenceDate,
    syncCutoff
  );

  if (filters.minOverdueTitlesPerCustomer != null && filters.minOverdueTitlesPerCustomer > 0) {
    const counts = new Map<string, number>();
    for (const row of overdueRows) {
      const key = `${row.customerDocument ?? ""}|${row.customerName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    overdueRows = overdueRows.filter((row) => {
      const key = `${row.customerDocument ?? ""}|${row.customerName}`;
      return (counts.get(key) ?? 0) >= filters.minOverdueTitlesPerCustomer!;
    });
  }

  const sortBy = filters.sortBy ?? "overdueAmount";
  const sortDirection = filters.sortDirection ?? "desc";
  const sorted = sortOverdueTitles(overdueRows, sortBy, sortDirection);

  const summary = buildSummary(sorted);
  const agingBuckets = buildAgingBuckets(sorted);
  const customerRanking = buildCustomerRanking(sorted);

  const page = Math.max(filters.page ?? 1, 1);
  const limit = Math.max(filters.limit ?? 100, 1);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const overdueTitles = paginate
    ? sorted.slice((safePage - 1) * limit, safePage * limit)
    : sorted;

  return {
    generatedAt: new Date().toISOString(),
    referenceDate: startOfLocalDay(referenceDate).toISOString(),
    filters,
    appliedFilters: buildAppliedFiltersRecord(filters),
    summary,
    agingBuckets,
    customerRanking,
    overdueTitles,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
  };
}

/** Base de títulos atrasados — motor oficial. */
export const filterFinanceArOverdueBaseRows = filterOfficialArOverdueTitles;

/** Total vencido gerencial — motor oficial. */
export const sumFinanceArOverdueOpenAmount = sumOfficialArOverdueAmount;
