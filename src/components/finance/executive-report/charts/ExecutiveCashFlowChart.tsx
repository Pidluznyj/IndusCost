import React from "react";
import { useExecutiveReportPdfMode } from "@/src/components/finance/executive-report/ExecutiveReportPrintContext";
import { ExecutiveChartShell, EXECUTIVE_CHART_HEIGHT } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";
import {
  FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT,
  FinanceCashFlowPlannedChart,
} from "@/src/components/finance/FinanceCashFlowPlannedChart";
import type { ExecutiveCashFlowChartRow } from "@/src/lib/financeExecutiveReportPresentation";
import { mapExecutiveCashFlowRowsToPlannedChart } from "@/src/lib/financeCashFlowExecutiveChart";
import { EXECUTIVE_CHART_PRINT_HEIGHT_PX } from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export const EXECUTIVE_CASH_FLOW_PLANNED_SUBTITLE =
  "Saldo líquido mensal e acumulado calculados por vencimento de contas a receber e contas a pagar.";

export function ExecutiveCashFlowChart({
  year,
  rows,
  empty,
  scenarioText,
  title,
  subtitle,
}: {
  year: number;
  rows: ExecutiveCashFlowChartRow[];
  empty?: boolean;
  scenarioText?: string;
  title?: string;
  subtitle?: string;
}) {
  const data = mapExecutiveCashFlowRowsToPlannedChart(rows);
  const pdfMode = useExecutiveReportPdfMode();
  const chartHeight = pdfMode
    ? EXECUTIVE_CHART_PRINT_HEIGHT_PX
    : Math.max(EXECUTIVE_CHART_HEIGHT, FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT);

  return (
    <ExecutiveChartShell
      title={title ?? `Fluxo de caixa planejado — ${year}`}
      subtitle={subtitle ?? EXECUTIVE_CASH_FLOW_PLANNED_SUBTITLE}
      empty={empty ?? rows.length === 0}
      testId="executive-cash-flow-chart"
      height={chartHeight}
      scenarioText={scenarioText}
    >
      <FinanceCashFlowPlannedChart
        data={data}
        height={chartHeight}
        showValueLabels
        showLineValueLabels={false}
        presentation="executive"
        testId="executive-cash-flow-planned-chart"
      />
    </ExecutiveChartShell>
  );
}
