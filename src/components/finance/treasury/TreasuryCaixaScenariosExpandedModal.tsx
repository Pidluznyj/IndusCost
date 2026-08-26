/**
 * Projeção do caixa — cenários — modal "Visão ampliada".
 *
 * Janela COMPLETA do ano civil: passado REALIZADO (01/01 → ontem, da série
 * canônica da Linha do tempo — a mesma composição da Visão Anual) + HOJE →
 * 31/12 PROJETADO pelo MESMO motor de cenários do card.
 *
 * Contratos:
 *  - carregado por React.lazy a partir da página (chunk separado);
 *  - NENHUM request ao abrir o modal; o clique em "Gerar projeção" dispara
 *    UM carregamento (cenários + board anual + agenda — todos endpoints
 *    canônicos existentes, os mesmos do card e da página);
 *  - o motor de cenários NÃO foi alterado: ele segue prospectivo e ancorado
 *    no saldo oficial de hoje; o passado entra como PREFIXO de linhas
 *    realizadas (três cenários coincidem com o realizado — a mesma regra
 *    que o motor aplica a dias < asOf);
 *  - o gráfico é o PRÓPRIO TreasuryCaixaScenariosChart (props opt-in
 *    prefix/brush); a linha Realista futura usa a MESMA timeline anual
 *    canônica (fonte única);
 *  - slicer 100% LOCAL (Ano completo / Hoje→31/12 / próx. 90/180 dias,
 *    datas civis, brush diário); KPIs derivam das linhas desenhadas;
 *  - corrida: AbortController + sequência; fechar/desmontar aborta.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import {
  buildTreasuryJpegFileName,
  exportTreasuryElementToJpeg,
} from "@/src/lib/treasury/treasuryChartJpegExport.js";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import {
  buildRows,
  TreasuryCaixaScenariosChart,
  type ScenarioChartRow,
} from "@/src/components/finance/treasury/TreasuryCaixaScenariosChart";
import {
  fetchTreasuryCaixaScenarios,
  type TreasuryCaixaScenariosPayload,
} from "@/src/lib/treasury/treasuryCaixaScenariosApi.js";
import { fetchTreasuryCaixa } from "@/src/lib/treasury/treasuryCaixaApi.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryAgendaDayDto } from "@/src/lib/treasury/contracts/index.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCaixaDayFlow } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { buildTreasuryCaixaAnnualSeries } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import {
  buildScenarioPastPrefix,
  civilDateToScenarioIndex,
  deriveScenarioExpandedKpis,
  matchScenarioFullPreset,
  normalizeScenarioExpandedRange,
  resolveScenarioExpandedHorizon,
  resolveScenarioFullPresetRange,
  TREASURY_SCENARIO_FULL_PRESETS,
  type TreasuryScenarioExpandedRange,
} from "@/src/lib/treasury/treasuryCaixaScenariosExpandedUi.js";
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
          "mt-1 text-base font-extrabold tabular-nums tracking-tight" +
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

type LoadedData = {
  payload: TreasuryCaixaScenariosPayload;
  /** Timeline anual canônica (passado+hoje+futuro) — fonte única do Realista. */
  annualRows: readonly {
    civilDate: string;
    opening: number | null;
    closing: number | null;
    inflows: number;
    outflows: number;
  }[];
};

export type TreasuryCaixaScenariosExpandedModalProps = {
  /** Fluxo bruto de hoje já carregado pela página (nenhum fetch extra). */
  todayFlowRaw: TreasuryCaixaDayFlow | null;
  /** Empresa das contas da página — necessária para a agenda canônica. */
  companyCode: string | null;
  onClose: () => void;
};

