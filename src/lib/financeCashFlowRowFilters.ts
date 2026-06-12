import type { Prisma } from "@prisma/client";
import {
  buildFinanceArPrismaWhere,
  matchesFinanceArDashboardFilters,
  resolveFinanceArDueDateBounds,
  startOfLocalDay,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceApPrismaWhere,
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
  cashFlowViewModeSlices,
  shouldIncludeCashFlowArMovement,
  shouldIncludeCashFlowApMovement,
} from "./financeCashFlowLedger.js";
import { deduplicateFinanceArRows } from "./financeAccountsReceivableDeduplication.js";
import {
  isFinanceApExcludedFromManagement,
  isFinanceArExcludedFromManagement,
} from "./financeInternalGroupExclusions.js";

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

  const modes = cashFlowViewModeSlices(filters.viewMode);
  for (const slice of modes) {
    if (!shouldIncludeCashFlowArMovement(row, slice)) continue;
    const movementDate =
      slice === "realized"
        ? row.settlementDate
        : filters.dateBase === "issue"
          ? row.competenceDate ?? row.dueDate
          : row.dueDate;
    if (dateInBounds(movementDate, from, toExclusive)) return true;
  }
  return false;
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

  const modes = cashFlowViewModeSlices(filters.viewMode);
  for (const slice of modes) {
    if (!shouldIncludeCashFlowApMovement(row, slice)) continue;
    const movementDate =
      slice === "realized"
        ? row.paymentDate ?? row.settlementDate
        : filters.dateBase === "issue"
          ? row.competenceDate ?? row.dueDate
          : row.dueDate;
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

export function filterCashFlowArRowsScoped(
  rows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date
): FinanceCashFlowArRow[] {
  const portfolio = rows.filter(
    (row) =>
      matchesCashFlowArPortfolio(row, arFilters, referenceDate) &&
      !isFinanceArExcludedFromManagement(row)
  );
  const deduped = deduplicateFinanceArRows(portfolio);
  return deduped.rows.filter((row) =>
    matchesCashFlowArPeriodScope(row, filters, referenceDate)
  );
}

export function filterCashFlowApRowsScoped(
  rows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date
): FinanceCashFlowApRow[] {
  return rows.filter(
    (row) =>
      matchesCashFlowApPortfolio(row, apFilters, referenceDate) &&
      !isFinanceApExcludedFromManagement(row) &&
      matchesCashFlowApPeriodScope(row, filters, referenceDate)
  );
}

/** Carrega linhas que podem contribuir ao modo selecionado (vencimento e/ou liquidação). */
export function buildCashFlowArPrismaWhere(
  filters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date = new Date()
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
    referenceDate
  );

  if (filters.viewMode === "projected") {
    return buildFinanceArPrismaWhere(arFilters, referenceDate);
  }

  const periodClauses: Prisma.NomusAccountsReceivableWhereInput[] = [];
  const dueClause: Prisma.NomusAccountsReceivableWhereInput = {};
  const dueFilter: Prisma.DateTimeNullableFilter = {};
  if (from != null) dueFilter.gte = from;
  if (toExclusive != null) dueFilter.lt = toExclusive;
  dueClause.dueDate = dueFilter;
  periodClauses.push(dueClause);

  const settlementClause: Prisma.NomusAccountsReceivableWhereInput = {};
  const settlementFilter: Prisma.DateTimeNullableFilter = {};
  if (from != null) settlementFilter.gte = from;
  if (toExclusive != null) settlementFilter.lt = toExclusive;
  settlementClause.settlementDate = settlementFilter;
  periodClauses.push(settlementClause);

  return {
    AND: [portfolioWhere, { OR: periodClauses }],
  };
}

export function buildCashFlowApPrismaWhere(
  filters: FinanceCashFlowDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date = new Date()
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
  });

  if (filters.viewMode === "projected") {
    return buildFinanceApPrismaWhere(apFilters);
  }

  const periodClauses: Prisma.NomusAccountsPayableWhereInput[] = [];
  const dueFilter: Prisma.DateTimeNullableFilter = {};
  if (from != null) dueFilter.gte = from;
  if (toExclusive != null) dueFilter.lt = toExclusive;
  periodClauses.push({ dueDate: dueFilter });

  const payFilter: Prisma.DateTimeNullableFilter = {};
  if (from != null) payFilter.gte = from;
  if (toExclusive != null) payFilter.lt = toExclusive;
  periodClauses.push({
    OR: [{ paymentDate: payFilter }, { settlementDate: payFilter }],
  });

  return {
    AND: [portfolioWhere, { OR: periodClauses }],
  };
}
