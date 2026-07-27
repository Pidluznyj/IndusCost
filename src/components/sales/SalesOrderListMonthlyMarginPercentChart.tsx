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
import type { LabelProps } from "recharts";
import type { SalesOrderResultMonthlyRow } from "@/src/lib/salesOrderResultTypes";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";
import { FINANCE_SALES_ORDERS_MONTH_LABELS } from "@/src/lib/financeSalesOrdersDashboardTypes";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";
import { getExecutiveChartColors } from "@/src/lib/executiveDashboardChartTheme";
import { resolveExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear";

function MarginPercentBarLabel(props: LabelProps) {
  const value =
    typeof props.value === "number"
      ? props.value
      : typeof props.value === "string"
        ? Number(props.value)
        : null;
  if (value == null || !Number.isFinite(value) || value === 0) return null;
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  const y = Number(props.y ?? 0) - 4;
  return (
    <text
      x={x}
      y={y}
      fill="#374151"
      fontSize={9}
      fontWeight={600}
      textAnchor="middle"
    >
      {formatSalesOrderMarginPercent(value)}
    </text>
  );
}

/**
 * Margem gerencial % mês a mês (motor oficial) — shell alinhado ao gráfico de pedidos.
 */
export function SalesOrderListMonthlyMarginPercentChart({
  rows,
  selectedYear,
}: {
  rows: SalesOrderResultMonthlyRow[];
  selectedYear: number;
}) {
  const byMonth = new Map(rows.map((row) => [row.month, row.marginPercent]));
  const yearCtx = resolveExecutiveDashboardYearContext(selectedYear, new Date());
  const colors = getExecutiveChartColors("salesOrders");

  const data = FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, index) => {
    const month = index + 1;
    const marginPercent = byMonth.get(month) ?? null;
    return {
      name: monthLabel,
      marginPercent: marginPercent ?? 0,
      hasMargin: marginPercent != null,
    };
  });

  const empty = data.every((row) => !row.hasMargin || row.marginPercent === 0);

  return (
    <FinanceBillingChartShell
      title={`Margem % por mês — ${selectedYear}`}
      subtitle="Margem gerencial oficial (receita líquida − custo versionado), ponderada por receita. Mesma população da listagem."
      empty={empty}
      emptyDescription="Sem margem calculável para o período (sem pedidos ou custo indisponível)."
      testId="sales-orders-monthly-margin-percent-chart"
    >
      {({ height }) => (
        <ResponsiveContainer width="100%" height={height || FINANCE_BILLING_CHART_HEIGHT}>
          <ComposedChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "#6B7280" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6B7280" }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={48}
              axisLine={false}
              tickLine={false}
              domain={[0, "auto"]}
            />
            <Tooltip
              formatter={(value: number) => [
                formatSalesOrderMarginPercent(value),
                "Margem %",
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="marginPercent"
              name={
                yearCtx.isSelectedYearCurrent
                  ? `Margem % ${selectedYear} YTD`
                  : `Margem % ${selectedYear}`
              }
              fill={colors.currentYearBar}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
            >
              <LabelList dataKey="marginPercent" content={<MarginPercentBarLabel />} />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </FinanceBillingChartShell>
  );
}
