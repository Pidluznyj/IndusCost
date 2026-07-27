/**
 * Gráfico multi-linha — saldos dos cenários na comparação.
 * Legenda textual; cor apenas reforça (não é a única indicação).
 */

import React, { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_BI_COLORS,
  financeBiCardClass,
} from "@/src/lib/financeBiDashboardTheme";
import {
  TREASURY_COMPARISON_SCENARIO_LABELS,
  type TreasuryComparisonChartPoint,
  type TreasuryComparisonScenario,
} from "@/src/lib/treasury/treasuryProjectionComparisonUi.js";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";

const SCENARIO_STROKE: Record<TreasuryComparisonScenario, string> = {
  CONTRACTUAL: "#64748B",
  PROBABLE: FINANCE_BI_COLORS.primary,
  CONFIRMED: FINANCE_BI_COLORS.success,
};

function ComparisonTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TreasuryComparisonChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px]">
      <p className="font-semibold mb-1">{row.label}</p>
      <p>
        {TREASURY_COMPARISON_SCENARIO_LABELS.CONTRACTUAL}: {row.CONTRACTUALText}
      </p>
      <p>
        {TREASURY_COMPARISON_SCENARIO_LABELS.PROBABLE}: {row.PROBABLEText}
      </p>
      <p>
        {TREASURY_COMPARISON_SCENARIO_LABELS.CONFIRMED}: {row.CONFIRMEDText}
      </p>
    </div>
  );
}

function ChartBody({
  points,
  visible,
  height,
}: {
  points: TreasuryComparisonChartPoint[];
  visible: TreasuryComparisonScenario[];
  height: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} />
          <XAxis
            dataKey="label"
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
          <Tooltip content={<ComparisonTooltip />} />
          <Legend
            formatter={(value: string) =>
              TREASURY_COMPARISON_SCENARIO_LABELS[
                value as TreasuryComparisonScenario
              ] ?? value
            }
          />
          {visible.map((scenario) => (
            <Line
              key={scenario}
              type="monotone"
              dataKey={scenario}
              name={scenario}
              stroke={SCENARIO_STROKE[scenario]}
              strokeWidth={2}
              connectNulls
              dot={{ r: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TreasuryProjectionComparisonChart({
  points,
  visible,
}: {
  points: TreasuryComparisonChartPoint[];
  visible: TreasuryComparisonScenario[];
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(420);

  if (points.length === 0) {
    return (
      <div
        className={`${financeBiCardClass} p-4`}
        data-testid="treasury-comparison-chart-empty"
      >
        <p className="text-sm text-muted-foreground">
          Sem pontos de saldo para comparar no período.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`${financeBiCardClass} p-4`}
      data-testid="treasury-comparison-chart"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Evolução do saldo por cenário
          </h3>
          <p className="text-xs text-muted-foreground">
            Linhas: Contratual, Provável e Confirmado. Alternar cenários abaixo
            não recalcula a projeção.
          </p>
        </div>
        <FinanceBiChartExpandButton onClick={() => setExpanded(true)} />
      </div>
      <ChartBody points={points} visible={visible} height={280} />
      <FinanceBiChartExpandModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title="Comparação de saldos por cenário"
      >
        <ChartBody points={points} visible={visible} height={expandedHeight} />
      </FinanceBiChartExpandModal>
    </div>
  );
}
