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
