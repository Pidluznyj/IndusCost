/**
 * Carrega série mensal por vencimento para simulação HH/HM — somente leitura.
 */
import {
  buildFinanceCostCenterDashboardDefault,
  parseFinanceCostCenterDashboardFilters,
  type FinanceCostCenterDashboardFilters,
} from "./financeCostCenterDashboard.js";
import {
  aggregateCostCenterMonthlyTotals,
  COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE,
  formatCostCenterHhHmSimulationPeriodLabel,
  parseCostCenterHhHmSimulationAveragePeriod,
  resolveCostCenterHhHmSimulationMonthSlots,
  type CostCenterHhHmSimulationAveragePeriod,
  type CostCenterMonthlyExpenseBucket,
  type CostCenterMonthlyExpenseSourceRow,
} from "./financeCostCenterHhHmSimulation.js";

export { parseCostCenterHhHmSimulationAveragePeriod };

export type CostCenterHhHmSimulationMonthlyPayload = {
  costCenterIds: string[];
  averagePeriod: CostCenterHhHmSimulationAveragePeriod;
  periodLabel: string;
  metricsScope: string;
  monthSlots: Array<{ year: number; month: number }>;
  monthlyBuckets: CostCenterMonthlyExpenseBucket[];
};

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

function endOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

export function resolveCostCenterHhHmSimulationDashboardFilters(input: {
  averagePeriod: CostCenterHhHmSimulationAveragePeriod;
  monthSlots: Array<{ year: number; month: number }>;
  baseFilters?: FinanceCostCenterDashboardFilters;
  referenceDate?: Date;
}): FinanceCostCenterDashboardFilters {
  const referenceDate = input.referenceDate ?? new Date();
  const base = input.baseFilters ?? parseFinanceCostCenterDashboardFilters({ status: "all" });

  if (input.averagePeriod === "MANUAL_VALUE" || input.monthSlots.length === 0) {
    return {
      ...base,
      apScope: "all_in_filter",
      year: undefined,
      month: undefined,
    };
  }

  const first = input.monthSlots[0]!;
  const last = input.monthSlots[input.monthSlots.length - 1]!;

  return {
    ...base,
    apScope: "all_in_filter",
    year: undefined,
    month: undefined,
    dueDateFrom: startOfMonth(first.year, first.month),
    dueDateTo: endOfMonth(last.year, last.month),
  };
}

export async function buildCostCenterHhHmSimulationMonthlyPayload(input: {
  costCenterIds: string[];
  averagePeriod: CostCenterHhHmSimulationAveragePeriod;
  query?: Record<string, unknown>;
  referenceDate?: Date;
}): Promise<CostCenterHhHmSimulationMonthlyPayload> {
  const referenceDate = input.referenceDate ?? new Date();
  const baseFilters = parseFinanceCostCenterDashboardFilters(input.query ?? { status: "all" });
  const dueDateFrom = baseFilters.dueDateFrom ?? null;
  const dueDateTo = baseFilters.dueDateTo ?? null;

  const monthSlots = resolveCostCenterHhHmSimulationMonthSlots({
    averagePeriod: input.averagePeriod,
    referenceDate,
    dueDateFrom,
    dueDateTo,
  });

  const periodLabel = formatCostCenterHhHmSimulationPeriodLabel({
    averagePeriod: input.averagePeriod,
    monthSlots,
  });

  if (input.averagePeriod === "MANUAL_VALUE") {
    return {
      costCenterIds: input.costCenterIds,
      averagePeriod: input.averagePeriod,
      periodLabel,
      metricsScope: COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE,
      monthSlots: [],
      monthlyBuckets: [],
    };
  }

  const dashboardFilters = resolveCostCenterHhHmSimulationDashboardFilters({
    averagePeriod: input.averagePeriod,
    monthSlots,
    baseFilters,
    referenceDate,
  });

  const dashboard = await buildFinanceCostCenterDashboardDefault(dashboardFilters, referenceDate);
  const sourceRows: CostCenterMonthlyExpenseSourceRow[] = dashboard.monthlySeries.byCostCenter.map(
    (row) => ({
      year: row.year,
      month: row.month,
      costCenterId: row.costCenterId,
      amount: row.amount,
    })
  );

  const monthlyBuckets = aggregateCostCenterMonthlyTotals({
    rows: sourceRows,
    costCenterIds: input.costCenterIds,
    monthSlots,
  });

  return {
    costCenterIds: input.costCenterIds,
    averagePeriod: input.averagePeriod,
    periodLabel,
    metricsScope: COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE,
    monthSlots,
    monthlyBuckets,
  };
}
