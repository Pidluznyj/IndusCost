import type { Prisma } from "@prisma/client";
import {
  buildFinanceArPrismaWhere,
  isFinanceArAllowedInManagementReport,
  matchesFinanceArDashboardFilters,
  resolveFinanceArDueDateBounds,
  startOfLocalDay,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceApPrismaWhere,
  filterFinanceApManagementReportRows,
  matchesFinanceApDashboardFilters,
  resolveFinanceApDueDateBounds,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  calendarCashFlowMovementSlices,
  resolveCalendarApRealizedMovementDate,
  resolveCashFlowApMovementDate,
  shouldIncludeCalendarApRealizedMovement,
  shouldIncludeCashFlowArMovement,
  shouldIncludeCashFlowApMovement,
  type CashFlowMovementSlice,
} from "./financeCashFlowLedger.js";
import { isFinanceCashFlowArOpenRow } from "./financeCashFlowDataset.js";
import { deduplicateFinanceArRows } from "./financeAccountsReceivableDeduplication.js";
import { buildFinanceCashFlowEffectiveArPortfolio } from "./finance/financeCashFlowEffectiveAr.js";
import type { FinanceArEffectiveOrderContext } from "./finance/financeAccountsReceivableEffectiveTitles.js";
import { suppressInferiorPreNfNomusArRows } from "./finance/financeArOperationalPortfolio.js";
import {
  isFinanceApExcludedFromReports,
  resolveEffectiveNomusApReportSyncCutoff,
  type NomusApReportSyncCutoff,
} from "./financeNomusApReportFreshness.js";
import {
  isFinanceArExcludedFromReports,
  resolveEffectiveNomusArReportSyncCutoff,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";

function dateInBounds(
  date: Date | null | undefined,
  from: Date | null,
  toExclusive: Date | null
): boolean {
  if (!date) return false;
  const d = startOfLocalDay(date).getTime();
  if (from != null && d < from.getTime()) return false;
  if (toExclusive != null && d >= toExclusive.getTime()) return false;
  return true;
}

/** Escopo de período é mais amplo que movimento previsto (carteira/YTD inclui parcialmente baixados). */
function contributesToCashFlowArPeriodScope(
  row: FinanceCashFlowArRow,
  slice: CashFlowMovementSlice
): boolean {
  if (slice === "projected") {
    if (row.suspendCollection) return false;
    if (isFinanceCashFlowArOpenRow(row) && row.balanceReceivable > 0) return true;
    return row.amountReceived > 0;
  }
  return shouldIncludeCashFlowArMovement(row, slice);
}

/** Linha entra no escopo do fluxo se contribui ao modo/ período selecionado. */
export function matchesCashFlowArPeriodScope(
  row: FinanceCashFlowArRow,
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): boolean {
  const { from, toExclusive, empty } = resolveFinanceArDueDateBounds({
    year: filters.year,
    month: filters.month,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  });
  if (empty) return false;

  const modes = calendarCashFlowMovementSlices(filters.viewMode);
  for (const slice of modes) {
    if (!contributesToCashFlowArPeriodScope(row, slice)) continue;
    // Fluxo planejado: sempre aloca pelo vencimento (dueDate).
    if (dateInBounds(row.dueDate ?? null, from, toExclusive)) return true;
  }
  return false;
}

function contributesToCashFlowApPeriodScope(
  row: FinanceCashFlowApRow,
  slice: CashFlowMovementSlice
): boolean {
  if (slice === "realized") {
    return shouldIncludeCalendarApRealizedMovement(row);
  }
  return shouldIncludeCashFlowApMovement(row, slice);
}

export function matchesCashFlowApPeriodScope(
  row: FinanceCashFlowApRow,
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): boolean {
  const { from, toExclusive, empty } = resolveFinanceApDueDateBounds({
    year: filters.year,
    month: filters.month,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  });
  if (empty) return false;

  const modes = calendarCashFlowMovementSlices(filters.viewMode);
  for (const slice of modes) {
    if (!contributesToCashFlowApPeriodScope(row, slice)) continue;
    const movementDate =
      slice === "realized"
        ? resolveCalendarApRealizedMovementDate(row)
        : resolveCashFlowApMovementDate(row, slice, filters.dateBase);
    if (dateInBounds(movementDate, from, toExclusive)) return true;
  }
  return false;
}

function matchesCashFlowArPortfolio(
  row: FinanceCashFlowArRow,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date
): boolean {
  const portfolioFilters: FinanceArDashboardFilters = {
    ...arFilters,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
  return matchesFinanceArDashboardFilters(row, portfolioFilters, referenceDate);
}

function matchesCashFlowApPortfolio(
  row: FinanceCashFlowApRow,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date
): boolean {
  const portfolioFilters: FinanceApDashboardFilters = {
    ...apFilters,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
  return matchesFinanceApDashboardFilters(row, portfolioFilters, referenceDate);
}

export type FinanceCashFlowArFilterOptions = {
  /** Agendas FIN-05 — habilita FIN-08 (mesma regra de Contas a Receber). */
  orderContexts?: FinanceArEffectiveOrderContext[];
};

function applyCashFlowArOperationalPortfolio(
  rows: FinanceCashFlowArRow[],
  referenceDate: Date,
  options?: FinanceCashFlowArFilterOptions
): FinanceCashFlowArRow[] {
  if ((options?.orderContexts?.length ?? 0) > 0) {
    return buildFinanceCashFlowEffectiveArPortfolio({
      rows,
      orderContexts: options!.orderContexts!,
      referenceDate,
    });
  }
  return suppressInferiorPreNfNomusArRows(
    deduplicateFinanceArRows(rows).rows
  ) as FinanceCashFlowArRow[];
}

export function filterCashFlowArPortfolioRows(
  rows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null,
  options?: FinanceCashFlowArFilterOptions
): FinanceCashFlowArRow[] {
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  const portfolio = rows.filter(
    (row) =>
      matchesCashFlowArPortfolio(row, arFilters, referenceDate) &&
      !isFinanceArExcludedFromReports(row, effectiveCutoff) &&
      isFinanceArAllowedInManagementReport(row, referenceDate)
  );
  return applyCashFlowArOperationalPortfolio(portfolio, referenceDate, options);
}

export function filterCashFlowApPortfolioRows(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  return filterFinanceApManagementReportRows(
    rows,
    {
      ...apFilters,
      year: undefined,
      month: undefined,
      dueDateFrom: undefined,
      dueDateTo: undefined,
    },
    referenceDate,
    syncCutoff
  );
}

export function filterCashFlowArRowsScoped(
  rows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null,
  options?: FinanceCashFlowArFilterOptions
): FinanceCashFlowArRow[] {
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  const portfolio = rows.filter(
    (row) =>
      matchesCashFlowArPortfolio(row, arFilters, referenceDate) &&
      !isFinanceArExcludedFromReports(row, effectiveCutoff) &&
      isFinanceArAllowedInManagementReport(row, referenceDate)
  );
  const operational = applyCashFlowArOperationalPortfolio(
    portfolio,
    referenceDate,
    options
  );
  return operational.filter((row) =>
    matchesCashFlowArPeriodScope(row, filters, referenceDate)
  ) as FinanceCashFlowArRow[];
}

export function filterCashFlowApRowsScoped(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowApRow[] {
  const effectiveCutoff = resolveEffectiveNomusApReportSyncCutoff(rows, syncCutoff);
  return rows.filter(
    (row) =>
      matchesCashFlowApPortfolio(row, apFilters, referenceDate) &&
      !isFinanceApExcludedFromReports(row, effectiveCutoff) &&
      matchesCashFlowApPeriodScope(row, filters, referenceDate)
  );
}

/** Carrega linhas que podem contribuir ao modo selecionado (vencimento e/ou liquidação). */
export function buildCashFlowArPrismaWhere(
  filters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): Prisma.NomusAccountsReceivableWhereInput {
  const { from, toExclusive, empty } = resolveFinanceArDueDateBounds({
    year: filters.year,
    month: filters.month,
    dueDateFrom: arFilters.dueDateFrom,
    dueDateTo: arFilters.dueDateTo,
  });
  if (empty) return { externalId: -1 };

  const portfolioWhere = buildFinanceArPrismaWhere(
    { ...arFilters, year: undefined, month: undefined, dueDateFrom: undefined, dueDateTo: undefined },
    referenceDate,
    syncCutoff
  );

  if (filters.viewMode === "projected") {
    return buildFinanceArPrismaWhere(arFilters, referenceDate, syncCutoff);
  }

  const dueClause: Prisma.NomusAccountsReceivableWhereInput = {};
  const dueFilter: Prisma.DateTimeNullableFilter = {};
  if (from != null) dueFilter.gte = from;
  if (toExclusive != null) dueFilter.lt = toExclusive;
  dueClause.dueDate = dueFilter;

  return {
    AND: [portfolioWhere, dueClause],
  };
}

export function buildCashFlowApPrismaWhere(
  filters: FinanceCashFlowDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null
): Prisma.NomusAccountsPayableWhereInput {
  const { from, toExclusive, empty } = resolveFinanceApDueDateBounds({
    year: filters.year,
    month: filters.month,
    dueDateFrom: apFilters.dueDateFrom,
    dueDateTo: apFilters.dueDateTo,
  });
  if (empty) return { externalId: -1 };

  const portfolioWhere = buildFinanceApPrismaWhere({
    ...apFilters,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  }, syncCutoff);

  if (filters.viewMode === "projected") {
    return buildFinanceApPrismaWhere(apFilters, syncCutoff);
  }

  const dueFilter: Prisma.DateTimeNullableFilter = {};
  if (from != null) dueFilter.gte = from;
  if (toExclusive != null) dueFilter.lt = toExclusive;
  const dueClause = { dueDate: dueFilter } as Prisma.NomusAccountsPayableWhereInput;

  return {
    AND: [portfolioWhere, dueClause],
  };
}
