/**
 * Radar Diário de Caixa — agregação independente dos filtros globais da página.
 * Usa data operacional de caixa (AR: dueDate; AP: scheduleDate/dueDate via getAccountsPayableOperationalDueDate).
 */
import { classifyFinanceArTitle, roundMoney, startOfLocalDay } from "./financeAccountsReceivableDashboard.js";
import { classifyFinanceApTitle } from "./financeAccountsPayableDashboard.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowDashboardFilters } from "./financeCashFlowDashboardTypes.js";
import {
  filterCashFlowApPortfolioRows,
  filterCashFlowArPortfolioRows,
} from "./financeCashFlowRowFilters.js";
import {
  resolveCashFlowApAmount,
  resolveCashFlowApMovementDate,
  resolveCashFlowArAmount,
  resolveCashFlowArMovementDate,
  shouldIncludeCashFlowApMovement,
  shouldIncludeCashFlowArMovement,
} from "./financeCashFlowLedger.js";
import { computeDaysFromToday } from "./financeHorizonBuckets.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import {
  compareNullableValues,
  sortRows,
  toggleSortState,
  type SortDirection,
  type SortState,
} from "./soldProductsTableSort.js";

export const DAILY_RADAR_RANGE_KEYS = [
  "overdue",
  "0-7",
  "8-15",
  "16-30",
  "31-60",
  "61-90",
] as const;

export type DailyRadarRangeKey = (typeof DAILY_RADAR_RANGE_KEYS)[number];

export type DailyRadarRangeDef = {
  key: DailyRadarRangeKey;
  label: string;
  fromDay: number;
  toDay: number;
};

export const DAILY_RADAR_RANGES: readonly DailyRadarRangeDef[] = [
  { key: "overdue", label: "Vencidos", fromDay: Number.NEGATIVE_INFINITY, toDay: -1 },
  { key: "0-7", label: "0 a 7 dias", fromDay: 0, toDay: 7 },
  { key: "8-15", label: "8 a 15 dias", fromDay: 8, toDay: 15 },
  { key: "16-30", label: "16 a 30 dias", fromDay: 16, toDay: 30 },
  { key: "31-60", label: "31 a 60 dias", fromDay: 31, toDay: 60 },
  { key: "61-90", label: "61 a 90 dias", fromDay: 61, toDay: 90 },
] as const;

const WEEKDAY_PT = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export type DailyRadarQuery = {
  baseDate: Date;
  rangeKey?: DailyRadarRangeKey;
  day?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: SortDirection;
  payableSortBy?: string;
  payableSortDirection?: SortDirection;
  receivableSortBy?: string;
  receivableSortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
};

export type DailyRadarRangeSummary = {
  key: DailyRadarRangeKey;
  label: string;
  dateFrom: string | null;
  dateTo: string | null;
  payableTotal: number;
  receivableTotal: number;
  netTotal: number;
  payableCount: number;
  receivableCount: number;
};

export type DailyRadarDaySummary = {
  date: string;
  dayOffset: number;
  weekday: string;
  payableTotal: number;
  receivableTotal: number;
  netTotal: number;
  payableCount: number;
  receivableCount: number;
  timing: "overdue" | "today" | "future";
};

export type DailyRadarPayableRow = {
  id: string;
  supplier: string | null;
  company: string | null;
  description: string | null;
  document: string | null;
  operationalDate: string;
  dueDate: string | null;
  scheduleDate: string | null;
  amount: number;
  status: string;
  paymentMethod: string | null;
  rescheduled: boolean;
};

export type DailyRadarReceivableRow = {
  id: string;
  customer: string | null;
  company: string | null;
  description: string | null;
  document: string | null;
  operationalDate: string;
  amount: number;
  status: string;
  invoiceIssued: boolean;
  paymentMethod: string | null;
};

/** Totalizadores de uma coluna de valores (faixa ou dia, após busca/filtros). */
export type DailyRadarGridSummary = {
  count: number;
  total: number;
  overdueTotal: number;
  upcomingTotal: number;
  maxAmount: number;
  averageAmount: number;
};

export type DailyRadarDetailGroup<Row> = {
  summary: DailyRadarGridSummary;
  /** @deprecated use summary.total — mantido por compatibilidade. */
  total: number;
  /** @deprecated use summary.count — mantido por compatibilidade. */
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rows: Row[];
};

