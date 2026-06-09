import React, { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BillingMultiYearMonthlyPoint } from "@/src/lib/financeBillingChartData";
import {
  FINANCE_BILLING_SERIES_COLORS,
  getFinanceBillingYearColor,
  resolveFinanceBillingComparisonYears,
} from "@/src/lib/financeBillingChartTheme";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
} from "@/src/lib/executiveDashboardFormatters";
import {
  billingMonthlyChartHasData,
  mapBillingMonthlyChartData,
} from "@/src/lib/financeBillingChartRender";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";

export function FinanceBillingMonthlyComparisonChart({
  points,
  selectedYear,
  showTarget = true,
}: {
  points: BillingMultiYearMonthlyPoint[];
  selectedYear: number;
  showTarget?: boolean;
}) {
  const years = useMemo(
    () => resolveFinanceBillingComparisonYears(selectedYear, 3),
    [selectedYear]
  );

  const data = useMemo(
    () => mapBillingMonthlyChartData(points, years, showTarget),
    [points, years, showTarget]
  );

  const empty = !billingMonthlyChartHasData(points, years);

  return (
    <FinanceBillingChartShell
      title="Faturamento Mês a Mês"
      subtitle="Comparativo por ano — SalesOrder (mercado)"
      empty={empty}
      emptyDescription="Sem faturamento mensal para os anos comparados."
    >
      <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (value == null) return "—";
              const label = name.startsWith("y") ? `Ano ${name.slice(1)}` : name;
              return [formatExecutiveCurrency(value), label];
            }}
            labelFormatter={(label) => `Mês: ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {years.map((year) => (
            <Bar
              key={year}
              dataKey={`y${year}`}
              name={`${year}`}
              fill={getFinanceBillingYearColor(year)}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          ))}
          {showTarget ? (
            <Line
              type="monotone"
              dataKey="target"
              name={`Meta ${selectedYear} (+30%)`}
              stroke={FINANCE_BILLING_SERIES_COLORS.target}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}
