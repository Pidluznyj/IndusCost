/**
 * Radar de vencimentos (AR ou AP) — mesma lógica de faixas/dias do Radar Diário de Caixa,
 * porém apenas um lado (recebimentos ou pagamentos).
 */
import {
  classifyFinanceArTitle,
  roundMoney,
  startOfLocalDay,
} from "./financeAccountsReceivableDashboard.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import {
  civilDateToLocalDate,
  formatCivilDate,
  startOfCivilDate,
  toCivilDateKey,
} from "./financeCivilDate.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  DAILY_RADAR_EXPORT_PAGE_SIZE,
  DAILY_RADAR_RANGES,
  DAILY_RADAR_RANGE_KEYS,
  dailyRadarDayCardLabel,
  type DailyRadarRangeDef,
  type DailyRadarRangeKey,
} from "./financeCashFlowDailyRadar.js";
import {
  resolveCashFlowApAmount,
  resolveCashFlowApMovementDate,
  resolveCashFlowArAmount,
  resolveCashFlowArMovementDate,
  shouldIncludeCashFlowApMovement,
  shouldIncludeCashFlowArMovement,
} from "./financeCashFlowLedger.js";
import { computeDaysFromToday } from "./financeHorizonBuckets.js";
import { sortRows, toggleSortState, type SortDirection, type SortState } from "./soldProductsTableSort.js";
import type { DueRadarMode } from "./financeDueRadarFilters.js";

const WEEKDAY_PT = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export type DueRadarQuery = {
  baseDate: Date;
  rangeKey?: DailyRadarRangeKey;
  day?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
  exportAll?: boolean;
};

export type DueRadarRangeSummary = {
  key: DailyRadarRangeKey;
  label: string;
  dateFrom: string | null;
  dateTo: string | null;
  totalAmount: number;
  titleCount: number;
  tone: "overdue" | "upcoming";
};

export type DueRadarDaySummary = {
  date: string;
  dayOffset: number;
  weekday: string;
  totalAmount: number;
  titleCount: number;
  timing: "overdue" | "today" | "future";
};

export type DueRadarGridSummary = {
  count: number;
  total: number;
  overdueTotal: number;
  upcomingTotal: number;
  maxAmount: number;
  averageAmount: number;
};

export type DueRadarReceivableGridRow = {
  id: string;
  customer: string | null;
  company: string | null;
  description: string | null;
  document: string | null;
  operationalDate: string;
  amount: number;
  balance: number;
  status: string;
  settlementDate: string | null;
};

export type DueRadarPayableGridRow = {
  id: string;
  supplier: string | null;
  company: string | null;
  description: string | null;
  document: string | null;
  operationalDate: string;
  amount: number;
  balance: number;
  scheduledDisplay: string;
};

export type DueRadarDetailGroup<Row> = {
  summary: DueRadarGridSummary;
  page: number;
  pageSize: number;
  totalPages: number;
  rows: Row[];
};

export type DueRadarSelectedDetail = {
  level: "range" | "day";
  rangeKey: DailyRadarRangeKey;
  rangeLabel: string;
  date: string | null;
  totalAmount: number;
  receivables?: DueRadarDetailGroup<DueRadarReceivableGridRow>;
  payables?: DueRadarDetailGroup<DueRadarPayableGridRow>;
};

export type DueRadarPayload = {
  mode: DueRadarMode;
  baseDate: string;
  ranges: DueRadarRangeSummary[];
  selectedRange?: {
    key: DailyRadarRangeKey;
    days: DueRadarDaySummary[];
  };
  selectedDetail?: DueRadarSelectedDetail;
};

type ArMovement = {
  row: FinanceCashFlowArRow;
  operationalDate: Date;
  dayOffset: number;
  amount: number;
};

type ApMovement = {
  row: FinanceCashFlowApRow;
  operationalDate: Date;
  dayOffset: number;
  amount: number;
};

function finiteMoney(value: number): number {
  return roundMoney(Number.isFinite(value) ? value : 0);
}