export type DailyRadarDayDetail = {
  date: string;
  payables: DailyRadarDetailGroup<DailyRadarPayableRow>;
  receivables: DailyRadarDetailGroup<DailyRadarReceivableRow>;
};

export type DailyRadarDetailLevel = "range" | "day";

/** Detalhe progressivo do drill-down (faixa ou dia) com grids AP/AR. */
export type DailyRadarSelectedDetail = {
  level: DailyRadarDetailLevel;
  rangeKey: DailyRadarRangeKey;
  rangeLabel: string;
  date: string | null;
  entriesTotal: number;
  exitsTotal: number;
  netTotal: number;
  payables: DailyRadarDetailGroup<DailyRadarPayableRow>;
  receivables: DailyRadarDetailGroup<DailyRadarReceivableRow>;
};

export type DailyRadarPayload = {
  baseDate: string;
  ranges: DailyRadarRangeSummary[];
  selectedRange?: {
    key: DailyRadarRangeKey;
    days: DailyRadarDaySummary[];
  };
  selectedDetail?: DailyRadarSelectedDetail;
  selectedDay?: DailyRadarDayDetail;
};

type InternalMovement = {
  type: "AR" | "AP";
  operationalDate: Date;
  dayOffset: number;
  amount: number;
  ar?: FinanceCashFlowArRow;
  ap?: FinanceCashFlowApRow;
};

export function createDailyRadarDashboardFilters(): FinanceCashFlowDashboardFilters {
  return {
    viewMode: "projected",
    dateBase: "due",
    status: "open",
    cashFlowScope: undefined,
  };
}

function finiteMoney(value: number): number {
  return roundMoney(Number.isFinite(value) ? value : 0);
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value: string): Date | null {
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfLocalDay(d);
}

function weekdayLabel(date: Date): string {
  return WEEKDAY_PT[date.getDay()] ?? "";
}

function dayTiming(dayOffset: number): "overdue" | "today" | "future" {
  if (dayOffset < 0) return "overdue";
  if (dayOffset === 0) return "today";
  return "future";
}

function dayLabel(dayOffset: number): string {
  if (dayOffset === 0) return "Hoje";
  if (dayOffset === 1) return "Amanhã";
  return `D+${dayOffset}`;
}

function matchesRange(dayOffset: number, def: DailyRadarRangeDef): boolean {
  return dayOffset >= def.fromDay && dayOffset <= def.toDay;
}

function findRangeDef(key: string | undefined): DailyRadarRangeDef | undefined {
  return DAILY_RADAR_RANGES.find((r) => r.key === key);
}

export function collectDailyRadarMovements(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  baseDate: Date
): InternalMovement[] {
  const dateBase = "due" as const;
  const movements: InternalMovement[] = [];

  for (const row of arRows) {
    if (!shouldIncludeCashFlowArMovement(row, "projected")) continue;
    const operationalDate = resolveCashFlowArMovementDate(row, "projected", dateBase);
    if (!operationalDate) continue;
    const amount = resolveCashFlowArAmount(row, "projected");
    if (amount <= 0) continue;
    const dayOffset = computeDaysFromToday(operationalDate, baseDate);
    movements.push({ type: "AR", operationalDate, dayOffset, amount, ar: row });
  }

  for (const row of apRows) {
    if (!shouldIncludeCashFlowApMovement(row, "projected")) continue;
    const operationalDate = resolveCashFlowApMovementDate(row, "projected", dateBase);
    if (!operationalDate) continue;
    const amount = resolveCashFlowApAmount(row, "projected");
    if (amount <= 0) continue;
    const dayOffset = computeDaysFromToday(operationalDate, baseDate);
    movements.push({ type: "AP", operationalDate, dayOffset, amount, ap: row });
  }

  return movements;
}

export function filterDailyRadarPortfolioRows(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): { arRows: FinanceCashFlowArRow[]; apRows: FinanceCashFlowApRow[] } {
  const filters = createDailyRadarDashboardFilters();
  return {
    arRows: filterCashFlowArPortfolioRows(
      arRows,
      filters,
      toCashFlowPortfolioArFilters(filters),
      referenceDate,
      arSyncCutoff
    ),
    apRows: filterCashFlowApPortfolioRows(
      apRows,
      filters,
      toCashFlowPortfolioApFilters(filters),
      referenceDate,
      apSyncCutoff
    ),
  };
}

