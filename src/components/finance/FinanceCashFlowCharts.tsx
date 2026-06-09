import React from "react";
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
import type { FinanceCashFlowMonthlyPoint } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  CONTROL_ROOM_COLORS,
  FINANCE_CASH_FLOW_CHART_HEIGHT,
  controlRoomCardClass,
  controlRoomCaptionClass,
} from "@/src/lib/financeControlRoomTheme";
import { FinanceCashFlowEmptyState } from "@/src/components/finance/cash-flow/FinanceCashFlowEmptyState";
import { cn } from "@/src/lib/utils";

function CashFlowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const byName = Object.fromEntries(payload.map((p) => [p.name, p.value]));
  const inflow = byName.Entradas ?? 0;
  const outflowRaw = byName.Saídas;
  const outflow = outflowRaw != null ? Math.abs(outflowRaw) : 0;
  const accumulated = byName["Saldo acumulado"];
  const net = inflow - outflow;

  return (
    <div className="rounded-md border border-[#D6D3D1] bg-[#FDFDFC] px-3 py-2 shadow-none font-mono text-[10px] text-[#1C1917]">
      <p className="font-ui font-semibold mb-1">Mês: {label}</p>
      <p className="text-[#2C5530]">Entradas: {formatFinanceCurrency(inflow)}</p>
      <p className="text-[#B64230]">Saídas: {formatFinanceCurrency(outflow)}</p>
      <p className="text-[#1C1917]">Líquido: {formatFinanceCurrency(net)}</p>
      {accumulated != null ? (
        <p className="text-[#1C1917]">Acumulado: {formatFinanceCurrency(accumulated)}</p>
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

  if (empty) {
    return (
      <FinanceCashFlowEmptyState
        title="Fluxo de Caixa e Saldo Acumulado"
        description="Sem movimentos para os filtros aplicados."
      />
    );
  }

  return (
    <div
      data-testid="cash-flow-main-chart"
      className={cn(controlRoomCardClass, "p-4 space-y-2 flex flex-col")}
      style={{ minHeight: FINANCE_CASH_FLOW_CHART_HEIGHT + 72 }}
    >
      <div>
        <h3 className="font-ui text-sm font-semibold text-[#1C1917]">
          Fluxo de Caixa e Saldo Acumulado
        </h3>
        <p className={controlRoomCaptionClass}>
          {viewModeLabel} · barras moss = entradas · terracotta = saídas · linha ink = acumulado
        </p>
      </div>
      <div style={{ height: FINANCE_CASH_FLOW_CHART_HEIGHT, width: "100%" }}>
        <ResponsiveContainer width="100%" height={FINANCE_CASH_FLOW_CHART_HEIGHT}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={CONTROL_ROOM_COLORS.border} />
            <ReferenceLine y={0} stroke={CONTROL_ROOM_COLORS.borderStrong} strokeWidth={1} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: CONTROL_ROOM_COLORS.textSecondary, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: CONTROL_ROOM_COLORS.textSecondary, fontFamily: "JetBrains Mono" }}
              tickFormatter={(v: number) => formatFinanceCurrencyCompact(Math.abs(v))}
              width={84}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CashFlowTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "IBM Plex Sans" }} />
            <Bar
              dataKey="inflow"
              name="Entradas"
              fill={CONTROL_ROOM_COLORS.inflow}
              radius={[2, 2, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="outflow"
              name="Saídas"
              fill={CONTROL_ROOM_COLORS.outflow}
              radius={[2, 2, 0, 0]}
              maxBarSize={28}
            />
            <Line
              type="monotone"
              dataKey="accumulated"
              name="Saldo acumulado"
              stroke={CONTROL_ROOM_COLORS.ink}
              strokeWidth={2}
              dot={{ r: 2, fill: CONTROL_ROOM_COLORS.ink }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
