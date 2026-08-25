/**
 * Caixa — Visão Anual da Linha do Tempo (apresentação).
 *
 * NÃO é um segundo motor: este arquivo apenas COMPÕE, na mesma ordem, as
 * mesmas funções canônicas de `treasuryCaixaRules` que a página da Caixa já
 * usa para montar a série do gráfico "Evolução do saldo". A página e o modal
 * anual importam a MESMA composição (`buildTreasuryCaixaTimelineFromBoardSources`
 * saiu da página para cá) — não existem duas contas para divergirem.
 *
 * O range anual não é calculado aqui: o board pedido só com `year` — sem
 * mês/dia — já resolve 01/01→31/12 (bissexto incluso) no backend, pelo
 * `resolveTreasuryCaixaDueDateRange`. A Visão Anual apenas deixa de enviar
 * `month`/`day`.
 *
 * Os KPIs derivam da MESMA série mensal do gráfico (nenhuma query própria):
 * saldo inicial = abertura do primeiro mês com saldo; menor saldo = menor
 * fechamento mensal; saldo final = fechamento do último mês, com o rótulo
 * oficial realizado × previsto do próprio ponto.
 */

import {
  appendTreasuryCaixaDailyDueEstimates,
  applyTreasuryCaixaCanonicalTodayFlow,
  buildTreasuryCaixaMonthlyBalanceChart,
  buildTreasuryCaixaMonthlyTimeline,
  buildTreasuryCaixaUnifiedTimeline,
  resolveTreasuryCaixaChainedOpeningForToday,
  type TreasuryCaixaBalanceChartPoint,
  type TreasuryCaixaDayFlow,
  type TreasuryCaixaTimeline,
  type TreasuryCaixaTimelineMonth,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryAgendaDayDto } from "@/src/lib/treasury/contracts/index.js";
import { treasuryMoneyToNumber } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import type { TreasuryCaixaPayload } from "@/src/lib/treasury/treasuryCaixaApi.js";

/**
 * Passado (do board, por data de liquidação) + hoje (fechamento do dia) +
 * futuro (agenda). Passar `agendaDays` vazio produz a linha do tempo só com o
 * que é fato — é o caminho usado quando não há projeção materializada.
 * (Movida da página da Caixa — mesma composição, agora compartilhada.)
 */
export function buildTreasuryCaixaTimelineFromBoardSources(
  board: TreasuryCaixaPayload,
  todayFlow: TreasuryCaixaDayFlow | null,
  agendaDays: readonly TreasuryAgendaDayDto[]
): TreasuryCaixaTimeline {
  return buildTreasuryCaixaUnifiedTimeline({
    todayCivilDate: todayTreasuryCivilDateInSaoPaulo(),
    realizedDays: board.realizedDays ?? [],
    todayFlow,
    // `inflows`/`outflows` = cenário pedido; são os que movem o closingBalance.
    // Os buckets `planned*` não servem: plannedOutflows só vem do contratual e
    // fica zerado quando se pede PROBABLE, deixando a coluna "Saiu" vazia.
    forecastDays: agendaDays.map((d) => ({
      civilDate: d.civilDate,
      openingBalance: treasuryMoneyToNumber(d.openingBalance),
      inflows: treasuryMoneyToNumber(d.inflows),
      outflows: treasuryMoneyToNumber(d.outflows),
      closingBalance:
        d.closingBalance == null
          ? null
          : treasuryMoneyToNumber(d.closingBalance),
    })),
  });
}

export type TreasuryCaixaAnnualSeries = {
  timeline: TreasuryCaixaTimeline;
  months: TreasuryCaixaTimelineMonth[];
  points: TreasuryCaixaBalanceChartPoint[];
};

/**
 * Série anual pela MESMA cadeia da página: correção canônica do fluxo de hoje
 * (regra dos N dias / abertura encadeada) ancorada no board DO ANO pedido,
 * linha do tempo unificada, estimativas por vencimento, agregação mensal e
 * pontos do gráfico oficial.
 */
