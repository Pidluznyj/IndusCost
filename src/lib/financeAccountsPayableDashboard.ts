import type { Prisma } from "@prisma/client";
import {
  buildFinanceApDataQualitySummary,
  createFinanceApDataQualityAccumulator,
  financeApDataQualityAlertsLegacy,
  trackFinanceApDataQualityRow,
} from "./financeAccountsPayableDataQuality.js";
import { buildSupplierSuggestedAction } from "./financeAccountsPayableActions.js";
import {
  FINANCE_AP_COMPANY_SUMMARY_LIMIT,
  FINANCE_AP_SUPPLIER_RANKING_LIMIT,
} from "./financeAccountsPayableDashboardTypes.js";

export type FinanceApTitleStatus =
  | "open"
  | "overdue"
  | "dueToday"
  | "upcoming"
  | "settled"
  | "suspended"
  | "all";

export type FinanceApSuspendPaymentFilter = "all" | "yes" | "no";

export type FinanceApDashboardFilters = {
  companyName?: string;
  personName?: string;
  personCnpj?: string;
  status: FinanceApTitleStatus;
  year?: number;
  month?: number;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  paymentMethodName?: string;
  bankAccountName?: string;
  documentQuery?: string;
  suspendPayment?: FinanceApSuspendPaymentFilter;
};

export class FinanceApFilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceApFilterParseError";
  }
}

export type FinanceApDashboardRow = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  amountPayable: number;
  amountPaid: number;
  balancePayable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  documentNumber: string | null;
  suspendPayment: boolean | null;
  nomusStatus: boolean | null;
  syncedAt: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const AGING_BUCKET_DEFS = [
  { key: "upcoming", label: "A vencer" },
  { key: "dueToday", label: "Vence hoje" },
  { key: "overdue1to7", label: "1 a 7 dias vencido" },
  { key: "overdue8to15", label: "8 a 15 dias vencido" },
  { key: "overdue16to30", label: "16 a 30 dias vencido" },
  { key: "overdue31to60", label: "31 a 60 dias vencido" },
  { key: "overdue61to90", label: "61 a 90 dias vencido" },
  { key: "overdue90plus", label: "Acima de 90 dias" },
] as const;

export type FinanceApAgingBucketKey = (typeof AGING_BUCKET_DEFS)[number]["key"];

const SCHEDULE_BUCKET_DEFS = [
  { key: "today", label: "Hoje", fromDays: 0, toDays: 0 },
  { key: "next7", label: "Próximos 7 dias", fromDays: 1, toDays: 7 },
  { key: "next15", label: "Próximos 15 dias", fromDays: 8, toDays: 15 },
  { key: "next30", label: "Próximos 30 dias", fromDays: 16, toDays: 30 },
  { key: "next60", label: "Próximos 60 dias", fromDays: 31, toDays: 60 },
  { key: "next90", label: "Próximos 90 dias", fromDays: 61, toDays: 90 },
] as const;

export type FinanceApScheduleBucketKey = (typeof SCHEDULE_BUCKET_DEFS)[number]["key"];

export function decimalFieldToNumber(value: Prisma.Decimal | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "object" && "toNumber" in value ? value.toNumber() : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapPrismaRowToFinanceApDashboardRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description?: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  paymentDate?: Date | null;
  amountPayable: Prisma.Decimal | null;
  amountPaid: Prisma.Decimal | null;
  balancePayable: Prisma.Decimal | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  documentNumber: string | null;
  suspendPayment: boolean | null;
  status?: boolean | null;
  syncedAt: Date;
}): FinanceApDashboardRow {
  return {
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description ?? null,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    paymentDate: row.paymentDate ?? null,
    amountPayable: decimalFieldToNumber(row.amountPayable),
    amountPaid: decimalFieldToNumber(row.amountPaid),
    balancePayable: decimalFieldToNumber(row.balancePayable),
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    sourceInvoiceId: row.sourceInvoiceId,
    documentNumber: row.documentNumber,
    suspendPayment: row.suspendPayment,
    nomusStatus: row.status ?? null,
    syncedAt: row.syncedAt,
  };
}

