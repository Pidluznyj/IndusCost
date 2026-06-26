import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  XAxis,
  YAxis,
} from "recharts";
import type { ExecutiveAnnualFlowChartRow } from "@/src/lib/financeExecutiveReportPresentation";
import { formatExecutiveReportAxisCurrency } from "@/src/lib/financeExecutiveReportPresentation";
import { ExecutiveChartShell } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import { useExecutiveChartFrameDimensions } from "@/src/components/finance/executive-report/charts/executiveChartFrameContext";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_IS_ANIMATION_ACTIVE,
  EXECUTIVE_CHART_LEGEND,
  EXECUTIVE_CHART_MARGIN,
  EXECUTIVE_CHART_X_TICK,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export function ExecutiveReportReceivablesChart({
  title,
  subtitle,
  rows,
  empty,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  rows: ExecutiveAnnualFlowChartRow[];
  empty?: boolean;
  scenarioText?: string;
}) {
  const { width, height } = useExecutiveChartFrameDimensions();
  const data = rows.map((row) => ({
    name: row.monthLabel,
    receivedAmount: row.receivedAmount,
    receivableOpenAmount: row.receivableOpenAmount,
  }));

  return (
    <ExecutiveChartShell
      title={title}
      subtitle={subtitle}
      empty={empty ?? rows.length === 0}
      testId="executive-report-receivables-chart"
      scenarioText={scenarioText}
    >
      <BarChart width={width} height={height} data={data} margin={EXECUTIVE_CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="name" interval={0} tick={EXECUTIVE_CHART_X_TICK} axisLine={false} tickLine={false} />
        <YAxis
          tick={EXECUTIVE_CHART_Y_TICK}
          tickFormatter={formatExecutiveReportAxisCurrency}
          width={EXECUTIVE_CHART_Y_AXIS_WIDTH}
          axisLine={false}
          tickLine={false}
        />
        <Legend wrapperStyle={EXECUTIVE_CHART_LEGEND} />
        <Bar
          dataKey="receivedAmount"
          name="Recebido"
          stackId="ar"
          fill="#15803D"
          maxBarSize={32}
          isAnimationActive={EXECUTIVE_CHART_IS_ANIMATION_ACTIVE}
        >
          <LabelList dataKey="receivedAmount" content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />} />
        </Bar>
        <Bar
          dataKey="receivableOpenAmount"
          name="A receber"
          stackId="ar"
          fill="#86EFAC"
          maxBarSize={32}
          isAnimationActive={EXECUTIVE_CHART_IS_ANIMATION_ACTIVE}
        >
          <LabelList
            dataKey="receivableOpenAmount"
            content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
          />
        </Bar>
      </BarChart>
    </ExecutiveChartShell>
  );
}
