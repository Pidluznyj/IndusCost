/**
 * Caixa — modal "Visão anual" da Linha do Tempo Financeira.
 *
 * Contratos desta tela:
 *  - carregada por React.lazy a partir da página (chunk separado);
 *  - NENHUM request ao abrir o modal nem ao trocar o ano — o fetch acontece
 *    exclusivamente no clique em "Gerar gráfico" (`handleGenerate`);
 *  - reutiliza o MESMO endpoint do board (`fetchTreasuryCaixa` só com year,
 *    sem mês/dia → 01/01–31/12 pelo motor) e a MESMA agenda canônica que a
 *    página busca por período — nenhum endpoint novo, nenhuma regra nova;
 *  - a série e os KPIs saem de `treasuryCaixaAnnualViewUi` (composição das
 *    funções canônicas — a mesma cadeia do gráfico "Evolução do saldo");
 *  - o gráfico é o PRÓPRIO `TreasuryCaixaBalanceChart` da página;
 *  - corrida: AbortController + número de sequência — resposta antiga nunca
 *    sobrescreve o ano mais novo; fechar/desmontar aborta e descarta.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import { TreasuryCaixaBalanceChart } from "@/src/components/finance/treasury/TreasuryCaixaBalanceChart";
import {
  fetchTreasuryCaixa,
  type TreasuryCaixaPayload,
} from "@/src/lib/treasury/treasuryCaixaApi.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import type { TreasuryAgendaDayDto } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryCaixaDayFlow } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import {
  annualRangeToCivilDates,
  buildTreasuryCaixaAnnualSeries,
  civilDateToAnnualIndex,
  deriveTreasuryCaixaAnnualKpis,
  matchAnnualPreset,
  normalizeAnnualRange,
  resolveAnnualPresetRange,
  sliceTreasuryCaixaAnnualSeries,
  TREASURY_CAIXA_ANNUAL_PRESETS,
  type TreasuryCaixaAnnualRange,
  type TreasuryCaixaAnnualSeries,
} from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

type AnnualResult = {
  year: number;
  series: TreasuryCaixaAnnualSeries;
};

function KpiCard({
  label,
  value,
  hint,
  negative,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  negative?: boolean;
  testId: string;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
      data-testid={testId}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={
          "mt-1 text-lg font-extrabold tabular-nums tracking-tight" +
          (negative ? " text-[#DC2626]" : " text-foreground")
        }
      >
        {value}
      </p>
      {hint ? (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export type TreasuryCaixaAnnualViewModalProps = {
  defaultYear: number;
  yearOptions: readonly number[];
  /** Fluxo bruto de hoje já carregado pela página (nenhum fetch extra). */
  todayFlowRaw: TreasuryCaixaDayFlow | null;
  /** Empresa das contas da página — necessária para a agenda canônica. */
  companyCode: string | null;
  onClose: () => void;
};