export function TreasuryCaixaScenariosExpandedModal({
  todayFlowRaw,
  companyCode,
  onClose,
}: TreasuryCaixaScenariosExpandedModalProps) {
  const todayCivil = todayTreasuryCivilDateInSaoPaulo();
  const horizon = useMemo(
    () => resolveScenarioExpandedHorizon(todayCivil),
    [todayCivil]
  );
  const yearStartCivil = `${todayCivil.slice(0, 4)}-01-01`;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedData | null>(null);
  const [range, setRange] = useState<TreasuryScenarioExpandedRange | null>(
    null
  );

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<LoadedData | null>(null);
  // Impressão em JPEG — captura o conteúdo do modal (KPIs + slicer + gráfico).
  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const [printing, setPrinting] = useState(false);
  const handlePrint = useCallback(async () => {
    const el = printAreaRef.current;
    if (!el || printing) return;
    setPrinting(true);
    try {
      await exportTreasuryElementToJpeg(
        el,
        buildTreasuryJpegFileName("projecao-caixa-visao-ampliada")
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao gerar a imagem."
      );
    } finally {
      setPrinting(false);
    }
  }, [printing]);

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
    const seq = (seqRef.current += 1);
    abortRef.current?.abort();

    const applyLoaded = (loaded: LoadedData) => {
      setData(loaded);
      const pastCount = loaded.annualRows.filter(
        (r) => r.civilDate < loaded.payload.asOfCivilDate
      ).length;
      const total = pastCount + loaded.payload.days.length;
      setRange(total > 0 ? { startIndex: 0, endIndex: total - 1 } : null);
      setError(null);
    };

    if (cacheRef.current) {
      applyLoaded(cacheRef.current);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const year = Number(todayCivil.slice(0, 4));
      // MESMOS endpoints canônicos: cenários (card) + board anual (página/
      // Visão Anual). A agenda entra na composição da timeline anual —
      // idêntica à pesquisa da página para o ano corrente.
      const [payload, board] = await Promise.all([
        fetchTreasuryCaixaScenarios({
          horizonDays: horizon.horizonDays,
          signal: controller.signal,
        }),
        fetchTreasuryCaixa({ year, signal: controller.signal }),
      ]);

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
          agendaDays = []; // fallback por vencimento — mesmo padrão da página
        }
      }

      if (seq !== seqRef.current) return;
      const annual = buildTreasuryCaixaAnnualSeries({
        board,
        todayFlowRaw,
        agendaDays,
      });
      const loaded: LoadedData = {
        payload,
        annualRows: annual.timeline.rows,
      };
      cacheRef.current = loaded;
      applyLoaded(loaded);
    } catch (err) {
      if (seq !== seqRef.current || controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : "Erro ao gerar a projeção."
      );
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [horizon.horizonDays, todayCivil, companyCode, todayFlowRaw]);

  // ── Prefixo do passado + linhas futuras (MESMO buildRows do gráfico) ────
  const prefix = useMemo(
    () =>
      data
        ? buildScenarioPastPrefix({
            timelineRows: data.annualRows,
            asOfCivilDate: data.payload.asOfCivilDate,
          })
        : null,
    [data]
  );

  const timelineByDate = useMemo(() => {
    if (!data) return null;
    const map = new Map<
      string,
      { opening: number | null; closing: number | null }
    >();
    for (const r of data.annualRows) {
      map.set(r.civilDate, { opening: r.opening, closing: r.closing });
    }
    return map;
  }, [data]);

  const futureRows = useMemo(
    () =>
      data
        ? buildRows(
            data.payload.days,
            data.payload.asOfCivilDate,
            timelineByDate,
            data.payload.salesVolumeScenarios ?? null,
            null
          )
        : [],
    [data, timelineByDate]
  );
  const rows = useMemo<ScenarioChartRow[]>(
    () =>
      prefix
        ? [...(prefix.rows as unknown as ScenarioChartRow[]), ...futureRows]
        : futureRows,
    [prefix, futureRows]
  );
  const pastCount = prefix?.rows.length ?? 0;
  const civilDates = useMemo(() => rows.map((r) => r.civilDate), [rows]);

  const activeRange =
    data != null && range != null && rows.length > 0
      ? normalizeScenarioExpandedRange(rows.length, range)
      : null;
  const visibleRows = useMemo(
    () =>
      activeRange != null
        ? rows.slice(activeRange.startIndex, activeRange.endIndex + 1)
        : [],
    [rows, activeRange]
  );
  const kpis =
    activeRange != null ? deriveScenarioExpandedKpis(visibleRows) : null;
  const activePreset =
    activeRange != null
      ? matchScenarioFullPreset(rows.length, pastCount, activeRange)
      : null;

  const applyDate = useCallback(
    (side: "from" | "to", civil: string) => {
      if (activeRange == null || civilDates.length === 0) return;
      const idx = civilDateToScenarioIndex(civilDates, civil);
      if (idx == null) return;
      setRange(
        normalizeScenarioExpandedRange(civilDates.length, {
          startIndex: side === "from" ? idx : activeRange.startIndex,
          endIndex: side === "to" ? idx : activeRange.endIndex,
        })
      );
    },
    [activeRange, civilDates]
  );

  return (
    <CostCenterDialog
      testId="caixa-scenarios-expanded-modal"
      title="Projeção do caixa — visão ampliada"
      subtitle={`Ano completo: realizado de ${formatCivilDate(yearStartCivil)} até ontem (Linha do tempo) + projeção de hoje (${formatCivilDate(todayCivil)}) até ${formatCivilDate(horizon.endCivil)} pelo mesmo motor de cenários.`}
      maxWidthClass="max-w-6xl"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            data-testid="caixa-scenarios-expanded-close"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div ref={printAreaRef} className="flex flex-col gap-4 bg-white">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Período:{" "}
            <span className="font-semibold text-foreground">
              {formatCivilDate(yearStartCivil)} →{" "}
              {formatCivilDate(horizon.endCivil)}
            </span>{" "}
            (realizado + {horizon.horizonDays} dias projetados)
          </p>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-60"
            data-testid="caixa-scenarios-expanded-generate"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? "Gerando…" : "Gerar projeção"}
          </button>
          {data != null ? (
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={printing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              data-testid="caixa-scenarios-expanded-print"
              title="Baixar esta tela como imagem JPEG em alta resolução"
            >
              {printing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Imprimir (JPEG)
            </button>
          ) : null}
        </div>

        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
            data-testid="caixa-scenarios-expanded-error"
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

        {data == null && !loading && !error ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            data-testid="caixa-scenarios-expanded-idle"
          >
            Clique em <strong>Gerar projeção</strong> para montar o ano
            completo — passado realizado + cenários até 31/12. Depois use os
            recortes abaixo sem novo carregamento.
          </p>
        ) : null}

        {data != null && activeRange != null && kpis != null ? (
          <>
            <div
              className="flex flex-wrap items-end gap-3"
              data-testid="caixa-scenarios-expanded-slicer"
            >
              <div className="flex flex-wrap gap-1.5">
                {TREASURY_SCENARIO_FULL_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() =>
                      setRange(
                        resolveScenarioFullPresetRange(
                          rows.length,
                          pastCount,
                          preset
                        )
                      )
                    }
                    className={
                      "rounded-md border px-2.5 py-1 text-[11px] font-semibold " +
                      (activePreset === preset.key
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-border text-foreground hover:bg-muted")
                    }
                    data-testid={`caixa-scenarios-expanded-preset-${preset.key}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label
                    htmlFor="caixa-scenarios-expanded-from"
                    className={financeModuleFilterLabelClass}
                  >
                    De
                  </label>
                  <input
                    id="caixa-scenarios-expanded-from"
                    type="date"
                    value={civilDates[activeRange.startIndex] ?? ""}
                    min={civilDates[0] ?? undefined}
                    max={civilDates[civilDates.length - 1] ?? undefined}
                    onChange={(e) => applyDate("from", e.target.value)}
                    className={financeModuleFilterFieldClass}
                    data-testid="caixa-scenarios-expanded-from"
                  />
                </div>
                <div>
                  <label
                    htmlFor="caixa-scenarios-expanded-to"
                    className={financeModuleFilterLabelClass}
                  >
                    Até
                  </label>
                  <input
                    id="caixa-scenarios-expanded-to"
                    type="date"
                    value={civilDates[activeRange.endIndex] ?? ""}
                    min={civilDates[0] ?? undefined}
                    max={civilDates[civilDates.length - 1] ?? undefined}
                    onChange={(e) => applyDate("to", e.target.value)}
                    className={financeModuleFilterFieldClass}
                    data-testid="caixa-scenarios-expanded-to"
                  />
                </div>
              </div>
            </div>
            <p className="-mt-2 text-[10px] text-muted-foreground">
              Passado = realizado da Linha do tempo (as três linhas
              coincidem); a partir de hoje, cenários do motor oficial. Tudo
              local — nenhum novo carregamento ao recortar.
            </p>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KpiCard
                label="Saldo inicial do recorte"
                value={formatMoney(kpis.initialBalance)}
                negative={(kpis.initialBalance ?? 0) < 0}
                testId="caixa-scenarios-expanded-kpi-initial"
              />
              <KpiCard
                label="Menor saldo (Realista)"
                value={formatMoney(kpis.minRealistic)}
                hint={
                  kpis.minRealisticDate
                    ? formatCivilDate(kpis.minRealisticDate)
                    : undefined
                }
                negative={(kpis.minRealistic ?? 0) < 0}
                testId="caixa-scenarios-expanded-kpi-min"
              />
              <KpiCard
                label="Saldo final (Realista)"
                value={formatMoney(kpis.finalRealistic)}
                negative={(kpis.finalRealistic ?? 0) < 0}
                testId="caixa-scenarios-expanded-kpi-final-real"
              />
              <KpiCard
                label="Saldo final (Otimista)"
                value={formatMoney(kpis.finalOptimistic)}
                negative={(kpis.finalOptimistic ?? 0) < 0}
                testId="caixa-scenarios-expanded-kpi-final-opt"
              />
              <KpiCard
                label="Saldo final (Pessimista)"
                value={formatMoney(kpis.finalPessimistic)}
                negative={(kpis.finalPessimistic ?? 0) < 0}
                testId="caixa-scenarios-expanded-kpi-final-pes"
              />
            </div>

            <TreasuryCaixaScenariosChart
              data={data.payload}
              timelineRows={data.annualRows}
              prefix={prefix as never}
              brush={{
                startIndex: activeRange.startIndex,
                endIndex: activeRange.endIndex,
                onChange: ({ startIndex, endIndex }) => {
                  if (startIndex == null || endIndex == null) return;
                  setRange(
                    normalizeScenarioExpandedRange(rows.length, {
                      startIndex,
                      endIndex,
                    })
                  );
                },
              }}
            />
          </>
        ) : null}
      </div>
    </CostCenterDialog>
  );
}

export default TreasuryCaixaScenariosExpandedModal;
