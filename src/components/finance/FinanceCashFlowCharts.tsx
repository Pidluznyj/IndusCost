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
import type { FinanceCashFlowMonthlyPoint } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";

function ChartCard({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <FinanceBiEmptyState
        title={title}
        description={subtitle ?? "Sem dados para exibir com os filtros aplicados."}
      />
    );
  }
  return (
    <div className={`${financeBiCardClass} p-5 space-y-3 min-h-[340px] flex flex-col`}>
      <div>
        <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
        {subtitle ? <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p> : null}
      </div>
      <div className="flex-1 min-h-[280px]">{children}</div>
    </div>
  );
}

export function FinanceCashFlowMonthlyChart({
  points,
  viewModeLabel,
}: {
  points: FinanceCashFlowMonthlyPoint[];
  viewModeLabel: string;
}) {
  const data = points.map((p) => ({
    name: p.monthLabel,
    inflow: p.inflowAmount,
    outflow: p.outflowAmount != null ? -p.outflowAmount : null,
    outflowPositive: p.outflowAmount,
    net: p.netFlowAmount,
    accumulated: p.accumulatedBalance,
  }));

  const empty = data.every(
    (d) =>
      (d.inflow == null || d.inflow === 0) &&
      (d.outflowPositive == null || d.outflowPositive === 0)
  );

  return (
    <ChartCard
      title="Fluxo de Caixa e Saldo Acumulado por Mês"
      subtitle={`${viewModeLabel} — barras verdes = entradas, vermelhas = saídas, linha azul = saldo acumulado`}
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(Math.abs(v))}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (value == null) return "—";
              const abs = Math.abs(value);
              if (name === "outflow") return formatFinanceCurrency(abs);
              return formatFinanceCurrency(value);
            }}
            labelFormatter={(label) => `Mês: ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="inflow" name="Entradas" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={32} />
          <Bar dataKey="outflow" name="Saídas" fill="#DC2626" radius={[4, 4, 0, 0]} maxBarSize={32} />
          <Line
            type="monotone"
            dataKey="accumulated"
            name="Saldo acumulado"
            stroke="#2563EB"
            strokeWidth={2}
            dot={{ r: 3, fill: "#2563EB" }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
