import React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatExecutiveCompactCurrency, formatExecutiveCurrency } from "@/src/lib/executiveDashboardFormatters";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";

export type FinanceSalesOrdersBreakdownChartRow = {
  name: string;
  amount: number;
  orderCount: number;
};

export function FinanceSalesOrdersBreakdownChart({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: FinanceSalesOrdersBreakdownChartRow[];
}) {
  const data = rows.map((row) => ({
    name: row.name,
    amount: row.amount,
    orderCount: row.orderCount,
  }));
  const empty = rows.every((r) => r.amount === 0 && r.orderCount === 0);

  return (
    <FinanceBillingChartShell title={title} subtitle={subtitle} empty={empty}>
      {({ height }) => (
        <ResponsiveContainer width="100%" height={height || FINANCE_BILLING_CHART_HEIGHT}>
          <ComposedChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: "#6B7280" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6B7280" }}
              tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
              width={80}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number, _name: string, item) => {
                const count = (item?.payload as { orderCount?: number })?.orderCount;
                return [
                  `${formatExecutiveCurrency(value)}${count != null ? ` · ${count} pedido(s)` : ""}`,
                  "Valor",
                ];
              }}
            />
            <Bar dataKey="amount" name="Valor" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={40}>
              <LabelList dataKey="amount" content={<ChartBarValueLabel />} />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </FinanceBillingChartShell>
  );
}
