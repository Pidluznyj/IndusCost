/**
 * Projeção do caixa — cenários — modal "Visão ampliada".
 *
 * O usuário escolhe data inicial e data final. O padrão continua 01/01 →
 * 31/12 do ano corrente (America/Sao_Paulo). Alterar as datas não busca
 * nada: só "Gerar projeção" carrega.
 *
 * Contratos:
 *  - carregado por React.lazy a partir da página (chunk separado);
 *  - NENHUM request ao abrir o modal; o clique em "Gerar projeção" dispara
 *    o carregamento (cenários + board anual + agenda — endpoints canônicos
 *    já existentes). Período só no passado não chama o motor de cenários;
 *  - o motor segue prospectivo e ancorado no saldo oficial de hoje; o
 *    passado entra como PREFIXO realizado (três cenários coincidem com o
 *    realizado). Projeção passada não vira realizado;
 *  - virada de ano: estimativas por vencimento do board daquele ano,
 *    opt-in, sem misturar títulos de CR/CP do ano da âncora;
 *  - acima de dois anos civis de projeção, ou de 3 anos de board:
 *    mensagem e proposta, sem truncar;
 *  - o gráfico é o PRÓPRIO TreasuryCaixaScenariosChart; a linha Realista
 *    futura usa a timeline canônica. Slicer local permanece;
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
import {
  fetchTreasuryCaixa,
  type TreasuryCaixaPayload,
} from "@/src/lib/treasury/treasuryCaixaApi.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryAgendaDayDto } from "@/src/lib/treasury/contracts/index.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import {
  appendTreasuryCaixaDailyDueEstimates,
  type TreasuryCaixaDayFlow,
  type TreasuryCaixaHistoricalArPresentationBridge,
  type TreasuryCaixaTimeline,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { buildTreasuryCaixaAnnualSeries } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import {
  buildScenarioPastPrefix,
  civilDateToScenarioIndex,
  defaultScenarioExpandedPeriod,
  deriveScenarioExpandedKpis,
  matchScenarioFullPreset,
  normalizeScenarioExpandedRange,
  planScenarioExpandedPeriod,
  rangeCoveringCivilDates,
  resolveScenarioFullPresetRange,
  scenarioExpandedDraftIsStale,
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

type TimelineRow = {
  civilDate: string;
  opening: number | null;
  closing: number | null;
  inflows: number;
  outflows: number;
  closingInformed?: number | null;
};

type HistorySlice = {
  year: number;
  rows: readonly TimelineRow[];
  presentationBridge: TreasuryCaixaHistoricalArPresentationBridge | null;
};

type LoadedData = {
  cacheKey: string;
  requestedStart: string;
  requestedEnd: string;
  asOfCivilDate: string;
  /** null = período inteiramente anterior a hoje; o gráfico usa só o prefixo. */
  payload: TreasuryCaixaScenariosPayload | null;
  /** Timeline da âncora + estimativas do ano seguinte — fonte do Realista futuro. */
  annualRows: readonly TimelineRow[];
  historySlices: readonly HistorySlice[];
  /** Ponte do ano da âncora, ou do único ano histórico. Só o prefixo consome. */
  presentationBridge: TreasuryCaixaHistoricalArPresentationBridge | null;
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
  const defaultPeriod = useMemo(
    () => defaultScenarioExpandedPeriod(todayCivil),
    [todayCivil]
  );

  const [startCivil, setStartCivil] = useState(defaultPeriod.startCivil);
  const [endCivil, setEndCivil] = useState(defaultPeriod.endCivil);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
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

    const plan = planScenarioExpandedPeriod({
      todayCivil,
      startCivil,
      endCivil,
    });
    if (plan.ok === false) {
      setError(plan.message);
      setProposal(plan.proposal);
      setLoading(false);
      return;
    }

    const applyLoaded = (loaded: LoadedData) => {
      setData(loaded);
      setRange(null);
      setError(null);
      setProposal(null);
    };

    const cacheKey = `${plan.startCivil}|${plan.endCivil}|${companyCode ?? ""}`;
    if (cacheRef.current?.cacheKey === cacheKey) {
      applyLoaded(cacheRef.current);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      const anchorYear = Number(todayCivil.slice(0, 4));
      const yearsToLoad = new Set<number>(plan.historyYears);
      if (plan.horizonDays != null) yearsToLoad.add(anchorYear);
      for (const year of plan.estimateYears) yearsToLoad.add(year);

      const boards = new Map<number, TreasuryCaixaPayload>();
      for (const year of [...yearsToLoad].sort((a, b) => a - b)) {
        const board = await fetchTreasuryCaixa({
          year,
          signal: controller.signal,
        });
        boards.set(year, board);
      }

      const anchorBoard = boards.get(anchorYear) ?? null;
      let agendaDays: readonly TreasuryAgendaDayDto[] = [];
      if (plan.horizonDays != null && companyCode && anchorBoard) {
        try {
          const agenda = await fetchTreasuryAgenda({
            companyCode,
            baseDate: anchorBoard.dueDateFrom,
            endDate: anchorBoard.dueDateTo,
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

      let payload: TreasuryCaixaScenariosPayload | null = null;
      if (plan.horizonDays != null) {
        payload = await fetchTreasuryCaixaScenarios({
          horizonDays: plan.horizonDays,
          extendDueEstimatesBeyondAnchorYear:
            plan.extendDueEstimatesBeyondAnchorYear,
          signal: controller.signal,
        });
      }
      if (seq !== seqRef.current) return;

      const seriesFor = (year: number, withAgenda: boolean) => {
        const board = boards.get(year);
        if (!board) return null;
        return buildTreasuryCaixaAnnualSeries({
          board,
          todayFlowRaw: year === anchorYear ? todayFlowRaw : null,
          agendaDays: withAgenda ? agendaDays : [],
        });
      };

      let stitched: TreasuryCaixaTimeline | null = null;
      if (plan.horizonDays != null && anchorBoard) {
        stitched = seriesFor(anchorYear, true)?.timeline ?? null;
        if (stitched) {
          for (const year of plan.estimateYears) {
            const extra = boards.get(year);
            if (!extra) continue;
            stitched = appendTreasuryCaixaDailyDueEstimates(
              stitched,
              extra.dailyDueEstimates ?? []
            );
          }
        }
      }

      const historySlices: HistorySlice[] = [];
      for (const year of plan.historyYears) {
        const board = boards.get(year);
        if (!board) continue;
        if (year === anchorYear && stitched) {
          historySlices.push({
            year,
            rows: stitched.rows,
            presentationBridge:
              board.historicalArGraphPresentationBridge ?? null,
          });
          continue;
        }
        const annual = seriesFor(year, false);
        if (!annual) continue;
        historySlices.push({
          year,
          rows: annual.timeline.rows,
          presentationBridge: board.historicalArGraphPresentationBridge ?? null,
        });
      }

      const loaded: LoadedData = {
        cacheKey,
        requestedStart: plan.startCivil,
        requestedEnd: plan.endCivil,
        asOfCivilDate: payload?.asOfCivilDate ?? todayCivil,
        payload,
        annualRows: stitched?.rows ?? historySlices[0]?.rows ?? [],
        historySlices,
        presentationBridge:
          anchorBoard?.historicalArGraphPresentationBridge ??
          historySlices[0]?.presentationBridge ??
          null,
      };
      cacheRef.current = loaded;
      applyLoaded(loaded);
    } catch (err) {
      const aborted = controller.signal.aborted;
      controller.abort();
      if (seq !== seqRef.current || aborted) return;
      setProposal(null);
      setError(
        err instanceof Error ? err.message : "Erro ao gerar a projeção."
      );
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [todayCivil, startCivil, endCivil, companyCode, todayFlowRaw]);

  // ── Prefixo do passado + linhas futuras (MESMO buildRows do gráfico) ────
  const prefix = useMemo(() => {
    if (!data) return null;
    const rows: ReturnType<typeof buildScenarioPastPrefix>["rows"] = [];
    const days: ReturnType<typeof buildScenarioPastPrefix>["days"] = [];
    const seen = new Set<string>();
    for (const slice of data.historySlices) {
      const built = buildScenarioPastPrefix({
        timelineRows: slice.rows,
        asOfCivilDate: data.asOfCivilDate,
        presentationBridge: slice.presentationBridge,
      });
      for (let i = 0; i < built.rows.length; i += 1) {
        const row = built.rows[i]!;
        if (
          row.civilDate < data.requestedStart ||
          row.civilDate > data.requestedEnd
        ) {
          continue;
        }
        if (seen.has(row.civilDate)) continue;
        seen.add(row.civilDate);
        rows.push(row);
        const day = built.days[i];
        if (day) days.push(day);
      }
    }
    return { rows, days };
  }, [data]);

  const hasHistoricalPresentationBridge = Boolean(
    data?.historySlices.some((slice) => {
      const bridge = slice.presentationBridge ?? data.presentationBridge;
      return (
        bridge != null &&
        (bridge.openingAdjustment !== 0 ||
          Object.keys(bridge.adjustmentByCivilDate).length > 0)
      );
    })
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
      data?.payload
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

  const coveredRange = useMemo(
    () =>
      data
        ? rangeCoveringCivilDates(
            civilDates,
            data.requestedStart,
            data.requestedEnd
          )
        : null,
    [data, civilDates]
  );
  const selectedRange = range ?? coveredRange;
  const activeRange =
    data != null && selectedRange != null && rows.length > 0
      ? normalizeScenarioExpandedRange(rows.length, selectedRange)
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
      subtitle={`Realizado da Linha do tempo até ontem e, a partir de hoje (${formatCivilDate(todayCivil)}), os mesmos cenários do card. O gráfico segue a data inicial e a data final.`}
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[11.5rem]">
            <label
              htmlFor="caixa-scenarios-expanded-period-start"
              className={financeModuleFilterLabelClass()}
            >
              Data inicial
            </label>
            <input
              id="caixa-scenarios-expanded-period-start"
              type="date"
              value={startCivil}
              onChange={(e) => setStartCivil(e.target.value)}
              className={financeModuleFilterFieldClass()}
              data-testid="caixa-scenarios-expanded-period-start"
            />
          </div>
          <div className="w-[11.5rem]">
            <label
              htmlFor="caixa-scenarios-expanded-period-end"
              className={financeModuleFilterLabelClass()}
            >
              Data final
            </label>
            <input
              id="caixa-scenarios-expanded-period-end"
              type="date"
              value={endCivil}
              onChange={(e) => setEndCivil(e.target.value)}
              className={financeModuleFilterFieldClass()}
              data-testid="caixa-scenarios-expanded-period-end"
            />
          </div>
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
        <p className="-mt-2 text-[10px] text-muted-foreground">
          Padrão: {formatCivilDate(defaultPeriod.startCivil)} a{" "}
          {formatCivilDate(defaultPeriod.endCivil)}. Alterar as datas não
          recalcula; use Gerar projeção.
          {data != null
            ? ` Gráfico atual: ${formatCivilDate(data.requestedStart)} → ${formatCivilDate(data.requestedEnd)}.`
            : ""}
        </p>
        {data != null &&
        scenarioExpandedDraftIsStale(
          { startCivil, endCivil },
          { startCivil: data.requestedStart, endCivil: data.requestedEnd }
        ) ? (
          <p
            className="-mt-2 text-[11px] font-semibold text-[#1D4ED8]"
            data-testid="caixa-scenarios-expanded-period-stale"
          >
            Período alterado. O gráfico ainda mostra{" "}
            {formatCivilDate(data.requestedStart)} →{" "}
            {formatCivilDate(data.requestedEnd)}. Clique em Gerar projeção
            para aplicar.
          </p>
        ) : null}

        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
            data-testid="caixa-scenarios-expanded-error"
          >
            <p>{error}</p>
            {proposal ? (
              <p
                className="mt-1 text-foreground"
                data-testid="caixa-scenarios-expanded-proposal"
              >
                {proposal}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="mt-1 font-semibold underline"
              >
                Tentar novamente
              </button>
            )}
          </div>
        ) : null}

        {data == null && !loading && !error ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            data-testid="caixa-scenarios-expanded-idle"
          >
            Clique em <strong>Gerar projeção</strong> para montar o período
            escolhido — realizado até ontem e cenários a partir de hoje.
            Depois use os recortes abaixo sem novo carregamento.
          </p>
        ) : null}

        {data != null && !loading && activeRange == null ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            data-testid="caixa-scenarios-expanded-empty"
          >
            Não há dias canônicos neste intervalo. A projeção não preenche a
            lacuna com saldo estimado.
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
                    className={financeModuleFilterLabelClass()}
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
                    className={financeModuleFilterFieldClass()}
                    data-testid="caixa-scenarios-expanded-from"
                  />
                </div>
                <div>
                  <label
                    htmlFor="caixa-scenarios-expanded-to"
                    className={financeModuleFilterLabelClass()}
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
                    className={financeModuleFilterFieldClass()}
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
            {hasHistoricalPresentationBridge ? (
              <p
                className="-mt-1 text-[10px] text-muted-foreground"
                data-testid="caixa-scenarios-expanded-historical-note"
              >
                Histórico do gráfico ajustado por competência para baixas
                administrativas. A tabela diária mantém os movimentos factuais.
              </p>
            ) : null}
            {data.requestedEnd > `${data.asOfCivilDate.slice(0, 4)}-12-31` ? (
              <p
                className="-mt-1 text-[10px] text-muted-foreground"
                data-testid="caixa-scenarios-expanded-next-year-note"
              >
                Depois de 31/12 do ano corrente, o Realista usa as estimativas
                por vencimento do board daquele ano, a mesma regra da Linha do
                tempo. O detalhe título a título não inclui os títulos do ano
                seguinte, para não alterar a população de Contas a Receber e
                Contas a Pagar do ano da âncora.
              </p>
            ) : null}

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
