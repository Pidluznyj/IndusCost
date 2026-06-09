import React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BillingForecastDailyPoint,
  BillingForecastMonthlyPoint,
} from "@/src/lib/financeBillingForecast";
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

export function FinanceBillingForecastMonthlyChart({
  points,
  selectedYear,
}: {
  points: BillingForecastMonthlyPoint[];
  selectedYear: number;
}) {
  const data = points.map((p) => ({
    name: p.monthLabel,
    realized: p.realized,
    forecast: p.forecast,
    difference: p.difference,
  }));

  const empty = data.every(
    (d) =>
      (d.realized == null || d.realized === 0) &&
      (d.forecast == null || d.forecast === 0)
  );

  return (
    <FinanceBillingChartShell
      title="Previsto x Realizado por Mês"
      subtitle="Realizado = NF processada · Previsto = pedidos abertos por expectedDeliveryDate"
      empty={empty}
      emptyDescription="Sem pedidos previstos ou faturamento realizado no ano."
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
              const labels: Record<string, string> = {
                realized: "Realizado (SalesOrder)",
                forecast: "Previsto (carteira)",
                difference: "Diferença",
              };
              return [formatExecutiveCurrency(value), labels[name] ?? name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="realized"
            name="Realizado"
            fill={getFinanceBillingYearColor(selectedYear)}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="forecast"
            name="Previsto"
            fill={FINANCE_BILLING_SERIES_COLORS.projection}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Line
            type="monotone"
            dataKey="difference"
            name="Diferença"
            stroke={FINANCE_BILLING_SERIES_COLORS.target}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}

export function FinanceBillingForecastDailyChart({
  points,
  monthLabel,
}: {
  points: BillingForecastDailyPoint[];
  monthLabel: string;
}) {
  const data = points.filter((p) => p.realized > 0 || p.forecast > 0);
  const empty = data.length === 0;

  return (
    <FinanceBillingChartShell
      title="Previsão diária no mês"
      subtitle={`${monthLabel} — realizado vs previsto por dia`}
      empty={empty}
      emptyDescription="Sem movimentação prevista ou realizada nos dias do mês."
    >
      <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#6B7280" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(v: number) => formatExecutiveCurrency(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="realized" name="Realizado" fill="#2E7D32" radius={[2, 2, 0, 0]} maxBarSize={12} />
          <Bar dataKey="forecast" name="Previsto" fill="#1565C0" radius={[2, 2, 0, 0]} maxBarSize={12} />
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}