function summarizeRange(
  movements: InternalMovement[],
  def: DailyRadarRangeDef,
  baseDate: Date
): DailyRadarRangeSummary {
  const inRange = movements.filter((m) => matchesRange(m.dayOffset, def));
  let payableTotal = 0;
  let receivableTotal = 0;
  let payableCount = 0;
  let receivableCount = 0;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const m of inRange) {
    if (m.type === "AP") {
      payableTotal += m.amount;
      payableCount += 1;
    } else {
      receivableTotal += m.amount;
      receivableCount += 1;
    }
    if (!minDate || m.operationalDate < minDate) minDate = m.operationalDate;
    if (!maxDate || m.operationalDate > maxDate) maxDate = m.operationalDate;
  }

  const dateFrom =
    def.fromDay === Number.NEGATIVE_INFINITY
      ? null
      : toIsoDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + def.fromDay));
  const dateTo =
    def.toDay === Number.POSITIVE_INFINITY
      ? null
      : toIsoDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + def.toDay));

  return {
    key: def.key,
    label: def.label,
    dateFrom: inRange.length > 0 && minDate ? toIsoDate(minDate) : dateFrom,
    dateTo: inRange.length > 0 && maxDate ? toIsoDate(maxDate) : dateTo,
    payableTotal: finiteMoney(payableTotal),
    receivableTotal: finiteMoney(receivableTotal),
    netTotal: finiteMoney(receivableTotal - payableTotal),
    payableCount,
    receivableCount,
  };
}

function buildDaysForRange(
  movements: InternalMovement[],
  def: DailyRadarRangeDef,
  baseDate: Date
): DailyRadarDaySummary[] {
  const byDate = new Map<string, DailyRadarDaySummary>();

  for (const m of movements) {
    if (!matchesRange(m.dayOffset, def)) continue;
    const dateKey = toIsoDate(m.operationalDate);
    const row =
      byDate.get(dateKey) ??
      ({
        date: dateKey,
        dayOffset: m.dayOffset,
        weekday: weekdayLabel(m.operationalDate),
        payableTotal: 0,
        receivableTotal: 0,
        netTotal: 0,
        payableCount: 0,
        receivableCount: 0,
        timing: dayTiming(m.dayOffset),
      } satisfies DailyRadarDaySummary);
    if (m.type === "AP") {
      row.payableTotal += m.amount;
      row.payableCount += 1;
    } else {
      row.receivableTotal += m.amount;
      row.receivableCount += 1;
    }
    row.netTotal = finiteMoney(row.receivableTotal - row.payableTotal);
    byDate.set(dateKey, row);
  }

  const days: DailyRadarDaySummary[] = [];
  if (Number.isFinite(def.fromDay) && Number.isFinite(def.toDay) && def.fromDay >= 0) {
    for (let offset = def.fromDay; offset <= def.toDay; offset += 1) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
      const dateKey = toIsoDate(d);
      const existing = byDate.get(dateKey);
      days.push(
        existing ?? {
          date: dateKey,
          dayOffset: offset,
          weekday: weekdayLabel(d),
          payableTotal: 0,
          receivableTotal: 0,
          netTotal: 0,
          payableCount: 0,
          receivableCount: 0,
          timing: dayTiming(offset),
        }
      );
    }
    return days;
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeSearch(term: string): string {
  return term.trim().toLowerCase();
}

function matchesSearch(haystack: string, term: string): boolean {
  if (!term) return true;
  return haystack.toLowerCase().includes(term);
}

function mapPayableRow(row: FinanceCashFlowApRow, referenceDate: Date): DailyRadarPayableRow {
  const operational = getAccountsPayableOperationalDueDate(row);
  const due = row.dueDate;
  const schedule = row.scheduleDate ?? null;
  const rescheduled =
    due != null &&
    schedule != null &&
    startOfLocalDay(schedule).getTime() > startOfLocalDay(due).getTime();
  return {
    id: `ap-${row.externalId}`,
    supplier: row.personName,
    company: row.companyName,
    description: row.description ?? null,
    document: row.documentNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null),
    operationalDate: operational ? toIsoDate(operational) : "",
    dueDate: due ? toIsoDate(due) : null,
    scheduleDate: schedule ? toIsoDate(schedule) : null,
    amount: finiteMoney(resolveCashFlowApAmount(row, "projected")),
    status: classifyFinanceApTitle(row, referenceDate),
    paymentMethod: row.paymentMethodName,
    rescheduled,
  };
}

