/**
 * Gráfico de evolução do saldo final da agenda.
 * Cor reforça status; rótulo textual de risco/status sempre presente.
 */

import React, { useState } from "react";
import {
  CartesianGrid,
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
import type { TreasuryAgendaBalanceChartPoint } from "@/src/lib/treasury/treasuryAgendaUi.js";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";

function AgendaBalanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TreasuryAgendaBalanceChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const statusLabel =
    row.status === "positive"
      ? "Saldo positivo"
      : row.status === "negative"
        ? "Saldo negativo"
        : "Saldo zerado";
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px]">
      <p className="font-semibold mb-1">{row.label}</p>
      <p>
        Saldo final: {row.closingBalanceText}{" "}
        <span className="text-muted-foreground">({statusLabel})</span>
      </p>
      <p className="mt-1 text-muted-foreground">{row.riskLabel}</p>
    </div>
  );
}

function ChartBody({
  points,
  height,
  minimumBalance,
}: {
  points: TreasuryAgendaBalanceChartPoint[];
  height: number;
  minimumBalance?: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1} />
          {typeof minimumBalance === "number" && minimumBalance !== 0 ? (
            <ReferenceLine
              y={minimumBalance}
              stroke="#EF4444"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `Limite: ${formatFinanceCurrencyCompact(minimumBalance)}`,
                fill: "#EF4444",
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
          ) : null}
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
          <Tooltip content={<AgendaBalanceTooltip />} />
          <Line
            type="monotone"
            dataKey="closingBalance"
            name="Saldo final"
            stroke={FINANCE_BI_COLORS.primary}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 1, fill: FINANCE_BI_COLORS.card }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export type TreasuryAgendaBalanceChartProps = {
  points: TreasuryAgendaBalanceChartPoint[];
  minimumBalance?: number;
};

export function TreasuryAgendaBalanceChart({
  points,
  minimumBalance = 0,
}: TreasuryAgendaBalanceChartProps) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(420);

  const breaches = points.filter(
    (p) => p.closingBalance < (minimumBalance ?? 0) || p.closingBalance < 0
  );

  if (points.length === 0) {
    return (
      <div
        className={`${financeBiCardClass} p-4`}
        data-testid="treasury-agenda-balance-chart-empty"
      >
        <p className="text-sm text-muted-foreground">
          Sem pontos de saldo para o período selecionado.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`${financeBiCardClass} p-4`}
      data-testid="treasury-agenda-balance-chart"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Evolução do Saldo Final & Linha do Tempo
          </h3>
          <p className="text-xs text-muted-foreground">
            Projeção diária por conta. Linha tracejada em vermelho marca o limite/saldo mínimo configurado.
          </p>
        </div>
        <FinanceBiChartExpandButton
          onClick={() => setExpanded(true)}
          label="Expandir gráfico"
        />
      </div>

      {breaches.length > 0 ? (
        <div
          className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          data-testid="treasury-agenda-limit-warning"
        >
          ⚠️ <strong>Alerta de Limite:</strong> O saldo projetado fica abaixo do limite/negativo em{" "}
          <strong>{breaches.length} dia(s)</strong> no período (primeiro registro em{" "}
          <span className="underline">{breaches[0]?.label}</span>).
        </div>
      ) : null}

      <ChartBody points={points} height={260} minimumBalance={minimumBalance} />
      <FinanceBiChartExpandModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title="Evolução do Saldo Final — Agenda & Linha do Tempo"
      >
        <ChartBody points={points} height={expandedHeight} minimumBalance={minimumBalance} />
      </FinanceBiChartExpandModal>
    </div>
  );
}
