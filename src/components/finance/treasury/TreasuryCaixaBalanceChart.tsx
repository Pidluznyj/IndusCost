/**
 * Caixa — Passo 9: evolução do saldo final, mês a mês, até o fim do ano.
 *
 * O ponto é o fechamento do mês, que JÁ vem acumulado desde a gênese pela
 * cadeia da linha do tempo — nada é somado aqui. Realizado e previsto entram na
 * mesma linha (o saldo é contínuo), mas o previsto é tracejado, porque é
 * estimativa e o usuário precisa enxergar onde o fato acaba.
 *
 * Toda a série vem do domínio (`buildTreasuryCaixaMonthlyBalanceChart`).
 */

import React from "react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TreasuryCaixaBalanceChartPoint } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";

/**
 * Recharts só tracejaria a linha inteira, não um trecho. Para separar fato de
 * estimativa desenhamos DUAS séries sobre o mesmo eixo: uma com os meses
 * realizados e outra com os previstos. O último mês realizado entra também na
 * série prevista — sem esse ponto em comum a linha apareceria partida no meio.
 */
type ChartRow = TreasuryCaixaBalanceChartPoint & {
  realized: number | null;
  forecast: number | null;
};

function buildChartRows(
  points: readonly TreasuryCaixaBalanceChartPoint[]
): ChartRow[] {
  const lastRealizedIndex = points.reduce(
    (acc, p, i) => (p.isForecast ? acc : i),
    -1
  );
  return points.map((p, i) => ({
    ...p,
    realized: p.isForecast ? null : p.closingBalance,
    forecast: p.isForecast || i === lastRealizedIndex ? p.closingBalance : null,
  }));
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[11px] shadow-sm">
      <p className="mb-1 font-semibold">{row.label}</p>
      <p>
        Saldo final:{" "}
        <span
          className={
            row.closingBalance < 0 ? "font-bold text-[#DC2626]" : "font-bold"
          }
        >
          {formatPredictiveCashFlowMoney(row.closingBalance)}
        </span>
      </p>
      <p className="mt-1 text-muted-foreground">
        {row.isForecast ? "Previsto pelos títulos em aberto" : "Realizado"}
      </p>
    </div>
  );
}

export type TreasuryCaixaBalanceChartBrush = {
  /** Índice inicial/final (inclusivos) da janela visível — controlado. */
  startIndex: number;
  endIndex: number;
  onChange: (range: { startIndex?: number; endIndex?: number }) => void;
};

export type TreasuryCaixaBalanceChartProps = {
  points: readonly TreasuryCaixaBalanceChartPoint[];
  /** Ação opcional no cabeçalho (ex.: botão "Visão anual" da página). */
  headerAction?: React.ReactNode;
  /**
   * Range slicer opcional (Visão Anual): Brush nativo do Recharts operando
   * na MESMA granularidade mensal do gráfico. A página da Caixa não passa a
   * prop — comportamento atual intacto.
   */
  brush?: TreasuryCaixaBalanceChartBrush;
};

export function TreasuryCaixaBalanceChart({
  points,
  headerAction,
  brush,
}: TreasuryCaixaBalanceChartProps) {
  if (points.length === 0) return null;

  const rows = buildChartRows(points);
  const negatives = rows.filter((r) => r.closingBalance < 0);
  const firstNegative = negatives[0];
  const lowest = rows.reduce(
    (min, r) => (r.closingBalance < min.closingBalance ? r : min),
    rows[0]!
  );

  return (
    <section
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
      data-testid="caixa-balance-chart"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Evolução do saldo — mês a mês
        </h2>
        {headerAction ?? null}
      </div>
      <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">
        Saldo no fim de cada mês, acumulado. Linha cheia é o que já aconteceu;
        tracejada é a previsão pelos títulos em aberto.
      </p>

      {firstNegative ? (
        <div
          className="mb-3 rounded border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[11px] leading-snug text-[#92400E]"
          data-testid="caixa-balance-chart-negative-warning"
        >
          O saldo fica <strong>negativo</strong> a partir de{" "}
          <strong>{firstNegative.label}</strong>
          {negatives.length > 1 ? (
            <>
              {" "}
              e em mais {negatives.length - 1}{" "}
              {negatives.length - 1 === 1 ? "mês" : "meses"}
            </>
          ) : null}
          . Pior momento: <strong>{lowest.label}</strong>, com{" "}
          <strong>{formatPredictiveCashFlowMoney(lowest.closingBalance)}</strong>{" "}
          — é o capital de giro que faltaria.
        </div>
      ) : null}

      <div style={{ width: "100%", height: brush ? 280 : 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={FINANCE_BI_COLORS.border}
            />
            <ReferenceLine
              y={0}
              stroke={FINANCE_BI_COLORS.textSecondary}
              strokeWidth={1}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
              tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
              width={72}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<BalanceTooltip />} />
            <Line
              type="monotone"
              dataKey="realized"
              name="Realizado"
              stroke={FINANCE_BI_COLORS.primary}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Previsto"
              stroke={FINANCE_BI_COLORS.textSecondary}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {brush ? (
              <Brush
                dataKey="label"
                height={26}
                travellerWidth={8}
                stroke={FINANCE_BI_COLORS.primary}
                fill="transparent"
                startIndex={brush.startIndex}
                endIndex={brush.endIndex}
                onChange={(range) =>
                  brush.onChange({
                    startIndex: range?.startIndex,
                    endIndex: range?.endIndex,
                  })
                }
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
