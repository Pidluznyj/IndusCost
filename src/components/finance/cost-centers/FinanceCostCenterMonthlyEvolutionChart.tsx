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
import { Loader2 } from "lucide-react";
import { FINANCE_BILLING_CHART_HEIGHT } from "@/src/components/finance/billing/FinanceBillingChartShell";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { CostCenterMonthlyEvolutionPayload } from "@/src/lib/financeCostCenterMonthlyEvolution.shared";

function formatAxisCurrency(value: number): string {
  if (!Number.isFinite(value)) return "R$ 0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)} Mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return formatFinanceCurrency(value);
}

function EvolutionTooltip({
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
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {formatFinanceCurrency(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-foreground tabular-nums">{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type Props = {
  payload: CostCenterMonthlyEvolutionPayload | null;
  loading?: boolean;
  error?: string | null;
  title?: string;
};

const SHELL_CLASS = "p-5 space-y-4";
const SUBTITLE = "Valores agrupados por vencimento no ano filtrado.";

export function FinanceCostCenterMonthlyEvolutionChart({
  payload,
  loading = false,
  error = null,
  title = "Evolução mensal do centro de custo",
}: Props) {
  const chartData = useMemo(() => payload?.points ?? [], [payload?.points]);
  const highlightMonth = payload?.highlightMonth ?? null;

  const header = (
    <div>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{SUBTITLE}</p>
    </div>
  );

  if (loading) {
    return (
      <div
        className={cn(financeBiCardClass, SHELL_CLASS)}
        data-testid="finance-cc-monthly-evolution-loading"
      >
        {header}
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando evolução mensal…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(financeBiCardClass, SHELL_CLASS)}
        data-testid="finance-cc-monthly-evolution-error"
      >
        {header}
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      </div>
    );
  }

  if (payload && !payload.hasYear) {
    return (
      <div
        className={cn(financeBiCardClass, SHELL_CLASS)}
        data-testid="finance-cc-monthly-evolution-no-year"
      >
        {header}
        <p className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
          Selecione um ano para visualizar a evolução mensal deste centro de custo.
        </p>
      </div>
    );
  }

  const summary = payload?.summary ?? null;
  const empty = !payload?.hasData;

  return (
    <div
      className={cn(financeBiCardClass, SHELL_CLASS)}
      data-testid="finance-cc-monthly-evolution"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        {header}
        {payload ? (
          <span className="text-[11px] text-muted-foreground">
            {payload.periodLabel} · {payload.metricsScope}
          </span>
        ) : null}
      </div>

      {summary ? (
        <div
          className="grid grid-cols-2 gap-2 lg:grid-cols-4"
          data-testid="finance-cc-monthly-evolution-summary"
        >
          <SummaryTile label="Total no ano" value={formatFinanceCurrency(summary.totalYear)} />
          <SummaryTile label="Média mensal" value={formatFinanceCurrency(summary.monthlyAverage)} />
          <SummaryTile
            label="Maior mês"
            value={summary.maxMonth ? formatFinanceCurrency(summary.maxMonth.amount) : "—"}
            hint={summary.maxMonth?.monthLabel}
          />
          <SummaryTile
            label="Menor mês com valor"
            value={summary.minMonth ? formatFinanceCurrency(summary.minMonth.amount) : "—"}
            hint={summary.minMonth?.monthLabel}
          />
        </div>
      ) : null}

      {empty ? (
        <p
          className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground"
          data-testid="finance-cc-monthly-evolution-empty"
        >
          Nenhum título alocado para este centro de custo no ano selecionado.
        </p>
      ) : (
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
            <Tooltip content={<EvolutionTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {highlightMonth != null ? (
              <ReferenceLine
                x={chartData.find((row) => row.month === highlightMonth)?.monthLabel}
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
              dataKey="amount"
              name="Alocado no mês"
              fill="#0ea5e9"
              radius={[4, 4, 0, 0]}
              maxBarSize={34}
            />
            <Line
              type="monotone"
              dataKey="trend"
              name="Tendência"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
