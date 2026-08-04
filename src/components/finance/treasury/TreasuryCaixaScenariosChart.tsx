/**
 * Caixa — Gráfico de cenários (Otimista / Realista / Pessimista).
 *
 * Tudo vem pronto do backend (`GET /api/treasury/caixa/scenarios`):
 * o componente só formata e desenha. Sem cálculo financeiro paralelo.
 *
 * - 3 linhas: Otimista (verde suave), Realista (azul destacado, mais grosso),
 *   Pessimista (vermelho suave). Linha em R$ 0,00 sempre visível.
 * - Faixa "Intervalo de cenário" (área discreta entre Otimista e Pessimista):
 *   é a distância entre a hipótese favorável e a conservadora, NÃO um
 *   intervalo estatístico de confiança.
 * - Tooltip vem do backend (saldo, entradas/saídas por cenário, alertas).
 * - Cards de resumo por cenário: menor saldo, primeiro negativo, necessidade
 *   máxima de caixa, saldo final, diferença para o Realista.
 */

import React, { useMemo, useState } from "react";
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
import { AlertTriangle, ArrowDown, Info, RefreshCw } from "lucide-react";
import type { TreasuryCaixaScenariosPayload } from "@/src/lib/treasury/treasuryCaixaScenariosApi.js";
import type {
  TreasuryScenarioDay,
  TreasuryScenarioSummary,
} from "@/src/lib/treasury/domain/treasuryCaixaScenariosTypes.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { cn } from "@/src/lib/utils";

export type TreasuryCaixaScenariosChartProps = {
  data: TreasuryCaixaScenariosPayload | null;
  loading?: boolean;
  onRefresh?: () => void;
  horizonDays?: number;
  onHorizonChange?: (days: number) => void;
};

/** Tokens de cor por cenário (usados TAMBÉM em estilo de linha para acessibilidade). */
const SCENARIO_STYLE = {
  optimistic: {
    label: "Otimista",
    color: "#059669", // emerald
    strokeDasharray: "6 3",
    strokeWidth: 2,
  },
  realistic: {
    label: "Realista",
    color: "#2563EB", // blue-600 (destaque)
    strokeDasharray: undefined,
    strokeWidth: 3,
  },
  pessimistic: {
    label: "Pessimista",
    color: "#DC2626", // red-600
    strokeDasharray: "2 3",
    strokeWidth: 2,
  },
} as const;

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
  bandLow: number | null;
  bandRange: number | null; // p/ empilhar a área "banda"
  isPast: boolean;
};

function money(value: number | null): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(value);
}

function shortDate(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  return `${d}/${m}`;
}

