/**
 * Projeção do caixa — cenários — modal "Visão ampliada".
 *
 * Contratos:
 *  - carregado por React.lazy a partir da página (chunk separado);
 *  - NENHUM request ao abrir o modal; o fetch acontece exclusivamente no
 *    clique em "Gerar projeção" (`handleGenerate`) — UM request ao MESMO
 *    endpoint do card (o serviço já aceita/clampa horizonDays até 365);
 *  - horizonte prospectivo HOJE → 31/12 (o motor não projeta passado; board
 *    cobre o ano civil do asOf — adaptação documentada no Ui);
 *  - o gráfico é o PRÓPRIO TreasuryCaixaScenariosChart (mesmas séries,
 *    legenda, tooltip, drill-down e simulador), com Brush opt-in;
 *  - slicer 100% LOCAL (presets/datas/brush recortam por índice diário);
 *    KPIs derivam do MESMO `buildRows` que desenha as linhas;
 *  - corrida: AbortController + sequência; fechar/desmontar aborta.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import {
  buildRows,
  TreasuryCaixaScenariosChart,
} from "@/src/components/finance/treasury/TreasuryCaixaScenariosChart";
import {
  fetchTreasuryCaixaScenarios,
  type TreasuryCaixaScenariosPayload,
} from "@/src/lib/treasury/treasuryCaixaScenariosApi.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import {
  civilDateToScenarioIndex,
  deriveScenarioExpandedKpis,
  matchScenarioExpandedPreset,
  normalizeScenarioExpandedRange,
  resolveScenarioExpandedHorizon,
  resolveScenarioExpandedPresetRange,
  TREASURY_SCENARIO_EXPANDED_PRESETS,
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

export type TreasuryCaixaScenariosExpandedModalProps = {
  /** Mesma série da Linha do tempo da página — fonte única do Realista. */
  timelineRows?: readonly {
    civilDate: string;
    opening: number | null;
    closing: number | null;
  }[];
  onClose: () => void;
};

export function TreasuryCaixaScenariosExpandedModal({
  timelineRows,
  onClose,
}: TreasuryCaixaScenariosExpandedModalProps) {
  const todayCivil = todayTreasuryCivilDateInSaoPaulo();
  const horizon = useMemo(
    () => resolveScenarioExpandedHorizon(todayCivil),
    [todayCivil]
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TreasuryCaixaScenariosPayload | null>(null);
  const [range, setRange] = useState<TreasuryScenarioExpandedRange | null>(
    null
  );

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<TreasuryCaixaScenariosPayload | null>(null);

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

    const applyPayload = (payload: TreasuryCaixaScenariosPayload) => {
      setData(payload);
      const count = payload.days.length;
      setRange(count > 0 ? { startIndex: 0, endIndex: count - 1 } : null);
      setError(null);
    };

    if (cacheRef.current) {
      applyPayload(cacheRef.current);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      // MESMO endpoint do card — só o horizonte muda (hoje → 31/12).
      const payload = await fetchTreasuryCaixaScenarios({
        horizonDays: horizon.horizonDays,
        signal: controller.signal,
      });
      if (seq !== seqRef.current) return; // outro Gerar/fechamento venceu
      cacheRef.current = payload;
      applyPayload(payload);
    } catch (err) {
      if (seq !== seqRef.current || controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : "Erro ao gerar a projeção."
      );
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [horizon.horizonDays]);

  // ── Linhas do gráfico: MESMO buildRows do componente (fonte única) ──────
  const timelineByDate = useMemo(() => {
    if (!timelineRows || timelineRows.length === 0) return null;
    const map = new Map<
      string,
      { opening: number | null; closing: number | null }
    >();
    for (const r of timelineRows) {
      map.set(r.civilDate, { opening: r.opening, closing: r.closing });
    }
    return map;
  }, [timelineRows]);

  const rows = useMemo(
    () =>
      data
        ? buildRows(
            data.days,
            data.asOfCivilDate,
            timelineByDate,
            data.salesVolumeScenarios ?? null,
            null
          )
        : [],
    [data, timelineByDate]
  );
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
  const kpis = activeRange != null ? deriveScenarioExpandedKpis(visibleRows) : null;
  const activePreset =
    activeRange != null
      ? matchScenarioExpandedPreset(rows.length, activeRange)
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
      subtitle={`Mesmo motor e mesmas séries do gráfico de cenários, projetados de hoje (${formatCivilDate(todayCivil)}) até ${formatCivilDate(horizon.endCivil)}.`}
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Período projetado:{" "}
            <span className="font-semibold text-foreground">
              hoje → {formatCivilDate(horizon.endCivil)}
            </span>{" "}
            ({horizon.horizonDays} dias)
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
            Clique em <strong>Gerar projeção</strong> para carregar os
            cenários até o fim do ano. Depois use os recortes abaixo para
            analisar qualquer trecho — sem novo carregamento.
          </p>
        ) : null}

        {data != null && activeRange != null && kpis != null ? (
          <>
            <div
              className="flex flex-wrap items-end gap-3"
              data-testid="caixa-scenarios-expanded-slicer"
            >
              <div className="flex flex-wrap gap-1.5">
                {TREASURY_SCENARIO_EXPANDED_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() =>
                      setRange(
                        resolveScenarioExpandedPresetRange(rows.length, preset)
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
              data={data}
              timelineRows={timelineRows}
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
