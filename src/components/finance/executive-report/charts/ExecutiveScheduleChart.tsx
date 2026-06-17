import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
}: {
  title: string;
  subtitle?: string;
  rows: ExecutiveScheduleChartRow[];
  empty?: boolean;
  variant: "receivable" | "payable";
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
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: "#64748B" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748B" }}
            tickFormatter={formatExecutiveReportAxisCurrency}
            width={88}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ScheduleTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
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
          </Bar>
          <Bar dataKey="overdueAmount" name={overdueLabel} fill={OVERDUE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24}>
            {data.map((entry) => (
              <Cell
                key={`overdue-${entry.name}`}
                fill={OVERDUE_COLOR}
                opacity={entry.isCurrentMonth ? 1 : 0.85}
              />
            ))}
          </Bar>
          <Bar dataKey="upcomingAmount" name="A vencer" fill={UPCOMING_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </ExecutiveChartShell>
  );
}
