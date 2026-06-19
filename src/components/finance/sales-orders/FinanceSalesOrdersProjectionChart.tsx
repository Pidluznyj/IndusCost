import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceSalesOrdersDashboardSummary } from "@/src/lib/financeSalesOrdersDashboardTypes";
import { formatExecutiveCompactCurrency, formatExecutiveCurrency } from "@/src/lib/executiveDashboardFormatters";
import {
  FINANCE_BILLING_SERIES_COLORS,
  getFinanceBillingYearColor,
} from "@/src/lib/financeBillingChartTheme";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";
import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";

export function FinanceSalesOrdersProjectionChart({
  summary,
  selectedYear,
  scenarioText,
}: {
  summary: FinanceSalesOrdersDashboardSummary;
  selectedYear: number;
  scenarioText?: string;
}) {
  const chartData = [
    {
      name: "Realizado",
      value: summary.monthSalesAmount,
      fill: getFinanceBillingYearColor(selectedYear),
    },
    {
      name: "Projeção",
      value: summary.monthProjectedAmount ?? 0,
      fill: FINANCE_BILLING_SERIES_COLORS.projection,
    },
    {
      name: "Meta",
      value: summary.monthTargetAmount ?? 0,
      fill: FINANCE_BILLING_SERIES_COLORS.target,
    },
  ];

  return (
    <div className="space-y-2">
      {scenarioText ? <ExecutiveChartScenario text={scenarioText} /> : null}
      <FinanceBillingChartShell
        title="Realizado vs Projetado"
        subtitle="Mês selecionado — ritmo atual de pedidos versus meta derivada (+30% sobre o ano anterior)."
      >
        <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
          <BarChart data={chartData} margin={{ top: 28, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: "#334155", fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
              width={88}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip formatter={(v: number) => formatExecutiveCurrency(v)} />
            <ReferenceLine y={0} stroke="#94A3B8" />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
              <LabelList dataKey="value" content={<ChartBarValueLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </FinanceBillingChartShell>
    </div>
  );
}
