import type { Prisma } from "@prisma/client";
import {
  buildOfficialCashFlowArApDashboardBundle,
  resolveOfficialCashFlowSources,
} from "./financeCashFlowRulesAdapter.js";
import {
  countFinanceArSanitizationInScope,
  decimalFieldToNumber,
  filterFinanceArRows,
  mapPrismaRowToFinanceArDashboardRow,
  parseFinanceArDashboardFilters,
  roundMoney,
  safeRatio,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
  type FinanceArInvoiceIssuedFilter,
  FinanceArFilterParseError,
} from "./financeAccountsReceivableDashboard.js";
import {
  resolveFinanceApOpenAmount,
  resolveFinanceApRealizedAmount,
} from "./financeAccountsPayableRules.js";
import {
  countFinanceApSanitizationInScope,
  filterFinanceApManagementReportRows,
  filterFinanceApRows,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
  FinanceApFilterParseError,
} from "./financeAccountsPayableDashboard.js";
import { mergeFinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import {
  DEFAULT_FINANCE_MANAGEMENT_SCOPE,
  parseFinanceManagementScope,
  type FinanceManagementScope,
} from "./financeInternalGroupExclusions.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type {
  FinanceCashFlowCriticalMovement,
  FinanceCashFlowDashboardFiltersApplied,
  FinanceCashFlowDashboardPayload,
  FinanceCashFlowDateBase,
  FinanceCashFlowMonthlyPoint,
  FinanceCashFlowPartySummary,
  FinanceCashFlowStatusFilter,
  FinanceCashFlowViewMode,
} from "./financeCashFlowDashboardTypes.js";
import {
  buildFinanceCashFlowDataset,
  isFinanceCashFlowArOpenRow,
  type FinanceCashFlowDataset,
} from "./financeCashFlowDataset.js";
import {
  buildCashFlowExecutiveReading,
  buildNetCashPositionMetrics,
  resolveMonthlyNetStatus,
} from "./financeCashFlowIntelligence.js";
import {
  buildCashFlowForecast,
  buildCashFlowOperationalRecommendations,
  buildConservativeScenario,
  buildScenarioChartPoints,
  buildStressScenario,
} from "./financeCashFlowForecast.js";
import {
  buildFinanceCashFlowCalendar,
  buildCashFlowDailyCalendarFromMovements,
} from "./financeCashFlowCalendar.js";
import {
  buildCashFlowExecutiveInsights,
  buildCashHealthScore,
  cashFlowCfoMetricsAreFinite,
} from "./financeCashFlowCfoDiagnostics.js";
import {
  buildCashFlowExecutiveYtdReading,
  buildFinanceCashFlowExecutiveYtd,
  buildYtdDashboardFilters,
  executiveYtdMetricsAreFinite,
} from "./financeCashFlowExecutiveYtd.js";
import {
  buildFinanceCashFlowExecutiveSummary,
  executiveSummaryMetricsAreFinite,
} from "./financeCashFlowExecutiveSummary.js";
import {
  buildCashFlowReconciliation,
  cashFlowViewModeSlices,
  computeCashFlowLedgerPeriodTotals,
  portfolioTotalsFromDatasetBlocks,
  resolveCashFlowArAmount,
  resolveCashFlowApAmount,
  resolveCashFlowArMovementDate,
  resolveCashFlowApMovementDate,
  shouldIncludeCashFlowArMovement,
  shouldIncludeCashFlowApMovement,
} from "./financeCashFlowLedger.js";
import {
  filterCashFlowArRowsScoped,
  filterCashFlowApRowsScoped,
} from "./financeCashFlowRowFilters.js";

export class FinanceCashFlowFilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceCashFlowFilterParseError";
  }
}

export type FinanceCashFlowDashboardFilters = {
  year?: number;
  month?: number;
  companyName?: string;
  viewMode: FinanceCashFlowViewMode;
  dateBase: FinanceCashFlowDateBase;
  status: FinanceCashFlowStatusFilter;
  customerName?: string;
  supplierName?: string;
  personCnpj?: string;
  paymentMethodName?: string;
  bankAccountName?: string;
  invoiceIssued?: FinanceArInvoiceIssuedFilter;
  /** Padrão: company — inclui AP a fornecedores do grupo na visão por empresa. */
  cashFlowScope?: FinanceManagementScope;
  /** Mês exibido no calendário quando filtro global é anual (Mês = Todos). */
  calendarDisplayMonth?: number;
};

