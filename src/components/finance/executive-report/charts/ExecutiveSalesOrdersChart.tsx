import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExecutiveSalesOrdersChartRow } from "@/src/lib/financeExecutiveReportPresentation";
import type { DashboardChartSeriesConfig } from "@/src/lib/executiveDashboardTypes";
import {
  formatExecutiveReportAxisCurrency,
  formatExecutiveReportPresentationCurrency,
} from "@/src/lib/financeExecutiveReportPresentation";
import {
  ExecutiveChartShell,
  ExecutiveTargetHint,
} from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_LEGEND,
  EXECUTIVE_CHART_MARGIN,
  EXECUTIVE_CHART_X_TICK,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

function SalesTooltip({
  active,
  payload,
  label,
  config,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  config: DashboardChartSeriesConfig;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="executive-chart-tooltip">
      <p className="executive-chart-tooltip-title">Mês: {label}</p>
      {payload.map((item) => {
        const name =
          item.dataKey === "previousYear"
            ? config.labels.previousYearBar
            : item.dataKey === "currentYear"
              ? config.labels.currentYearBar
              : item.dataKey === "target"
                ? config.labels.targetLine
                : "Projeção";
        return (
          <p key={item.dataKey} style={{ color: item.color }}>
            {name}: {formatExecutiveReportPresentationCurrency(item.value)}
          </p>
        );
      })}
    </div>
  );
}

export function ExecutiveSalesOrdersChart({
  title,
  subtitle,
  rows,
  config,
  empty,
  targetMissing,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  rows: ExecutiveSalesOrdersChartRow[];
  config: DashboardChartSeriesConfig;
  empty?: boolean;
  targetMissing?: boolean;
  scenarioText?: string;
}) {
  const data = rows.map((row) => ({
    name: row.monthLabel,
    month: row.month,
    isCurrentMonth: row.isCurrentMonth,
    previousYear: row.previousYear,
    currentYear: row.currentYear ?? 0,
    target: row.target,
    projected: row.projected ?? 0,
  }));

  return (
    <div className="space-y-2">
      <ExecutiveTargetHint missing={targetMissing ?? false} />
      <ExecutiveChartShell
        title={title}
        subtitle={subtitle ?? "Comparativo ano anterior × ano atual, meta e projeção"}
        empty={empty ?? rows.length === 0}
        testId="executive-sales-orders-chart"
        scenarioText={scenarioText}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={EXECUTIVE_CHART_MARGIN}>
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
            <Tooltip content={<SalesTooltip config={config} />} />
            <Legend wrapperStyle={EXECUTIVE_CHART_LEGEND} />
            <Bar
              dataKey="previousYear"
              name={config.labels.previousYearBar}
              fill={config.colors.previousYearBar}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            >
              <LabelList
                dataKey="previousYear"
                content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
              />
            </Bar>
            <Bar
              dataKey="currentYear"
              name={config.labels.currentYearBar}
              fill={config.colors.currentYearBar}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            >
              {data.map((entry) => (
                <Cell
                  key={`current-${entry.name}`}
                  fill={config.colors.currentYearBar}
                  opacity={entry.isCurrentMonth ? 1 : 0.85}
                  stroke={entry.isCurrentMonth ? "#0F172A" : undefined}
                  strokeWidth={entry.isCurrentMonth ? 2 : 0}
                />
              ))}
              <LabelList
                dataKey="currentYear"
                content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
              />
            </Bar>
            <Line
              type="monotone"
              dataKey="target"
              name={config.labels.targetLine}
              stroke={config.colors.targetLine}
              strokeWidth={2.5}
              dot={false}
            />
            {config.colors.projectedLine ? (
              <Line
                type="monotone"
                dataKey="projected"
                name={config.labels.projectedLine ?? "Projeção"}
                stroke={config.colors.projectedLine}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </ExecutiveChartShell>
    </div>
  );
}
