import React, { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PredictiveCashFlowDailyBalance } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";

export type PredictiveCashFlowTimelineChartProps = {
  timeline: readonly PredictiveCashFlowDailyBalance[];
};

export function PredictiveCashFlowTimelineChart({
  timeline,
}: PredictiveCashFlowTimelineChartProps) {
  const data = useMemo(
    () =>
      timeline.map((d) => ({
        ...d,
        label: formatPredictiveCashFlowDate(d.date),
      })),
    [timeline]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        Sem dados de projeção para o período.
      </div>
    );
  }

  return (
    <div className="h-56 w-full min-h-[14rem]" data-testid="predictive-cf-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pcfBalancePos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="pcfBalanceNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#fb7185" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={72}
            tickFormatter={(v: number) =>
              new Intl.NumberFormat("pt-BR", {
                notation: "compact",
                compactDisplay: "short",
              }).format(v)
            }
          />
          <Tooltip
            contentStyle={{
              background: "rgba(15,23,42,0.92)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12,
              color: "#e2e8f0",
            }}
            formatter={(value: number | string) => [
              formatPredictiveCashFlowMoney(Number(value)),
              "Saldo",
            ]}
            labelFormatter={(label) => String(label)}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#38bdf8"
            strokeWidth={2}
            fill="url(#pcfBalancePos)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
