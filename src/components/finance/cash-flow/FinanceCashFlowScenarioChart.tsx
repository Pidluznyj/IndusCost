import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceCashFlowScenarioChartPoint } from "@/src/lib/financeCashFlowForecast";
import { formatFinanceCurrency, formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import {
  FINANCE_CASH_FLOW_CHART_HEIGHT,
  FinanceCashFlowChartShell,
} from "@/src/components/finance/cash-flow/FinanceCashFlowChartShell";

function ScenarioTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827] max-w-xs">
      <p className="font-semibold mb-1">Mês: {label}</p>
      {payload.map((entry) => {
        if (entry.value == null) return null;
        const names: Record<string, string> = {
          base: "Base",
          conservative: "Conservador (80% AR / 50% vencidos)",
          stress: "Crítico (60% AR / 30% vencidos)",
        };
        const key = entry.dataKey ?? "";
        return (
          <p key={key} style={{ color: entry.color }}>
            {names[key] ?? key}: {formatFinanceCurrency(entry.value)}
          </p>
        );
      })}
      <p className="text-[#6B7280] mt-1 border-t pt-1">
        Conservador e crítico são simulações — não alteram dados oficiais.
      </p>
    </div>
  );
}

function scenarioChartHasData(points: FinanceCashFlowScenarioChartPoint[]): boolean {
  return points.some(
    (p) => p.base != null || p.conservative != null || p.stress != null
  );
}

export function FinanceCashFlowScenarioChart({
  points,
}: {
  points: FinanceCashFlowScenarioChartPoint[];
}) {
  const empty = !scenarioChartHasData(points);

  return (
    <FinanceCashFlowChartShell
      testId="cash-flow-scenario-chart"
      title="Previsão de caixa por cenário"
      subtitle="Base vs conservador vs crítico · verde = posição positiva · vermelho = negativa"
      empty={empty}
      emptyDescription="Sem dados de previsão para os filtros aplicados."
    >
      <ResponsiveContainer width="100%" height={FINANCE_CASH_FLOW_CHART_HEIGHT}>
        <ComposedChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
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
          <Tooltip content={<ScenarioTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="base" name="Base" maxBarSize={20} radius={[2, 2, 0, 0]}>
            {points.map((entry) => (
              <Cell
                key={`base-${entry.name}`}
                fill={
                  entry.base != null && entry.base < 0
                    ? FINANCE_BI_COLORS.risk
                    : FINANCE_BI_COLORS.success
                }
              />
            ))}
          </Bar>
          <Bar dataKey="conservative" name="Conservador" maxBarSize={20} radius={[2, 2, 0, 0]}>
            {points.map((entry) => (
              <Cell
                key={`cons-${entry.name}`}
                fill={
                  entry.conservative != null && entry.conservative < 0
                    ? "#F59E0B"
                    : "#34D399"
                }
              />
            ))}
          </Bar>
          <Bar dataKey="stress" name="Crítico" maxBarSize={20} radius={[2, 2, 0, 0]}>
            {points.map((entry) => (
              <Cell
                key={`stress-${entry.name}`}
                fill={
                  entry.stress != null && entry.stress < 0
                    ? "#B91C1C"
                    : "#6EE7B7"
                }
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceCashFlowChartShell>
  );
}
