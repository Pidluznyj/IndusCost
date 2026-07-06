import React from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesOrdersAccumulatedPoint } from "@/src/lib/executiveDashboardTypes";
import type { DashboardChartSeriesConfig } from "@/src/lib/executiveDashboardTypes";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
} from "@/src/lib/executiveDashboardFormatters";
import {
  billingAccumulatedChartHasData,
  mapBillingAccumulatedChartData,
} from "@/src/lib/financeBillingChartRender";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";

export function FinanceBillingAccumulatedChart({
  series,
  config,
}: {
  series: SalesOrdersAccumulatedPoint[];
  config: DashboardChartSeriesConfig;
}) {
  const data = mapBillingAccumulatedChartData(series);
  const empty = !billingAccumulatedChartHasData(series);

  return (
    <FinanceBillingChartShell
      title="Faturamento Acumulado NF-e"
      subtitle="Evolução acumulada YTD com meta e projeção — SalesOrder"
      empty={empty}
      emptyDescription="Sem faturamento acumulado para o ano selecionado."
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
          <Tooltip formatter={(v: number) => formatExecutiveCurrency(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="previous"
            name={config.labels.previousYearBar}
            stroke={config.colors.previousYearBar}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="current"
            name={config.labels.currentYearBar}
            stroke={config.colors.currentYearBar}
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="target"
            name={config.labels.targetLine}
            stroke={config.colors.targetLine}
            strokeWidth={2}
            strokeDasharray="4 2"
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
              connectNulls={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}