export function TreasuryCaixaAnnualViewModal({
  defaultYear,
  yearOptions,
  todayFlowRaw,
  companyCode,
  onClose,
}: TreasuryCaixaAnnualViewModalProps) {
  const [year, setYear] = useState(defaultYear);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnnualResult | null>(null);
  // Slicer de período — recorte LOCAL da série carregada (índices de mês).
  // Nenhum request ao mover: gráfico (Brush), datas e KPIs derivam daqui.
  const [range, setRange] = useState<TreasuryCaixaAnnualRange | null>(null);

  // Cache por ano enquanto o modal está aberto: voltar a um ano já gerado
  // não refaz o request. Vive num ref para não reexecutar efeitos.
  const cacheRef = useRef(
    new Map<
      number,
      { board: TreasuryCaixaPayload; agendaDays: readonly TreasuryAgendaDayDto[] }
    >()
  );
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Fechar/desmontar: aborta o request em voo e invalida a sequência —
  // nenhuma resposta tardia toca o state depois do unmount.
  useEffect(() => {
    return () => {
      seqRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleGenerate = useCallback(async () => {
    const requestedYear = year;
    const seq = (seqRef.current += 1);
    abortRef.current?.abort();

    const cached = cacheRef.current.get(requestedYear);
    if (cached) {
      const series = buildTreasuryCaixaAnnualSeries({
        board: cached.board,
        todayFlowRaw,
        agendaDays: cached.agendaDays,
      });
      setResult({ year: requestedYear, series });
      setRange(
        series.points.length > 0
          ? { startIndex: 0, endIndex: series.points.length - 1 }
          : null
      );
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      // MESMO endpoint do board da página; sem month/day → ano civil inteiro.
      const board = await fetchTreasuryCaixa({
        year: requestedYear,
        signal: controller.signal,
      });

      // MESMA agenda canônica que a página busca para o período retornado.
      let agendaDays: readonly TreasuryAgendaDayDto[] = [];
      if (companyCode) {
        try {
          const agenda = await fetchTreasuryAgenda({
            companyCode,
            baseDate: board.dueDateFrom,
            endDate: board.dueDateTo,
            scenario: "PROBABLE",
            accountIds: null,
            consolidated: true,
            includeDayDetail: false,
            signal: controller.signal,
          });
          agendaDays = agenda.days ?? [];
        } catch (agendaErr) {
          if (controller.signal.aborted) throw agendaErr;
          // Sem projeção materializada: o futuro cai no fallback por
          // vencimento (dailyDueEstimates) — mesmo comportamento da página.
          agendaDays = [];
        }
      }

      if (seq !== seqRef.current) return; // outro "Gerar" venceu
      cacheRef.current.set(requestedYear, { board, agendaDays });
      const series = buildTreasuryCaixaAnnualSeries({
        board,
        todayFlowRaw,
        agendaDays,
      });
      setResult({ year: requestedYear, series });
      setRange(
        series.points.length > 0
          ? { startIndex: 0, endIndex: series.points.length - 1 }
          : null
      );
    } catch (err) {
      if (seq !== seqRef.current || controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : "Erro ao gerar a visão anual."
      );
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [year, companyCode, todayFlowRaw]);

  // ── Slicer: recorte local + sincronização preset ↔ datas ↔ brush ──────
  const points = result?.series.points ?? [];
  const activeRange =
    result != null && range != null && points.length > 0
      ? normalizeAnnualRange(points.length, range)
      : null;
  const visible =
    result != null && activeRange != null
      ? sliceTreasuryCaixaAnnualSeries(result.series, activeRange)
      : null;
  const kpis = visible != null ? deriveTreasuryCaixaAnnualKpis(visible) : null;
  const rangeDates =
    activeRange != null ? annualRangeToCivilDates(points, activeRange) : null;
  const activePreset =
    activeRange != null ? matchAnnualPreset(points, activeRange) : null;

  const applyDate = useCallback(
    (side: "from" | "to", civil: string) => {
      if (activeRange == null || points.length === 0) return;
      const idx = civilDateToAnnualIndex(points, civil);
      if (idx == null) return; // entrada não-parseável: mantém estado atual
      setRange(
        normalizeAnnualRange(points.length, {
          startIndex: side === "from" ? idx : activeRange.startIndex,
          endIndex: side === "to" ? idx : activeRange.endIndex,
        })
      );
    },
    [activeRange, points]
  );

  return (
    <CostCenterDialog
      testId="caixa-annual-view-modal"
      title="Visão anual da Tesouraria"
      subtitle="Analise a Linha do Tempo Financeira de um ano completo — mesmas regras e mesma leitura do gráfico da Caixa."
      maxWidthClass="max-w-5xl"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            data-testid="caixa-annual-close"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="caixa-annual-year"
              className={financeModuleFilterLabelClass}
            >
              Ano
            </label>
            <select
              id="caixa-annual-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className={financeModuleFilterFieldClass}
              data-testid="caixa-annual-year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-60"
            data-testid="caixa-annual-generate"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? "Gerando…" : "Gerar gráfico"}
          </button>
        </div>

        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
            data-testid="caixa-annual-error"
          >
            {error}{" "}
            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="font-semibold underline"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}

        {result == null && !loading && !error ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            data-testid="caixa-annual-idle"
          >
            Escolha o ano e clique em <strong>Gerar gráfico</strong> para
            montar a linha do tempo de janeiro a dezembro.
          </p>
        ) : null}

        {result != null && kpis != null && activeRange != null ? (
          <>
            <div
              className="flex flex-wrap items-end gap-3"
              data-testid="caixa-annual-slicer"
            >
              <div className="flex flex-wrap gap-1.5">
                {TREASURY_CAIXA_ANNUAL_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() =>
                      setRange(resolveAnnualPresetRange(points, preset))
                    }
                    className={
                      "rounded-md border px-2.5 py-1 text-[11px] font-semibold " +
                      (activePreset === preset.key
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-border text-foreground hover:bg-muted")
                    }
                    data-testid={`caixa-annual-preset-${preset.key}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label
                    htmlFor="caixa-annual-from"
                    className={financeModuleFilterLabelClass}
                  >
                    De
                  </label>
                  <input
                    id="caixa-annual-from"
                    type="date"
                    value={rangeDates?.fromCivil ?? ""}
                    min={`${result.year}-01-01`}
                    max={`${result.year}-12-31`}
                    onChange={(e) => applyDate("from", e.target.value)}
                    className={financeModuleFilterFieldClass}
                    data-testid="caixa-annual-from"
                  />
                </div>
                <div>
                  <label
                    htmlFor="caixa-annual-to"
                    className={financeModuleFilterLabelClass}
                  >
                    Até
                  </label>
                  <input
                    id="caixa-annual-to"
                    type="date"
                    value={rangeDates?.toCivil ?? ""}
                    min={`${result.year}-01-01`}
                    max={`${result.year}-12-31`}
                    onChange={(e) => applyDate("to", e.target.value)}
                    className={financeModuleFilterFieldClass}
                    data-testid="caixa-annual-to"
                  />
                </div>
              </div>
            </div>
            <p className="-mt-2 text-[10px] text-muted-foreground">
              O recorte segue a granularidade do gráfico (mês a mês): a data
              escolhida seleciona o mês correspondente. Tudo local — nenhum
              novo carregamento.
            </p>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Saldo inicial do período"
                value={formatMoney(kpis.initialBalance)}
                negative={(kpis.initialBalance ?? 0) < 0}
                testId="caixa-annual-kpi-initial"
              />
              <KpiCard
                label="Menor saldo do período"
                value={formatMoney(kpis.lowestBalance)}
                hint={kpis.lowestBalanceIsForecast ? "previsto" : "realizado"}
                negative={(kpis.lowestBalance ?? 0) < 0}
                testId="caixa-annual-kpi-lowest"
              />
              <KpiCard
                label="Mês do menor saldo"
                value={kpis.lowestBalanceLabel ?? "—"}
                testId="caixa-annual-kpi-lowest-date"
              />
              <KpiCard
                label={
                  kpis.finalBalanceIsForecast
                    ? "Saldo final projetado"
                    : "Saldo final realizado"
                }
                value={formatMoney(kpis.finalBalance)}
                negative={(kpis.finalBalance ?? 0) < 0}
                testId="caixa-annual-kpi-final"
              />
            </div>

            {points.length > 0 ? (
              <TreasuryCaixaBalanceChart
                points={points}
                brush={{
                  startIndex: activeRange.startIndex,
                  endIndex: activeRange.endIndex,
                  onChange: ({ startIndex, endIndex }) => {
                    if (startIndex == null || endIndex == null) return;
                    setRange(
                      normalizeAnnualRange(points.length, {
                        startIndex,
                        endIndex,
                      })
                    );
                  },
                }}
              />
            ) : (
              <p
                className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
                data-testid="caixa-annual-empty"
              >
                Sem movimentação registrada para {result.year}.
              </p>
            )}
          </>
        ) : null}
      </div>
    </CostCenterDialog>
  );
}

export default TreasuryCaixaAnnualViewModal;
