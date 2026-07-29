import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
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

function MarginPercentBarLabel(props: LabelProps) {
  const value =
    typeof props.value === "number"
      ? props.value
      : typeof props.value === "string"
        ? Number(props.value)
        : null;
  if (value == null || !Number.isFinite(value)) return null;
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  const y = Number(props.y ?? 0) - 4;
  return (
    <text
      x={x}
      y={y}
      fill="#15803D"
      fontSize={10}
      fontWeight={600}
      textAnchor="middle"
    >
      {formatSalesOrderMarginPercent(value)}
    </text>
  );
}

/**
 * Novo gráfico de Margem comercial % por mês.
 * Calcula a margem mensal ponderada de forma limpa e independente de filtros.
 */
export function SalesOrderMonthlyCommercialMarginChart({
  rows,
  selectedYear,
}: {
  rows: SalesOrderResultMonthlyRow[];
  selectedYear: number;
}) {
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const colors = getExecutiveChartColors("salesOrders");

  const data = FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, index) => {
    const month = index + 1;
    const row = byMonth.get(month);
    const marginPercent = row?.marginPercent ?? null;
    return {
      name: monthLabel,
      marginPercent: marginPercent == null ? null : marginPercent,
      hasMargin: marginPercent != null,
      isPartial: row?.isPartial === true,
      marginAmount: row?.marginAmount ?? 0,
      coveredNetValue: row?.coveredNetValue ?? 0,
      ordersCount: row?.ordersCount ?? 0,
    };
  });

  const empty = data.every((row) => !row.hasMargin);

  return (
    <FinanceBillingChartShell
      title={`Margem % por mês — ${selectedYear}`}
      subtitle="Margem comercial mensal (mesmo motor do card): Σ margem ÷ Σ líquido coberto por mês de emissão. Só o filtro Ano afeta este gráfico — população anual canônica."
      empty={empty}
      emptyDescription="Sem margem comercial calculável para o período."
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
              formatter={(value: number | null, _name, item) => {
                const payload = item?.payload as
                  | {
                      hasMargin?: boolean;
                      isPartial?: boolean;
                      marginAmount?: number;
                      coveredNetValue?: number;
                    }
                  | undefined;
                if (!payload?.hasMargin || value == null || !Number.isFinite(value)) {
                  return ["Sem base válida", "Margem comercial %"];
                }
                const suffix = payload.isPartial ? " (parcial)" : "";
                return [
                  `${formatSalesOrderMarginPercent(value)}${suffix}`,
                  "Margem comercial %",
                ];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="marginPercent"
              name={`Margem comercial % ${selectedYear}`}
              fill={colors.currentYearBar}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`margin-cell-${index}`}
                  fill={entry.hasMargin ? colors.currentYearBar : "transparent"}
                />
              ))}
              <LabelList dataKey="marginPercent" content={<MarginPercentBarLabel />} />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </FinanceBillingChartShell>
  );
}

/** Alias para compatibilidade com importações existentes. */
export const SalesOrderListMonthlyMarginPercentChart = SalesOrderMonthlyCommercialMarginChart;
