/**
 * Caixa — Gráfico de cenários por SENSIBILIDADE DE VENDAS.
 *
 * CONCEITO: Otimista = vendas +20% · Realista = projeção atual (Linha do
 * tempo canônica, intocada) · Pessimista = vendas −20%. Percentuais vêm da
 * política central via payload — nunca hardcoded aqui.
 *
 * Tudo vem pronto do backend (`GET /api/treasury/caixa/scenarios`):
 * o componente só formata e desenha. Sem cálculo financeiro paralelo —
 * apenas soma dos deltas diários prontos sobre a série da tabela.
 *
 * As linhas PODEM se cruzar: crescer consome caixa (MP/insumos antes dos
 * recebimentos) e vender menos alivia desembolsos antes de reduzir
 * recebimentos. Nenhuma correção artificial de ordenação é aplicada.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
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
import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import type { TreasuryCaixaScenariosPayload } from "@/src/lib/treasury/treasuryCaixaScenariosApi.js";
import type {
  TreasuryScenarioDay,
  TreasuryScenarioSummary,
} from "@/src/lib/treasury/domain/treasuryCaixaScenariosTypes.js";
import {
  applyScenarioDeltasToClosings,
  type TreasuryScenarioDeltaSet,
} from "@/src/lib/treasury/domain/treasuryCaixaScenarioDeltas.js";
import {
  buildTreasurySalesVolumeExecutiveLines,
  computeTreasurySalesVolumeScenarios,
  type TreasurySalesVolumeMemoryEntry,
  type TreasurySalesVolumeScenarioIndicators,
  type TreasurySalesVolumeScenariosResult,
} from "@/src/lib/treasury/domain/treasuryCaixaSalesVolumeScenarios.js";
import { TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS } from "@/src/lib/treasury/contracts/treasurySalesVolumeScenarioPolicy.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { cn } from "@/src/lib/utils";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";

export type TreasuryCaixaScenariosChartProps = {
  data: TreasuryCaixaScenariosPayload | null;
  loading?: boolean;
  onRefresh?: () => void;
  horizonDays?: number;
  onHorizonChange?: (days: number) => void;
  /**
   * Série de saldos da "Linha do tempo" (mesma `timeline.rows` que alimenta a
   * tabela). Quando informada, a linha Realista do gráfico passa a EXIBIR
   * exatamente esses saldos — não uma recomputação que "deveria" bater.
   * Otimista/Pessimista preservam o delta calculado pelo motor canônico.
   * Ver `buildRows` para o porquê arquitetural.
   */
  timelineRows?: readonly {
    civilDate: string;
    opening: number | null;
    closing: number | null;
  }[];
};

/** Tokens de cor por cenário (usados TAMBÉM em estilo de linha para acessibilidade). */
const SCENARIO_STYLE = {
  optimistic: {
    color: "#059669", // emerald
    strokeDasharray: "6 3",
    strokeWidth: 2,
  },
  realistic: {
    color: "#2563EB", // blue-600 (destaque)
    strokeDasharray: undefined,
    strokeWidth: 3,
  },
  pessimistic: {
    color: "#DC2626", // red-600
    strokeDasharray: "2 3",
    strokeWidth: 2,
  },
} as const;

/**
 * Nomes visuais do CONCEITO ATUAL (sensibilidade de vendas). Os percentuais
 * vêm da política central via payload — nunca hardcoded aqui.
 */
function buildScenarioLabels(
  sales: TreasurySalesVolumeScenariosResult | undefined
): { optimistic: string; realistic: string; pessimistic: string } {
  const optPct = sales?.optimisticIndicators.variationPct;
  const pesPct = sales?.pessimisticIndicators.variationPct;
  return {
    optimistic:
      optPct != null
        ? `Otimista — vendas ${optPct > 0 ? "+" : ""}${optPct}%`
        : "Otimista",
    realistic: "Realista — projeção atual",
    pessimistic:
      pesPct != null ? `Pessimista — vendas ${pesPct}%` : "Pessimista",
  };
}

const HORIZON_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 7, label: "7 dias" },
  { value: 15, label: "15 dias" },
  { value: 30, label: "30 dias" },
  { value: 60, label: "60 dias" },
  { value: 90, label: "90 dias" },
];

type ChartRow = {
  civilDate: string;
  label: string;
  opt: number | null;
  real: number | null;
  pes: number | null;
  /**
   * Trechos em ZONA VERMELHA (saldo tocando/abaixo de R$ 0,00) — inclui os
   * vizinhos imediatos para o segmento de cruzamento também ficar vermelho.
   * Desenhados como overlay sobre a linha base; null fora da zona.
   */
  optNeg: number | null;
  realNeg: number | null;
  pesNeg: number | null;
  /** Linha "Simulação" (what-if do usuário) e sua zona vermelha. */
  sim: number | null;
  simNeg: number | null;
  bandLow: number | null;
  bandRange: number | null; // p/ empilhar a área "banda"
  isPast: boolean;
  /**
   * Saldo de abertura EXIBIDO — vem da Linha do tempo quando disponível
   * (fonte única) e cai no `day.openingBalance` do backend caso contrário.
   * O tooltip usa este valor para não contradizer a linha desenhada.
   */
  openingShown: number | null;
};

function money(value: number | null): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(value);
}

function shortDate(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  return `${d}/${m}`;
}

/**
 * Monta as linhas do gráfico.
 *
 * FONTE ÚNICA DO REALISTA — quando `timelineClosingByDate` é informado, a
 * linha Realista usa EXATAMENTE o mesmo `closing` que a tabela "Linha do
 * tempo" exibe naquele dia. Não é uma segunda conta que "deveria dar igual":
 * é o mesmo número, lido da mesma variável (`timeline.rows` do
 * TreasuryCaixaPage). Divergir passa a ser estruturalmente impossível.
 *
 * Motivo: a Linha do tempo é montada no FRONTEND a partir de três fontes
 * (board.realizedDays + /today/closing + /agenda materializada, com
 * `dailyDueEstimates` só complementando o que a agenda não cobre), enquanto o
 * motor de cenários roda no BACKEND usando `dailyDueEstimates` para todos os
 * dias. Nos dias em que a agenda materializada existe, as duas fontes
 * divergem — e a diferença acumulava dia após dia.
 *
 * OTIMISTA/PESSIMISTA POR VOLUME DE VENDAS — cada cenário é literalmente
 * "Linha do tempo + delta acumulado do dia": o backend converteu a variação
 * de ±pct% nas vendas de referência em diferenças diárias de entradas
 * (recebimentos simulados) e saídas variáveis (MP, impostos, comissões,
 * fretes), e aqui só somamos essas diferenças sobre a MESMA série que a
 * tabela exibe. O Realista nunca é recalculado. Como a Linha do tempo só
 * tem linha em dia com movimento, os dias sem linha herdam o último
 * fechamento conhecido (forward-fill) antes do delta.
 *
 * Sem `salesVolumeScenarios` no payload (cache antigo), apenas o Realista é
 * desenhado — o conceito anterior de antecipação/postergação foi removido e
 * NUNCA volta por fallback.
 */
