/**
 * Evolução do saldo — linha firme/suave, visão consolidada (default) ou por banco.
 * Partida: abertura informada → fechamento de ontem → automático.
 */

import React, { useEffect, useMemo, useState } from "react";
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
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowDailyBalance,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { fetchTreasuryTodayOpening } from "@/src/lib/treasury/treasuryTodayOpeningApi.js";
import {
  buildPredictiveEvolutionBoard,
  PREDICTIVE_EVOLUTION_START_SOURCE_LABELS,
  resolvePredictiveEvolutionStartsFromOpeningWorkspace,
  type PredictiveEvolutionSeriesPoint,
  type PredictiveEvolutionViewMode,
} from "@/src/lib/treasury/treasuryPredictiveCashFlowEvolution.js";
import { resolveTreasurySimpleCashRiskRange } from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import type { TreasurySimpleCashRiskPeriod } from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryAgendaUi.js";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowTimelineChartProps = {
  timeline: readonly PredictiveCashFlowDailyBalance[];
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  period: TreasurySimpleCashRiskPeriod;
};

function EvolutionTooltip({
  active,
  payload,
  mode,
  accountNames,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number;
    color?: string;
    payload?: PredictiveEvolutionSeriesPoint & Record<string, number>;
  }>;
  mode: PredictiveEvolutionViewMode;
  accountNames: ReadonlyMap<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-xs shadow-md">
      <p className="mb-1.5 text-sm font-bold text-[#111827]">{row.label}</p>
      {mode === "consolidated" ? (
        <>
          <p className="tabular-nums text-[#111827]">
            Saldo:{" "}
            <span className="font-semibold">
              {formatPredictiveCashFlowMoney(Number(row.balance))}
            </span>
          </p>
          <p className="mt-1 text-[#6B7280]">
            Abertura: {formatPredictiveCashFlowMoney(row.opening)}
          </p>
          <p className="text-[#059669]">
            CR: {formatPredictiveCashFlowMoney(row.receivables)}
          </p>
          <p className="text-[#DC2626]">
            CP: {formatPredictiveCashFlowMoney(row.payables)}
          </p>
        </>
      ) : (
        <ul className="space-y-1">
          {payload.map((p) => {
            const key = String(p.dataKey ?? "");
            const name = accountNames.get(key) ?? key;
            return (
              <li key={key} className="flex justify-between gap-4 tabular-nums">
                <span style={{ color: p.color }} className="font-medium">
                  {name}
                </span>
                <span className="font-semibold text-[#111827]">
                  {formatPredictiveCashFlowMoney(Number(p.value ?? 0))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {row.belowLimit ? (
        <p className="mt-2 font-semibold text-[#DC2626]">
          Abaixo do limite (caixa negativo)
        </p>
      ) : null}
    </div>
  );
}

export function PredictiveCashFlowTimelineChart({
  timeline,
  accounts,
  transactions,
  period,
}: PredictiveCashFlowTimelineChartProps) {
  const [mode, setMode] = useState<PredictiveEvolutionViewMode>("consolidated");
  const [openingLoaded, setOpeningLoaded] = useState(false);
  const [openingAccounts, setOpeningAccounts] = useState<
    Awaited<ReturnType<typeof fetchTreasuryTodayOpening>>["accounts"] | null
  >(null);

  const range = useMemo(() => {
    if (timeline.length > 0) {
      return {
        baseDate: timeline[0]!.date,
        endDate: timeline[timeline.length - 1]!.date,
      };
    }
    return resolveTreasurySimpleCashRiskRange(period, todayCivilDateLocal());
  }, [timeline, period]);

  useEffect(() => {
    const ac = new AbortController();
    setOpeningLoaded(false);
    void fetchTreasuryTodayOpening({
      date: range.baseDate,
      signal: ac.signal,
    })
      .then((ws) => {
        if (ac.signal.aborted) return;
        setOpeningAccounts(ws.accounts);
        setOpeningLoaded(true);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setOpeningAccounts(null);
        setOpeningLoaded(true);
      });
    return () => ac.abort();
  }, [range.baseDate]);

  const starts = useMemo(
    () =>
      resolvePredictiveEvolutionStartsFromOpeningWorkspace({
        accounts,
        openingAccounts,
      }),
    [accounts, openingAccounts]
  );

  const board = useMemo(() => {
    if (accounts.some((a) => a.isActive && a.includeInConsolidated)) {
      return buildPredictiveEvolutionBoard({
        mode,
        fromDate: range.baseDate,
        toDate: range.endDate,
        accounts,
        transactions,
        starts,
      });
    }
    // Fallback: só agenda consolidada (sem contas mapeadas).
    const points = timeline.map((d) => ({
      date: d.date,
      label: formatPredictiveCashFlowDate(d.date),
      opening: d.openingBalance,
      balance: d.balance,
      balanceText: formatPredictiveCashFlowMoney(d.balance),
      receivables: d.receivables,
      payables: d.payables,
      belowLimit: d.balance < 0,
    }));
    return {
      mode,
      fromDate: range.baseDate,
      toDate: range.endDate,
      points,
      starts: [],
      startSourceSummary: "automatic" as const,
      accounts: [],
    };
  }, [
    mode,
    range.baseDate,
    range.endDate,
    accounts,
    transactions,
    starts,
    timeline,
  ]);

  const chartData = useMemo(() => {
    return board.points.map((p) => {
      const row: PredictiveEvolutionSeriesPoint & Record<string, number> = {
        ...p,
      };
      if (p.byAccount) {
        for (const [id, value] of Object.entries(p.byAccount)) {
          row[id] = value;
        }
      }
      return row;
    });
  }, [board.points]);

  const accountNames = useMemo(
    () => new Map(board.accounts.map((a) => [a.id, a.name])),
    [board.accounts]
  );

  const startLabel =
    PREDICTIVE_EVOLUTION_START_SOURCE_LABELS[board.startSourceSummary];

  if (chartData.length === 0) {
    return (
      <div
        className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[#E5E7EB] bg-[#F8FAFC] text-sm text-[#6B7280]"
        data-testid="predictive-cf-chart-empty"
      >
        Sem dados de projeção para o período. Cadastre contas e carregue a agenda.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="predictive-cf-chart">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-0.5"
          role="group"
          aria-label="Visão do gráfico"
        >
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition",
              mode === "consolidated"
                ? "bg-white text-[#0369a1] shadow-sm"
                : "text-[#6B7280] hover:text-[#111827]"
            )}
            onClick={() => setMode("consolidated")}
            data-testid="predictive-cf-chart-mode-consolidated"
          >
            Consolidado
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition",
              mode === "by_account"
                ? "bg-white text-[#0369a1] shadow-sm"
                : "text-[#6B7280] hover:text-[#111827]"
            )}
            onClick={() => setMode("by_account")}
            data-testid="predictive-cf-chart-mode-by-account"
          >
            Por banco
          </button>
        </div>
        <p className="text-xs text-[#6B7280]" data-testid="predictive-cf-chart-start-source">
          Partida: {startLabel}
          {!openingLoaded ? " · carregando abertura…" : ""}
        </p>
      </div>

      <div className="h-80 w-full min-h-[20rem]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 16, right: 16, left: 8, bottom: 8 }}
          >
            <CartesianGrid
              stroke={FINANCE_BI_COLORS.border}
              strokeDasharray="4 4"
              vertical={false}
            />
            <ReferenceLine
              y={0}
              stroke="#DC2626"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              label={{
                value: "Limite (R$ 0)",
                position: "insideTopRight",
                fill: "#DC2626",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "#6B7280", fontSize: 12, fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: "#374151", fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              width={88}
              tickFormatter={(v: number) =>
                new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                  notation: "compact",
                  compactDisplay: "short",
                  maximumFractionDigits: 1,
                }).format(v)
              }
            />
            <Tooltip
              content={
                <EvolutionTooltip mode={mode} accountNames={accountNames} />
              }
            />
            {mode === "by_account" ? (
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(value: string) => accountNames.get(value) ?? value}
              />
            ) : null}
            {mode === "consolidated" ? (
              <Line
                type="monotone"
                dataKey="balance"
                name="Saldo consolidado"
                stroke="#0369a1"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#0369a1" }}
                activeDot={{ r: 6, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ) : (
              board.accounts.map((a) => (
                <Line
                  key={a.id}
                  type="monotone"
                  dataKey={a.id}
                  name={a.id}
                  stroke={a.color}
                  strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 2, fill: "#fff", stroke: a.color }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-[#6B7280]">
        Linha do comportamento do caixa ao longo dos dias. Use o tooltip para
        valores exatos. A linha vermelha tracejada marca o limite (saldo zero).
      </p>
    </div>
  );
}
