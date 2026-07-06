import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";

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

  const empty =
    (data.realized == null || data.realized === 0) &&
    (data.projected == null || data.projected === 0) &&
    (data.target == null || data.target === 0);

  return (
    <FinanceBillingChartShell
      title="Realizado vs Projetado vs Meta"
      subtitle="Mês corrente — projeção baseada na média diária YTD"
      empty={empty}
      emptyDescription="Sem valores de realizado, projeção ou meta para o mês."
    >
      <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(v: number) => formatExecutiveCurrency(v)} />
          {data.target != null && data.target > 0 ? (
            <ReferenceLine
              y={data.target}
              stroke={FINANCE_BILLING_SERIES_COLORS.targetDashed}
              strokeDasharray="4 4"
              label={{ value: "Meta", position: "right", fontSize: 10 }}
            />
          ) : null}
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}
