import type { Prisma } from "@prisma/client";
import {
  buildFinanceArDataQualitySummary,
  createFinanceArDataQualityAccumulator,
  financeArDataQualityAlertsLegacy,
  trackFinanceArDataQualityRow,
} from "./financeAccountsReceivableDataQuality.js";
import { buildCustomerSuggestedAction } from "./financeAccountsReceivableActions.js";
import { deduplicateFinanceArRows } from "./financeAccountsReceivableDeduplication.js";
import {
  isFinanceArExcludedFromReports,
  isNomusArStaleForReports,
  mergeFinanceArPrismaWhereWithSyncCutoff,
  resolveEffectiveNomusArReportSyncCutoff,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import { isFinanceArGhostTitle, isFinanceInternalGroupPerson } from "./financeInternalGroupExclusions.js";
import type { FinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import { buildFinanceArHorizonSummary } from "./financeHorizonAggregation.js";

export type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type FinanceArTitleStatus =
  | "open"
  | "overdue"
  | "dueToday"
  | "upcoming"
  | "settled"
  | "suspended"
  | "all";

export type FinanceArInvoiceIssuedFilter = "all" | "yes" | "no";

export type FinanceArDashboardFilters = {
  companyName?: string;
  personName?: string;
  personCnpj?: string;
  status: FinanceArTitleStatus;
  year?: number;
  month?: number;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  paymentMethodName?: string;
  bankAccountName?: string;
  invoiceIssued?: FinanceArInvoiceIssuedFilter;
};

export class FinanceArFilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceArFilterParseError";
  }
}

export type FinanceArDashboardRow = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendCollection: boolean | null;
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

export type FinanceArAgingBucketKey = (typeof AGING_BUCKET_DEFS)[number]["key"];

const SCHEDULE_BUCKET_DEFS = [
  { key: "today", label: "Hoje", fromDays: 0, toDays: 0 },
  { key: "next7", label: "Próximos 7 dias", fromDays: 1, toDays: 7 },
  { key: "next15", label: "Próximos 15 dias", fromDays: 8, toDays: 15 },
  { key: "next30", label: "Próximos 30 dias", fromDays: 16, toDays: 30 },
  { key: "next60", label: "Próximos 60 dias", fromDays: 31, toDays: 60 },
  { key: "next90", label: "Próximos 90 dias", fromDays: 61, toDays: 90 },
] as const;

export type FinanceArScheduleBucketKey = (typeof SCHEDULE_BUCKET_DEFS)[number]["key"];

export function decimalFieldToNumber(value: Prisma.Decimal | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "object" && "toNumber" in value ? value.toNumber() : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapPrismaRowToFinanceArDashboardRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description?: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: Prisma.Decimal | null;
  amountReceived: Prisma.Decimal | null;
  balanceReceivable: Prisma.Decimal | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendCollection: boolean | null;
  status?: boolean | null;
  syncedAt: Date;
}): FinanceArDashboardRow {
  return {
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description ?? null,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    amountReceivable: decimalFieldToNumber(row.amountReceivable),
    amountReceived: decimalFieldToNumber(row.amountReceived),
    balanceReceivable: decimalFieldToNumber(row.balanceReceivable),
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    suspendCollection: row.suspendCollection,
    nomusStatus: row.status ?? null,
    syncedAt: row.syncedAt,
  };
}

