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
import type { ExecutiveAnnualPayablesChartRow } from "@/src/lib/financeExecutiveReportPresentation";
import { formatExecutiveReportAxisCurrency } from "@/src/lib/financeExecutiveReportPresentation";
import { ExecutiveChartShell } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import { useExecutiveChartFrameDimensions } from "@/src/components/finance/executive-report/charts/executiveChartFrameContext";
import { useExecutiveReportPdfMode } from "@/src/components/finance/executive-report/ExecutiveReportPrintContext";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_IS_ANIMATION_ACTIVE,
  EXECUTIVE_CHART_LEGEND,
  resolveExecutiveChartMargin,
  EXECUTIVE_CHART_X_TICK,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export function ExecutiveReportPayablesChart({
  title,
  subtitle,
  rows,
  empty,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  rows: ExecutiveAnnualPayablesChartRow[];
  empty?: boolean;
  scenarioText?: string;
}) {
  const { width, height } = useExecutiveChartFrameDimensions();
  const pdfMode = useExecutiveReportPdfMode();
  const data = rows.map((row) => ({
    name: row.monthLabel,
    paidAmount: row.paidAmount,
    payableOpenAmount: row.payableOpenAmount,
  }));

  return (
    <ExecutiveChartShell
      title={title}
      subtitle={subtitle}
      empty={empty ?? rows.length === 0}
      testId="executive-report-payables-chart"
      scenarioText={scenarioText}
    >
      <BarChart width={width} height={height} data={data} margin={resolveExecutiveChartMargin(pdfMode)}>
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
          dataKey="paidAmount"
          name="Pago"
          stackId="ap"
          fill="#B45309"
          maxBarSize={32}
          isAnimationActive={EXECUTIVE_CHART_IS_ANIMATION_ACTIVE}
        >
          <LabelList dataKey="paidAmount" content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />} />
        </Bar>
        <Bar
          dataKey="payableOpenAmount"
          name="A pagar"
          stackId="ap"
          fill="#FDBA74"
          maxBarSize={32}
          isAnimationActive={EXECUTIVE_CHART_IS_ANIMATION_ACTIVE}
        >
          <LabelList
            dataKey="payableOpenAmount"
            content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
          />
        </Bar>
      </BarChart>
    </ExecutiveChartShell>
  );
}