function toIsoDate(date: Date): string {
  return toCivilDateKey(date) ?? "";
}

function parseIsoDate(value: string): Date | null {
  const key = toCivilDateKey(value);
  if (!key) return null;
  const d = civilDateToLocalDate(key);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeMovementDate(date: Date | null): Date | null {
  if (!date) return null;
  const key = toCivilDateKey(date);
  if (!key) return null;
  return civilDateToLocalDate(key);
}

function weekdayLabel(date: Date): string {
  return WEEKDAY_PT[date.getDay()] ?? "";
}

function dayTiming(dayOffset: number): "overdue" | "today" | "future" {
  if (dayOffset < 0) return "overdue";
  if (dayOffset === 0) return "today";
  return "future";
}

function matchesRange(dayOffset: number, def: DailyRadarRangeDef): boolean {
  return dayOffset >= def.fromDay && dayOffset <= def.toDay;
}

function findRangeDef(key: string | undefined): DailyRadarRangeDef | undefined {
  return DAILY_RADAR_RANGES.find((r) => r.key === key);
}

function isInRadarHorizon(dayOffset: number): boolean {
  return DAILY_RADAR_RANGES.some((def) => matchesRange(dayOffset, def));
}

export function collectArDueRadarMovements(
  rows: FinanceCashFlowArRow[],
  baseDate: Date
): ArMovement[] {
  const movements: ArMovement[] = [];
  for (const row of rows) {
    if (!shouldIncludeCashFlowArMovement(row, "projected")) continue;
    const operationalDateRaw = resolveCashFlowArMovementDate(row, "projected", "due");
    const operationalDate = normalizeMovementDate(operationalDateRaw);
    if (!operationalDate) continue;
    const amount = resolveCashFlowArAmount(row, "projected");
    if (amount <= 0) continue;
    const dayOffset = computeDaysFromToday(operationalDate, baseDate);
    if (!isInRadarHorizon(dayOffset)) continue;
    movements.push({ row, operationalDate, dayOffset, amount });
  }
  return movements;
}

export function collectApDueRadarMovements(
  rows: FinanceCashFlowApRow[],
  baseDate: Date
): ApMovement[] {
  const movements: ApMovement[] = [];
  for (const row of rows) {
    if (!shouldIncludeCashFlowApMovement(row, "projected")) continue;
    const operationalDateRaw = resolveCashFlowApMovementDate(row, "projected", "due");
    const operationalDate = normalizeMovementDate(operationalDateRaw);
    if (!operationalDate) continue;
    const amount = resolveCashFlowApAmount(row, "projected");
    if (amount <= 0) continue;
    const dayOffset = computeDaysFromToday(operationalDate, baseDate);
    if (!isInRadarHorizon(dayOffset)) continue;
    movements.push({ row, operationalDate, dayOffset, amount });
  }
  return movements;
}

function summarizeRangeFromMovements(
  movements: Array<{ operationalDate: Date; dayOffset: number; amount: number }>,
  def: DailyRadarRangeDef,
  baseDate: Date
): DueRadarRangeSummary {
  const inRange = movements.filter((m) => matchesRange(m.dayOffset, def));
  let totalAmount = 0;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const m of inRange) {
    totalAmount += m.amount;
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
    totalAmount: finiteMoney(totalAmount),
    titleCount: inRange.length,
    tone: def.key === "overdue" ? "overdue" : "upcoming",
  };
}