function mapReceivableRow(row: FinanceCashFlowArRow, referenceDate: Date): DailyRadarReceivableRow {
  const due = row.dueDate;
  return {
    id: `ar-${row.externalId}`,
    customer: row.personName,
    company: row.companyName,
    description: row.description ?? null,
    document: row.sourceInvoiceNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null),
    operationalDate: due ? toIsoDate(due) : "",
    amount: finiteMoney(resolveCashFlowArAmount(row, "projected")),
    status: classifyFinanceArTitle(row, referenceDate),
    invoiceIssued: row.sourceInvoiceId != null,
    paymentMethod: row.paymentMethodName,
  };
}

type PayableSortKey = "supplier" | "company" | "amount" | "status" | "operationalDate";
type ReceivableSortKey = "customer" | "company" | "amount" | "status" | "operationalDate";

const PAYABLE_SORT_ACCESSORS = {
  supplier: { get: (r: DailyRadarPayableRow) => r.supplier, kind: "text" as const },
  company: { get: (r: DailyRadarPayableRow) => r.company, kind: "text" as const },
  amount: { get: (r: DailyRadarPayableRow) => r.amount, kind: "number" as const, defaultDirection: "desc" as const },
  status: { get: (r: DailyRadarPayableRow) => r.status, kind: "text" as const },
  operationalDate: { get: (r: DailyRadarPayableRow) => r.operationalDate, kind: "date" as const },
};

const RECEIVABLE_SORT_ACCESSORS = {
  customer: { get: (r: DailyRadarReceivableRow) => r.customer, kind: "text" as const },
  company: { get: (r: DailyRadarReceivableRow) => r.company, kind: "text" as const },
  amount: { get: (r: DailyRadarReceivableRow) => r.amount, kind: "number" as const, defaultDirection: "desc" as const },
  status: { get: (r: DailyRadarReceivableRow) => r.status, kind: "text" as const },
  operationalDate: { get: (r: DailyRadarReceivableRow) => r.operationalDate, kind: "date" as const },
};

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: safePage, pageSize, totalPages, total };
}

function summarizeGrid(items: Array<{ amount: number; overdue: boolean }>): DailyRadarGridSummary {
  let total = 0;
  let overdueTotal = 0;
  let upcomingTotal = 0;
  let maxAmount = 0;
  for (const item of items) {
    total += item.amount;
    if (item.overdue) overdueTotal += item.amount;
    else upcomingTotal += item.amount;
    if (item.amount > maxAmount) maxAmount = item.amount;
  }
  const count = items.length;
  return {
    count,
    total: finiteMoney(total),
    overdueTotal: finiteMoney(overdueTotal),
    upcomingTotal: finiteMoney(upcomingTotal),
    maxAmount: finiteMoney(maxAmount),
    averageAmount: count > 0 ? finiteMoney(total / count) : 0,
  };
}

/**
 * Detalhe AP/AR de um escopo de movimentos (dia OU faixa inteira), com busca,
 * ordenação, paginação e totalizadores. Usado tanto para `selectedDetail`
 * (drill-down progressivo) quanto para `selectedDay` (compatibilidade).
 */
