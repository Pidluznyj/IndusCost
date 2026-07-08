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
import type { CostCenterMonthlyChartPayload } from "@/src/lib/financeCostCenterMonthlyChart.shared";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { Loader2 } from "lucide-react";

function formatAxisCurrency(value: number): string {
  if (!Number.isFinite(value)) return "R$ 0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)} Mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return formatFinanceCurrency(value);
}

function MonthlyChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {formatFinanceCurrency(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

type Props = {
  payload: CostCenterMonthlyChartPayload | null;
  loading?: boolean;
  error?: string | null;
  title?: string;
};

export function FinanceCostCenterMonthlyDrilldownChart({
  payload,
  loading = false,
  error = null,
  title = "Comportamento mensal do centro de custo",
}: Props) {
  const chartData = useMemo(() => payload?.series ?? [], [payload?.series]);
  const highlightedMonth = payload?.highlightMonth ?? null;

  if (loading) {
    return (
      <div
        className={cn(financeBiCardClass, "flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground")}
        data-testid="finance-cc-monthly-chart-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando gráfico mensal…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(financeBiCardClass, "p-4 text-sm text-rose-700")}
        data-testid="finance-cc-monthly-chart-error"
      >
        {error}
      </div>
    );
  }

  const empty = !payload?.hasData;

  return (
    <div data-testid="finance-cc-monthly-chart">
      <FinanceBillingChartShell
        title={title}
        subtitle={
          payload
            ? `${payload.periodLabel} · ${payload.metricsScope}`
            : "Série mensal por data de vencimento"
        }
        empty={empty}
        emptyDescription="Nenhum título encontrado para este centro de custo no período."
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
          <Tooltip content={<MonthlyChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {highlightedMonth != null ? (
            <ReferenceLine
              x={chartData.find((row) => row.month === highlightedMonth)?.monthLabel}
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
            dataKey="paidAmount"
            name="Pago / realizado"
            fill="#059669"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
          <Line
            type="monotone"
            dataKey="openAmount"
            name="Previsto / em aberto"
            stroke="#0284c7"
            strokeWidth={2}
            dot={{ r: 3, fill: "#0284c7" }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
    </div>
  );
}