function buildDaysForRange(
  movements: Array<{ operationalDate: Date; dayOffset: number; amount: number }>,
  def: DailyRadarRangeDef,
  baseDate: Date
): DueRadarDaySummary[] {
  const byDate = new Map<string, DueRadarDaySummary>();

  for (const m of movements) {
    if (!matchesRange(m.dayOffset, def)) continue;
    const dateKey = toIsoDate(m.operationalDate);
    const row =
      byDate.get(dateKey) ??
      ({
        date: dateKey,
        dayOffset: m.dayOffset,
        weekday: weekdayLabel(m.operationalDate),
        totalAmount: 0,
        titleCount: 0,
        timing: dayTiming(m.dayOffset),
      } satisfies DueRadarDaySummary);
    row.totalAmount += m.amount;
    row.titleCount += 1;
    byDate.set(dateKey, row);
  }

  if (Number.isFinite(def.fromDay) && Number.isFinite(def.toDay) && def.fromDay >= 0) {
    const days: DueRadarDaySummary[] = [];
    for (let offset = def.fromDay; offset <= def.toDay; offset += 1) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
      const dateKey = toIsoDate(d);
      const existing = byDate.get(dateKey);
      days.push(
        existing ?? {
          date: dateKey,
          dayOffset: offset,
          weekday: weekdayLabel(d),
          totalAmount: 0,
          titleCount: 0,
          timing: dayTiming(offset),
        }
      );
    }
    return days.map((d) => ({ ...d, totalAmount: finiteMoney(d.totalAmount) }));
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, totalAmount: finiteMoney(d.totalAmount) }));
}

function normalizeSearch(term: string): string {
  return term.trim().toLowerCase();
}

function matchesSearch(haystack: string, term: string): boolean {
  if (!term) return true;
  return haystack.toLowerCase().includes(term);
}

function mapReceivableGridRow(row: FinanceCashFlowArRow, referenceDate: Date): DueRadarReceivableGridRow {
  const due = row.dueDate;
  return {
    id: `ar-${row.externalId}`,
    customer: row.personName,
    company: row.companyName,
    description: row.description ?? null,
    document: row.sourceInvoiceNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null),
    operationalDate: toCivilDateKey(due) ?? "",
    amount: finiteMoney(resolveCashFlowArAmount(row, "projected")),
    balance: finiteMoney(row.balanceReceivable),
    status: classifyFinanceArTitle(row, referenceDate),
    settlementDate: toCivilDateKey(row.settlementDate),
  };
}

function mapPayableGridRow(row: FinanceCashFlowApRow, referenceDate: Date): DueRadarPayableGridRow {
  const due = row.dueDate;
  const schedule = row.scheduleDate ?? null;
  const operational = getAccountsPayableOperationalDueDate(row);
  const dataAgendada = toCivilDateKey(schedule);
  const dataUsadaNoFluxo = toCivilDateKey(operational) ?? "";
  return {
    id: `ap-${row.externalId}`,
    supplier: row.personName,
    company: row.companyName,
    description: row.description ?? null,
    document: row.documentNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null),
    operationalDate: dataUsadaNoFluxo,
    amount: finiteMoney(resolveCashFlowApAmount(row, "projected")),
    balance: finiteMoney(resolveCashFlowApAmount(row, "projected")),
    scheduledDisplay: dataAgendada ? formatCivilDate(dataAgendada) : "—",
  };
}

function formatPayableScheduledDisplay(row: Pick<FinanceCashFlowApRow, "dueDate" | "scheduleDate">): string {
  const schedule = row.scheduleDate;
  const due = row.dueDate;
  if (schedule && due && startOfCivilDate(schedule).getTime() > startOfCivilDate(due).getTime()) {
    const key = toCivilDateKey(schedule);
    return key ? formatCivilDate(key) : "—";
  }
  if (schedule && !due) {
    const key = toCivilDateKey(schedule);
    return key ? formatCivilDate(key) : "—";
  }
  return "—";
}

type ReceivableSortKey = "customer" | "company" | "amount" | "status" | "operationalDate";
type PayableSortKey = "supplier" | "company" | "amount" | "operationalDate";

const RECEIVABLE_SORT_ACCESSORS = {
  customer: { get: (r: DueRadarReceivableGridRow) => r.customer, kind: "text" as const },
  company: { get: (r: DueRadarReceivableGridRow) => r.company, kind: "text" as const },
  amount: { get: (r: DueRadarReceivableGridRow) => r.amount, kind: "number" as const, defaultDirection: "desc" as const },
  status: { get: (r: DueRadarReceivableGridRow) => r.status, kind: "text" as const },
  operationalDate: { get: (r: DueRadarReceivableGridRow) => r.operationalDate, kind: "date" as const },
};