function buildScopedDetail(
  scopeMovements: InternalMovement[],
  query: DailyRadarQuery,
  referenceDate: Date
): {
  payables: DailyRadarDetailGroup<DailyRadarPayableRow>;
  receivables: DailyRadarDetailGroup<DailyRadarReceivableRow>;
  entriesTotal: number;
  exitsTotal: number;
  netTotal: number;
} {
  const search = normalizeSearch(query.search ?? "");
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 200);
  const page = query.page ?? 1;

  let payables = scopeMovements
    .filter((m) => m.type === "AP" && m.ap)
    .map((m) => ({ row: mapPayableRow(m.ap!, referenceDate), overdue: m.dayOffset < 0 }));
  let receivables = scopeMovements
    .filter((m) => m.type === "AR" && m.ar)
    .map((m) => ({ row: mapReceivableRow(m.ar!, referenceDate), overdue: m.dayOffset < 0 }));

  if (search) {
    payables = payables.filter((p) =>
      matchesSearch(
        `${p.row.supplier ?? ""} ${p.row.company ?? ""} ${p.row.description ?? ""} ${p.row.document ?? ""}`,
        search
      )
    );
    receivables = receivables.filter((r) =>
      matchesSearch(
        `${r.row.customer ?? ""} ${r.row.company ?? ""} ${r.row.description ?? ""} ${r.row.document ?? ""}`,
        search
      )
    );
  }

  const payableSummary = summarizeGrid(payables.map((p) => ({ amount: p.row.amount, overdue: p.overdue })));
  const receivableSummary = summarizeGrid(
    receivables.map((r) => ({ amount: r.row.amount, overdue: r.overdue }))
  );

  const payableSortKey = (query.payableSortBy as PayableSortKey) || (query.sortBy as PayableSortKey) || "amount";
  const receivableSortKey =
    (query.receivableSortBy as ReceivableSortKey) || (query.sortBy as ReceivableSortKey) || "amount";
  const payableSortDir = query.payableSortDirection ?? query.sortDirection ?? "desc";
  const receivableSortDir = query.receivableSortDirection ?? query.sortDirection ?? "desc";

  let payableRows = payables.map((p) => p.row);
  let receivableRows = receivables.map((r) => r.row);

  if (PAYABLE_SORT_ACCESSORS[payableSortKey as PayableSortKey]) {
    payableRows = sortRows(
      payableRows,
      { key: payableSortKey as PayableSortKey, direction: payableSortDir },
      PAYABLE_SORT_ACCESSORS
    );
  }
  if (RECEIVABLE_SORT_ACCESSORS[receivableSortKey as ReceivableSortKey]) {
    receivableRows = sortRows(
      receivableRows,
      { key: receivableSortKey as ReceivableSortKey, direction: receivableSortDir },
      RECEIVABLE_SORT_ACCESSORS
    );
  }

  const payablesPage = paginate(payableRows, page, pageSize);
  const receivablesPage = paginate(receivableRows, page, pageSize);

  return {
    payables: {
      summary: payableSummary,
      total: payableSummary.total,
      count: payableSummary.count,
      page: payablesPage.page,
      pageSize,
      totalPages: payablesPage.totalPages,
      rows: payablesPage.rows,
    },
    receivables: {
      summary: receivableSummary,
      total: receivableSummary.total,
      count: receivableSummary.count,
      page: receivablesPage.page,
      pageSize,
      totalPages: receivablesPage.totalPages,
      rows: receivablesPage.rows,
    },
    entriesTotal: receivableSummary.total,
    exitsTotal: payableSummary.total,
    netTotal: finiteMoney(receivableSummary.total - payableSummary.total),
  };
}

function buildDayDetail(
  movements: InternalMovement[],
  dayIso: string,
  query: DailyRadarQuery,
  referenceDate: Date
): DailyRadarDayDetail {
  const dayMovements = movements.filter((m) => toIsoDate(m.operationalDate) === dayIso);
  const scoped = buildScopedDetail(dayMovements, query, referenceDate);
  return { date: dayIso, payables: scoped.payables, receivables: scoped.receivables };
}

export function buildDailyRadarQuery(params: {
  baseDate?: string;
  range?: DailyRadarRangeKey;
  day?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: SortDirection;
  payableSortBy?: string;
  payableSortDirection?: SortDirection;
  receivableSortBy?: string;
  receivableSortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
}): string {
  const qs = new URLSearchParams();
  if (params.baseDate) qs.set("baseDate", params.baseDate);
  if (params.range) qs.set("range", params.range);
  if (params.day) qs.set("day", params.day);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDirection) qs.set("sortDirection", params.sortDirection);
  if (params.payableSortBy) qs.set("payableSortBy", params.payableSortBy);
  if (params.payableSortDirection) qs.set("payableSortDirection", params.payableSortDirection);
  if (params.receivableSortBy) qs.set("receivableSortBy", params.receivableSortBy);
  if (params.receivableSortDirection) qs.set("receivableSortDirection", params.receivableSortDirection);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  return qs.toString();
}

