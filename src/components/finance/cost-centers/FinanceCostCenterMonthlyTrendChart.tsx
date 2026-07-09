import React, { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FinanceBillingChartShell,
  FINANCE_BILLING_CHART_HEIGHT,
} from "@/src/components/finance/billing/FinanceBillingChartShell";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildCostCenterMonthlyTrendChartData,
  type CostCenterMonthlyChartPoint,
  type CostCenterMonthlyTrendChartPoint,
} from "@/src/lib/financeCostCenterMonthlyChart.shared";

function formatAxisCurrency(value: number): string {
  if (!Number.isFinite(value)) return "R$ 0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)} Mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return formatFinanceCurrency(value);
}

function TrendChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: CostCenterMonthlyTrendChartPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {point ? (
        <>
          <p className="text-foreground">
            Total: {formatFinanceCurrency(point.totalAmount)}
          </p>
          <p className="text-emerald-700">
            Pago: {formatFinanceCurrency(point.paidAmount)}
          </p>
          <p className="text-sky-800">
            Em aberto: {formatFinanceCurrency(point.openAmount)}
          </p>
        </>
      ) : null}
      {payload
        .filter((entry) => entry.name === "Tendência")
        .map((entry) => (
          <p key={entry.name} style={{ color: entry.color }}>
            {entry.name}: {formatFinanceCurrency(entry.value ?? 0)}
          </p>
        ))}
    </div>
  );
}

type Props = {
  series: CostCenterMonthlyChartPoint[];
  highlightMonth?: number | null;
  empty?: boolean;
};

export function FinanceCostCenterMonthlyTrendChart({
  series,
  highlightMonth = null,
  empty = false,
}: Props) {
  const chartData = useMemo<CostCenterMonthlyTrendChartPoint[]>(
    () => buildCostCenterMonthlyTrendChartData(series),
    [series]
  );
  const highlightedLabel = highlightMonth
    ? chartData.find((row) => row.month === highlightMonth)?.monthLabel
    : null;

  return (
    <FinanceBillingChartShell
      title="Gastos mensais por vencimento"
      subtitle="Barras: total do mês · Linha: tendência linear"
      empty={empty}
      emptyDescription="Nenhum gasto encontrado para este centro no ano filtrado."
    >
      <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
          />
          <YAxis
            tickFormatter={formatAxisCurrency}
            width={72}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<TrendChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {highlightedLabel ? (
            <ReferenceLine
              x={highlightedLabel}
              stroke="#6366f1"
              strokeDasharray="4 4"
              label={{
                value: "Mês filtrado",
                position: "insideTopRight",
                fontSize: 10,
                fill: "#6366f1",
              }}
            />
          ) : null}
          <Bar
            dataKey="totalAmount"
            name="Total mensal"
            fill="#4f46e5"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
          <Line
            type="monotone"
            dataKey="trendValue"
            name="Tendência"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}