export function buildTreasuryCaixaAnnualSeries(input: {
  board: TreasuryCaixaPayload;
  /** Fluxo bruto de hoje (mesmo dado que a página já carregou no bootstrap). */
  todayFlowRaw: TreasuryCaixaDayFlow | null;
  agendaDays: readonly TreasuryAgendaDayDto[];
}): TreasuryCaixaAnnualSeries {
  const { board, todayFlowRaw, agendaDays } = input;
  const todayCivil = todayTreasuryCivilDateInSaoPaulo();
  const canonicalToday =
    board.canonicalDays?.find((d) => d.civilDate === todayCivil) ?? null;
  const chainedOpening = resolveTreasuryCaixaChainedOpeningForToday(
    board.realizedDays ?? [],
    todayCivil
  );
  const correctedTodayFlow = todayFlowRaw
    ? applyTreasuryCaixaCanonicalTodayFlow(todayFlowRaw, canonicalToday, {
        fallbackOpening: chainedOpening,
      })
    : null;

  const base = buildTreasuryCaixaTimelineFromBoardSources(
    board,
    correctedTodayFlow,
    agendaDays
  );
  const timeline = appendTreasuryCaixaDailyDueEstimates(
    base,
    board.dailyDueEstimates ?? []
  );
  const months = buildTreasuryCaixaMonthlyTimeline(timeline.rows);
  const points = buildTreasuryCaixaMonthlyBalanceChart(months);
  return { timeline, months, points };
}

export type TreasuryCaixaAnnualKpis = {
  /** Abertura do primeiro mês com saldo acumulado; null = indisponível. */
  initialBalance: number | null;
  /** Menor fechamento mensal do ano; null quando não há ponto. */
  lowestBalance: number | null;
  /** Rótulo oficial do mês do menor saldo (ex.: "set/26"). */
  lowestBalanceLabel: string | null;
  lowestBalanceIsForecast: boolean;
  /** Fechamento do último mês com saldo; null quando não há ponto. */
  finalBalance: number | null;
  /** true = saldo final é previsão pelos títulos em aberto (rótulo oficial). */
  finalBalanceIsForecast: boolean;
};

/* ------------------------------------------------------------------ */
/*  Slicer de período — recorte LOCAL da série anual (zero request).    */
/*  Granularidade: MENSAL — a mesma do gráfico oficial (o ponto é o     */
/*  "Terminou" do mês). Nenhuma regra financeira é recalculada: o       */
/*  recorte é um slice dos MESMOS meses/pontos que o motor produziu.    */
/* ------------------------------------------------------------------ */

/** Intervalo por ÍNDICE de mês na série carregada (0-based, inclusivo). */
export type TreasuryCaixaAnnualRange = {
  startIndex: number;
  endIndex: number;
};

export type TreasuryCaixaAnnualPreset = {
  key: "full" | "q1" | "q2" | "q3" | "q4";
  label: string;
  /** Meses civis 1..12 (inclusivos) que o preset cobre. */
  startMonth: number;
  endMonth: number;
};

export const TREASURY_CAIXA_ANNUAL_PRESETS: readonly TreasuryCaixaAnnualPreset[] =
  [
    { key: "full", label: "Ano inteiro", startMonth: 1, endMonth: 12 },
    { key: "q1", label: "1º Tri", startMonth: 1, endMonth: 3 },
    { key: "q2", label: "2º Tri", startMonth: 4, endMonth: 6 },
    { key: "q3", label: "3º Tri", startMonth: 7, endMonth: 9 },
    { key: "q4", label: "4º Tri", startMonth: 10, endMonth: 12 },
  ];

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Datas civis (YYYY-MM-DD) do intervalo efetivo: 1º dia do mês inicial e
 * último dia do mês final — sempre strings civis, nunca Date (sem timezone
 * para deslocar 01/01 ou 31/12).
 */
export function annualRangeToCivilDates(
  points: readonly TreasuryCaixaBalanceChartPoint[],
  range: TreasuryCaixaAnnualRange
): { fromCivil: string; toCivil: string } | null {
  const start = points[range.startIndex];
  const end = points[range.endIndex];
  if (!start || !end) return null;
  const [ey, em] = end.monthKey.split("-").map(Number);
  if (!ey || !em) return null;
  return {
    fromCivil: `${start.monthKey}-01`,
    toCivil: `${end.monthKey}-${String(lastDayOfMonth(ey, em)).padStart(2, "0")}`,
  };
}

/**
 * Converte uma data civil digitada num índice de mês da série carregada.
 * Clampa ao ano carregado: antes do 1º ponto → 0; depois do último →
 * último índice. Retorna null só para entrada não-parseável.
 */