const PAYABLE_SORT_ACCESSORS = {
  supplier: { get: (r: DueRadarPayableGridRow) => r.supplier, kind: "text" as const },
  company: { get: (r: DueRadarPayableGridRow) => r.company, kind: "text" as const },
  amount: { get: (r: DueRadarPayableGridRow) => r.amount, kind: "number" as const, defaultDirection: "desc" as const },
  operationalDate: { get: (r: DueRadarPayableGridRow) => r.operationalDate, kind: "date" as const },
};

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: safePage, pageSize, totalPages, total };
}

function summarizeGrid(items: Array<{ amount: number; overdue: boolean }>): DueRadarGridSummary {
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

function buildArScopedDetail(
  scopeMovements: ArMovement[],
  query: DueRadarQuery,
  referenceDate: Date
): DueRadarDetailGroup<DueRadarReceivableGridRow> {
  const search = normalizeSearch(query.search ?? "");
  const pageSizeCap = query.exportAll ? DAILY_RADAR_EXPORT_PAGE_SIZE : 200;
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), pageSizeCap);
  const page = query.page ?? 1;

  let items = scopeMovements.map((m) => ({
    row: mapReceivableGridRow(m.row, referenceDate),
    overdue: m.dayOffset < 0,
  }));

  if (search) {
    items = items.filter((item) =>
      matchesSearch(
        `${item.row.customer ?? ""} ${item.row.company ?? ""} ${item.row.description ?? ""} ${item.row.document ?? ""}`,
        search
      )
    );
  }

  const summary = summarizeGrid(items.map((i) => ({ amount: i.row.amount, overdue: i.overdue })));
  const sortKey = (query.sortBy as ReceivableSortKey) || "amount";
  const sortDir = query.sortDirection ?? "desc";
  let rows = items.map((i) => i.row);
  if (RECEIVABLE_SORT_ACCESSORS[sortKey as ReceivableSortKey]) {
    rows = sortRows(rows, { key: sortKey as ReceivableSortKey, direction: sortDir }, RECEIVABLE_SORT_ACCESSORS);
  }
  const paged = paginate(rows, page, pageSize);
  return { summary, ...paged };
}

function buildApScopedDetail(
  scopeMovements: ApMovement[],
  query: DueRadarQuery,
  referenceDate: Date
): DueRadarDetailGroup<DueRadarPayableGridRow> {
  const search = normalizeSearch(query.search ?? "");
  const pageSizeCap = query.exportAll ? DAILY_RADAR_EXPORT_PAGE_SIZE : 200;
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), pageSizeCap);
  const page = query.page ?? 1;

  let items = scopeMovements.map((m) => ({
    row: {
      ...mapPayableGridRow(m.row, referenceDate),
      scheduledDisplay: formatPayableScheduledDisplay(m.row),
    },
    overdue: m.dayOffset < 0,
  }));

  if (search) {
    items = items.filter((item) =>
      matchesSearch(
        `${item.row.supplier ?? ""} ${item.row.company ?? ""} ${item.row.description ?? ""} ${item.row.document ?? ""}`,
        search
      )
    );
  }

  const summary = summarizeGrid(items.map((i) => ({ amount: i.row.amount, overdue: i.overdue })));
  const sortKey = (query.sortBy as PayableSortKey) || "amount";
  const sortDir = query.sortDirection ?? "desc";
  let rows = items.map((i) => i.row);
  if (PAYABLE_SORT_ACCESSORS[sortKey as PayableSortKey]) {
    rows = sortRows(rows, { key: sortKey as PayableSortKey, direction: sortDir }, PAYABLE_SORT_ACCESSORS);
  }
  const paged = paginate(rows, page, pageSize);
  return { summary, ...paged };
}

