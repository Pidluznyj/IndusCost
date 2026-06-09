import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceCashFlowMonthlyPoint } from "@/src/lib/financeCashFlowDashboardTypes";
import { formatFinanceCurrency, formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import {
  buildCashFlowNetPositionChartRows,
  cashFlowMonthlySeriesHasData,
} from "@/src/lib/financeCashFlowDisplay";
import {
  FINANCE_CASH_FLOW_CHART_HEIGHT,
  FinanceCashFlowChartShell,
} from "@/src/components/finance/cash-flow/FinanceCashFlowChartShell";

function NetPositionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, number> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827]">
      <p className="font-semibold mb-1">Mês: {label}</p>
      <p className="text-[#059669]">A receber: {formatFinanceCurrency(row.receivable)}</p>
      <p className="text-[#DC2626]">A pagar: {formatFinanceCurrency(row.payable)}</p>
      <p className="text-[#111827]">Posição líquida: {formatFinanceCurrency(row.netPosition)}</p>
      {row.accumulated != null ? (
        <p className="text-[#2563EB]">Acumulado: {formatFinanceCurrency(row.accumulated)}</p>
      ) : null}
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
  const data = buildCashFlowNetPositionChartRows(points);
  const empty = !cashFlowMonthlySeriesHasData(points);

  return (
    <FinanceCashFlowChartShell
      testId="cash-flow-main-chart"
      title="Posição Líquida Mensal — Receber x Pagar"
      subtitle={`${viewModeLabel} · barras verdes acima do zero · vermelhas abaixo · linha = saldo acumulado`}
      empty={empty}
      emptyDescription="Sem movimentos para os filtros aplicados."
    >
      <ResponsiveContainer width="100%" height={FINANCE_CASH_FLOW_CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1.5} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            width={84}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<NetPositionTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="netPosition" name="Posição líquida" maxBarSize={36} radius={[3, 3, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={`net-${entry.name}`}
                fill={entry.netPosition >= 0 ? FINANCE_BI_COLORS.success : FINANCE_BI_COLORS.risk}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="accumulated"
            name="Saldo acumulado"
            stroke={FINANCE_BI_COLORS.primary}
            strokeWidth={2}
            dot={{ r: 2, fill: FINANCE_BI_COLORS.primary }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceCashFlowChartShell>
  );
}
