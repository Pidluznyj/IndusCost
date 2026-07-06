import type { FinanceCashFlowExecutiveMonthlyRow } from "@/src/lib/financeCashFlowExecutiveSummary";

/** Linha do gráfico planejado — espelha `FinanceCashFlowExecutiveMonthlyRow` para a UI. */
export type ExecutiveMonthlyPlannedChartRow = {
  name: string;
  received: number;
  receivableOpen: number;
  estimatedInflow: number;
  paid: number;
  payableOpen: number;
  estimatedOutflow: number;
  netBalance: number;
  accumulatedBalance: number;
};

export function executiveMonthlyTimelineHasChartData(
  rows: FinanceCashFlowExecutiveMonthlyRow[]
): boolean {
  return rows.some(
    (row) =>
      row.received !== 0 ||
      row.receivableOpenDue !== 0 ||
      row.paid !== 0 ||
      row.payableOpenDue !== 0 ||
      row.estimatedInflow !== 0 ||
      row.estimatedOutflow !== 0 ||
      row.netFlow !== 0
  );
}

/** Mapeia linhas do Relatório Presidencial para o gráfico planejado compartilhado. */
export function mapExecutiveCashFlowRowsToPlannedChart(
  rows: Array<{
    monthLabel: string;
    inflow: number;
    outflow: number;
    netFlow: number;
    accumulated: number;
  }>
): ExecutiveMonthlyPlannedChartRow[] {
  return rows.map((row) => ({
    name: row.monthLabel,
    received: 0,
    receivableOpen: 0,
    estimatedInflow: row.inflow,
    paid: 0,
    payableOpen: 0,
    estimatedOutflow: row.outflow,
    netBalance: row.netFlow,
    accumulatedBalance: row.accumulated,
  }));
}

/** Mapeia a timeline executiva mensal para o gráfico — sem recálculo financeiro. */
export function buildExecutiveMonthlyPlannedChartRows(
  rows: FinanceCashFlowExecutiveMonthlyRow[]
): ExecutiveMonthlyPlannedChartRow[] {
  return rows.map((row) => ({
    name: row.monthLabel,
    received: row.received,
    receivableOpen: row.receivableOpenDue,
    estimatedInflow: row.estimatedInflow,
    paid: row.paid,
    payableOpen: row.payableOpenDue,
    estimatedOutflow: row.estimatedOutflow,
    netBalance: row.netFlow,
    accumulatedBalance: row.accumulatedNet,
  }));
}
