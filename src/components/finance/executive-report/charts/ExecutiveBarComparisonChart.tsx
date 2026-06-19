import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ExecutiveBarComparisonRow,
  ExecutiveBarComparisonSeries,
} from "@/src/lib/financeExecutiveReportPresentation";
import {
  formatExecutiveReportAxisCurrency,
  formatExecutiveReportPresentationCurrency,
} from "@/src/lib/financeExecutiveReportPresentation";
import { ExecutiveChartShell } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_LEGEND,
  EXECUTIVE_CHART_MARGIN,
  EXECUTIVE_CHART_X_TICK,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

function ComparisonTooltip({
  active,
  payload,
  label,
  years,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  years: ExecutiveBarComparisonSeries[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="executive-chart-tooltip">
      <p className="executive-chart-tooltip-title">Mês: {label}</p>
      {years.map((series) => {
        const item = payload.find((p) => p.dataKey === `y${series.year}`);
        const value = item?.value;
        return (
          <p key={series.year} style={{ color: series.color }}>
            {series.label}:{" "}
            {value == null ? "—" : formatExecutiveReportPresentationCurrency(value)}
          </p>
        );
      })}
    </div>
  );
}

export function ExecutiveBarComparisonChart({
  title,
  subtitle,
  years,
  rows,
  empty,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  years: ExecutiveBarComparisonSeries[];
  rows: ExecutiveBarComparisonRow[];
  empty?: boolean;
  scenarioText?: string;
}) {
  const data = useMemo(
    () =>
      rows.map((row) => {
        const entry: Record<string, string | number | boolean | null> = {
          name: row.monthLabelPt,
          month: row.month,
          isCurrentMonth: row.isCurrentMonth,
        };
        for (const series of years) {
          entry[`y${series.year}`] = row.values[series.year] ?? null;
        }
        return entry;
      }),
    [rows, years]
  );

  return (
    <ExecutiveChartShell
      title={title}
      subtitle={subtitle}
      empty={empty ?? rows.length === 0}
      testId="executive-bar-comparison-chart"
      scenarioText={scenarioText}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={EXECUTIVE_CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="name"
            interval={0}
            tick={EXECUTIVE_CHART_X_TICK}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={EXECUTIVE_CHART_Y_TICK}
            tickFormatter={formatExecutiveReportAxisCurrency}
            width={EXECUTIVE_CHART_Y_AXIS_WIDTH}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ComparisonTooltip years={years} />} />
          <Legend wrapperStyle={EXECUTIVE_CHART_LEGEND} />
          {years.map((series) => (
            <Bar
              key={series.year}
              dataKey={`y${series.year}`}
              name={series.label}
              fill={series.color}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            >
              {data.map((entry) => (
                <Cell
                  key={`${series.year}-${entry.name}`}
                  fill={series.color}
                  opacity={entry.isCurrentMonth ? 1 : 0.82}
                  stroke={entry.isCurrentMonth ? "#0F172A" : undefined}
                  strokeWidth={entry.isCurrentMonth ? 1 : 0}
                />
              ))}
              <LabelList
                dataKey={`y${series.year}`}
                content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ExecutiveChartShell>
  );
}
