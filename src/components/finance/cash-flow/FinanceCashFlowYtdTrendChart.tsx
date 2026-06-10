import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceCashFlowExecutiveYtdTrendPoint } from "@/src/lib/financeCashFlowExecutiveYtd";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cashFlowMonthlySeriesHasData } from "@/src/lib/financeCashFlowDisplay";

function YtdTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: FinanceCashFlowExecutiveYtdTrendPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px]">
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-[#059669]">Entrada: {formatFinanceCurrency(row.inflow ?? 0)}</p>
      <p className="text-[#DC2626]">Saída: {formatFinanceCurrency(row.outflow ?? 0)}</p>
      <p>Líquido: {formatFinanceCurrency(row.net ?? 0)}</p>
      {row.accumulated != null ? (
        <p className="text-[#2563EB]">Acumulado: {formatFinanceCurrency(row.accumulated)}</p>
      ) : null}
    </div>
  );
}

export function FinanceCashFlowYtdTrendChart({
  points,
}: {
  points: FinanceCashFlowExecutiveYtdTrendPoint[];
}) {
  const hasData = points.some(
    (p) =>
      (p.inflow != null && p.inflow !== 0) ||
      (p.outflow != null && p.outflow !== 0) ||
      (p.net != null && p.net !== 0)
  );

  return (
    <div
      data-testid="cash-flow-ytd-trend-chart"
      className={`${financeBiCardClass} p-3 flex flex-col min-h-[140px]`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280] mb-2">
        Tendência YTD do caixa
      </p>
      {!hasData ? (
        <p className="text-sm text-muted-foreground flex-1 flex items-center">
          Sem movimentos no ano para exibir tendência.
        </p>
      ) : (
        <div style={{ width: "100%", height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
              <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1} />
              <XAxis
                dataKey="monthLabel"
                tick={{ fontSize: 9, fill: FINANCE_BI_COLORS.textSecondary }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: FINANCE_BI_COLORS.textSecondary }}
                tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
                width={72}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<YtdTrendTooltip />} />
              <Bar dataKey="net" name="Líquido" maxBarSize={14} radius={[2, 2, 0, 0]}>
                {points.map((entry) => (
                  <Cell
                    key={`ytd-${entry.month}`}
                    fill={
                      entry.status === "negative"
                        ? FINANCE_BI_COLORS.risk
                        : entry.status === "positive"
                          ? FINANCE_BI_COLORS.success
                          : FINANCE_BI_COLORS.border
                    }
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="accumulated"
                name="Acumulado"
                stroke={FINANCE_BI_COLORS.primary}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function ytdTrendChartHasRenderableData(
  points: FinanceCashFlowExecutiveYtdTrendPoint[]
): boolean {
  return cashFlowMonthlySeriesHasData(
    points.map((p) => ({
      year: 0,
      month: Number(p.month),
      monthLabel: p.monthLabel,
      inflowAmount: p.inflow,
      outflowAmount: p.outflow,
      netFlowAmount: p.net,
      accumulatedBalance: p.accumulated,
      status: p.status === "neutral" ? null : p.status,
      inflowCount: 0,
      outflowCount: 0,
    }))
  );
}