function assignScheduleBucketKey(daysFromToday: number): FinanceArScheduleBucketKey | null {
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

export function resolveFinanceArCustomerKey(
  row: Pick<FinanceArDashboardRow, "personCnpj" | "personName" | "externalId">
): string {
  const cnpj = row.personCnpj?.trim();
  if (cnpj) return `cnpj:${cnpj}`;
  const name = row.personName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return `id:${row.externalId}`;
}

export function isFinanceArOpen(row: Pick<FinanceArDashboardRow, "balanceReceivable">): boolean {
  return row.balanceReceivable > 0;
}

export function isFinanceArSettled(row: Pick<FinanceArDashboardRow, "balanceReceivable">): boolean {
  return row.balanceReceivable <= 0;
}

/** Título baixado/recebido — saldo zerado, liquidação registrada ou recebimento integral. */
export function isFinanceArReceivedOrSettled(
  row: Pick<
    FinanceArDashboardRow,
    "balanceReceivable" | "settlementDate" | "amountReceivable" | "amountReceived"
  >
): boolean {
  if (row.balanceReceivable <= 0) return true;
  if (row.settlementDate != null) return true;
  if (
    row.amountReceivable > 0 &&
    roundMoney(row.amountReceived) >= roundMoney(row.amountReceivable)
  ) {
    return true;
  }
  return false;
}

/** Título com NF de origem vinculada no Nomus (`idNfe` ou `numeroNotaFiscalOrigem`). */
export function hasFinanceArSourceInvoice(
  row: Pick<FinanceArDashboardRow, "sourceInvoiceId" | "sourceInvoiceNumber">
): boolean {
  return row.sourceInvoiceId != null || Boolean(row.sourceInvoiceNumber?.trim());
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

function parseStatusFilter(value: unknown): FinanceArTitleStatus {
  const normalized = String(value ?? "all")
    .trim()
    .toLowerCase();
  const allowed: FinanceArTitleStatus[] = [
    "open",
    "overdue",
    "dueToday",
    "upcoming",
    "settled",
    "suspended",
    "all",
  ];
  return allowed.includes(normalized as FinanceArTitleStatus)
    ? (normalized as FinanceArTitleStatus)
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
  if (!/^\d{4}$/.test(raw)) {
    throw new FinanceArFilterParseError(
      "Ano inválido. Informe um ano com 4 dígitos (ex.: 2026)."
    );
  }
  const year = Number.parseInt(raw, 10);
  if (!Number.isFinite(year) || year < 1000 || year > 9999) {
    throw new FinanceArFilterParseError(
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
    throw new FinanceArFilterParseError("Mês inválido. Informe um valor entre 1 e 12.");
  }
  if (!hasYear) {
    throw new FinanceArFilterParseError("Informe o ano ao filtrar por mês.");
  }
  return month;
}

export function resolveFinanceArDueDateBounds(
  filters: Pick<FinanceArDashboardFilters, "dueDateFrom" | "dueDateTo" | "year" | "month">
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

function parseInvoiceIssuedFilter(value: unknown): FinanceArInvoiceIssuedFilter {
  const raw = parseOptionalQueryString(value);
  if (raw === null) return "all";
  const normalized = raw.toLowerCase();
  if (normalized === "all" || normalized === "todos") return "all";
  if (["yes", "sim", "true", "1", "s"].includes(normalized)) return "yes";
  if (["no", "nao", "não", "false", "0", "n"].includes(normalized)) return "no";
  throw new FinanceArFilterParseError(
    'NF emitida inválida. Use "yes", "no" ou omita para todos.'
  );
}

export function parseFinanceArDashboardFilters(query: Record<string, unknown>): FinanceArDashboardFilters {
  const year = parseYearFilter(query.year);
  const month = parseMonthFilter(query.month, year != null);
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
    invoiceIssued: parseInvoiceIssuedFilter(query.invoiceIssued),
  };
}

export function classifyFinanceArTitle(
  row: FinanceArDashboardRow,
  today: Date
): Exclude<FinanceArTitleStatus, "all"> | "unknown" {
  if (row.suspendCollection === true && !isFinanceArReceivedOrSettled(row)) return "suspended";
  if (isFinanceArReceivedOrSettled(row)) return "settled";
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

function assignAgingBucketKey(dueDate: Date, today: Date): FinanceArAgingBucketKey {
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

function pushFinanceArPrismaContains(
  and: Prisma.NomusAccountsReceivableWhereInput[],
  field: "companyName" | "personName" | "personCnpj" | "paymentMethodName" | "bankAccountName",
  value: string | undefined
) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  and.push({ [field]: { contains: trimmed, mode: "insensitive" } });
}

function financeArNotSuspendedClause(): Prisma.NomusAccountsReceivableWhereInput {
  return { OR: [{ suspendCollection: false }, { suspendCollection: null }] };
}

/** Pré-filtro seguro no banco — complementa `filterFinanceArRows` em memória. */
export function buildFinanceArPrismaWhere(
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): Prisma.NomusAccountsReceivableWhereInput {
  const and: Prisma.NomusAccountsReceivableWhereInput[] = [];
  const { from, toExclusive, empty } = resolveFinanceArDueDateBounds(filters);
  if (empty) return { externalId: -1 };
  if (from != null || toExclusive != null) {
    const dueDate: Prisma.DateTimeNullableFilter = {};
    if (from != null) dueDate.gte = from;
    if (toExclusive != null) dueDate.lt = toExclusive;
    and.push({ dueDate });
  }

  pushFinanceArPrismaContains(and, "companyName", filters.companyName);
  pushFinanceArPrismaContains(and, "personName", filters.personName);
  pushFinanceArPrismaContains(and, "personCnpj", filters.personCnpj);
  pushFinanceArPrismaContains(and, "paymentMethodName", filters.paymentMethodName);
  pushFinanceArPrismaContains(and, "bankAccountName", filters.bankAccountName);

  const openStatuses = new Set<FinanceArTitleStatus>([
    "open",
    "overdue",
    "dueToday",
    "upcoming",
    "suspended",
  ]);
  if (openStatuses.has(filters.status)) {
    and.push({ balanceReceivable: { gt: 0 } });
  } else if (filters.status === "settled") {
    and.push({ OR: [{ balanceReceivable: { lte: 0 } }, { balanceReceivable: null }] });
  }

  if (filters.status === "suspended") {
    and.push({ suspendCollection: true });
  }

  const today = startOfLocalDay(referenceDate);
  const tomorrow = startOfLocalDay(addLocalDays(referenceDate, 1));
  if (filters.status === "overdue") {
    and.push(financeArNotSuspendedClause());
    and.push({ dueDate: { lt: today } });
  } else if (filters.status === "dueToday") {
    and.push(financeArNotSuspendedClause());
    and.push({ dueDate: { gte: today, lt: tomorrow } });
  } else if (filters.status === "upcoming") {
    and.push(financeArNotSuspendedClause());
    and.push({ dueDate: { gte: tomorrow } });
  }

  const invoiceFilter = filters.invoiceIssued ?? "all";
  if (invoiceFilter === "yes") {
    and.push({
      OR: [
        { sourceInvoiceId: { not: null } },
        {
          AND: [
            { sourceInvoiceNumber: { not: null } },
            { NOT: { sourceInvoiceNumber: "" } },
          ],
        },
      ],
    });
  } else if (invoiceFilter === "no") {
    and.push({
      AND: [
        { sourceInvoiceId: null },
        { OR: [{ sourceInvoiceNumber: null }, { sourceInvoiceNumber: "" }] },
      ],
    });
  }

  return mergeFinanceArPrismaWhereWithSyncCutoff(
    and.length > 0 ? { AND: and } : {},
    syncCutoff
  );
}

export function matchesFinanceArDashboardFilters(
  row: FinanceArDashboardRow,
  filters: FinanceArDashboardFilters,
  referenceDate: Date
): boolean {
  const today = startOfLocalDay(referenceDate);
  const companyFilter = normalizeFilterText(filters.companyName);
  const personFilter = normalizeFilterText(filters.personName);
  const cnpjFilter = normalizeFilterText(filters.personCnpj);
  const paymentFilter = normalizeFilterText(filters.paymentMethodName);
  const bankFilter = normalizeFilterText(filters.bankAccountName);

  if (!textMatchesFilter(row.companyName, companyFilter)) return false;
  if (!textMatchesFilter(row.personName, personFilter)) return false;
  if (!textMatchesFilter(row.personCnpj, cnpjFilter)) return false;
  if (!textMatchesFilter(row.paymentMethodName, paymentFilter)) return false;
  if (!textMatchesFilter(row.bankAccountName, bankFilter)) return false;

  const { from: dueFrom, toExclusive: dueToExclusive } =
    resolveFinanceArDueDateBounds(filters);

  if (dueFrom && (!row.dueDate || startOfLocalDay(row.dueDate).getTime() < dueFrom.getTime())) {
    return false;
  }
  if (
    dueToExclusive &&
    (!row.dueDate || startOfLocalDay(row.dueDate).getTime() >= dueToExclusive.getTime())
  ) {
    return false;
  }

  const invoiceFilter = filters.invoiceIssued ?? "all";
  if (invoiceFilter !== "all") {
    const hasInvoice = hasFinanceArSourceInvoice(row);
    if (invoiceFilter === "yes" && !hasInvoice) return false;
    if (invoiceFilter === "no" && hasInvoice) return false;
  }

  if (filters.status === "all") return true;
  const status = classifyFinanceArTitle(row, today);
  if (filters.status === "open") return !isFinanceArReceivedOrSettled(row);
  if (filters.status === "settled") return isFinanceArReceivedOrSettled(row);
  if (filters.status === "suspended") return status === "suspended";
  return status === filters.status;
}

export function countFinanceArSanitizationInScope(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): Pick<
  FinanceDataSanitization,
  | "ignoredInternalGroupReceivables"
  | "ignoredGhostReceivables"
  | "ignoredStaleReceivables"
  | "supersededPreInvoiceReceivables"
  | "supersededPreInvoiceAmount"
> {
  const { empty } = resolveFinanceArDueDateBounds(filters);
  if (empty) {
    return {
      ignoredInternalGroupReceivables: 0,
      ignoredGhostReceivables: 0,
      ignoredStaleReceivables: 0,
      supersededPreInvoiceReceivables: 0,
      supersededPreInvoiceAmount: 0,
    };
  }

  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  let ignoredInternalGroupReceivables = 0;
  let ignoredGhostReceivables = 0;
  let ignoredStaleReceivables = 0;
  const preDedup: FinanceArDashboardRow[] = [];

  for (const row of rows) {
    if (!matchesFinanceArDashboardFilters(row, filters, referenceDate)) continue;
    if (
      isFinanceInternalGroupPerson({
        personName: row.personName,
        personCnpj: row.personCnpj,
      })
    ) {
      ignoredInternalGroupReceivables += 1;
    } else if (isFinanceArGhostTitle(row)) {
      ignoredGhostReceivables += 1;
    } else if (isNomusArStaleForReports(row, effectiveCutoff)) {
      ignoredStaleReceivables += 1;
    } else {
      preDedup.push(row);
    }
  }

  const deduped = deduplicateFinanceArRows(preDedup);
  return {
    ignoredInternalGroupReceivables,
    ignoredGhostReceivables,
    ignoredStaleReceivables,
    supersededPreInvoiceReceivables: deduped.supersededPreInvoiceCount,
    supersededPreInvoiceAmount: deduped.supersededPreInvoiceAmount,
  };
}

export function filterFinanceArRows(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArDashboardRow[] {
  const { empty } = resolveFinanceArDueDateBounds(filters);
  if (empty) return [];

  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  const matched = rows.filter(
    (row) =>
      matchesFinanceArDashboardFilters(row, filters, referenceDate) &&
      !isFinanceArExcludedFromReports(row, effectiveCutoff)
  );
  return deduplicateFinanceArRows(matched).rows;
}

/** Fonte única de AR gerencial para dashboards (stale, grupo interno, fantasma, dedup). */
export function filterFinanceArManagementReportRows(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArDashboardRow[] {
  return filterFinanceArRows(rows, filters, referenceDate, syncCutoff);
}

export function buildFinanceAccountsReceivableDashboard(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters = { status: "all" },
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
) {
  const filteredRows = filterFinanceArRows(rows, filters, referenceDate, syncCutoff);
  const today = startOfLocalDay(referenceDate);
  const in7Days = endOfLocalDay(addLocalDays(today, 7));
  const in30Days = endOfLocalDay(addLocalDays(today, 30));
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = endOfLocalDay(
    new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)
  );

  let openTitlesCount = 0;
  let settledTitlesCount = 0;
  let totalAmountReceivable = 0;
  let totalReceivedAmount = 0;
  let totalOpenAmount = 0;
  let overdueAmount = 0;
  let dueTodayAmount = 0;
  let upcomingAmount = 0;
  let dueNext7DaysAmount = 0;
  let dueNext30DaysAmount = 0;
  let receivedThisMonthAmount = 0;
  let lastSyncAt: Date | null = null;
  let overdueOver30DaysAmount = 0;
  let overdueOver30DaysCount = 0;
  let avgDaysOverdueTotalWeightedDays = 0;
  let avgDaysOverdueTotalBalance = 0;

  let openWithInvoiceCount = 0;
  let openWithoutInvoiceCount = 0;
  let openWithInvoiceAmount = 0;
  let openWithoutInvoiceAmount = 0;
  let overdueWithInvoiceAmount = 0;
  let overdueWithoutInvoiceAmount = 0;

  const overdueCustomers = new Set<string>();

  const agingAcc = new Map<
    FinanceArAgingBucketKey,
    { amount: number; count: number; customers: Set<string> }
  >();
  for (const def of AGING_BUCKET_DEFS) {
    agingAcc.set(def.key, { amount: 0, count: 0, customers: new Set() });
  }

  type ScheduleClientAcc = { personName: string | null; personCnpj: string | null; amount: number };
  const scheduleAcc = new Map<
    FinanceArScheduleBucketKey,
    {
      amount: number;
      count: number;
      customers: Set<string>;
      topClients: Map<string, ScheduleClientAcc>;
    }
  >();
  for (const def of SCHEDULE_BUCKET_DEFS) {
    scheduleAcc.set(def.key, { amount: 0, count: 0, customers: new Set(), topClients: new Map() });
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
      receivedThisMonthAmount: number;
      titlesCount: number;
      customers: Set<string>;
    }
  >();

  const dataQualityAcc = createFinanceArDataQualityAccumulator();

  for (const row of filteredRows) {
    if (lastSyncAt == null || row.syncedAt > lastSyncAt) lastSyncAt = row.syncedAt;
    totalAmountReceivable += row.amountReceivable;
    totalReceivedAmount += row.amountReceived;

    trackFinanceArDataQualityRow(dataQualityAcc, row, today);

    if (
      row.settlementDate &&
      row.settlementDate.getTime() >= monthStart.getTime() &&
      row.settlementDate.getTime() <= monthEnd.getTime()
    ) {
      receivedThisMonthAmount += row.amountReceived;
      const companyName = row.companyName?.trim() || "Sem empresa";
      const company =
        companyAcc.get(companyName) ??
        ({
          companyName,
          openAmount: 0,
          overdueAmount: 0,
          upcomingAmount: 0,
          receivedThisMonthAmount: 0,
          titlesCount: 0,
          customers: new Set<string>(),
        } as {
          companyName: string;
          openAmount: number;
          overdueAmount: number;
          upcomingAmount: number;
          receivedThisMonthAmount: number;
          titlesCount: number;
          customers: Set<string>;
        });
      companyAcc.set(companyName, {
        ...company,
        receivedThisMonthAmount: company.receivedThisMonthAmount + row.amountReceived,
      });
    }

    if (isFinanceArReceivedOrSettled(row)) {
      settledTitlesCount += 1;
      continue;
    }

    openTitlesCount += 1;
    const balance = row.balanceReceivable;
    totalOpenAmount += balance;

    const hasInvoice = hasFinanceArSourceInvoice(row);
    if (hasInvoice) {
      openWithInvoiceCount += 1;
      openWithInvoiceAmount += balance;
    } else {
      openWithoutInvoiceCount += 1;
      openWithoutInvoiceAmount += balance;
    }

    const status = classifyFinanceArTitle(row, today);
    const customerKey = resolveFinanceArCustomerKey(row);

    if (status === "overdue") {
      overdueAmount += balance;
      overdueCustomers.add(customerKey);
      if (hasInvoice) overdueWithInvoiceAmount += balance;
      else overdueWithoutInvoiceAmount += balance;
      const daysO = computeDaysOverdue(row.dueDate, today);
      if (daysO > 30) {
        overdueOver30DaysAmount += balance;
        overdueOver30DaysCount += 1;
      }
      if (daysO > 0 && balance > 0) {
        avgDaysOverdueTotalWeightedDays += daysO * balance;
        avgDaysOverdueTotalBalance += balance;
      }
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
      bucket.customers.add(customerKey);

      const dueDay = startOfLocalDay(row.dueDate);
      const daysFromToday = Math.floor((dueDay.getTime() - today.getTime()) / MS_PER_DAY);
      if (daysFromToday >= 0) {
        const scheduleKey = assignScheduleBucketKey(daysFromToday);
        if (scheduleKey) {
          const sched = scheduleAcc.get(scheduleKey)!;
          sched.amount += balance;
          sched.count += 1;
          sched.customers.add(customerKey);
          const clientKey = customerKey;
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
      debtorAcc.get(customerKey) ??
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
    debtorAcc.set(customerKey, {
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
      hasSuspendedOpen: debtor.hasSuspendedOpen || row.suspendCollection === true,
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
        receivedThisMonthAmount: 0,
        titlesCount: 0,
        customers: new Set<string>(),
      } as const);
    companyAcc.set(companyName, {
      companyName,
      openAmount: company.openAmount + balance,
      overdueAmount: company.overdueAmount + (status === "overdue" ? balance : 0),
      upcomingAmount:
        company.upcomingAmount + (status === "upcoming" || status === "dueToday" ? balance : 0),
      receivedThisMonthAmount: company.receivedThisMonthAmount,
      titlesCount: company.titlesCount + 1,
      customers: new Set([...company.customers, customerKey]),
    });
  }

  const delinquencyRate = safeRatio(overdueAmount, totalOpenAmount);
  const avgDaysOverdue =
    avgDaysOverdueTotalBalance > 0
      ? roundMoney(avgDaysOverdueTotalWeightedDays / avgDaysOverdueTotalBalance)
      : null;

  const agingBuckets = AGING_BUCKET_DEFS.map((def) => {
    const bucket = agingAcc.get(def.key)!;
    return {
      key: def.key,
      label: def.label,
      amount: roundMoney(bucket.amount),
      count: bucket.count,
      customersCount: bucket.customers.size,
      percentOfOpenAmount: roundMoney(safeRatio(bucket.amount, totalOpenAmount) * 100),
    };
  });

  const topDebtors = [...debtorAcc.values()]
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
      delinquencyRate: roundMoney(safeRatio(row.overdueAmount, row.openAmount) * 100),
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
      customersCount: bucket.customers.size,
      topClients,
    };
  });

  const customerRanking = [...debtorAcc.values()]
    .sort((a, b) => b.totalOpenAmount - a.totalOpenAmount)
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
      suggestedAction: buildCustomerSuggestedAction({
        maxDaysOverdue: debtor.maxDaysOverdue,
        hasSuspendedOpen: debtor.hasSuspendedOpen,
        overdueAmount: debtor.overdueAmount,
      }),
    }));

  const companySummary = [...companyAcc.values()]
    .sort((a, b) => b.openAmount - a.openAmount)
    .map((row) => ({
      companyName: row.companyName,
      openAmount: roundMoney(row.openAmount),
      overdueAmount: roundMoney(row.overdueAmount),
      upcomingAmount: roundMoney(row.upcomingAmount),
      receivedThisMonthAmount: roundMoney(row.receivedThisMonthAmount),
      titlesCount: row.titlesCount,
      customersCount: row.customers.size,
      delinquencyRate: roundMoney(safeRatio(row.overdueAmount, row.openAmount) * 100),
    }));

  const criticalTitles = filteredRows
    .filter((row) => !isFinanceArReceivedOrSettled(row))
    .map((row) => {
      const calculatedStatus = classifyFinanceArTitle(row, today);
      return {
        externalId: row.externalId,
        companyName: row.companyName,
        personName: row.personName,
        personCnpj: row.personCnpj,
        dueDate: row.dueDate?.toISOString() ?? null,
        amountReceivable: roundMoney(row.amountReceivable),
        amountReceived: roundMoney(row.amountReceived),
        balanceReceivable: roundMoney(row.balanceReceivable),
        paymentMethodName: row.paymentMethodName,
        bankAccountName: row.bankAccountName,
        sourceInvoiceId: row.sourceInvoiceId,
        sourceInvoiceNumber: row.sourceInvoiceNumber,
        suspendCollection: row.suspendCollection,
        calculatedStatus,
        daysOverdue: computeDaysOverdue(row.dueDate, today),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceReceivable - a.balanceReceivable)
    .slice(0, 20);

  return {
    generatedAt: referenceDate.toISOString(),
    referenceDate: today.toISOString(),
    filtersApplied: filters,
    source: "NomusAccountsReceivable (read-only local sync)",
    cards: {
      totalRecords: filteredRows.length,
      totalAmountReceivable: roundMoney(totalAmountReceivable),
      totalReceivedAmount: roundMoney(totalReceivedAmount),
      openTitlesCount,
      settledTitlesCount,
      totalOpenAmount: roundMoney(totalOpenAmount),
      openWithInvoiceCount,
      openWithoutInvoiceCount,
      openWithInvoiceAmount: roundMoney(openWithInvoiceAmount),
      openWithoutInvoiceAmount: roundMoney(openWithoutInvoiceAmount),
      overdueWithInvoiceAmount: roundMoney(overdueWithInvoiceAmount),
      overdueWithoutInvoiceAmount: roundMoney(overdueWithoutInvoiceAmount),
      preInvoiceShareOfOpenPercent: roundMoney(
        safeRatio(openWithoutInvoiceAmount, totalOpenAmount) * 100
      ),
      overdueAmount: roundMoney(overdueAmount),
      dueTodayAmount: roundMoney(dueTodayAmount),
      upcomingAmount: roundMoney(upcomingAmount),
      dueNext7DaysAmount: roundMoney(dueNext7DaysAmount),
      dueNext30DaysAmount: roundMoney(dueNext30DaysAmount),
      receivedThisMonthAmount: roundMoney(receivedThisMonthAmount),
      delinquencyRate: roundMoney(delinquencyRate * 100),
      overdueCustomersCount: overdueCustomers.size,
      lastSyncAt: lastSyncAt?.toISOString() ?? null,
      overdueOver30DaysAmount: roundMoney(overdueOver30DaysAmount),
      overdueOver30DaysCount,
      avgDaysOverdue,
    },
    agingBuckets,
    topDebtors,
    monthlyDueSchedule,
    paymentMethodSummary,
    companySummary,
    scheduleBuckets,
    customerRanking,
    criticalTitles,
    dataQualityAlerts: financeArDataQualityAlertsLegacy(dataQualityAcc),
    dataQualitySummary: buildFinanceArDataQualitySummary(dataQualityAcc),
    dataSanitization: {
      ...countFinanceArSanitizationInScope(rows, filters, referenceDate, syncCutoff),
      ignoredInternalGroupPayables: 0,
      ignoredPurchaseOrderAgendaPayables: 0,
    },
    financialHorizon: buildFinanceArHorizonSummary(rows, filters, referenceDate, syncCutoff),
  };
}
