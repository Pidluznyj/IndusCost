/**
 * Série mensal por centro de custo — gráfico de drilldown do Mapa de Gastos.
 * Motor server: reutiliza monthlySeries.byCostCenter do dashboard oficial.
 * Helpers puros: financeCostCenterMonthlyChart.shared.ts
 */
import {
  buildFinanceCostCenterDashboardDefault,
  type FinanceCostCenterDashboardFilters,
} from "./financeCostCenterDashboard.js";
import {
  buildCostCenterMonthlyChartFilters,
  buildCostCenterMonthlyChartSeries,
  formatCostCenterMonthlyChartPeriodLabel,
  type CostCenterMonthlyChartPayload,
} from "./financeCostCenterMonthlyChart.shared.js";

export {
  COST_CENTER_MONTHLY_CHART_MONTH_LABELS,
  buildCostCenterMonthlyChartFilters,
  buildCostCenterMonthlyChartQuery,
  buildCostCenterMonthlyChartSeries,
  formatCostCenterMonthlyChartPeriodLabel,
  parseCostCenterMonthlyChartCostCenterIds,
  type CostCenterMonthlyChartPayload,
  type CostCenterMonthlyChartPoint,
  type CostCenterMonthlyChartSourceRow,
} from "./financeCostCenterMonthlyChart.shared.js";

export async function buildCostCenterMonthlyChartPayloadDefault(
  filters: FinanceCostCenterDashboardFilters,
  costCenterIds: string[],
  referenceDate: Date = new Date()
): Promise<CostCenterMonthlyChartPayload> {
  if (costCenterIds.length === 0) {
    const year = filters.year ?? referenceDate.getFullYear();
    return {
      year,
      costCenterIds: [],
      series: buildCostCenterMonthlyChartSeries({
        rows: [],
        costCenterIds: [],
        year,
        highlightMonth: filters.month ?? null,
      }),
      hasData: false,
      periodLabel: formatCostCenterMonthlyChartPeriodLabel(year, filters.month),
      metricsScope: "Valores por data de vencimento (Contas a Pagar)",
      highlightMonth: filters.month ?? null,
    };
  }

  const year = filters.year ?? referenceDate.getFullYear();
  const chartFilters = buildCostCenterMonthlyChartFilters(filters);
  const dashboard = await buildFinanceCostCenterDashboardDefault(chartFilters, referenceDate);
  const series = buildCostCenterMonthlyChartSeries({
    rows: dashboard.monthlySeries.byCostCenter,
    costCenterIds,
    year,
    highlightMonth: filters.month ?? null,
  });
  const hasData = series.some(
    (point) => point.paidAmount > 0 || point.openAmount > 0 || point.totalAmount > 0
  );

  return {
    year,
    costCenterIds,
    series,
    hasData,
    periodLabel: formatCostCenterMonthlyChartPeriodLabel(year, filters.month),
    metricsScope: "Valores por data de vencimento (Contas a Pagar)",
    highlightMonth: filters.month ?? null,
  };
}
