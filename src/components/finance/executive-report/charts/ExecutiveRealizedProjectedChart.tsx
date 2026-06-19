import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExecutiveRealizedProjectedChartModel } from "@/src/lib/financeExecutiveReportPresentation";
import { formatExecutiveReportPresentationCurrency } from "@/src/lib/financeExecutiveReportPresentation";
import {
  FINANCE_BILLING_SERIES_COLORS,
  getFinanceBillingYearColor,
} from "@/src/lib/financeBillingChartTheme";
import {
  ExecutiveChartShell,
  ExecutiveTargetHint,
} from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_MARGIN,
  EXECUTIVE_CHART_X_TICK_EMPHASIS,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

function RealizedTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { name: string; value: number; fill: string } }>;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="executive-chart-tooltip">
      <p className="executive-chart-tooltip-title">{row.name}</p>
      <p>{formatExecutiveReportPresentationCurrency(row.value)}</p>
    </div>
  );
}

export function ExecutiveRealizedProjectedChart({
  title,
  subtitle,
  model,
  selectedYear,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  model: ExecutiveRealizedProjectedChartModel;
  selectedYear: number;
  scenarioText?: string;
}) {
  const chartData = [
    {
      name: "Realizado",
      value: model.realized ?? 0,
      fill: getFinanceBillingYearColor(selectedYear),
      highlight: true,
    },
    {
      name: "Projeção",
      value: model.projected ?? 0,
      fill: FINANCE_BILLING_SERIES_COLORS.projection,
      highlight: false,
    },
    {
      name: "Meta mensal",
      value: model.target ?? 0,
      fill: FINANCE_BILLING_SERIES_COLORS.target,
      highlight: false,
    },
  ];

  return (
    <div className="space-y-2">
      <ExecutiveTargetHint missing={!model.hasTarget} />
      <ExecutiveChartShell
        title={title}
        subtitle={
          subtitle ??
          `Mês atual: ${model.currentMonthLabel} — realizado, projeção e meta`
        }
        empty={!model.hasData}
        testId="executive-realized-projected-chart"
        scenarioText={scenarioText}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={EXECUTIVE_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="name"
              tick={EXECUTIVE_CHART_X_TICK_EMPHASIS}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={EXECUTIVE_CHART_Y_TICK}
              tickFormatter={(v) => formatExecutiveReportPresentationCurrency(v)}
              width={EXECUTIVE_CHART_Y_AXIS_WIDTH}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<RealizedTooltip />} />
            <ReferenceLine y={0} stroke="#94A3B8" />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72}>
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.fill}
                  stroke={entry.highlight ? "#0F172A" : undefined}
                  strokeWidth={entry.highlight ? 2 : 0}
                />
              ))}
              <LabelList
                dataKey="value"
                content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ExecutiveChartShell>
    </div>
  );
}
