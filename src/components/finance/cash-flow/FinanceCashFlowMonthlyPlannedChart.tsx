import React from "react";
import type { FinanceCashFlowExecutiveMonthlyRow } from "@/src/lib/financeCashFlowExecutiveSummary";
import {
  buildExecutiveMonthlyPlannedChartRows,
  executiveMonthlyTimelineHasChartData,
} from "@/src/lib/financeCashFlowExecutiveChart";
import { FINANCE_CF_HELP_MONTHLY_CHART } from "@/src/lib/financeCashFlowBlockHelp";
import { FinanceCashFlowChartShell } from "@/src/components/finance/cash-flow/FinanceCashFlowChartShell";
import {
  FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT,
  FinanceCashFlowPlannedChart,
} from "@/src/components/finance/FinanceCashFlowPlannedChart";

export function FinanceCashFlowMonthlyPlannedChart({
  year,
  rows,
}: {
  year: number;
  rows: FinanceCashFlowExecutiveMonthlyRow[];
}) {
  const data = buildExecutiveMonthlyPlannedChartRows(rows);
  const empty = rows.length === 0 || !executiveMonthlyTimelineHasChartData(rows);

  return (
    <FinanceCashFlowChartShell
      testId="cash-flow-monthly-planned-chart"
      title={`Fluxo de caixa planejado — ${year}`}
      subtitle="Saldo líquido mensal e acumulado calculados por vencimento de contas a receber e contas a pagar."
      help={FINANCE_CF_HELP_MONTHLY_CHART}
      empty={empty}
      emptyDescription="Sem dados para montar o fluxo planejado do período filtrado."
      chartHeight={FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT}
    >
      <FinanceCashFlowPlannedChart
        data={data}
        height={FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT}
        showValueLabels
        showLineValueLabels
      />
    </FinanceCashFlowChartShell>
  );
}