function assignScheduleBucketKey(daysFromToday: number): FinanceApScheduleBucketKey | null {
  for (const def of SCHEDULE_BUCKET_DEFS) {
    if (daysFromToday >= def.fromDays && daysFromToday <= def.toDays) {
      return def.key;
    }
  }
  return null;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function safeRatio(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  const ratio = part / total;
  return Number.isFinite(ratio) ? ratio : 0;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function resolveFinanceApSupplierKey(
  row: Pick<FinanceApDashboardRow, "personCnpj" | "personName" | "externalId">
): string {
  const cnpj = row.personCnpj?.trim();
  if (cnpj) return `cnpj:${cnpj}`;
  const name = row.personName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return `id:${row.externalId}`;
}

export function isFinanceApOpen(row: Pick<FinanceApDashboardRow, "balancePayable">): boolean {
  return row.balancePayable > 0;
}

export function isFinanceApSettled(row: Pick<FinanceApDashboardRow, "balancePayable">): boolean {
  return row.balancePayable <= 0;
}

/** Título com NF de origem vinculada no Nomus (`idNfe` ou `numeroNotaFiscalOrigem`). */
export function hasFinanceApDocument(
  row: Pick<FinanceApDashboardRow, "sourceInvoiceId" | "documentNumber">
): boolean {
  return row.sourceInvoiceId != null || Boolean(row.documentNumber?.trim());
}

function normalizeFilterText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function textMatchesFilter(field: string | null | undefined, filter: string | null): boolean {
  if (!filter) return true;
  return (field ?? "").trim().toLowerCase().includes(filter);
}

function parseIsoDateOnly(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseStatusFilter(value: unknown): FinanceApTitleStatus {
  const normalized = String(value ?? "all")
    .trim()
    .toLowerCase();
  const allowed: FinanceApTitleStatus[] = [
    "open",
    "overdue",
    "dueToday",
    "upcoming",
    "settled",
    "suspended",
    "all",
  ];
  return allowed.includes(normalized as FinanceApTitleStatus)
    ? (normalized as FinanceApTitleStatus)
    : "all";
}

function parseOptionalQueryString(value: unknown): string | null {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseYearFilter(value: unknown): number | undefined {
  const raw = parseOptionalQueryString(value);
  if (raw === null) return undefined;
  if (raw.toLowerCase() === "all") return undefined;
  if (!/^\d{4}$/.test(raw)) {
    throw new FinanceApFilterParseError(
      "Ano inválido. Informe um ano com 4 dígitos (ex.: 2026)."
    );
  }
  const year = Number.parseInt(raw, 10);
  if (!Number.isFinite(year) || year < 1000 || year > 9999) {
    throw new FinanceApFilterParseError(
      "Ano inválido. Informe um ano com 4 dígitos (ex.: 2026)."
    );
  }
  return year;
}

function parseMonthFilter(value: unknown, hasYear: boolean): number | undefined {
  const raw = parseOptionalQueryString(value);
  if (raw === null) return undefined;
  const month = Number.parseInt(raw, 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new FinanceApFilterParseError("Mês inválido. Informe um valor entre 1 e 12.");
  }
  if (!hasYear) {
    throw new FinanceApFilterParseError("Informe o ano ao filtrar por mês.");
  }
  return month;
}

export function resolveFinanceApDueDateBounds(
  filters: Pick<FinanceApDashboardFilters, "dueDateFrom" | "dueDateTo" | "year" | "month">
): { from: Date | null; toExclusive: Date | null; empty: boolean } {
  let from: Date | null = filters.dueDateFrom ? startOfLocalDay(filters.dueDateFrom) : null;
  let toExclusive: Date | null = filters.dueDateTo
    ? startOfLocalDay(addLocalDays(filters.dueDateTo, 1))
    : null;

  if (filters.year != null) {
    let ymFrom = new Date(filters.year, 0, 1, 0, 0, 0, 0);
    let ymToExclusive = new Date(filters.year + 1, 0, 1, 0, 0, 0, 0);
    if (filters.month != null) {
      ymFrom = new Date(filters.year, filters.month - 1, 1, 0, 0, 0, 0);
      ymToExclusive = new Date(filters.year, filters.month, 1, 0, 0, 0, 0);
    }
    from = from ? (from.getTime() > ymFrom.getTime() ? from : ymFrom) : ymFrom;
    toExclusive = toExclusive
      ? toExclusive.getTime() < ymToExclusive.getTime()
        ? toExclusive
        : ymToExclusive
      : ymToExclusive;
  }

  const empty =
    from != null && toExclusive != null && from.getTime() >= toExclusive.getTime();
  return { from, toExclusive, empty };
}

export function hasFinanceApPeriodFilter(
  filters: Pick<FinanceApDashboardFilters, "year" | "month" | "dueDateFrom" | "dueDateTo">
): boolean {
  return (
    filters.year != null ||
    filters.month != null ||
    filters.dueDateFrom != null ||
    filters.dueDateTo != null
  );
}

export function isFinanceApPeriodAllQuery(query: Record<string, unknown>): boolean {
  const raw = query.period;
  if (raw == null || raw === "") return false;
  return String(raw).trim().toLowerCase() === "all";
}

/** Período padrão (ano corrente) quando a requisição não fixa escopo nem pede todos os anos. */
export function resolveFinanceApDashboardFiltersForLoad(
  query: Record<string, unknown>,
  filters: FinanceApDashboardFilters,
  referenceDate = new Date()
): FinanceApDashboardFilters {
  if (isFinanceApPeriodAllQuery(query) || hasFinanceApPeriodFilter(filters)) {
    return filters;
  }
  return { ...filters, year: referenceDate.getFullYear() };
}

function pushFinanceApPrismaContains(
  and: Prisma.NomusAccountsPayableWhereInput[],
  field: "companyName" | "personName" | "personCnpj" | "paymentMethodName" | "bankAccountName",
  value: string | undefined
) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  and.push({ [field]: { contains: trimmed, mode: "insensitive" } });
}

export function buildFinanceApPrismaWhere(
  filters: FinanceApDashboardFilters
): Prisma.NomusAccountsPayableWhereInput {
  const and: Prisma.NomusAccountsPayableWhereInput[] = [];
  const { from, toExclusive, empty } = resolveFinanceApDueDateBounds(filters);
  if (empty) return { externalId: -1 };
  if (from != null || toExclusive != null) {
    const dueDate: Prisma.DateTimeNullableFilter = {};
    if (from != null) dueDate.gte = from;
    if (toExclusive != null) dueDate.lt = toExclusive;
    and.push({ dueDate });
  }

  pushFinanceApPrismaContains(and, "companyName", filters.companyName);
  pushFinanceApPrismaContains(and, "personName", filters.personName);
  pushFinanceApPrismaContains(and, "personCnpj", filters.personCnpj);
  pushFinanceApPrismaContains(and, "paymentMethodName", filters.paymentMethodName);
  pushFinanceApPrismaContains(and, "bankAccountName", filters.bankAccountName);

  const openStatuses = new Set<FinanceApTitleStatus>([
    "open",
    "overdue",
    "dueToday",
    "upcoming",
    "suspended",
  ]);
  if (openStatuses.has(filters.status)) {
    and.push({ balancePayable: { gt: 0 } });
  } else if (filters.status === "settled") {
    and.push({ OR: [{ balancePayable: { lte: 0 } }, { balancePayable: null }] });
  }

  const suspendFilter = filters.suspendPayment ?? "all";
  if (suspendFilter === "yes") {
    and.push({ suspendPayment: true });
  } else if (suspendFilter === "no") {
    and.push({ OR: [{ suspendPayment: false }, { suspendPayment: null }] });
  }

  return and.length > 0 ? { AND: and } : {};
}

function parseSuspendPaymentFilter(value: unknown): FinanceApSuspendPaymentFilter {
  const raw = parseOptionalQueryString(value);
  if (raw === null) return "all";
  const normalized = raw.toLowerCase();
  if (normalized === "all" || normalized === "todos") return "all";
  if (["yes", "sim", "true", "1", "s"].includes(normalized)) return "yes";
  if (["no", "nao", "não", "false", "0", "n"].includes(normalized)) return "no";
  throw new FinanceApFilterParseError(
    'Pagamento suspenso inválido. Use "yes", "no" ou omita para todos.'
  );
}

export function parseFinanceApDashboardFilters(query: Record<string, unknown>): FinanceApDashboardFilters {
  const year = parseYearFilter(query.year);
  const month = parseMonthFilter(query.month, year != null);
  const documentQuery =
    parseOptionalQueryString(query.documentQuery) ??
    parseOptionalQueryString(query.documentNumber) ??
    undefined;
  return {
    companyName: typeof query.companyName === "string" ? query.companyName : undefined,
    personName: typeof query.personName === "string" ? query.personName : undefined,
    personCnpj: typeof query.personCnpj === "string" ? query.personCnpj : undefined,
    status: parseStatusFilter(query.status),
    year,
    month,
    dueDateFrom: parseIsoDateOnly(query.dueDateFrom),
    dueDateTo: parseIsoDateOnly(query.dueDateTo),
    paymentMethodName:
      typeof query.paymentMethodName === "string" ? query.paymentMethodName : undefined,
    bankAccountName: typeof query.bankAccountName === "string" ? query.bankAccountName : undefined,
    documentQuery: documentQuery ?? undefined,
    suspendPayment: parseSuspendPaymentFilter(query.suspendPayment),
  };
}

export function classifyFinanceApTitle(
  row: FinanceApDashboardRow,
  today: Date
): Exclude<FinanceApTitleStatus, "all"> | "unknown" {
  if (row.suspendPayment === true && isFinanceApOpen(row)) return "suspended";
  if (isFinanceApSettled(row)) return "settled";
  if (!isFinanceApOpen(row)) return "settled";
  if (!row.dueDate) return "unknown";
  const due = startOfLocalDay(row.dueDate);
  const t = startOfLocalDay(today);
  if (due < t) return "overdue";
  if (due.getTime() === t.getTime()) return "dueToday";
  return "upcoming";
}

export function computeDaysOverdue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  const due = startOfLocalDay(dueDate);
  const t = startOfLocalDay(today);
  if (due >= t) return 0;
  return Math.floor((t.getTime() - due.getTime()) / MS_PER_DAY);
}

function assignAgingBucketKey(dueDate: Date, today: Date): FinanceApAgingBucketKey {
  const due = startOfLocalDay(dueDate);
  const t = startOfLocalDay(today);
  const diffDays = Math.floor((due.getTime() - t.getTime()) / MS_PER_DAY);
  if (diffDays > 0) return "upcoming";
  if (diffDays === 0) return "dueToday";
  const overdueDays = -diffDays;
  if (overdueDays <= 7) return "overdue1to7";
  if (overdueDays <= 15) return "overdue8to15";
  if (overdueDays <= 30) return "overdue16to30";
  if (overdueDays <= 60) return "overdue31to60";
  if (overdueDays <= 90) return "overdue61to90";
  return "overdue90plus";
}

function isDueInRange(dueDate: Date | null, from: Date, to: Date): boolean {
  if (!dueDate) return false;
  const due = startOfLocalDay(dueDate).getTime();
  return due >= from.getTime() && due <= to.getTime();
}

export function filterFinanceApRows(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date = new Date()
): FinanceApDashboardRow[] {
  const today = startOfLocalDay(referenceDate);
  const companyFilter = normalizeFilterText(filters.companyName);
  const personFilter = normalizeFilterText(filters.personName);
  const cnpjFilter = normalizeFilterText(filters.personCnpj);
  const paymentFilter = normalizeFilterText(filters.paymentMethodName);
  const bankFilter = normalizeFilterText(filters.bankAccountName);
  const { from: dueFrom, toExclusive: dueToExclusive, empty } =
    resolveFinanceApDueDateBounds(filters);
  if (empty) return [];

  return rows.filter((row) => {
    if (!textMatchesFilter(row.companyName, companyFilter)) return false;
    if (!textMatchesFilter(row.personName, personFilter)) return false;
    if (!textMatchesFilter(row.personCnpj, cnpjFilter)) return false;
    if (!textMatchesFilter(row.paymentMethodName, paymentFilter)) return false;
    if (!textMatchesFilter(row.bankAccountName, bankFilter)) return false;

    if (dueFrom && (!row.dueDate || startOfLocalDay(row.dueDate).getTime() < dueFrom.getTime())) {
      return false;
    }
    if (
      dueToExclusive &&
      (!row.dueDate || startOfLocalDay(row.dueDate).getTime() >= dueToExclusive.getTime())
    ) {
      return false;
    }

    const documentFilter = normalizeFilterText(filters.documentQuery);
    if (documentFilter) {
      const docText = `${row.documentNumber ?? ""} ${row.sourceInvoiceId ?? ""}`.toLowerCase();
      if (!docText.includes(documentFilter)) return false;
    }

    const suspendFilter = filters.suspendPayment ?? "all";
    if (suspendFilter !== "all") {
      const suspended = row.suspendPayment === true;
      if (suspendFilter === "yes" && !suspended) return false;
      if (suspendFilter === "no" && suspended) return false;
    }

    if (filters.status === "all") return true;
    const status = classifyFinanceApTitle(row, today);
    if (filters.status === "open") return isFinanceApOpen(row);
    if (filters.status === "settled") return isFinanceApSettled(row);
    if (filters.status === "suspended") return status === "suspended";
    return status === filters.status;
  });
}

export function buildFinanceAccountsPayableDashboard(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters = { status: "all" },
  referenceDate: Date = new Date()
) {
  const filteredRows = filterFinanceApRows(rows, filters, referenceDate);
  const today = startOfLocalDay(referenceDate);
  const in7Days = endOfLocalDay(addLocalDays(today, 7));
  const in30Days = endOfLocalDay(addLocalDays(today, 30));
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = endOfLocalDay(
    new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)
  );

  let openTitlesCount = 0;
  let settledTitlesCount = 0;
  let totalOpenAmount = 0;
  let overdueAmount = 0;
  let dueTodayAmount = 0;
  let upcomingAmount = 0;
  let dueNext7DaysAmount = 0;
  let dueNext30DaysAmount = 0;
  let paidThisMonthAmount = 0;
  let lastSyncAt: Date | null = null;

  let totalPayableAmount = 0;

  const overdueSuppliers = new Set<string>();

  const agingAcc = new Map<
    FinanceApAgingBucketKey,
    { amount: number; count: number; suppliers: Set<string> }
  >();
  for (const def of AGING_BUCKET_DEFS) {
    agingAcc.set(def.key, { amount: 0, count: 0, suppliers: new Set() });
  }

  type ScheduleClientAcc = { personName: string | null; personCnpj: string | null; amount: number };
  const scheduleAcc = new Map<
    FinanceApScheduleBucketKey,
    {
      amount: number;
      count: number;
      suppliers: Set<string>;
      topClients: Map<string, ScheduleClientAcc>;
    }
  >();
  for (const def of SCHEDULE_BUCKET_DEFS) {
    scheduleAcc.set(def.key, { amount: 0, count: 0, suppliers: new Set(), topClients: new Map() });
  }

  const debtorAcc = new Map<
    string,
    {
      personName: string | null;
      personCnpj: string | null;
      totalOpenAmount: number;
      overdueAmount: number;
      upcomingAmount: number;
      titlesCount: number;
      oldestOverdueDate: Date | null;
      maxDaysOverdue: number;
      hasSuspendedOpen: boolean;
    }
  >();

  const monthlyAcc = new Map<string, { year: number; month: number; openAmount: number; overdueAmount: number; upcomingAmount: number; titlesCount: number }>();
  const paymentAcc = new Map<
    string,
    { paymentMethodName: string; openAmount: number; overdueAmount: number; titlesCount: number }
  >();
  const companyAcc = new Map<
    string,
    {
      companyName: string;
      openAmount: number;
      overdueAmount: number;
      upcomingAmount: number;
      paidThisMonthAmount: number;
      titlesCount: number;
      suppliers: Set<string>;
    }
  >();

  const dataQualityAcc = createFinanceApDataQualityAccumulator();

  for (const row of filteredRows) {
    if (lastSyncAt == null || row.syncedAt > lastSyncAt) lastSyncAt = row.syncedAt;

    trackFinanceApDataQualityRow(dataQualityAcc, row, today);
    totalPayableAmount += row.amountPayable;

    const paidAt = row.paymentDate ?? row.settlementDate;
    if (paidAt && paidAt.getTime() >= monthStart.getTime() && paidAt.getTime() <= monthEnd.getTime()) {
      paidThisMonthAmount += row.amountPaid;
      const companyName = row.companyName?.trim() || "Sem empresa";
      const company =
        companyAcc.get(companyName) ??
        ({
          companyName,
          openAmount: 0,
          overdueAmount: 0,
          upcomingAmount: 0,
          paidThisMonthAmount: 0,
          titlesCount: 0,
          suppliers: new Set<string>(),
        } as {
          companyName: string;
          openAmount: number;
          overdueAmount: number;
          upcomingAmount: number;
          paidThisMonthAmount: number;
          titlesCount: number;
          suppliers: Set<string>;
        });
      companyAcc.set(companyName, {
        ...company,
        paidThisMonthAmount: company.paidThisMonthAmount + row.amountPaid,
      });
    }

    if (isFinanceApSettled(row)) {
      settledTitlesCount += 1;
      continue;
    }

    openTitlesCount += 1;
    const balance = row.balancePayable;
    totalOpenAmount += balance;

    const status = classifyFinanceApTitle(row, today);
    const supplierKey = resolveFinanceApSupplierKey(row);

    if (status === "overdue") {
      overdueAmount += balance;
      overdueSuppliers.add(supplierKey);
    } else if (status === "dueToday") {
      dueTodayAmount += balance;
    } else if (status === "upcoming") {
      upcomingAmount += balance;
    }

    if (row.dueDate) {
      if (isDueInRange(row.dueDate, today, in7Days)) dueNext7DaysAmount += balance;
      if (isDueInRange(row.dueDate, today, in30Days)) dueNext30DaysAmount += balance;

      const bucketKey = assignAgingBucketKey(row.dueDate, today);
      const bucket = agingAcc.get(bucketKey)!;
      bucket.amount += balance;
      bucket.count += 1;
      bucket.suppliers.add(supplierKey);

      const dueDay = startOfLocalDay(row.dueDate);
      const daysFromToday = Math.floor((dueDay.getTime() - today.getTime()) / MS_PER_DAY);
      if (daysFromToday >= 0) {
        const scheduleKey = assignScheduleBucketKey(daysFromToday);
        if (scheduleKey) {
          const sched = scheduleAcc.get(scheduleKey)!;
          sched.amount += balance;
          sched.count += 1;
          sched.suppliers.add(supplierKey);
          const clientKey = supplierKey;
          const existingClient = sched.topClients.get(clientKey);
          sched.topClients.set(clientKey, {
            personName: existingClient?.personName ?? row.personName,
            personCnpj: existingClient?.personCnpj ?? row.personCnpj,
            amount: (existingClient?.amount ?? 0) + balance,
          });
        }
      }

      const monthKey = `${row.dueDate.getFullYear()}-${row.dueDate.getMonth() + 1}`;
      const monthRow =
        monthlyAcc.get(monthKey) ??
        ({
          year: row.dueDate.getFullYear(),
          month: row.dueDate.getMonth() + 1,
          openAmount: 0,
          overdueAmount: 0,
          upcomingAmount: 0,
          titlesCount: 0,
        } as const);
      const nextMonth = {
        ...monthRow,
        openAmount: monthRow.openAmount + balance,
        titlesCount: monthRow.titlesCount + 1,
        overdueAmount: monthRow.overdueAmount + (status === "overdue" ? balance : 0),
        upcomingAmount:
          monthRow.upcomingAmount + (status === "upcoming" || status === "dueToday" ? balance : 0),
      };
      monthlyAcc.set(monthKey, nextMonth);
    }

    const debtor =
      debtorAcc.get(supplierKey) ??
      ({
        personName: row.personName,
        personCnpj: row.personCnpj,
        totalOpenAmount: 0,
        overdueAmount: 0,
        upcomingAmount: 0,
        titlesCount: 0,
        oldestOverdueDate: null,
        maxDaysOverdue: 0,
        hasSuspendedOpen: false,
      } as const);
    const daysOverdue = computeDaysOverdue(row.dueDate, today);
    debtorAcc.set(supplierKey, {
      personName: debtor.personName ?? row.personName,
      personCnpj: debtor.personCnpj ?? row.personCnpj,
      totalOpenAmount: debtor.totalOpenAmount + balance,
      overdueAmount: debtor.overdueAmount + (status === "overdue" ? balance : 0),
      upcomingAmount:
        debtor.upcomingAmount + (status === "upcoming" || status === "dueToday" ? balance : 0),
      titlesCount: debtor.titlesCount + 1,
      oldestOverdueDate:
        status === "overdue" && row.dueDate
          ? !debtor.oldestOverdueDate || row.dueDate < debtor.oldestOverdueDate
            ? row.dueDate
            : debtor.oldestOverdueDate
          : debtor.oldestOverdueDate,
      maxDaysOverdue: Math.max(debtor.maxDaysOverdue, daysOverdue),
      hasSuspendedOpen: debtor.hasSuspendedOpen || row.suspendPayment === true,
    });

    const paymentName = row.paymentMethodName?.trim() || "Sem forma de pagamento";
    const payment =
      paymentAcc.get(paymentName) ??
      ({ paymentMethodName: paymentName, openAmount: 0, overdueAmount: 0, titlesCount: 0 } as const);
    paymentAcc.set(paymentName, {
      paymentMethodName: paymentName,
      openAmount: payment.openAmount + balance,
      overdueAmount: payment.overdueAmount + (status === "overdue" ? balance : 0),
      titlesCount: payment.titlesCount + 1,
    });

    const companyName = row.companyName?.trim() || "Sem empresa";
    const company =
      companyAcc.get(companyName) ??
      ({
        companyName,
        openAmount: 0,
        overdueAmount: 0,
        upcomingAmount: 0,
        paidThisMonthAmount: 0,
        titlesCount: 0,
        suppliers: new Set<string>(),
      } as const);
    companyAcc.set(companyName, {
      companyName,
      openAmount: company.openAmount + balance,
      overdueAmount: company.overdueAmount + (status === "overdue" ? balance : 0),
      upcomingAmount:
        company.upcomingAmount + (status === "upcoming" || status === "dueToday" ? balance : 0),
      paidThisMonthAmount: company.paidThisMonthAmount,
      titlesCount: company.titlesCount + 1,
      suppliers: new Set([...company.suppliers, supplierKey]),
    });
  }

  const overduePercent = safeRatio(overdueAmount, totalOpenAmount);

  const agingBuckets = AGING_BUCKET_DEFS.map((def) => {
    const bucket = agingAcc.get(def.key)!;
    return {
      key: def.key,
      label: def.label,
      amount: roundMoney(bucket.amount),
      count: bucket.count,
      suppliersCount: bucket.suppliers.size,
      percentOfOpenAmount: roundMoney(safeRatio(bucket.amount, totalOpenAmount) * 100),
    };
  });

  const topSuppliersList = [...debtorAcc.values()]
    .sort((a, b) => b.totalOpenAmount - a.totalOpenAmount)
    .slice(0, 10)
    .map((debtor) => ({
      personName: debtor.personName,
      personCnpj: debtor.personCnpj,
      totalOpenAmount: roundMoney(debtor.totalOpenAmount),
      overdueAmount: roundMoney(debtor.overdueAmount),
      upcomingAmount: roundMoney(debtor.upcomingAmount),
      titlesCount: debtor.titlesCount,
      oldestOverdueDate: debtor.oldestOverdueDate?.toISOString() ?? null,
      maxDaysOverdue: debtor.maxDaysOverdue,
      percentOfPortfolio: roundMoney(safeRatio(debtor.totalOpenAmount, totalOpenAmount) * 100),
    }));

  const monthlyDueSchedule = [...monthlyAcc.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((row) => ({
      year: row.year,
      month: row.month,
      openAmount: roundMoney(row.openAmount),
      overdueAmount: roundMoney(row.overdueAmount),
      upcomingAmount: roundMoney(row.upcomingAmount),
      titlesCount: row.titlesCount,
    }));

  const paymentMethodSummary = [...paymentAcc.values()]
    .sort((a, b) => b.openAmount - a.openAmount)
    .map((row) => ({
      paymentMethodName: row.paymentMethodName,
      openAmount: roundMoney(row.openAmount),
      overdueAmount: roundMoney(row.overdueAmount),
      titlesCount: row.titlesCount,
      averageTicket: roundMoney(row.titlesCount > 0 ? row.openAmount / row.titlesCount : 0),
      overduePercent: roundMoney(safeRatio(row.overdueAmount, row.openAmount) * 100),
    }));

  const scheduleBuckets = SCHEDULE_BUCKET_DEFS.map((def) => {
    const bucket = scheduleAcc.get(def.key)!;
    const topClients = [...bucket.topClients.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((c) => ({
        personName: c.personName,
        personCnpj: c.personCnpj,
        amount: roundMoney(c.amount),
      }));
    return {
      key: def.key,
      label: def.label,
      amount: roundMoney(bucket.amount),
      count: bucket.count,
      suppliersCount: bucket.suppliers.size,
      topClients,
    };
  });

  const supplierRanking = [...debtorAcc.values()]
    .sort((a, b) => b.totalOpenAmount - a.totalOpenAmount)
    .slice(0, FINANCE_AP_SUPPLIER_RANKING_LIMIT)
    .map((debtor) => ({
      personName: debtor.personName,
      personCnpj: debtor.personCnpj,
      totalOpenAmount: roundMoney(debtor.totalOpenAmount),
      overdueAmount: roundMoney(debtor.overdueAmount),
      upcomingAmount: roundMoney(debtor.upcomingAmount),
      titlesCount: debtor.titlesCount,
      oldestOverdueDate: debtor.oldestOverdueDate?.toISOString() ?? null,
      maxDaysOverdue: debtor.maxDaysOverdue,
      percentOfPortfolio: roundMoney(safeRatio(debtor.totalOpenAmount, totalOpenAmount) * 100),
      suggestedAction: buildSupplierSuggestedAction({
        maxDaysOverdue: debtor.maxDaysOverdue,
        hasSuspendedOpen: debtor.hasSuspendedOpen,
        overdueAmount: debtor.overdueAmount,
      }),
    }));

  const companySummary = [...companyAcc.values()]
    .sort((a, b) => b.openAmount - a.openAmount)
    .slice(0, FINANCE_AP_COMPANY_SUMMARY_LIMIT)
    .map((row) => ({
      companyName: row.companyName,
      openAmount: roundMoney(row.openAmount),
      overdueAmount: roundMoney(row.overdueAmount),
      upcomingAmount: roundMoney(row.upcomingAmount),
      paidThisMonthAmount: roundMoney(row.paidThisMonthAmount),
      titlesCount: row.titlesCount,
      suppliersCount: row.suppliers.size,
      overduePercent: roundMoney(safeRatio(row.overdueAmount, row.openAmount) * 100),
    }));

  const criticalTitles = filteredRows
    .filter((row) => isFinanceApOpen(row))
    .map((row) => {
      const calculatedStatus = classifyFinanceApTitle(row, today);
      return {
        externalId: row.externalId,
        companyName: row.companyName,
        personName: row.personName,
        personCnpj: row.personCnpj,
        dueDate: row.dueDate?.toISOString() ?? null,
        amountPayable: roundMoney(row.amountPayable),
        amountPaid: roundMoney(row.amountPaid),
        balancePayable: roundMoney(row.balancePayable),
        paymentMethodName: row.paymentMethodName,
        bankAccountName: row.bankAccountName,
        sourceInvoiceId: row.sourceInvoiceId,
        documentNumber: row.documentNumber,
        suspendPayment: row.suspendPayment,
        calculatedStatus,
        daysOverdue: computeDaysOverdue(row.dueDate, today),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balancePayable - a.balancePayable)
    .slice(0, 20);

  return {
    generatedAt: referenceDate.toISOString(),
    referenceDate: today.toISOString(),
    filtersApplied: filters,
    source: "NomusAccountsPayable (read-only local sync)",
    cards: {
      totalRecords: filteredRows.length,
      totalPayableAmount: roundMoney(totalPayableAmount),
      openTitlesCount,
      settledTitlesCount,
      totalOpenAmount: roundMoney(totalOpenAmount),
      overdueAmount: roundMoney(overdueAmount),
      upcomingAmount: roundMoney(upcomingAmount),
      paidThisMonthAmount: roundMoney(paidThisMonthAmount),
      dueTodayAmount: roundMoney(dueTodayAmount),
      dueNext7DaysAmount: roundMoney(dueNext7DaysAmount),
      dueNext30DaysAmount: roundMoney(dueNext30DaysAmount),
      overdueSuppliersCount: overdueSuppliers.size,
      overduePercent: roundMoney(overduePercent * 100),
      topSupplier: topSuppliersList[0]
        ? {
            personName: topSuppliersList[0].personName,
            personCnpj: topSuppliersList[0].personCnpj,
            totalOpenAmount: topSuppliersList[0].totalOpenAmount,
          }
        : null,
      lastSyncAt: lastSyncAt?.toISOString() ?? null,
    },
    agingBuckets,
    topSuppliers: topSuppliersList,
    monthlyDueSchedule,
    paymentMethodSummary,
    companySummary,
    scheduleBuckets,
    supplierRanking,
    criticalTitles,
    dataQualityAlerts: financeApDataQualityAlertsLegacy(dataQualityAcc),
    dataQualitySummary: buildFinanceApDataQualitySummary(dataQualityAcc),
  };
}
