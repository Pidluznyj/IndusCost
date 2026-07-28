import React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardChartSeriesConfig } from "@/src/lib/executiveDashboardTypes";
import type { FinanceSalesOrdersMonthlyComparisonRow } from "@/src/lib/financeSalesOrdersDashboardTypes";
import { formatExecutiveCompactCurrency, formatExecutiveCurrency } from "@/src/lib/executiveDashboardFormatters";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";
import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";

export function FinanceSalesOrdersMonthlyChart({
  rows,
  selectedYear,
  previousYear,
  config,
  scenarioText,
}: {
  rows: FinanceSalesOrdersMonthlyComparisonRow[];
  selectedYear: number;
  previousYear: number;
  config: DashboardChartSeriesConfig;
  scenarioText?: string;
}) {
  const data = rows.map((row) => ({
    name: row.monthLabel,
    currentYear: row.currentYearAmount,
    previousYear: row.previousYearAmount,
  }));
  const empty = rows.every((r) => r.currentYearAmount === 0 && r.previousYearAmount === 0);

  return (
    <div className="space-y-2">
      {scenarioText ? <ExecutiveChartScenario text={scenarioText} /> : null}
      <FinanceBillingChartShell
        title={`Pedidos de venda por mês — ${selectedYear} vs ${previousYear}`}
        subtitle="Valor vendido em pedidos emitidos (issueDate), excluindo cancelados e erros."
        empty={empty}
        testId="sales-orders-monthly-comparison-chart"
      >
        {({ height }) => (
          <ResponsiveContainer width="100%" height={height || FINANCE_BILLING_CHART_HEIGHT}>
            <ComposedChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 4 }}>
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
                formatter={(value: number, name: string) => [
                  formatExecutiveCurrency(value),
                  name === "currentYear" ? String(selectedYear) : String(previousYear),
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="previousYear"
                name={config.labels.previousYearBar}
                fill={config.colors.previousYearBar}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              >
                <LabelList dataKey="previousYear" content={<ChartBarValueLabel />} />
              </Bar>
              <Bar
                dataKey="currentYear"
                name={config.labels.currentYearBar}
                fill={config.colors.currentYearBar}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              >
                <LabelList dataKey="currentYear" content={<ChartBarValueLabel />} />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </FinanceBillingChartShell>
    </div>
  );
}
