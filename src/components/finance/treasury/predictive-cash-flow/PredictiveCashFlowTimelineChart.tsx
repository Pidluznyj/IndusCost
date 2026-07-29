/**
 * Evolução do saldo — linha firme/suave + barras CR/CP do dia.
 * Slicer livre de período no gráfico; consolidado ou por banco.
 * CR credita e CP debita o saldo da conta/linha.
 */

import React, { useEffect, useMemo, useState } from "react";
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
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowTimelineChartProps = {
  timeline: readonly PredictiveCashFlowDailyBalance[];
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  /** Horizonte carregado (agenda) — base do slicer. */
  fromDate: string;
  toDate: string;
};

type ChartRow = PredictiveEvolutionSeriesPoint & {
  chartReceivables: number;
  chartPayables: number;
  chartPayablesNeg: number;
} & Record<string, number | string | boolean | Record<string, number> | undefined>;

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
    name?: string;
    payload?: ChartRow;
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
        CR (credita): {formatPredictiveCashFlowMoney(row.chartReceivables)}
      </p>
      <p className="text-[#DC2626]">
        CP (debita): {formatPredictiveCashFlowMoney(row.chartPayables)}
      </p>
      {mode === "by_account" ? (
        <ul className="mt-2 space-y-1 border-t border-[#E5E7EB] pt-2">
          {payload
            .filter((p) => accountNames.has(String(p.dataKey ?? "")))
            .map((p) => {
              const key = String(p.dataKey ?? "");
              return (
                <li key={key} className="flex justify-between gap-4 tabular-nums">
                  <span style={{ color: p.color }} className="font-medium">
                    {accountNames.get(key) ?? key}
                  </span>
                  <span className="font-semibold text-[#111827]">
                    {formatPredictiveCashFlowMoney(Number(p.value ?? 0))}
                  </span>
                </li>
              );
            })}
        </ul>
      ) : null}
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
  fromDate,
  toDate,
}: PredictiveCashFlowTimelineChartProps) {
  const [mode, setMode] = useState<PredictiveEvolutionViewMode>("consolidated");
  const [bankId, setBankId] = useState<string>("all");
  const [sliceFrom, setSliceFrom] = useState(fromDate);
  const [sliceTo, setSliceTo] = useState(toDate);
  const [openingLoaded, setOpeningLoaded] = useState(false);
  const [openingAccounts, setOpeningAccounts] = useState<
    Awaited<ReturnType<typeof fetchTreasuryTodayOpening>>["accounts"] | null
  >(null);

  useEffect(() => {
    setSliceFrom(fromDate);
    setSliceTo(toDate);
  }, [fromDate, toDate]);

  const effectiveFrom =
    sliceFrom && sliceTo && sliceFrom > sliceTo ? sliceTo : sliceFrom || fromDate;
  const effectiveTo =
    sliceFrom && sliceTo && sliceFrom > sliceTo ? sliceFrom : sliceTo || toDate;

  useEffect(() => {
    const ac = new AbortController();
    setOpeningLoaded(false);
    void fetchTreasuryTodayOpening({
      date: effectiveFrom,
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
  }, [effectiveFrom]);

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
        fromDate: effectiveFrom,
        toDate: effectiveTo,
        accounts,
        transactions,
        starts,
      });
    }
    const points = timeline
      .filter((d) => d.date >= effectiveFrom && d.date <= effectiveTo)
      .map((d) => ({
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
      fromDate: effectiveFrom,
      toDate: effectiveTo,
      points,
      starts: [],
      startSourceSummary: "automatic" as const,
      accounts: [],
    };
  }, [
    mode,
    effectiveFrom,
    effectiveTo,
    accounts,
    transactions,
    starts,
    timeline,
  ]);

  const chartData = useMemo((): ChartRow[] => {
    return board.points.map((p) => {
      const accountBalances = p.byAccount ?? {};
      const useBank = mode === "by_account" && bankId !== "all";
      const chartReceivables = useBank
        ? Number(p.byAccountReceivables?.[bankId] ?? 0)
        : p.receivables;
      const chartPayables = useBank
        ? Number(p.byAccountPayables?.[bankId] ?? 0)
        : p.payables;
      return {
        ...p,
        ...accountBalances,
        chartReceivables,
        chartPayables,
        chartPayablesNeg: -Math.abs(chartPayables),
        balance: useBank
          ? Number(p.byAccount?.[bankId] ?? p.balance)
          : p.balance,
      } as ChartRow;
    });
  }, [board.points, mode, bankId]);

  const accountNames = useMemo(
    () => new Map(board.accounts.map((a) => [a.id, a.name])),
    [board.accounts]
  );

  const startLabel =
    PREDICTIVE_EVOLUTION_START_SOURCE_LABELS[board.startSourceSummary];

  const visibleAccountLines =
    mode === "by_account" && bankId !== "all"
      ? board.accounts.filter((a) => a.id === bankId)
      : board.accounts;

  return (
    <div className="space-y-3" data-testid="predictive-cf-chart">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
            onClick={() => {
              setMode("consolidated");
              setBankId("all");
            }}
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

        <div
          className="flex flex-wrap items-end gap-2 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2"
          data-testid="predictive-cf-chart-slicer"
        >
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>De</span>
            <input
              type="date"
              className={cn(financeModuleFilterFieldClass(), "w-auto min-w-[9.5rem]")}
              value={effectiveFrom}
              max={effectiveTo}
              onChange={(e) => setSliceFrom(e.target.value)}
              data-testid="predictive-cf-chart-slice-from"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Até</span>
            <input
              type="date"
              className={cn(financeModuleFilterFieldClass(), "w-auto min-w-[9.5rem]")}
              value={effectiveTo}
              min={effectiveFrom}
              onChange={(e) => setSliceTo(e.target.value)}
              data-testid="predictive-cf-chart-slice-to"
            />
          </label>
          {mode === "by_account" ? (
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Banco</span>
              <select
                className={cn(financeModuleFilterFieldClass(), "min-w-[12rem]")}
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
                data-testid="predictive-cf-chart-bank"
              >
                <option value="all">Todos os bancos</option>
                {board.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-[#374151] hover:bg-white"
            onClick={() => {
              setSliceFrom(fromDate);
              setSliceTo(toDate);
            }}
          >
            Resetar período
          </button>
        </div>
      </div>

      <p className="text-xs text-[#6B7280]" data-testid="predictive-cf-chart-start-source">
        Partida: {startLabel}
        {!openingLoaded ? " · carregando abertura…" : ""}
        {" · "}
        Barras verdes = CR (somam) · barras vermelhas = CP (debitam) · linha = saldo
      </p>

      {chartData.length === 0 ? (
        <div
          className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[#E5E7EB] bg-[#F8FAFC] text-sm text-[#6B7280]"
          data-testid="predictive-cf-chart-empty"
        >
          Sem dados de projeção para o período do slicer.
        </div>
      ) : (
        <div className="h-96 w-full min-h-[22rem]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
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
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar
                dataKey="chartReceivables"
                name="CR (a receber)"
                fill="#34D399"
                fillOpacity={0.85}
                maxBarSize={28}
                isAnimationActive={false}
              />
              <Bar
                dataKey="chartPayablesNeg"
                name="CP (a pagar)"
                fill="#F87171"
                fillOpacity={0.9}
                maxBarSize={28}
                isAnimationActive={false}
              />
              {mode === "consolidated" ||
              (mode === "by_account" && bankId !== "all") ? (
                <Line
                  type="monotone"
                  dataKey="balance"
                  name={
                    bankId !== "all" && mode === "by_account"
                      ? accountNames.get(bankId) ?? "Saldo"
                      : "Saldo consolidado"
                  }
                  stroke="#0369a1"
                  strokeWidth={3}
                  dot={{ r: 3.5, strokeWidth: 2, fill: "#fff", stroke: "#0369a1" }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ) : (
                visibleAccountLines.map((a) => (
                  <Line
                    key={a.id}
                    type="monotone"
                    dataKey={a.id}
                    name={a.name}
                    stroke={a.color}
                    strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 2, fill: "#fff", stroke: a.color }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