function buildRows(
  days: readonly TreasuryScenarioDay[],
  asOf: string,
  timelineByDate?: ReadonlyMap<
    string,
    { opening: number | null; closing: number | null }
  > | null,
  sales?: TreasurySalesVolumeScenariosResult | null,
  /** Deltas da simulação what-if aplicada pelo usuário (mesmo motor puro). */
  simDeltas?: TreasuryScenarioDeltaSet | null
): ChartRow[] {
  // Realista mostrado: Linha do tempo com forward-fill; fallback = backend.
  const realShownByDate = new Map<string, number | null>();
  let lastTimelineClosing: number | null = null;
  for (const d of days) {
    const t = timelineByDate?.get(d.civilDate);
    if (t?.closing != null) lastTimelineClosing = t.closing;
    realShownByDate.set(
      d.civilDate,
      t?.closing ?? lastTimelineClosing ?? d.realistic.closingBalance
    );
  }

  let optByDate: Map<string, number | null> | null = null;
  let pesByDate: Map<string, number | null> | null = null;
  let simByDate: Map<string, number | null> | null = null;
  if (sales) {
    const orderedCivilDates = days.map((d) => d.civilDate);
    optByDate = applyScenarioDeltasToClosings({
      orderedCivilDates,
      realisticClosingByDay: realShownByDate,
      deltas: sales.optimistic,
    });
    pesByDate = applyScenarioDeltasToClosings({
      orderedCivilDates,
      realisticClosingByDay: realShownByDate,
      deltas: sales.pessimistic,
    });
    if (simDeltas) {
      simByDate = applyScenarioDeltasToClosings({
        orderedCivilDates,
        realisticClosingByDay: realShownByDate,
        deltas: simDeltas,
      });
    }
  }

  const rows: ChartRow[] = days.map((d) => {
    const fromTimeline = timelineByDate?.get(d.civilDate) ?? null;
    const real = realShownByDate.get(d.civilDate) ?? null;
    const openingShown =
      fromTimeline?.opening != null ? fromTimeline.opening : d.openingBalance;

    const opt = optByDate?.get(d.civilDate) ?? null;
    const pes = pesByDate?.get(d.civilDate) ?? null;
    const sim = simByDate?.get(d.civilDate) ?? null;

    let bandLow: number | null = null;
    let bandRange: number | null = null;
    if (opt != null && pes != null) {
      bandLow = Math.min(opt, pes);
      const bandHigh = Math.max(opt, pes);
      bandRange = bandHigh - bandLow;
    }
    return {
      civilDate: d.civilDate,
      label: shortDate(d.civilDate),
      opt,
      real,
      pes,
      sim,
      optNeg: null,
      realNeg: null,
      pesNeg: null,
      simNeg: null,
      bandLow,
      bandRange,
      isPast: d.civilDate < asOf,
      openingShown,
    };
  });

  // Zona vermelha: saldo tocando/abaixo de R$ 0,00. Inclui os vizinhos
  // imediatos para que o SEGMENTO de cruzamento (positivo → negativo)
  // também seja desenhado em vermelho, não só a partir do primeiro ponto
  // negativo.
  const inRedZone = (v: number | null | undefined) => v != null && v <= 0;
  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    const prev = rows[i - 1];
    const next = rows[i + 1];
    if (inRedZone(cur.opt) || inRedZone(prev?.opt) || inRedZone(next?.opt)) {
      cur.optNeg = cur.opt;
    }
    if (inRedZone(cur.real) || inRedZone(prev?.real) || inRedZone(next?.real)) {
      cur.realNeg = cur.real;
    }
    if (inRedZone(cur.pes) || inRedZone(prev?.pes) || inRedZone(next?.pes)) {
      cur.pesNeg = cur.pes;
    }
    if (inRedZone(cur.sim) || inRedZone(prev?.sim) || inRedZone(next?.sim)) {
      cur.simNeg = cur.sim;
    }
  }
  return rows;
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: TreasuryCaixaScenariosPayload["confidence"];
}) {
  const map = {
    HIGH: {
      label: "Confiabilidade alta",
      className: "bg-emerald-100 text-emerald-800",
    },
    MEDIUM: {
      label: "Confiabilidade média",
      className: "bg-amber-100 text-amber-800",
    },
    LOW: {
      label: "Confiabilidade baixa",
      className: "bg-red-100 text-red-800",
    },
  } as const;
  const meta = map[confidence];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        meta.className
      )}
      data-testid="caixa-scenarios-confidence"
      data-confidence={confidence}
    >
      {meta.label}
    </span>
  );
}