export type FinanceCashFlowArRow = FinanceArDashboardRow & {
  competenceDate?: Date | null;
};

export type FinanceCashFlowApRow = FinanceApDashboardRow & {
  competenceDate?: Date | null;
};

export const FINANCE_CASH_FLOW_AR_SELECT = {
  externalId: true,
  companyName: true,
  personName: true,
  personCnpj: true,
  description: true,
  dueDate: true,
  settlementDate: true,
  competenceDate: true,
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

export const FINANCE_CASH_FLOW_AP_SELECT = {
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
  competenceDate: true,
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

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

function parseOptionalQueryString(value: unknown): string | null {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseYearFilter(value: unknown): number | undefined {
  const raw = parseOptionalQueryString(value);
  if (raw === null) return undefined;
  if (!/^\d{4}$/.test(raw)) {
    throw new FinanceCashFlowFilterParseError(
      "Ano inválido. Informe um ano com 4 dígitos (ex.: 2026)."
    );
  }
  const year = Number.parseInt(raw, 10);
  if (!Number.isFinite(year) || year < 1000 || year > 9999) {
    throw new FinanceCashFlowFilterParseError("Ano inválido.");
  }
  return year;
}

function parseMonthFilter(value: unknown, hasYear: boolean): number | undefined {
  const raw = parseOptionalQueryString(value);
  if (raw === null) return undefined;
  const month = Number.parseInt(raw, 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new FinanceCashFlowFilterParseError("Mês inválido. Informe um valor entre 1 e 12.");
  }
  if (!hasYear) {
    throw new FinanceCashFlowFilterParseError("Informe o ano ao filtrar por mês.");
  }
  return month;
}

function parseViewMode(value: unknown): FinanceCashFlowViewMode {
  const raw = String(value ?? "projected").trim().toLowerCase();
  if (raw === "projected" || raw === "realized" || raw === "combined") return raw;
  throw new FinanceCashFlowFilterParseError(
    "Visão inválida. Use projected, realized ou combined."
  );
}

function parseDateBase(value: unknown): FinanceCashFlowDateBase {
  const raw = String(value ?? "due").trim().toLowerCase();
  if (raw === "due" || raw === "settlement" || raw === "issue") return raw;
  throw new FinanceCashFlowFilterParseError(
    "Data base inválida. Use due, settlement ou issue."
  );
}

function parseCashFlowStatus(value: unknown): FinanceCashFlowStatusFilter {
  const raw = String(value ?? "all").trim().toLowerCase();
  const allowed: FinanceCashFlowStatusFilter[] = ["all", "open", "settled", "overdue"];
  return allowed.includes(raw as FinanceCashFlowStatusFilter)
    ? (raw as FinanceCashFlowStatusFilter)
    : "all";
}

function parseInvoiceIssued(value: unknown): FinanceArInvoiceIssuedFilter | undefined {
  const raw = String(value ?? "all").trim().toLowerCase();
  if (raw === "all") return undefined;
  if (raw === "yes" || raw === "no") return raw;
  throw new FinanceCashFlowFilterParseError("NF emitida inválida. Use all, yes ou no.");
}

export function parseFinanceCashFlowDashboardFilters(
  query: Record<string, unknown>
): FinanceCashFlowDashboardFilters {
  const year = parseYearFilter(query.year);
  const month = parseMonthFilter(query.month, year != null);
  const calendarDisplayMonth = parseMonthFilter(query.calendarDisplayMonth, true);
  return {
    year,
    month,
    calendarDisplayMonth: month == null ? calendarDisplayMonth : undefined,
    companyName: parseOptionalQueryString(query.companyName) ?? undefined,
    viewMode: parseViewMode(query.viewMode),
    dateBase: parseDateBase(query.dateBase),
    status: parseCashFlowStatus(query.status),
    customerName: parseOptionalQueryString(query.customerName) ?? undefined,
    supplierName: parseOptionalQueryString(query.supplierName) ?? undefined,
    personCnpj: parseOptionalQueryString(query.personCnpj) ?? undefined,
    paymentMethodName: parseOptionalQueryString(query.paymentMethodName) ?? undefined,
    bankAccountName: parseOptionalQueryString(query.bankAccountName) ?? undefined,
    invoiceIssued: parseInvoiceIssued(query.invoiceIssued),
    cashFlowScope: parseFinanceManagementScope(query.cashFlowScope),
  };
}

function hasFinanceCashFlowPeriodFilter(filters: FinanceCashFlowDashboardFilters): boolean {
  return filters.year != null || filters.month != null;
}

export function isFinanceCashFlowPeriodAllQuery(query: Record<string, unknown>): boolean {
  const raw = query.period;
  if (raw == null || raw === "") return false;
  return String(raw).trim().toLowerCase() === "all";
}

/** Período padrão (ano corrente) quando a requisição não fixa escopo nem pede todos os anos. */
export function resolveFinanceCashFlowFiltersForLoad(
  query: Record<string, unknown>,
  filters: FinanceCashFlowDashboardFilters,
  referenceDate = new Date()
): FinanceCashFlowDashboardFilters {
  if (isFinanceCashFlowPeriodAllQuery(query) || hasFinanceCashFlowPeriodFilter(filters)) {
    return filters;
  }
  return { ...filters, year: referenceDate.getFullYear() };
}

export function mapPrismaRowToFinanceCashFlowArRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description?: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  competenceDate: Date | null;
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
}): FinanceCashFlowArRow {
  return {
    ...mapPrismaRowToFinanceArDashboardRow(row),
    competenceDate: row.competenceDate,
  };
}

export function mapPrismaRowToFinanceCashFlowApRow(row: {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description?: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  competenceDate: Date | null;
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
}): FinanceCashFlowApRow {
  return {
    ...mapPrismaRowToFinanceApDashboardRow(row),
    competenceDate: row.competenceDate,
  };
}

export function toArLoadFilters(cf: FinanceCashFlowDashboardFilters): FinanceArDashboardFilters {
  const status =
    cf.status === "open"
      ? "open"
      : cf.status === "settled"
        ? "settled"
        : cf.status === "overdue"
          ? "overdue"
          : "all";
  return {
    companyName: cf.companyName,
    personName: cf.customerName,
    personCnpj: cf.personCnpj,
    status,
    year: cf.year,
    month: cf.month,
    paymentMethodName: cf.paymentMethodName,
    bankAccountName: cf.bankAccountName,
    invoiceIssued: cf.invoiceIssued,
  };
}

export function toApLoadFilters(cf: FinanceCashFlowDashboardFilters): FinanceApDashboardFilters {
  const status =
    cf.status === "open"
      ? "open"
      : cf.status === "settled"
        ? "settled"
        : cf.status === "overdue"
          ? "overdue"
          : "all";
  return {
    companyName: cf.companyName,
    personName: cf.supplierName,
    personCnpj: cf.personCnpj,
    status,
    year: cf.year,
    month: cf.month,
    paymentMethodName: cf.paymentMethodName,
    bankAccountName: cf.bankAccountName,
    managementScope: cf.cashFlowScope ?? DEFAULT_FINANCE_MANAGEMENT_SCOPE,
  };
}

/** Filtros AR equivalentes ao portfólio do Fluxo (sem recorte de mês/ano). */
export function toCashFlowPortfolioArFilters(
  cfFilters: FinanceCashFlowDashboardFilters
): FinanceArDashboardFilters {
  const base = toArLoadFilters(cfFilters);
  return {
    ...base,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
}

/** Filtros AP equivalentes ao portfólio do Fluxo (sem recorte de mês/ano). */
export function toCashFlowPortfolioApFilters(
  cfFilters: FinanceCashFlowDashboardFilters
): FinanceApDashboardFilters {
  const base = toApLoadFilters(cfFilters);
  return {
    ...base,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
}

export function filterCashFlowArRows(
  rows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceCashFlowArRow[] {
  return filterCashFlowArRowsScoped(rows, filters, toArLoadFilters(filters), referenceDate, syncCutoff);
}

export function filterCashFlowApRows(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  return filterCashFlowApRowsScoped(rows, filters, toApLoadFilters(filters), referenceDate, syncCutoff);
}

type MonthBucket = {
  inflow: number;
  outflow: number;
  inflowCount: number;
  outflowCount: number;
};

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

function getYearMonth(date: Date): { year: number; month: number } {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function isFutureMonth(
  year: number,
  month: number,
  anchorYear: number,
  anchorMonth: number
): boolean {
  if (year > anchorYear) return true;
  if (year < anchorYear) return false;
  return month > anchorMonth;
}

function buildMonthlyBuckets(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  seriesYear: number,
  referenceDate: Date
): Map<number, MonthBucket> {
  const buckets = new Map<number, MonthBucket>();
  for (let m = 1; m <= 12; m += 1) {
    buckets.set(m, { inflow: 0, outflow: 0, inflowCount: 0, outflowCount: 0 });
  }

  const modes = cashFlowViewModeSlices(filters.viewMode);

  for (const slice of modes) {
    for (const row of arRows) {
      if (!shouldIncludeCashFlowArMovement(row, slice)) continue;
      const amount = resolveCashFlowArAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowArMovementDate(row, slice, filters.dateBase);
      if (!date || date.getFullYear() !== seriesYear) continue;
      if (filters.month != null && date.getMonth() + 1 !== filters.month) continue;
      const bucket = buckets.get(date.getMonth() + 1);
      if (!bucket) continue;
      bucket.inflow += amount;
      bucket.inflowCount += 1;
    }

    for (const row of apRows) {
      if (!shouldIncludeCashFlowApMovement(row, slice)) continue;
      const amount = resolveCashFlowApAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowApMovementDate(row, slice, filters.dateBase);
      if (!date || date.getFullYear() !== seriesYear) continue;
      if (filters.month != null && date.getMonth() + 1 !== filters.month) continue;
      const bucket = buckets.get(date.getMonth() + 1);
      if (!bucket) continue;
      bucket.outflow += amount;
      bucket.outflowCount += 1;
    }
  }

  return buckets;
}

export function buildFinanceCashFlowMonthlySeries(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowMonthlyPoint[] {
  const seriesYear = filters.year ?? referenceDate.getFullYear();
  const anchorMonth = referenceDate.getMonth() + 1;
  const buckets = buildMonthlyBuckets(arRows, apRows, filters, seriesYear, referenceDate);
  const nullFutureRealized = filters.viewMode === "realized";

  let accumulated = 0;
  const points: FinanceCashFlowMonthlyPoint[] = [];

  for (let m = 1; m <= 12; m += 1) {
    const bucket = buckets.get(m)!;
    const future =
      nullFutureRealized &&
      isFutureMonth(seriesYear, m, seriesYear, anchorMonth);

    if (future) {
      points.push({
        year: seriesYear,
        month: m,
        monthLabel: MONTH_LABELS[m - 1]!,
        inflowAmount: null,
        outflowAmount: null,
        netFlowAmount: null,
        accumulatedBalance: null,
        status: null,
        inflowCount: 0,
        outflowCount: 0,
      });
      continue;
    }

    const inflow = roundMoney(bucket.inflow);
    const outflow = roundMoney(bucket.outflow);
    const net = roundMoney(inflow - outflow);
    accumulated = roundMoney(accumulated + net);

    points.push({
      year: seriesYear,
      month: m,
      monthLabel: MONTH_LABELS[m - 1]!,
      inflowAmount: inflow,
      outflowAmount: outflow,
      netFlowAmount: net,
      accumulatedBalance: accumulated,
      status: resolveMonthlyNetStatus(net),
      inflowCount: bucket.inflowCount,
      outflowCount: bucket.outflowCount,
    });
  }

  return points;
}

function sumPeriodAmounts(
  series: FinanceCashFlowMonthlyPoint[],
  monthFilter?: number
): { inflow: number; outflow: number; net: number; accumulated: number; negativeMonths: number } {
  let inflow = 0;
  let outflow = 0;
  let accumulated = 0;
  let negativeMonths = 0;

  for (const p of series) {
    if (monthFilter != null && p.month !== monthFilter) continue;
    if (p.inflowAmount == null || p.outflowAmount == null || p.netFlowAmount == null) continue;
    inflow += p.inflowAmount;
    outflow += p.outflowAmount;
    accumulated = p.accumulatedBalance ?? accumulated;
    if (p.netFlowAmount < 0) negativeMonths += 1;
  }

  return {
    inflow: roundMoney(inflow),
    outflow: roundMoney(outflow),
    net: roundMoney(inflow - outflow),
    accumulated: roundMoney(accumulated),
    negativeMonths,
  };
}

export function buildFinanceCashFlowDashboard(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date = new Date(),
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowDashboardPayload {
  const arFilters = toArLoadFilters(filters);
  const apFilters = toApLoadFilters(filters);
  const dataset = buildFinanceCashFlowDataset(
    arRows,
    apRows,
    filters,
    arFilters,
    apFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  return buildFinanceCashFlowDashboardFromDataset(dataset, arRows, apRows, filters, referenceDate, arSyncCutoff, apSyncCutoff);
}

export function buildFinanceCashFlowDashboardFromDataset(
  dataset: FinanceCashFlowDataset,
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date = new Date(),
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowDashboardPayload {
  const filteredAr = dataset.arRowsSanitized;
  const filteredAp = dataset.apRowsSanitized;
  const { blocks } = dataset;
  const monthlySeries = buildFinanceCashFlowMonthlySeries(
    filteredAr,
    filteredAp,
    filters,
    referenceDate
  );
  const period = sumPeriodAmounts(monthlySeries, filters.month);

  let lastSync: Date | null = null;
  for (const row of [...filteredAr, ...filteredAp]) {
    if (lastSync == null || row.syncedAt > lastSync) lastSync = row.syncedAt;
  }

  const totalReceivableRounded = blocks.totalReceivableOpen;
  const totalPayableRounded = blocks.totalPayableOpen;
  const overdueReceivable = blocks.overdueReceivableAmount;
  const overduePayable = blocks.overduePayableAmount;
  const netPosition = buildNetCashPositionMetrics(totalReceivableRounded, totalPayableRounded);
  const topCustomers = blocks.topReceivableCustomers;
  const topSuppliers = blocks.topPayableSuppliers;
  const critical = {
    largestInflows: blocks.largestExpectedInflows,
    largestOutflows: blocks.largestExpectedOutflows,
    overdueReceivables: blocks.overdueReceivables,
    overduePayables: blocks.overduePayables,
  };

  const filtersApplied: FinanceCashFlowDashboardFiltersApplied = {
    year: filters.year,
    month: filters.month,
    companyName: filters.companyName,
    viewMode: filters.viewMode,
    dateBase: filters.dateBase,
    status: filters.status,
    customerName: filters.customerName,
    supplierName: filters.supplierName,
    personCnpj: filters.personCnpj,
    paymentMethodName: filters.paymentMethodName,
    bankAccountName: filters.bankAccountName,
    invoiceIssued: filters.invoiceIssued,
    cashFlowScope: filters.cashFlowScope ?? DEFAULT_FINANCE_MANAGEMENT_SCOPE,
  };

  const cashForecast = buildCashFlowForecast(filteredAr, filteredAp, filters, referenceDate);
  const conservativeScenario = buildConservativeScenario(
    filteredAr,
    filteredAp,
    filters,
    referenceDate,
    cashForecast.horizons.next12Months
  );
  const stressScenario = buildStressScenario(filteredAr, filteredAp, filters, referenceDate);
  const scenarioChartPoints = buildScenarioChartPoints(
    cashForecast.monthlyPoints,
    conservativeScenario.monthlyPoints,
    stressScenario.monthlyPoints
  );
  const operationalRecommendations = buildCashFlowOperationalRecommendations({
    cards: {
      netCashPositionAbs: netPosition.netCashPositionAbs,
      netCashPositionStatus: netPosition.netCashPositionStatus,
      cashNeedAmount: netPosition.cashNeedAmount,
    },
    cashForecast,
    conservativeScenario,
    overdueReceivables: critical.overdueReceivables,
    overduePayables: critical.overduePayables,
    topSupplier: topSuppliers[0],
  });

  const dataSanitization = mergeFinanceDataSanitization(
    countFinanceArSanitizationInScope(arRows, toArLoadFilters(filters), referenceDate, arSyncCutoff),
    countFinanceApSanitizationInScope(apRows, toApLoadFilters(filters), referenceDate, apSyncCutoff)
  );

  const partialPayload = {
    generatedAt: new Date().toISOString(),
    referenceDate: referenceDate.toISOString(),
    filtersApplied,
    dataSanitization,
    sources: resolveOfficialCashFlowSources(),
    cards: {
      totalReceivableOpen: totalReceivableRounded,
      totalPayableOpen: totalPayableRounded,
      inflowAmount: period.inflow,
      outflowAmount: period.outflow,
      netFlowAmount: period.net,
      accumulatedBalance: period.accumulated,
      overdueCashImpact: roundMoney(overdueReceivable + overduePayable),
      overdueReceivableAmount: roundMoney(overdueReceivable),
      overduePayableAmount: roundMoney(overduePayable),
      outflowToInflowPercent:
        period.inflow > 0 ? roundMoney(safeRatio(period.outflow, period.inflow) * 100) : null,
      negativeBalanceMonthsCount: period.negativeMonths,
      netCashPosition: netPosition.netCashPosition,
      netCashPositionStatus: netPosition.netCashPositionStatus,
      netCashPositionAbs: netPosition.netCashPositionAbs,
      netCashPositionLabel: netPosition.netCashPositionLabel,
      cashCoverageRatio: netPosition.cashCoverageRatio,
      cashNeedAmount: netPosition.cashNeedAmount,
      cashNeedLabel: netPosition.cashNeedLabel,
      arRecords: filteredAr.length,
      apRecords: filteredAp.length,
      lastSyncAt: lastSync?.toISOString() ?? null,
      hasInitialBankBalance: false as const,
    },
    cashForecast,
    conservativeScenario,
    stressScenario,
    scenarioChartPoints,
    operationalRecommendations,
    topCustomers,
    topSuppliers,
    largestProjectedInflows: critical.largestInflows,
    largestProjectedOutflows: critical.largestOutflows,
    overdueReceivables: critical.overdueReceivables,
    overduePayables: critical.overduePayables,
    monthlySeries,
  };

  const ytdFilters = buildYtdDashboardFilters(filters, referenceDate);
  const ytdAr = filterCashFlowArRows(arRows, ytdFilters, referenceDate, arSyncCutoff);
  const ytdAp = filterCashFlowApRows(apRows, ytdFilters, referenceDate, apSyncCutoff);
  const ytdMonthlySeries = buildFinanceCashFlowMonthlySeries(
    ytdAr,
    ytdAp,
    ytdFilters,
    referenceDate
  );
  const executiveYtd = buildFinanceCashFlowExecutiveYtd(
    ytdAr,
    ytdAp,
    ytdMonthlySeries,
    arRows,
    filters,
    referenceDate
  );
  const executiveYtdReading = buildCashFlowExecutiveYtdReading(executiveYtd);
  const executiveSummary = buildFinanceCashFlowExecutiveSummary(
    arRows,
    apRows,
    filters,
    referenceDate,
    {
      inflowAmount: period.inflow,
      outflowAmount: period.outflow,
      netFlowAmount: period.net,
      accumulatedBalance: period.accumulated,
    },
    arSyncCutoff,
    apSyncCutoff
  );

  const cashHealthScore = buildCashHealthScore(partialPayload);
  const executiveInsights = buildCashFlowExecutiveInsights(
    partialPayload,
    filteredAr,
    filteredAp,
    referenceDate
  );
  const calendar = buildFinanceCashFlowCalendar(
    filteredAr,
    filteredAp,
    filters,
    referenceDate,
    { monthlySeries, executiveMonthlyTimeline: executiveSummary.monthlyTimeline }
  );
  const dailyCalendar = buildCashFlowDailyCalendarFromMovements(
    filteredAr,
    filteredAp,
    filters,
    referenceDate
  );

  const officialDash = buildOfficialCashFlowArApDashboardBundle({
    arRows,
    apRows,
    filters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff,
  });
  const arDashPortfolio = officialDash.arPortfolio;
  const apDashPortfolio = officialDash.apPortfolio;
  const arDashPeriod = officialDash.arPeriod;
  const apDashPeriod = officialDash.apPeriod;
  const ledgerPeriod = computeCashFlowLedgerPeriodTotals(
    filteredAr,
    filteredAp,
    filters,
    referenceDate
  );
  const portfolio = portfolioTotalsFromDatasetBlocks(blocks);
  const apPaidInScope = filteredAp.reduce(
    (sum, row) => sum + resolveFinanceApRealizedAmount(row),
    0
  );
  const openReceivableWithoutDueDate = dataset.arPortfolioRows.filter(
    (r) => isFinanceCashFlowArOpenRow(r) && !r.dueDate
  ).length;

  const reconciliation = buildCashFlowReconciliation(
    filters,
    {
      inflowAmount: period.inflow,
      outflowAmount: period.outflow,
      netFlowAmount: period.net,
      totalReceivableOpen: totalReceivableRounded,
      totalPayableOpen: totalPayableRounded,
    },
    ledgerPeriod,
    portfolio,
    {
      arDashboardOpenPortfolio: arDashPortfolio.cards.totalOpenAmount,
      arDashboardOpenPeriod: arDashPeriod.cards.totalOpenAmount,
      apDashboardOpenPortfolio: apDashPortfolio.cards.totalOpenAmount,
      apDashboardOpenPeriod: apDashPeriod.cards.totalOpenAmount,
      arDashboardReceived: arDashPeriod.cards.totalReceivedAmount,
      apDashboardPaid: roundMoney(apPaidInScope),
    },
    { openReceivableWithoutDueDate }
  );

  return {
    ...partialPayload,
    executiveSummary,
    executiveYtd,
    executiveYtdReading,
    cashHealthScore,
    executiveInsights,
    dailyCalendar,
    calendar,
    reconciliation,
    executiveReading: buildCashFlowExecutiveReading({
      cards: {
        netCashPosition: netPosition.netCashPosition,
        netCashPositionAbs: netPosition.netCashPositionAbs,
        netCashPositionStatus: netPosition.netCashPositionStatus,
        overdueReceivableAmount: roundMoney(overdueReceivable),
        overduePayableAmount: roundMoney(overduePayable),
        negativeBalanceMonthsCount: period.negativeMonths,
      },
      topCustomer: topCustomers[0],
      topSupplier: topSuppliers[0],
    }),
  };
}

export function financeCashFlowMetricsAreFinite(payload: FinanceCashFlowDashboardPayload): boolean {
  const nums = [
    payload.cards.totalReceivableOpen,
    payload.cards.totalPayableOpen,
    payload.cards.inflowAmount,
    payload.cards.outflowAmount,
    payload.cards.netFlowAmount,
    payload.cards.accumulatedBalance,
    payload.cards.overdueCashImpact,
    payload.cards.netCashPosition,
    payload.cards.netCashPositionAbs,
    payload.cards.cashNeedAmount,
  ];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  if (
    payload.cards.cashCoverageRatio != null &&
    !Number.isFinite(payload.cards.cashCoverageRatio)
  ) {
    return false;
  }
  for (const p of payload.monthlySeries) {
    for (const v of [p.inflowAmount, p.outflowAmount, p.netFlowAmount, p.accumulatedBalance]) {
      if (v != null && !Number.isFinite(v)) return false;
    }
  }
  for (const h of Object.values(payload.cashForecast.horizons)) {
    for (const v of [
      h.projectedInflow,
      h.projectedOutflow,
      h.projectedNet,
      h.projectedAccumulated,
      h.maxCashNeed,
      h.maxCashSurplus,
    ]) {
      if (!Number.isFinite(v)) return false;
    }
  }
  for (const p of payload.cashForecast.monthlyPoints) {
    for (const v of [
      p.projectedInflow,
      p.projectedOutflow,
      p.projectedNet,
      p.projectedAccumulated,
    ]) {
      if (v != null && !Number.isFinite(v)) return false;
    }
  }
  for (const v of [
    payload.conservativeScenario.projectedInflowConservative,
    payload.conservativeScenario.projectedOutflow,
    payload.conservativeScenario.projectedNetConservative,
    payload.conservativeScenario.cashNeedConservative,
    payload.conservativeScenario.deltaVsBase,
    payload.stressScenario.projectedInflowStress,
    payload.stressScenario.projectedOutflowStress,
    payload.stressScenario.projectedNetStress,
    payload.stressScenario.cashNeedStress,
  ]) {
    if (!Number.isFinite(v)) return false;
  }
  for (const p of payload.scenarioChartPoints) {
    for (const v of [p.base, p.conservative, p.stress]) {
      if (v != null && !Number.isFinite(v)) return false;
    }
  }
  if (!Number.isFinite(payload.cashHealthScore.score)) return false;
  for (const v of Object.values(payload.cashHealthScore.components)) {
    if (!Number.isFinite(v)) return false;
  }
  for (const d of payload.dailyCalendar) {
    for (const v of [d.inflowAmount, d.outflowAmount, d.netAmount]) {
      if (!Number.isFinite(v)) return false;
    }
  }
  for (const d of payload.calendar.days) {
    for (const v of [d.inflow, d.outflow, d.net]) {
      if (!Number.isFinite(v)) return false;
    }
    for (const m of d.movements) {
      for (const v of [
        m.amountOriginal,
        m.amountRealized,
        m.balanceOpen,
        m.calendarAmount,
      ]) {
        if (!Number.isFinite(v)) return false;
      }
    }
  }
  for (const w of payload.calendar.weeks) {
    for (const v of [w.inflow, w.outflow, w.net]) {
      if (!Number.isFinite(v)) return false;
    }
  }
  const calRec = payload.calendar.reconciliation;
  for (const v of [
    calRec.calendarReceived,
    calRec.timelineReceived,
    calRec.receivedDiff,
    calRec.calendarOpenReceivable,
    calRec.timelineOpenReceivable,
    calRec.openReceivableDiff,
    calRec.calendarEstimatedInflow,
    calRec.timelineEstimatedInflow,
    calRec.estimatedInflowDiff,
    calRec.calendarPaid,
    calRec.timelinePaid,
    calRec.paidDiff,
    calRec.calendarOpenPayable,
    calRec.timelineOpenPayable,
    calRec.openPayableDiff,
    calRec.calendarEstimatedOutflow,
    calRec.timelineEstimatedOutflow,
    calRec.estimatedOutflowDiff,
    calRec.calendarNet,
    calRec.timelineNet,
    calRec.netDiff,
  ]) {
    if (!Number.isFinite(v)) return false;
  }
  for (const v of [
    payload.calendar.monthSummary.inflow,
    payload.calendar.monthSummary.outflow,
    payload.calendar.monthSummary.net,
    payload.calendar.monthSummary.inflowRealized,
    payload.calendar.monthSummary.inflowOpen,
    payload.calendar.monthSummary.outflowRealized,
    payload.calendar.monthSummary.outflowOpen,
  ]) {
    if (!Number.isFinite(v)) return false;
  }
  if (!cashFlowCfoMetricsAreFinite(payload.executiveInsights)) return false;
  if (!executiveYtdMetricsAreFinite(payload.executiveYtd)) return false;
  if (!executiveSummaryMetricsAreFinite(payload.executiveSummary)) return false;
  const rec = payload.reconciliation;
  for (const v of [
    rec.netCashFlow,
    rec.receivable.cashFlowInflow,
    rec.receivable.ledgerInflow,
    rec.receivable.arDashboardOpen,
    rec.receivable.arDashboardReceived,
    rec.receivable.deltaVsLedger,
    rec.receivable.deltaOpenVsAr,
    rec.payable.cashFlowOutflow,
    rec.payable.ledgerOutflow,
    rec.payable.apDashboardOpen,
    rec.payable.apDashboardPaid,
    rec.payable.deltaVsLedger,
    rec.payable.deltaOpenVsAp,
  ]) {
    if (!Number.isFinite(v)) return false;
  }
  return true;
}

export {
  FinanceArFilterParseError,
  FinanceApFilterParseError,
  parseFinanceArDashboardFilters,
  parseFinanceApDashboardFilters,
};