export function parseDailyRadarQuery(query: Record<string, unknown>): DailyRadarQuery {
  const baseRaw = typeof query.baseDate === "string" ? query.baseDate.trim() : "";
  const baseDate = parseIsoDate(baseRaw) ?? startOfLocalDay(new Date());
  const rangeRaw = typeof query.range === "string" ? query.range.trim() : "";
  const rangeKey = DAILY_RADAR_RANGE_KEYS.includes(rangeRaw as DailyRadarRangeKey)
    ? (rangeRaw as DailyRadarRangeKey)
    : undefined;
  const day = typeof query.day === "string" && query.day.trim() ? query.day.trim() : undefined;
  const search = typeof query.search === "string" ? query.search : undefined;
  const sortBy = typeof query.sortBy === "string" ? query.sortBy : undefined;
  const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";
  const payableSortBy = typeof query.payableSortBy === "string" ? query.payableSortBy : undefined;
  const payableSortDirection = query.payableSortDirection === "asc" ? "asc" : "desc";
  const receivableSortBy = typeof query.receivableSortBy === "string" ? query.receivableSortBy : undefined;
  const receivableSortDirection = query.receivableSortDirection === "asc" ? "asc" : "desc";
  const page = Number.parseInt(String(query.page ?? "1"), 10);
  const pageSize = Number.parseInt(String(query.pageSize ?? query.limit ?? "25"), 10);
  return {
    baseDate,
    rangeKey,
    day,
    search,
    sortBy,
    sortDirection,
    payableSortBy,
    payableSortDirection,
    receivableSortBy,
    receivableSortDirection,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 25,
  };
}

export function buildFinanceCashFlowDailyRadar(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  query: DailyRadarQuery,
  referenceDate: Date = new Date()
): DailyRadarPayload {
  const baseDate = startOfLocalDay(query.baseDate);
  const movements = collectDailyRadarMovements(arRows, apRows, baseDate);

  const ranges = DAILY_RADAR_RANGES.map((def) => summarizeRange(movements, def, baseDate));

  const payload: DailyRadarPayload = {
    baseDate: toIsoDate(baseDate),
    ranges,
  };

  const rangeDef = findRangeDef(query.rangeKey);
  if (rangeDef) {
    payload.selectedRange = {
      key: rangeDef.key,
      days: buildDaysForRange(movements, rangeDef, baseDate),
    };

    // Drill-down progressivo: faixa inteira por padrão, refinando ao dia quando houver dia.
    const rangeMovements = movements.filter((m) => matchesRange(m.dayOffset, rangeDef));
    let scopeMovements = rangeMovements;
    let level: DailyRadarDetailLevel = "range";
    let dateIso: string | null = null;
    if (query.day) {
      const parsedDay = parseIsoDate(query.day);
      if (parsedDay) {
        const dayKey = toIsoDate(parsedDay);
        scopeMovements = rangeMovements.filter((m) => toIsoDate(m.operationalDate) === dayKey);
        level = "day";
        dateIso = dayKey;
      }
    }

    const scoped = buildScopedDetail(scopeMovements, query, referenceDate);
    payload.selectedDetail = {
      level,
      rangeKey: rangeDef.key,
      rangeLabel: rangeDef.label,
      date: dateIso,
      entriesTotal: scoped.entriesTotal,
      exitsTotal: scoped.exitsTotal,
      netTotal: scoped.netTotal,
      payables: scoped.payables,
      receivables: scoped.receivables,
    };
  }

  if (query.day) {
    const dayIso = parseIsoDate(query.day);
    if (dayIso) {
      payload.selectedDay = buildDayDetail(movements, toIsoDate(dayIso), query, referenceDate);
    }
  }

  return payload;
}

export function dailyRadarDayCardLabel(dayOffset: number): string {
  return dayLabel(dayOffset);
}

export { toggleSortState, type SortState, type SortDirection };
