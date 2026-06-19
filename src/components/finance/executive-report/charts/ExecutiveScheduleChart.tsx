import React from "react";
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
import type { ExecutiveScheduleChartRow } from "@/src/lib/financeExecutiveReportPresentation";
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

const OPEN_COLOR = "#2563EB";
const OVERDUE_COLOR = "#DC2626";
const UPCOMING_COLOR = "#059669";

function ScheduleTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="executive-chart-tooltip">
      <p className="executive-chart-tooltip-title">Mês: {label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} style={{ color: item.color }}>
          {item.dataKey === "openAmount"
            ? "Em aberto"
            : item.dataKey === "overdueAmount"
              ? "Vencido/Atrasado"
              : "A vencer"}
          : {formatExecutiveReportPresentationCurrency(item.value)}
        </p>
      ))}
    </div>
  );
}

export function ExecutiveScheduleChart({
  title,
  subtitle,
  rows,
  empty,
  variant,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  rows: ExecutiveScheduleChartRow[];
  empty?: boolean;
  variant: "receivable" | "payable";
  scenarioText?: string;
}) {
  const data = rows.map((row) => ({
    name: row.monthLabel,
    month: row.month,
    isCurrentMonth: row.isCurrentMonth,
    openAmount: row.openAmount,
    overdueAmount: row.overdueAmount,
    upcomingAmount: row.upcomingAmount,
  }));

  const openLabel = variant === "receivable" ? "Em aberto" : "Em aberto";
  const overdueLabel = variant === "receivable" ? "Atrasado" : "Vencido";

  return (
    <ExecutiveChartShell
      title={title}
      subtitle={subtitle}
      empty={empty ?? rows.length === 0}
      testId={`executive-${variant}-schedule-chart`}
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
          <Tooltip content={<ScheduleTooltip />} />
          <Legend wrapperStyle={EXECUTIVE_CHART_LEGEND} />
          <Bar dataKey="openAmount" name={openLabel} fill={OPEN_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24}>
            {data.map((entry) => (
              <Cell
                key={`open-${entry.name}`}
                fill={OPEN_COLOR}
                opacity={entry.isCurrentMonth ? 1 : 0.85}
                stroke={entry.isCurrentMonth ? "#0F172A" : undefined}
                strokeWidth={entry.isCurrentMonth ? 1 : 0}
              />
            ))}
            <LabelList
              dataKey="openAmount"
              content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
            />
          </Bar>
          <Bar dataKey="overdueAmount" name={overdueLabel} fill={OVERDUE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24}>
            {data.map((entry) => (
              <Cell
                key={`overdue-${entry.name}`}
                fill={OVERDUE_COLOR}
                opacity={entry.isCurrentMonth ? 1 : 0.85}
              />
            ))}
            <LabelList
              dataKey="overdueAmount"
              content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
            />
          </Bar>
          <Bar dataKey="upcomingAmount" name="A vencer" fill={UPCOMING_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24}>
            <LabelList
              dataKey="upcomingAmount"
              content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ExecutiveChartShell>
  );
}
