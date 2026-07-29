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
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        Sem dados de projeção para o período.
      </div>
    );
  }

  return (
    <div className="h-64 w-full min-h-[16rem]" data-testid="predictive-cf-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pcfBalancePos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#0284c7" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
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
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 10,
              color: "hsl(var(--foreground))",
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
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
            stroke="#0369a1"
            strokeWidth={2}
            fill="url(#pcfBalancePos)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
