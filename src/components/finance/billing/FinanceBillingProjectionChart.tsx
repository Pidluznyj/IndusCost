import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BillingRealizedVsProjected } from "@/src/lib/executiveDashboardTypes";
import {
  FINANCE_BILLING_SERIES_COLORS,
  getFinanceBillingYearColor,
} from "@/src/lib/financeBillingChartTheme";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
} from "@/src/lib/executiveDashboardFormatters";

function ChartShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white dark:bg-card shadow-sm p-5 space-y-3 min-h-[280px] flex flex-col">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      <div className="flex-1 min-h-[220px]">{children}</div>
    </div>
  );
}

export function FinanceBillingProjectionChart({
  data,
  selectedYear,
}: {
  data: BillingRealizedVsProjected;
  selectedYear: number;
}) {
  const chartData = [
    {
      name: "Realizado",
      value: data.realized ?? 0,
      fill: getFinanceBillingYearColor(selectedYear),
    },
    {
      name: "Projeção",
      value: data.projected ?? 0,
      fill: FINANCE_BILLING_SERIES_COLORS.projection,
    },
    {
      name: "Meta (+30%)",
      value: data.target ?? 0,
      fill: FINANCE_BILLING_SERIES_COLORS.target,
    },
  ];

  return (
    <ChartShell
      title="Realizado vs Projetado vs Meta"
      subtitle="Mês corrente — projeção baseada na média diária YTD"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
            width={72}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(v: number) => formatExecutiveCurrency(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {data.target != null ? (
            <ReferenceLine
              y={data.target}
              stroke={FINANCE_BILLING_SERIES_COLORS.targetDashed}
              strokeDasharray="4 4"
              label={{ value: "Meta", position: "right", fontSize: 10 }}
            />
          ) : null}
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