export function civilDateToAnnualIndex(
  points: readonly TreasuryCaixaBalanceChartPoint[],
  civilDate: string
): number | null {
  if (points.length === 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate.trim());
  if (!m) return null;
  const monthKey = `${m[1]}-${m[2]}`;
  const idx = points.findIndex((p) => p.monthKey === monthKey);
  if (idx >= 0) return idx;
  if (monthKey < points[0]!.monthKey) return 0;
  return points.length - 1;
}

/**
 * Normaliza um intervalo: índices dentro da série e start ≤ end (datas
 * invertidas são corrigidas por troca — nunca estado vazio/NaN).
 */
export function normalizeAnnualRange(
  pointCount: number,
  range: TreasuryCaixaAnnualRange
): TreasuryCaixaAnnualRange {
  if (pointCount <= 0) return { startIndex: 0, endIndex: 0 };
  const clamp = (v: number) =>
    Math.min(pointCount - 1, Math.max(0, Math.trunc(Number.isFinite(v) ? v : 0)));
  const a = clamp(range.startIndex);
  const b = clamp(range.endIndex);
  return a <= b
    ? { startIndex: a, endIndex: b }
    : { startIndex: b, endIndex: a };
}

/** Índices do preset dentro da série carregada (meses podem faltar no início/fim). */
export function resolveAnnualPresetRange(
  points: readonly TreasuryCaixaBalanceChartPoint[],
  preset: TreasuryCaixaAnnualPreset
): TreasuryCaixaAnnualRange {
  if (points.length === 0) return { startIndex: 0, endIndex: 0 };
  let start = -1;
  let end = -1;
  for (let i = 0; i < points.length; i += 1) {
    const month = Number(points[i]!.monthKey.slice(5, 7));
    if (month >= preset.startMonth && month <= preset.endMonth) {
      if (start < 0) start = i;
      end = i;
    }
  }
  if (start < 0) return { startIndex: 0, endIndex: points.length - 1 };
  return { startIndex: start, endIndex: end };
}

/** Qual preset corresponde exatamente ao intervalo atual (para highlight). */
export function matchAnnualPreset(
  points: readonly TreasuryCaixaBalanceChartPoint[],
  range: TreasuryCaixaAnnualRange
): TreasuryCaixaAnnualPreset["key"] | null {
  for (const preset of TREASURY_CAIXA_ANNUAL_PRESETS) {
    const r = resolveAnnualPresetRange(points, preset);
    if (r.startIndex === range.startIndex && r.endIndex === range.endIndex) {
      return preset.key;
    }
  }
  return null;
}

/**
 * Recorte LOCAL da série — slice puro dos MESMOS meses/pontos do motor.
 * Equivalência semântica por construção: nenhum valor é recalculado.
 */
export function sliceTreasuryCaixaAnnualSeries(
  series: Pick<TreasuryCaixaAnnualSeries, "months" | "points">,
  range: TreasuryCaixaAnnualRange
): Pick<TreasuryCaixaAnnualSeries, "months" | "points"> {
  const { startIndex, endIndex } = normalizeAnnualRange(
    series.points.length,
    range
  );
  const monthKeys = new Set(
    series.points.slice(startIndex, endIndex + 1).map((p) => p.monthKey)
  );
  return {
    months: series.months.filter((m) => monthKeys.has(m.monthKey)),
    points: series.points.slice(startIndex, endIndex + 1),
  };
}

/** KPIs derivados da MESMA série do gráfico — nenhuma consulta própria. */
export function deriveTreasuryCaixaAnnualKpis(
  series: Pick<TreasuryCaixaAnnualSeries, "months" | "points">
): TreasuryCaixaAnnualKpis {
  const firstWithOpening = series.months.find(
    (m) => m.opening != null && Number.isFinite(m.opening)
  );

  let lowest: TreasuryCaixaBalanceChartPoint | null = null;
  for (const p of series.points) {
    if (lowest == null || p.closingBalance < lowest.closingBalance) lowest = p;
  }
  const last =
    series.points.length > 0 ? series.points[series.points.length - 1]! : null;

  return {
    initialBalance: firstWithOpening?.opening ?? null,
    lowestBalance: lowest?.closingBalance ?? null,
    lowestBalanceLabel: lowest?.label ?? null,
    lowestBalanceIsForecast: lowest?.isForecast ?? false,
    finalBalance: last?.closingBalance ?? null,
    finalBalanceIsForecast: last?.isForecast ?? false,
  };
}