function buildRows(
  days: readonly TreasuryScenarioDay[],
  asOf: string
): ChartRow[] {
  return days.map((d) => {
    const opt = d.optimistic.closingBalance;
    const real = d.realistic.closingBalance;
    const pes = d.pessimistic.closingBalance;
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
      bandLow,
      bandRange,
      isPast: d.civilDate < asOf,
    };
  });
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
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  label?: string;
  daysByLabel: Map<string, TreasuryScenarioDay>;
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
    count,
  }: {
    label: string;
    color: string;
    value: number | null;
    count?: number;
  }) => (
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
      {count != null ? (
        <span className="text-[10px] text-[#6B7280]">({count} tít)</span>
      ) : null}
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
          {money(day.openingBalance)}
        </span>
      </div>
      <div className="space-y-0.5 border-t border-[#E5E7EB]/60 pt-1.5">
        <Line
          label="Otimista"
          color={SCENARIO_STYLE.optimistic.color}
          value={day.optimistic.closingBalance}
          count={day.optimistic.receivableCount + day.optimistic.payableCount}
        />
        <Line
          label="Realista"
          color={SCENARIO_STYLE.realistic.color}
          value={day.realistic.closingBalance}
          count={day.realistic.receivableCount + day.realistic.payableCount}
        />
        <Line
          label="Pessimista"
          color={SCENARIO_STYLE.pessimistic.color}
          value={day.pessimistic.closingBalance}
          count={
            day.pessimistic.receivableCount + day.pessimistic.payableCount
          }
        />
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

export function TreasuryCaixaScenariosChart({
  data,
  loading = false,
  onRefresh,
  horizonDays,
  onHorizonChange,
}: TreasuryCaixaScenariosChartProps) {
  const [drilldownDate, setDrilldownDate] = useState<string | null>(null);

  const rows = useMemo(
    () => (data ? buildRows(data.days, data.asOfCivilDate) : []),
    [data]
  );

  const daysByLabel = useMemo(() => {
    const map = new Map<string, TreasuryScenarioDay>();
    if (data) for (const d of data.days) map.set(d.civilDate, d);
    return map;
  }, [data]);

  const diffs = useMemo(() => {
    if (!data) return { opt: null, pes: null };
    const realFinal = data.summaries.realistic.finalBalance;
    const optFinal = data.summaries.optimistic.finalBalance;
    const pesFinal = data.summaries.pessimistic.finalBalance;
    return {
      opt: realFinal != null && optFinal != null ? optFinal - realFinal : null,
      pes: realFinal != null && pesFinal != null ? pesFinal - realFinal : null,
    };
  }, [data]);

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
            Otimista · Realista · Pessimista — a partir de{" "}
            {data ? formatCivilDate(data.asOfCivilDate) : "—"}
          </p>
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
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                onClick={(state: unknown) => {
                  const s = state as
                    | { activePayload?: Array<{ payload?: ChartRow }> }
                    | null;
                  const payload = s?.activePayload?.[0]?.payload;
                  if (payload) setDrilldownDate(payload.civilDate);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                  tickFormatter={(v: number) => money(v)}
                />
                <Tooltip
                  content={(props) => (
                    <ScenarioTooltip {...props} daysByLabel={daysByLabel} />
                  )}
                />
                <ReferenceLine
                  y={0}
                  stroke="#DC2626"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: "R$ 0,00",
                    fill: "#DC2626",
                    fontSize: 10,
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
                />
                <Line
                  type="monotone"
                  dataKey="opt"
                  name={SCENARIO_STYLE.optimistic.label}
                  stroke={SCENARIO_STYLE.optimistic.color}
                  strokeWidth={SCENARIO_STYLE.optimistic.strokeWidth}
                  strokeDasharray={SCENARIO_STYLE.optimistic.strokeDasharray}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="pes"
                  name={SCENARIO_STYLE.pessimistic.label}
                  stroke={SCENARIO_STYLE.pessimistic.color}
                  strokeWidth={SCENARIO_STYLE.pessimistic.strokeWidth}
                  strokeDasharray={SCENARIO_STYLE.pessimistic.strokeDasharray}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="real"
                  name={SCENARIO_STYLE.realistic.label}
                  stroke={SCENARIO_STYLE.realistic.color}
                  strokeWidth={SCENARIO_STYLE.realistic.strokeWidth}
                  dot={false}
                  isAnimationActive={false}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              A faixa cinza é o <strong>Intervalo de cenário</strong> — a
              distância entre a hipótese operacional favorável e a conservadora.
              Não é um intervalo estatístico de confiança.
            </span>
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <SummaryCard
              title="Otimista"
              color={SCENARIO_STYLE.optimistic.color}
              summary={data.summaries.optimistic}
              diffToRealistic={diffs.opt}
            />
            <SummaryCard
              title="Realista (principal)"
              color={SCENARIO_STYLE.realistic.color}
              summary={data.summaries.realistic}
              diffToRealistic={null}
            />
            <SummaryCard
              title="Pessimista"
              color={SCENARIO_STYLE.pessimistic.color}
              summary={data.summaries.pessimistic}
              diffToRealistic={diffs.pes}
            />
          </div>

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
              <p className="mt-1 text-[10px]">
                Política em uso: pessimista{" "}
                {data.policy.pessimisticEnabled ? "habilitado" : "desligado"} ·
                atraso de CR {data.policy.pessimisticReceivableDelayDays} dias ·
                versão {data.policy.version}.
              </p>
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
    </section>
  );
}

function ScenarioDayDrilldown({
  day,
  onClose,
}: {
  day: TreasuryScenarioDay;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"realistic" | "optimistic" | "pessimistic">(
    "realistic"
  );
  const facts = day[tab];
  return (
    <div
      className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"
      data-testid="caixa-scenarios-drilldown"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase text-[#6B7280]">
          Composição — {formatCivilDate(day.civilDate)}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Fechar
        </button>
      </div>
      <div
        className="mb-2 inline-flex rounded-md border border-[#E5E7EB] bg-white p-0.5"
        role="group"
      >
        {(["realistic", "optimistic", "pessimistic"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTab(s)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-semibold",
              tab === s
                ? "bg-[#2563EB] text-white"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid={`caixa-scenarios-drilldown-tab-${s}`}
          >
            {s === "realistic"
              ? "Realista"
              : s === "optimistic"
                ? "Otimista"
                : "Pessimista"}
          </button>
        ))}
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