function SummaryCard({
  title,
  color,
  summary,
  diffToRealistic,
}: {
  title: string;
  color: string;
  summary: TreasuryScenarioSummary;
  diffToRealistic: number | null;
}) {
  return (
    <div
      className="rounded-xl border border-[#E5E7EB] bg-white p-3"
      data-testid={`caixa-scenarios-card-${summary.scenario.toLowerCase()}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-6 rounded"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
          {title}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-[#6B7280]">Menor saldo</p>
          <p
            className={cn(
              "font-bold tabular-nums",
              summary.minBalance != null && summary.minBalance < 0
                ? "text-red-700"
                : "text-[#111827]"
            )}
          >
            {money(summary.minBalance)}
          </p>
          <p className="text-[10px] text-[#6B7280]">
            {summary.minBalanceDate
              ? `em ${formatCivilDate(summary.minBalanceDate)}`
              : ""}
          </p>
        </div>
        <div>
          <p className="text-[#6B7280]">Saldo final</p>
          <p
            className={cn(
              "font-bold tabular-nums",
              summary.finalBalance != null && summary.finalBalance < 0
                ? "text-red-700"
                : "text-[#111827]"
            )}
          >
            {money(summary.finalBalance)}
          </p>
        </div>
        <div>
          <p className="text-[#6B7280]">Necessidade de caixa</p>
          <p className="font-bold tabular-nums text-[#111827]">
            {money(summary.maxCashNeed)}
          </p>
        </div>
        <div>
          <p className="text-[#6B7280]">Dias negativos</p>
          <p className="font-bold tabular-nums text-[#111827]">
            {summary.negativeDaysCount}
            {summary.firstNegativeDate ? (
              <span className="ml-1 text-[10px] font-normal text-[#6B7280]">
                (1º em {formatCivilDate(summary.firstNegativeDate)})
              </span>
            ) : null}
          </p>
        </div>
        {diffToRealistic != null ? (
          <div className="col-span-2">
            <p className="text-[#6B7280]">Diferença p/ Realista (saldo final)</p>
            <p
              className={cn(
                "font-bold tabular-nums",
                diffToRealistic > 0 ? "text-emerald-700" : "text-red-700"
              )}
            >
              {diffToRealistic > 0 ? "+" : ""}
              {money(diffToRealistic)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScenarioTooltip({
  active,
  payload,
  label,
  daysByLabel,
  labels,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  label?: string;
  daysByLabel: Map<string, TreasuryScenarioDay>;
  labels: { optimistic: string; realistic: string; pessimistic: string };
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const day = daysByLabel.get(row.civilDate);
  if (!day) return null;

  const Line = ({
    label,
    color,
    value,
  }: {
    label: string;
    color: string;
    value: number | null;
  }) =>
    value == null ? null : (
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="font-semibold" style={{ color }}>
          {label}
        </span>
        <span className="ml-auto tabular-nums">{money(value)}</span>
      </div>
    );

  return (
    <div className="min-w-[280px] rounded-lg border border-[#E5E7EB] bg-white p-2.5 shadow-md text-[#111827]">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
        {formatCivilDate(row.civilDate)} {row.isPast ? "· passado" : ""}
      </p>
      <div className="mb-2 text-[11px]">
        <span className="text-[#6B7280]">Saldo inicial:</span>{" "}
        <span className="font-semibold tabular-nums">
          {money(row.openingShown)}
        </span>
      </div>
      {/* Valores vindos do ChartRow (o que a linha desenha), não do payload
          bruto do backend — assim tooltip e gráfico nunca se contradizem. */}
      <div className="space-y-0.5 border-t border-[#E5E7EB]/60 pt-1.5">
        <Line
          label={labels.optimistic}
          color={SCENARIO_STYLE.optimistic.color}
          value={row.opt}
        />
        <Line
          label={labels.realistic}
          color={SCENARIO_STYLE.realistic.color}
          value={row.real}
        />
        <Line
          label={labels.pessimistic}
          color={SCENARIO_STYLE.pessimistic.color}
          value={row.pes}
        />
        <Line label="Simulação" color={SIMULATION_COLOR} value={row.sim} />
      </div>
      {!row.isPast ? (
        <div className="mt-2 border-t border-[#E5E7EB]/60 pt-1.5 text-[10px] text-[#6B7280]">
          <div>
            Realista: A receber {money(day.realistic.receivableInflows)} · A pagar{" "}
            {money(day.realistic.payableOutflows)}
          </div>
          {day.otherInflows > 0 || day.otherOutflows > 0 ? (
            <div>
              Outros: +{money(day.otherInflows)} / −{money(day.otherOutflows)}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 border-t border-[#E5E7EB]/60 pt-1.5 text-[10px] text-[#6B7280]">
          Realizado: +{money(day.realizedInflows)} / −{money(day.realizedOutflows)}
        </div>
      )}
      {day.warnings.length > 0 ? (
        <div className="mt-1.5 border-t border-[#E5E7EB]/60 pt-1.5 text-[10px] text-amber-700">
          {day.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type SeriesKey = "optimistic" | "realistic" | "pessimistic" | "band" | "simulation";

/** dataKey da série no Recharts → chave interna de visibilidade (os nomes
 *  visuais agora são dinâmicos — vêm da política via payload). */
const LEGEND_DATAKEY_TO_SERIES: Record<string, SeriesKey> = {
  opt: "optimistic",
  real: "realistic",
  pes: "pessimistic",
  bandRange: "band",
  sim: "simulation",
};

const SIMULATION_COLOR = "#7C3AED"; // violeta — distinto dos 3 cenários

/**
 * Renderiza o gráfico canônico dos cenários. Extraído do componente para
 * reuso entre o card embutido (h=320) e o modo apresentação (~72vh).
 * Visibilidade das séries governada por `visible[SeriesKey]`; ocultar
 * mantém o payload no dataset (o Tooltip continua descrevendo o dia
 * inteiro), só remove a linha/área do desenho.
 */
function renderScenariosChart(params: {
  rows: ChartRow[];
  daysByLabel: Map<string, TreasuryScenarioDay>;
  heightPx: number;
  visible: Record<SeriesKey, boolean>;
  onLegendClick: (key: SeriesKey) => void;
  onPointClick: (civilDate: string) => void;
  labels: { optimistic: string; realistic: string; pessimistic: string };
  /** true quando o usuário aplicou uma simulação (linha + legenda entram). */
  hasSimulation: boolean;
}) {
  const {
    rows,
    daysByLabel,
    heightPx,
    visible,
    onLegendClick,
    onPointClick,
    labels,
    hasSimulation,
  } = params;
  return (
    <div style={{ height: `${heightPx}px` }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
          onClick={(state: unknown) => {
            const s = state as
              | { activePayload?: Array<{ payload?: ChartRow }> }
              | null;
            const payload = s?.activePayload?.[0]?.payload;
            if (payload) onPointClick(payload.civilDate);
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#6B7280", fontSize: 11 }}
            interval="preserveStartEnd"
          />
          {/* padding inferior descola a linha de R$ 0,00 do piso do eixo —
              sem ele, quando todos os valores são positivos o zero coincide
              com a borda e a linha "some". */}
          <YAxis
            tick={{ fill: "#6B7280", fontSize: 11 }}
            tickFormatter={(v: number) => money(v)}
            padding={{ bottom: 16 }}
          />
          <Tooltip
            content={(props) => (
              <ScenarioTooltip
                {...props}
                daysByLabel={daysByLabel}
                labels={labels}
              />
            )}
          />
          {/* Linha mediana do ZERO — sempre visível (extendDomain + padding
              do eixo). Abaixo dela, os trechos das linhas ficam vermelhos. */}
          <ReferenceLine
            y={0}
            stroke="#DC2626"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{
              value: "R$ 0,00",
              fill: "#DC2626",
              fontSize: 10,
              fontWeight: 700,
              position: "insideBottomRight",
            }}
          />
          {/* Faixa "Intervalo de cenário" — empilhamento: base transparente
              (bandLow) + range para desenhar apenas a diferença. Área
              discreta em cinza para não competir com as linhas. */}
          <Area
            type="monotone"
            dataKey="bandLow"
            stackId="band"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            hide={!visible.band}
          />
          <Area
            type="monotone"
            dataKey="bandRange"
            stackId="band"
            stroke="none"
            fill="#6B7280"
            fillOpacity={0.08}
            isAnimationActive={false}
            name="Intervalo de cenário"
            hide={!visible.band}
          />
          <Line
            type="monotone"
            dataKey="opt"
            name={labels.optimistic}
            stroke={SCENARIO_STYLE.optimistic.color}
            strokeWidth={SCENARIO_STYLE.optimistic.strokeWidth}
            strokeDasharray={SCENARIO_STYLE.optimistic.strokeDasharray}
            dot={false}
            isAnimationActive={false}
            hide={!visible.optimistic}
          />
          <Line
            type="monotone"
            dataKey="pes"
            name={labels.pessimistic}
            stroke={SCENARIO_STYLE.pessimistic.color}
            strokeWidth={SCENARIO_STYLE.pessimistic.strokeWidth}
            strokeDasharray={SCENARIO_STYLE.pessimistic.strokeDasharray}
            dot={false}
            isAnimationActive={false}
            hide={!visible.pessimistic}
          />
          <Line
            type="monotone"
            dataKey="real"
            name={labels.realistic}
            stroke={SCENARIO_STYLE.realistic.color}
            strokeWidth={SCENARIO_STYLE.realistic.strokeWidth}
            dot={false}
            isAnimationActive={false}
            hide={!visible.realistic}
          />
          {hasSimulation ? (
            <Line
              type="monotone"
              dataKey="sim"
              name="Simulação"
              stroke={SIMULATION_COLOR}
              strokeWidth={2.5}
              strokeDasharray="8 4"
              dot={false}
              isAnimationActive={false}
              hide={!visible.simulation}
            />
          ) : null}
          {/* Overlays de ZONA VERMELHA — trechos onde o saldo toca ou cruza
              R$ 0,00 ficam vermelhos sólidos por cima da linha base. Fora da
              zona os pontos são null (nada é desenhado). Sem entrada na
              legenda; seguem a visibilidade da série correspondente. */}
          {hasSimulation ? (
            <Line
              type="monotone"
              dataKey="simNeg"
              stroke="#B91C1C"
              strokeWidth={3.5}
              dot={false}
              isAnimationActive={false}
              legendType="none"
              connectNulls={false}
              hide={!visible.simulation}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="optNeg"
            stroke="#B91C1C"
            strokeWidth={SCENARIO_STYLE.optimistic.strokeWidth + 1}
            dot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
            hide={!visible.optimistic}
          />
          <Line
            type="monotone"
            dataKey="pesNeg"
            stroke="#B91C1C"
            strokeWidth={SCENARIO_STYLE.pessimistic.strokeWidth + 1}
            dot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
            hide={!visible.pessimistic}
          />
          <Line
            type="monotone"
            dataKey="realNeg"
            stroke="#B91C1C"
            strokeWidth={SCENARIO_STYLE.realistic.strokeWidth + 1}
            dot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
            hide={!visible.realistic}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
            onClick={(entry: { value?: string; dataKey?: unknown }) => {
              const dk = typeof entry?.dataKey === "string" ? entry.dataKey : "";
              const key = LEGEND_DATAKEY_TO_SERIES[dk];
              if (key) onLegendClick(key);
            }}
            formatter={(value: string, entry: { dataKey?: unknown }) => {
              const dk = typeof entry?.dataKey === "string" ? entry.dataKey : "";
              const key = LEGEND_DATAKEY_TO_SERIES[dk];
              const off = key ? !visible[key] : false;
              return (
                <span
                  style={{
                    color: off ? "#9CA3AF" : "#111827",
                    textDecoration: off ? "line-through" : "none",
                  }}
                  title={
                    off
                      ? `${value} — oculto (clique para mostrar)`
                      : `${value} — clique para ocultar`
                  }
                >
                  {value}
                </span>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const DEFAULT_VISIBLE: Record<SeriesKey, boolean> = {
  optimistic: true,
  realistic: true,
  pessimistic: true,
  band: true,
  simulation: true,
};

export function TreasuryCaixaScenariosChart({
  data,
  loading = false,
  onRefresh,
  horizonDays,
  onHorizonChange,
  timelineRows,
}: TreasuryCaixaScenariosChartProps) {
  const [drilldownDate, setDrilldownDate] = useState<string | null>(null);
  /**
   * Visibilidade por série — controlada pela legenda clicável (Recharts
   * repassa o evento). Ocultar a série mantém o payload, só some do desenho;
   * o Realista permanece "principal" independente do estado, mas pode ser
   * escondido para inspeção isolada de Otimista/Pessimista.
   */
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>(DEFAULT_VISIBLE);
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight();

  const toggleSeries = (key: SeriesKey) =>
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));

  /** Índice civilDate → saldos da Linha do tempo (fonte única do Realista). */
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

  /**
   * SIMULADOR WHAT-IF — campos acima do gráfico pré-preenchidos com os
   * defaults do Realista/base; "Aplicar" reexecuta o MESMO motor puro de
   * cenários (client-safe) com os parâmetros do usuário e desenha a linha
   * "Simulação". Nada é persistido; nenhum título é tocado.
   */
  const [simFields, setSimFields] = useState<{
    monthlyBase: string;
    variationPct: string;
    receiptLagDays: string;
    variableCostPct: string;
  } | null>(null);
  const [simDeltas, setSimDeltas] = useState<TreasuryScenarioDeltaSet | null>(
    null
  );

  const simDefaults = useMemo(() => {
    const sales = data?.salesVolumeScenarios;
    if (!sales) return null;
    const buckets = sales.receiptLagProfile.buckets;
    const wSum = buckets.reduce((s, b) => s + b.weight, 0);
    const avgLag =
      wSum > 0
        ? Math.round(
            buckets.reduce((s, b) => s + b.lagDays * b.weight, 0) / wSum
          )
        : TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS.defaultReceiptLagDays;
    const costPct = Math.round(sales.coverage.variableCostRatioTotal * 1000) / 10;
    return {
      monthlyBase: String(Math.round(sales.baseline.monthlyAverageAmount)),
      variationPct: "0",
      receiptLagDays: String(avgLag),
      variableCostPct: String(costPct),
    };
  }, [data]);

  useEffect(() => {
    // Re-preenche os defaults quando o payload muda; descarta simulação velha.
    setSimFields(simDefaults);
    setSimDeltas(null);
  }, [simDefaults]);

  const applySimulation = useCallback(() => {
    const sales = data?.salesVolumeScenarios;
    if (!sales || !simFields) return;
    const parse = (s: string) => {
      const n = Number(String(s).replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const monthlyBase = parse(simFields.monthlyBase);
    const variationPct = parse(simFields.variationPct);
    const receiptLagDays = parse(simFields.receiptLagDays);
    const variableCostPct = parse(simFields.variableCostPct);
    if (monthlyBase == null || variationPct == null) return;

    // Prazo: mantém o perfil real (parcelas) quando o usuário não mudou a
    // média; se mudou, vira prazo único informado.
    const defaultLag = simDefaults ? Number(simDefaults.receiptLagDays) : null;
    const receiptLagProfile =
      receiptLagDays != null && receiptLagDays !== defaultLag
        ? {
            buckets: [{ lagDays: Math.max(0, Math.round(receiptLagDays)), weight: 1 }],
            source: `simulação manual (${Math.round(receiptLagDays)} dias)`,
            isFallback: true,
          }
        : sales.receiptLagProfile;

    // Custos: reescala as razões oficiais proporcionalmente para o total
    // informado — preserva o PRAZO de cada categoria (MP/imposto/comissão/
    // frete continuam saindo nas suas datas).
    const currentTotal = sales.variableCosts.reduce((s, c) => s + c.ratio, 0);
    const targetTotal =
      variableCostPct != null ? Math.max(0, variableCostPct) / 100 : currentTotal;
    const variableCosts =
      currentTotal > 0
        ? sales.variableCosts.map((c) => ({
            ...c,
            ratio: c.ratio * (targetTotal / currentTotal),
          }))
        : targetTotal > 0
          ? [
              {
                kind: "RAW_MATERIAL" as const,
                ratio: targetTotal,
                ratioSource: "simulação manual (custo variável agregado)",
                outflowLagDays:
                  TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS.defaultRawMaterialLagDays,
                lagSource: "parâmetro configurável",
                isFallbackLag: true,
              },
            ]
          : [];

    const result = computeTreasurySalesVolumeScenarios({
      asOfCivilDate: sales.asOfCivilDate,
      horizonEndCivilDate: sales.horizonEndCivilDate,
      policy: {
        ...TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS,
        optimisticSalesVariationPct: variationPct,
        pessimisticSalesVariationPct: 0,
      },
      baseline: {
        ...sales.baseline,
        monthlyAverageAmount: monthlyBase,
        description: `simulação manual sobre ${sales.baseline.description}`,
      },
      receiptLagProfile,
      variableCosts,
      coverageWarnings: [],
    });
    setSimDeltas(result.optimistic);
  }, [data, simFields, simDefaults]);

  const clearSimulation = useCallback(() => {
    setSimFields(simDefaults);
    setSimDeltas(null);
  }, [simDefaults]);

  const rows = useMemo(
    () =>
      data
        ? buildRows(
            data.days,
            data.asOfCivilDate,
            timelineByDate,
            data.salesVolumeScenarios ?? null,
            simDeltas
          )
        : [],
    [data, timelineByDate, simDeltas]
  );

  /** Resumo da simulação — seleção simples sobre a série já desenhada. */
  const simSummary = useMemo(() => {
    if (!simDeltas) return null;
    let min: number | null = null;
    let minDate: string | null = null;
    let firstNegative: string | null = null;
    let final: number | null = null;
    for (const r of rows) {
      if (r.sim == null) continue;
      final = r.sim;
      if (min == null || r.sim < min) {
        min = r.sim;
        minDate = r.civilDate;
      }
      if (firstNegative == null && r.sim < 0) firstNegative = r.civilDate;
    }
    if (min == null) return null;
    return { min, minDate, firstNegative, final };
  }, [rows, simDeltas]);

  const labels = useMemo(
    () => buildScenarioLabels(data?.salesVolumeScenarios),
    [data]
  );

  const daysByLabel = useMemo(() => {
    const map = new Map<string, TreasuryScenarioDay>();
    if (data) for (const d of data.days) map.set(d.civilDate, d);
    return map;
  }, [data]);

  /**
   * Resumos derivados da MESMA série que o gráfico desenha. Quando a linha
   * Realista é ancorada na Linha do tempo, os sumários do backend passariam a
   * descrever outra curva — os cards contradiriam o próprio gráfico. Aqui não
   * há cálculo financeiro novo: apenas mínimo, saldo final, primeiro negativo
   * e contagem sobre pontos já calculados.
   */
  const summaries = useMemo(() => {
    if (!data) return null;
    if (!timelineByDate) return data.summaries; // sem âncora → backend manda.

    function summarize(
      pick: (r: ChartRow) => number | null,
      base: TreasuryScenarioSummary
    ): TreasuryScenarioSummary {
      let finalBalance: number | null = null;
      let minBalance: number | null = null;
      let minBalanceDate: string | null = null;
      let firstNegativeDate: string | null = null;
      let negativeDaysCount = 0;
      for (const r of rows) {
        const v = pick(r);
        if (v == null) continue;
        finalBalance = v;
        if (minBalance == null || v < minBalance) {
          minBalance = v;
          minBalanceDate = r.civilDate;
        }
        if (v < 0) {
          negativeDaysCount += 1;
          if (firstNegativeDate == null) firstNegativeDate = r.civilDate;
        }
      }
      return {
        ...base,
        finalBalance,
        minBalance,
        minBalanceDate,
        firstNegativeDate,
        negativeDaysCount,
        maxCashNeed:
          minBalance != null && minBalance < 0
            ? Math.round(-minBalance * 100) / 100
            : 0,
      };
    }

    return {
      optimistic: summarize((r) => r.opt, data.summaries.optimistic),
      realistic: summarize((r) => r.real, data.summaries.realistic),
      pessimistic: summarize((r) => r.pes, data.summaries.pessimistic),
    };
  }, [data, rows, timelineByDate]);

  const diffs = useMemo(() => {
    if (!summaries) return { opt: null, pes: null };
    const realFinal = summaries.realistic.finalBalance;
    const optFinal = summaries.optimistic.finalBalance;
    const pesFinal = summaries.pessimistic.finalBalance;
    return {
      opt: realFinal != null && optFinal != null ? optFinal - realFinal : null,
      pes: realFinal != null && pesFinal != null ? pesFinal - realFinal : null,
    };
  }, [summaries]);

  /**
   * Memória de cálculo por cenário — movimentos SIMULADOS agregados por
   * mês/tipo, ordenados por |valor|. Só apresentação: o texto vem pronto
   * ("explanation" determinística em pt-BR, gerada no backend).
   */
  const memoryByScenario = useMemo(() => {
    const memory = data?.salesVolumeScenarios?.memory;
    if (!memory || memory.length === 0) return null;
    const pick = (scenario: "OPTIMISTIC" | "PESSIMISTIC") =>
      memory
        .filter((m) => m.scenario === scenario)
        .sort(
          (a, b) =>
            Math.abs(b.inWindowAmount + b.beyondHorizonAmount) -
            Math.abs(a.inWindowAmount + a.beyondHorizonAmount)
        )
        .slice(0, 8);
    return { optimistic: pick("OPTIMISTIC"), pessimistic: pick("PESSIMISTIC") };
  }, [data]);

  /** Frases executivas determinísticas (templates fixos, backend). */
  const executiveLines = useMemo(() => {
    const sales = data?.salesVolumeScenarios;
    if (!sales) return null;
    const lines = buildTreasurySalesVolumeExecutiveLines({
      optimistic: sales.optimisticIndicators,
      pessimistic: sales.pessimisticIndicators,
    });
    // Menor saldo por cenário — números já exibidos nos cards (mesma série
    // desenhada); aqui só entram na frase fixa.
    const s = summaries ?? data?.summaries;
    if (s?.optimistic.minBalance != null && s.optimistic.minBalanceDate) {
      lines.push(
        `O menor saldo do cenário Otimista seria ${money(s.optimistic.minBalance)} em ${formatCivilDate(s.optimistic.minBalanceDate)}.`
      );
    }
    if (
      s?.pessimistic.maxCashNeed != null &&
      s.pessimistic.maxCashNeed > 0 &&
      s.pessimistic.minBalanceDate
    ) {
      lines.push(
        `A necessidade máxima de caixa no cenário Pessimista seria de ${money(s.pessimistic.maxCashNeed)} em ${formatCivilDate(s.pessimistic.minBalanceDate)}.`
      );
    }
    return lines;
  }, [data, summaries]);

  const drilldownDay = drilldownDate ? daysByLabel.get(drilldownDate) : null;

  return (
    <section
      className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm"
      data-testid="caixa-scenarios-chart"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Projeção do caixa — cenários
          </h2>
          <p className="text-xs text-muted-foreground">
            {data?.salesVolumeScenarios
              ? `Sensibilidade de vendas (${data.salesVolumeScenarios.optimisticIndicators.variationPct > 0 ? "+" : ""}${data.salesVolumeScenarios.optimisticIndicators.variationPct}% / ${data.salesVolumeScenarios.pessimisticIndicators.variationPct}%) sobre o Realista`
              : "Otimista · Realista · Pessimista"}{" "}
            — a partir de {data ? formatCivilDate(data.asOfCivilDate) : "—"}
          </p>
          {data?.officialTodayBalance?.amount != null ? (
            <p
              className="mt-0.5 text-[11px] text-muted-foreground"
              data-testid="caixa-scenarios-anchor-source"
            >
              Saldo inicial:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {money(data.officialTodayBalance.amount)}
              </span>{" "}
              · Fonte: {data.officialTodayBalance.sourceLabel}
              {data.officialTodayBalance.accountsWithoutBalance > 0 ? (
                <span className="ml-1 text-amber-700">
                  ({data.officialTodayBalance.accountsWithoutBalance} conta
                  {data.officialTodayBalance.accountsWithoutBalance === 1
                    ? ""
                    : "s"}{" "}
                  sem saldo informado)
                </span>
              ) : null}
            </p>
          ) : data?.officialTodayBalance?.source === "NONE" ? (
            <p
              className="mt-0.5 text-[11px] text-amber-700"
              data-testid="caixa-scenarios-anchor-source"
            >
              Sem saldo oficial informado — cenários usam a cadeia calculada
              (pode divergir do banco).
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data ? <ConfidenceBadge confidence={data.confidence} /> : null}
          {onHorizonChange ? (
            <div
              className="inline-flex overflow-hidden rounded-lg border border-[#E5E7EB] bg-white p-0.5"
              role="group"
              aria-label="Horizonte"
            >
              {HORIZON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onHorizonChange(opt.value)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-semibold transition",
                    horizonDays === opt.value
                      ? "bg-[#2563EB] text-white"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`caixa-scenarios-horizon-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-semibold hover:bg-[#F9FAFB]"
              data-testid="caixa-scenarios-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          ) : null}
          {data ? (
            <FinanceBiChartExpandButton
              onClick={() => setExpanded(true)}
              testId="caixa-scenarios-expand"
              label="Ampliar em modo apresentação"
            />
          ) : null}
        </div>
      </header>

      {loading ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Carregando cenários…
        </p>
      ) : !data ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Cenários indisponíveis.
        </p>
      ) : (
        <>
          {data.salesVolumeScenarios && simFields ? (
            <div
              className="mb-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2"
              data-testid="caixa-scenarios-simulator"
            >
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                Simular caixa{" "}
                <span className="font-normal normal-case">
                  — parâmetros pré-preenchidos com a base real; a linha{" "}
                  <span style={{ color: SIMULATION_COLOR }} className="font-semibold">
                    Simulação
                  </span>{" "}
                  usa o mesmo motor dos cenários. Nada é gravado.
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-2">
                {(
                  [
                    ["monthlyBase", "Vendas mensais (R$)", "caixa-sim-base"],
                    ["variationPct", "Variação de vendas (%)", "caixa-sim-pct"],
                    ["receiptLagDays", "Prazo médio receb. (dias)", "caixa-sim-lag"],
                    ["variableCostPct", "Custos variáveis (%)", "caixa-sim-cost"],
                  ] as const
                ).map(([field, label, testId]) => (
                  <label key={field} className="flex flex-col gap-0.5 text-[10px] font-semibold text-[#6B7280]">
                    {label}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={simFields[field]}
                      onChange={(e) =>
                        setSimFields((prev) =>
                          prev ? { ...prev, [field]: e.target.value } : prev
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applySimulation();
                      }}
                      className="w-36 rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[12px] font-normal tabular-nums text-[#111827]"
                      data-testid={testId}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={applySimulation}
                  className="rounded-lg bg-[#7C3AED] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#6D28D9]"
                  data-testid="caixa-sim-apply"
                >
                  Aplicar
                </button>
                {simDeltas ? (
                  <button
                    type="button"
                    onClick={clearSimulation}
                    className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                    data-testid="caixa-sim-clear"
                  >
                    Limpar
                  </button>
                ) : null}
              </div>
              {simSummary ? (
                <p className="mt-1.5 text-[11px]" data-testid="caixa-sim-summary">
                  <span className="font-semibold" style={{ color: SIMULATION_COLOR }}>
                    Simulação:
                  </span>{" "}
                  menor saldo{" "}
                  <span
                    className={cn(
                      "font-bold tabular-nums",
                      simSummary.min < 0 ? "text-red-700" : "text-[#111827]"
                    )}
                  >
                    {money(simSummary.min)}
                  </span>
                  {simSummary.minDate ? ` em ${formatCivilDate(simSummary.minDate)}` : ""}
                  {simSummary.firstNegative
                    ? ` · fica negativo em ${formatCivilDate(simSummary.firstNegative)}`
                    : " · não fica negativo no período"}
                  {" · saldo final "}
                  <span className="font-bold tabular-nums">
                    {money(simSummary.final)}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}

          {renderScenariosChart({
            rows,
            daysByLabel,
            heightPx: 320,
            visible,
            onLegendClick: toggleSeries,
            onPointClick: (civilDate) => setDrilldownDate(civilDate),
            labels,
            hasSimulation: simDeltas != null,
          })}

          <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              A faixa cinza é o <strong>Intervalo de cenário</strong> — a
              distância entre vendas{" "}
              {data.salesVolumeScenarios
                ? `${data.salesVolumeScenarios.optimisticIndicators.variationPct > 0 ? "+" : ""}${data.salesVolumeScenarios.optimisticIndicators.variationPct}% e ${data.salesVolumeScenarios.pessimisticIndicators.variationPct}%`
                : "otimistas e pessimistas"}
              . As linhas podem se cruzar: crescer consome caixa antes de
              devolver, e vender menos alivia desembolsos antes de reduzir
              recebimentos. Não é um intervalo estatístico de confiança.
            </span>
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <SummaryCard
              title={labels.optimistic}
              color={SCENARIO_STYLE.optimistic.color}
              summary={(summaries ?? data.summaries).optimistic}
              diffToRealistic={diffs.opt}
            />
            <SummaryCard
              title={`${labels.realistic} (principal)`}
              color={SCENARIO_STYLE.realistic.color}
              summary={(summaries ?? data.summaries).realistic}
              diffToRealistic={null}
            />
            <SummaryCard
              title={labels.pessimistic}
              color={SCENARIO_STYLE.pessimistic.color}
              summary={(summaries ?? data.summaries).pessimistic}
              diffToRealistic={diffs.pes}
            />
          </div>

          {data.salesVolumeScenarios ? (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              <SalesScenarioIndicatorCard
                title={labels.optimistic}
                color={SCENARIO_STYLE.optimistic.color}
                indicators={data.salesVolumeScenarios.optimisticIndicators}
              />
              <SalesScenarioIndicatorCard
                title={labels.pessimistic}
                color={SCENARIO_STYLE.pessimistic.color}
                indicators={data.salesVolumeScenarios.pessimisticIndicators}
              />
            </div>
          ) : null}

          {executiveLines && executiveLines.length > 0 ? (
            <div
              className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[11px] text-[#111827]"
              data-testid="caixa-scenarios-executive"
            >
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                Resumo executivo
              </p>
              <ul className="space-y-0.5">
                {executiveLines.map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <SalesScenarioAssumptions sales={data.salesVolumeScenarios} />
          <SalesScenarioCoverage sales={data.salesVolumeScenarios} />
          <OutOfHorizonNote sales={data.salesVolumeScenarios} />

          {memoryByScenario ? (
            <details
              className="mt-2 text-[11px] text-muted-foreground"
              data-testid="caixa-scenarios-memory"
            >
              <summary className="cursor-pointer font-semibold">
                Memória de cálculo — movimentos simulados por cenário
              </summary>
              <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
                <SimulatedMemoryList
                  title={labels.optimistic}
                  color={SCENARIO_STYLE.optimistic.color}
                  entries={memoryByScenario.optimistic}
                />
                <SimulatedMemoryList
                  title={labels.pessimistic}
                  color={SCENARIO_STYLE.pessimistic.color}
                  entries={memoryByScenario.pessimistic}
                />
              </div>
            </details>
          ) : null}

          {data.alerts.length > 0 ? (
            <div
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
              data-testid="caixa-scenarios-alerts"
            >
              <p className="mb-1 flex items-center gap-1 font-bold uppercase text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Alertas
              </p>
              <ul className="space-y-0.5">
                {data.alerts.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.confidenceReasons.length > 0 ? (
            <details className="mt-2 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer font-semibold">
                Por que essa confiabilidade?
              </summary>
              <ul className="mt-1 space-y-0.5">
                {data.confidenceReasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
              {data.salesVolumeScenarios ? (
                <p className="mt-1 text-[10px]">
                  Política de cenários: vendas{" "}
                  {data.salesVolumeScenarios.optimisticIndicators.variationPct >
                  0
                    ? "+"
                    : ""}
                  {data.salesVolumeScenarios.optimisticIndicators.variationPct}%
                  /{" "}
                  {data.salesVolumeScenarios.pessimisticIndicators.variationPct}
                  % · base {data.salesVolumeScenarios.baseline.description}.
                </p>
              ) : null}
            </details>
          ) : null}

          {drilldownDay ? (
            <ScenarioDayDrilldown
              day={drilldownDay}
              onClose={() => setDrilldownDate(null)}
            />
          ) : null}
        </>
      )}

      {data ? (
        <FinanceBiChartExpandModal
          open={expanded}
          onClose={() => setExpanded(false)}
          eyebrow="Financeiro · Tesouraria · Caixa"
          title="Projeção do caixa — cenários"
          subtitle={`${labels.optimistic} · ${labels.realistic} · ${labels.pessimistic} — a partir de ${formatCivilDate(data.asOfCivilDate)}${
            data.officialTodayBalance?.amount != null
              ? ` · Saldo inicial ${money(data.officialTodayBalance.amount)} (${data.officialTodayBalance.sourceLabel})`
              : ""
          }`}
          testId="caixa-scenarios-expand-modal"
        >
          {renderScenariosChart({
            rows,
            daysByLabel,
            heightPx: expandedHeight,
            visible,
            onLegendClick: toggleSeries,
            onPointClick: (civilDate) => setDrilldownDate(civilDate),
            labels,
            hasSimulation: simDeltas != null,
          })}
          {data.alerts.length > 0 ? (
            <div
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
              data-testid="caixa-scenarios-expand-alerts"
            >
              <p className="mb-1 flex items-center gap-1 font-bold uppercase text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Alertas
              </p>
              <ul className="space-y-0.5">
                {data.alerts.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 flex items-start gap-1 text-[12px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              A faixa cinza é o <strong>Intervalo de cenário</strong> —
              distância entre os cenários de vendas otimista e pessimista.
              Clique numa entrada da legenda para mostrar/ocultar cada série.
            </span>
          </p>
        </FinanceBiChartExpandModal>
      ) : null}
    </section>
  );
}

/**
 * "Premissas do cenário" — SOMENTE o que foi realmente aplicado (as frases
 * vêm prontas do backend; nada é inferido aqui).
 */
function SalesScenarioAssumptions({
  sales,
}: {
  sales: TreasurySalesVolumeScenariosResult | undefined;
}) {
  if (!sales || sales.assumptions.length === 0) return null;
  return (
    <details
      className="mt-2 text-[11px] text-muted-foreground"
      data-testid="caixa-scenarios-assumptions"
      open
    >
      <summary className="cursor-pointer font-semibold">
        Premissas do cenário
      </summary>
      <ul className="mt-1 space-y-0.5">
        {sales.assumptions.map((a, i) => (
          <li key={i}>• {a}</li>
        ))}
      </ul>
    </details>
  );
}

/** Cobertura da simulação — lacunas declaradas, nunca escondidas. */
function SalesScenarioCoverage({
  sales,
}: {
  sales: TreasurySalesVolumeScenariosResult | undefined;
}) {
  if (!sales) return null;
  const c = sales.coverage;
  const kindLabel: Record<string, string> = {
    RAW_MATERIAL: "matéria-prima",
    TAX: "impostos",
    COMMISSION: "comissões",
    FREIGHT: "fretes",
  };
  return (
    <div
      className={cn(
        "mt-2 rounded-lg border px-3 py-2 text-[11px]",
        c.isPartial
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-[#E5E7EB] bg-[#F9FAFB] text-[#111827]"
      )}
      data-testid="caixa-scenarios-coverage"
    >
      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">
        Cobertura da simulação
      </p>
      <p>
        Custos variáveis identificados:{" "}
        {Math.round(c.variableCostRatioTotal * 100)}% do valor vendido (
        {c.includedCostKinds.length > 0
          ? c.includedCostKinds.map((k) => kindLabel[k] ?? k).join(", ")
          : "nenhum"}
        )
        {c.excludedCostKinds.length > 0
          ? ` · fora da simulação: ${c.excludedCostKinds.map((k) => kindLabel[k] ?? k).join(", ")}`
          : ""}
        .
      </p>
      {c.isPartial ? (
        <p className="mt-0.5 font-semibold">
          Esta simulação não possui cobertura completa dos custos variáveis. O
          saldo apresentado pode estar otimista.
        </p>
      ) : null}
      {c.warnings.map((w, i) => (
        <p key={i} className="mt-0.5">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}

/**
 * Valores deslocados para DEPOIS do horizonte visível — a spec proíbe
 * empilhá-los no último dia do gráfico; são reportados à parte.
 */
function OutOfHorizonNote({
  sales,
}: {
  sales: TreasurySalesVolumeScenariosResult | undefined;
}) {
  if (!sales) return null;
  const parts: string[] = [];
  const o = sales.optimisticIndicators;
  const p = sales.pessimisticIndicators;
  if (o.inflowsBeyondHorizon !== 0)
    parts.push(
      `Otimista: ${money(o.inflowsBeyondHorizon)} de recebimentos e ${money(o.outflowsBeyondHorizon)} de saídas variáveis`
    );
  if (p.inflowsBeyondHorizon !== 0)
    parts.push(
      `Pessimista: ${money(p.inflowsBeyondHorizon)} de recebimentos e ${money(p.outflowsBeyondHorizon)} de saídas variáveis`
    );
  if (parts.length === 0) return null;
  return (
    <p
      className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground"
      data-testid="caixa-scenarios-out-of-horizon"
    >
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>
        Parte das vendas simuladas será recebida <strong>após o período
        exibido</strong>: {parts.join(" · ")}. Amplie o horizonte para vê-los.
      </span>
    </p>
  );
}

/** Indicadores do cenário de vendas (valores prontos do backend). */
function SalesScenarioIndicatorCard({
  title,
  color,
  indicators,
}: {
  title: string;
  color: string;
  indicators: TreasurySalesVolumeScenarioIndicators;
}) {
  const isOptimistic = indicators.variationPct > 0;
  return (
    <div
      className="rounded-xl border border-[#E5E7EB] bg-white p-3 text-[11px]"
      data-testid={`caixa-scenarios-sales-indicators-${indicators.scenario.toLowerCase()}`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="h-2.5 w-6 rounded"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
          {title} — efeito das vendas
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[#6B7280]">
            {isOptimistic ? "Vendas adicionais" : "Perda de vendas"}
          </p>
          <p className="font-bold tabular-nums text-[#111827]">
            {money(indicators.incrementalSalesInWindow)}
          </p>
        </div>
        <div>
          <p className="text-[#6B7280]">
            {isOptimistic
              ? "Recebimentos adicionais"
              : "Redução de recebimentos"}
          </p>
          <p className="font-bold tabular-nums text-[#111827]">
            {money(indicators.inflowsInWindow)}
          </p>
        </div>
        <div>
          <p className="text-[#6B7280]">
            {isOptimistic
              ? "Saídas variáveis adicionais"
              : "Economia em custos variáveis"}
          </p>
          <p className="font-bold tabular-nums text-[#111827]">
            {money(indicators.outflowsInWindow)}
          </p>
        </div>
        <div>
          <p className="text-[#6B7280]">Efeito líquido no horizonte</p>
          <p
            className={cn(
              "font-bold tabular-nums",
              indicators.netEffectInWindow >= 0
                ? "text-emerald-700"
                : "text-red-700"
            )}
          >
            {money(indicators.netEffectInWindow)}
          </p>
        </div>
        {isOptimistic ? (
          <>
            <div>
              <p className="text-[#6B7280]">Capital de giro p/ crescer</p>
              <p className="font-bold tabular-nums text-[#111827]">
                {money(indicators.peakCashConsumed)}
                {indicators.peakCashConsumedDate ? (
                  <span className="ml-1 text-[10px] font-normal text-[#6B7280]">
                    (pico em {formatCivilDate(indicators.peakCashConsumedDate)})
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-[#6B7280]">Crescimento vira caixa positivo</p>
              <p className="font-bold tabular-nums text-[#111827]">
                {indicators.firstNetPositiveDate
                  ? formatCivilDate(indicators.firstNetPositiveDate)
                  : "após o horizonte"}
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-[#6B7280]">Alívio temporário máximo</p>
              <p className="font-bold tabular-nums text-[#111827]">
                {money(indicators.peakCashReleased)}
                {indicators.peakCashReleasedDate ? (
                  <span className="ml-1 text-[10px] font-normal text-[#6B7280]">
                    (em {formatCivilDate(indicators.peakCashReleasedDate)})
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-[#6B7280]">Queda pressiona o caixa em</p>
              <p className="font-bold tabular-nums text-[#111827]">
                {indicators.firstNetNegativeDate
                  ? formatCivilDate(indicators.firstNetNegativeDate)
                  : "sem pressão no horizonte"}
              </p>
            </div>
          </>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-[#6B7280]">
        Custos fixos não são alterados em nenhum cenário.
      </p>
    </div>
  );
}

function SimulatedMemoryList({
  title,
  color,
  entries,
}: {
  title: string;
  color: string;
  entries: readonly TreasurySalesVolumeMemoryEntry[];
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-2">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
        <span
          className="h-2 w-4 rounded"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        {title}
        <span className="ml-auto font-normal normal-case">
          movimentos simulados — nunca títulos oficiais
        </span>
      </p>
      {entries.length === 0 ? (
        <p className="text-[11px]">Nenhum movimento simulado neste cenário.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((m) => (
            <li
              key={`${m.baselinePeriod}-${m.movementType}`}
              className="border-t border-black/5 pt-1 first:border-t-0 first:pt-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#111827]">
                  {m.baselinePeriod} · {m.cashDirection === "IN" ? "entrada" : "saída"}
                </span>
                <span className="tabular-nums font-semibold text-[#111827]">
                  {money(m.inWindowAmount)}
                </span>
              </div>
              <p className="text-[10px] leading-snug">{m.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Composição do dia — SOMENTE o Realista (títulos oficiais). Os cenários de
 * vendas não têm títulos por dia: são movimentos simulados agregados,
 * auditáveis na "Memória de cálculo" acima.
 */
function ScenarioDayDrilldown({
  day,
  onClose,
}: {
  day: TreasuryScenarioDay;
  onClose: () => void;
}) {
  const facts = day.realistic;
  return (
    <div
      className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"
      data-testid="caixa-scenarios-drilldown"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase text-[#6B7280]">
          Composição Realista — {formatCivilDate(day.civilDate)}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Fechar
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <DrilldownTable
          title="Contas a Receber"
          tone="in"
          totalLabel="A receber projetado"
          total={facts.receivableInflows}
          rows={facts.receivableProjections}
        />
        <DrilldownTable
          title="Contas a Pagar"
          tone="out"
          totalLabel="A pagar projetado"
          total={facts.payableOutflows}
          rows={facts.payableProjections}
        />
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Otimista/Pessimista somam a este dia apenas movimentos SIMULADOS de
        vendas (ver "Memória de cálculo") — títulos oficiais nunca são
        multiplicados.
      </p>
    </div>
  );
}

function DrilldownTable({
  title,
  tone,
  totalLabel,
  total,
  rows,
}: {
  title: string;
  tone: "in" | "out";
  totalLabel: string;
  total: number;
  rows: TreasuryScenarioDay["realistic"]["receivableProjections"];
}) {
  const totalClass = tone === "in" ? "text-emerald-700" : "text-red-700";
  return (
    <div
      className={cn(
        "rounded-lg border p-2",
        tone === "in"
          ? "border-emerald-200 bg-emerald-50/50"
          : "border-red-200 bg-red-50/50"
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <p
          className={cn(
            "text-[11px] font-bold uppercase tracking-wide",
            tone === "in" ? "text-emerald-800" : "text-red-800"
          )}
        >
          {title}
        </p>
        <p className={cn("text-[11px] font-bold tabular-nums", totalClass)}>
          {money(total)}
        </p>
      </div>
      <p className="mb-1 text-[10px] text-muted-foreground">{totalLabel}</p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nenhum título.</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-1 font-semibold">Contraparte</th>
              <th className="pr-1 font-semibold">Vencto oficial</th>
              <th className="pr-1 font-semibold">Regra</th>
              <th className="text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.externalId} className="border-t border-black/5">
                <td className="max-w-[160px] truncate py-1 pr-1">
                  {r.personName ?? "—"}
                </td>
                <td className="whitespace-nowrap py-1 pr-1 tabular-nums">
                  {r.officialDueDate
                    ? formatCivilDate(r.officialDueDate)
                    : "—"}
                </td>
                <td
                  className="py-1 pr-1 text-[10px] text-muted-foreground"
                  title={r.reasonDetail}
                >
                  {r.reasonCode}
                </td>
                <td className={cn("whitespace-nowrap py-1 text-right tabular-nums", totalClass)}>
                  {money(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