export function buildDueRadarQuery(params: {
  baseDate?: string;
  range?: DailyRadarRangeKey;
  day?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: SortDirection;
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
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  return qs.toString();
}

export function parseDueRadarQuery(query: Record<string, unknown>): DueRadarQuery {
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
  const page = Number.parseInt(String(query.page ?? "1"), 10);
  const pageSize = Number.parseInt(String(query.pageSize ?? query.limit ?? "25"), 10);
  return {
    baseDate,
    rangeKey,
    day,
    search,
    sortBy,
    sortDirection,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 25,
  };
}

export function buildFinanceArDueRadar(
  rows: FinanceCashFlowArRow[],
  query: DueRadarQuery,
  referenceDate: Date = new Date()
): DueRadarPayload {
  const baseDate = startOfLocalDay(query.baseDate);
  const movements = collectArDueRadarMovements(rows, baseDate);
  const ranges = DAILY_RADAR_RANGES.map((def) => summarizeRangeFromMovements(movements, def, baseDate));

  const payload: DueRadarPayload = {
    mode: "receivable",
    baseDate: toIsoDate(baseDate),
    ranges,
  };

  const rangeDef = findRangeDef(query.rangeKey);
  if (rangeDef) {
    payload.selectedRange = {
      key: rangeDef.key,
      days: buildDaysForRange(movements, rangeDef, baseDate),
    };

    let scopeMovements = movements.filter((m) => matchesRange(m.dayOffset, rangeDef));
    let level: "range" | "day" = "range";
    let dateIso: string | null = null;
    if (query.day) {
      const parsedDay = parseIsoDate(query.day);
      if (parsedDay) {
        const dayKey = toIsoDate(parsedDay);
        scopeMovements = scopeMovements.filter((m) => toIsoDate(m.operationalDate) === dayKey);
        level = "day";
        dateIso = dayKey;
      }
    }

    const receivables = buildArScopedDetail(scopeMovements, query, referenceDate);
    payload.selectedDetail = {
      level,
      rangeKey: rangeDef.key,
      rangeLabel: rangeDef.label,
      date: dateIso,
      totalAmount: receivables.summary.total,
      receivables,
    };
  }

  return payload;
}

export function buildFinanceApDueRadar(
  rows: FinanceCashFlowApRow[],
  query: DueRadarQuery,
  referenceDate: Date = new Date()
): DueRadarPayload {
  const baseDate = startOfLocalDay(query.baseDate);
  const movements = collectApDueRadarMovements(rows, baseDate);
  const ranges = DAILY_RADAR_RANGES.map((def) => summarizeRangeFromMovements(movements, def, baseDate));

  const payload: DueRadarPayload = {
    mode: "payable",
    baseDate: toIsoDate(baseDate),
    ranges,
  };

  const rangeDef = findRangeDef(query.rangeKey);
  if (rangeDef) {
    payload.selectedRange = {
      key: rangeDef.key,
      days: buildDaysForRange(movements, rangeDef, baseDate),
    };

    let scopeMovements = movements.filter((m) => matchesRange(m.dayOffset, rangeDef));
    let level: "range" | "day" = "range";
    let dateIso: string | null = null;
    if (query.day) {
      const parsedDay = parseIsoDate(query.day);
      if (parsedDay) {
        const dayKey = toIsoDate(parsedDay);
        scopeMovements = scopeMovements.filter((m) => toIsoDate(m.operationalDate) === dayKey);
        level = "day";
        dateIso = dayKey;
      }
    }

    const payables = buildApScopedDetail(scopeMovements, query, referenceDate);
    payload.selectedDetail = {
      level,
      rangeKey: rangeDef.key,
      rangeLabel: rangeDef.label,
      date: dateIso,
      totalAmount: payables.summary.total,
      payables,
    };
  }

  return payload;
}

export { dailyRadarDayCardLabel, toggleSortState, DAILY_RADAR_EXPORT_PAGE_SIZE, type SortState, type SortDirection };
