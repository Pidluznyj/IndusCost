/**
 * Projeção do caixa — cenários — VISÃO AMPLIADA (apresentação).
 *
 * NÃO é um segundo motor: o modal pede ao MESMO endpoint dos cenários o
 * horizonte de HOJE até a data final pedida (o serviço aceita até 366 dias
 * e, sem o parâmetro explícito, continua clampando em silêncio para os
 * recortes do card) e desenha com o MESMO componente/`buildRows`. Este
 * arquivo resolve o período, o recorte local (slicer) e os KPIs derivados —
 * nenhuma fórmula financeira vive aqui.
 *
 * SEMÂNTICA TEMPORAL (motor real): a projeção é PROSPECTIVA — janela civil
 * de asOf (hoje) até asOf + horizonDays. Não existe projeção retroativa; o
 * passado realizado entra como PREFIXO da Linha do tempo do ano pedido.
 * O padrão da visão ampliada continua 01/01 → 31/12 do ano de hoje.
 * Período que o motor não cobre é recusado com mensagem — nunca truncado.
 *
 * Datas são strings civis (YYYY-MM-DD) de ponta a ponta — nada de
 * `new Date("YYYY-MM-DD")` deslocando dia por timezone. O fuso operacional
 * é America/Sao_Paulo (`todayTreasuryCivilDateInSaoPaulo`).
 */

import { normalizeAnnualRange } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import type { TreasuryCaixaAnnualRange } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import type { TreasuryCaixaHistoricalArPresentationBridge } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { isTreasuryCivilDate } from "@/src/lib/treasury/contracts/treasuryCivilDate.js";
import {
  addCivilDays,
  diffCivilDays,
} from "@/src/lib/treasury/domain/treasuryCaixaScenarioDeltas.js";

/**
 * Igual a `TREASURY_CAIXA_SCENARIOS_MAX_HORIZON_DAYS` no serviço de cenários.
 * Um ano civil inteiro (366 em bissexto). A visão ampliada recusa acima
 * disto em vez de herdar o clamp silencioso do serviço.
 */
export const SCENARIO_EXPANDED_MAX_HORIZON_DAYS = 366;

/**
 * Cada ano civil é um board oficial completo da Caixa. Três anos cobrem o
 * caso suportado (ano anterior realizado + ano da âncora + ano seguinte
 * dentro do teto de 366 dias) sem multiplicar essa leitura.
 */
export const SCENARIO_EXPANDED_MAX_CIVIL_YEARS = 3;

export type { TreasuryCaixaAnnualRange as TreasuryScenarioExpandedRange };
export { normalizeAnnualRange as normalizeScenarioExpandedRange };

/**
 * Horizonte prospectivo da visão ampliada: de hoje (inclusive) até 31/12 do
 * ano de hoje (inclusive). 31/12 → 1; 01/01 → 365 (366 em bissexto).
 */
export function resolveScenarioExpandedHorizon(todayCivil: string): {
  horizonDays: number;
  endCivil: string;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayCivil.trim());
  if (!m) return { horizonDays: 90, endCivil: todayCivil };
  const year = Number(m[1]);
  const endCivil = `${year}-12-31`;
  const startUtc = Date.UTC(year, Number(m[2]) - 1, Number(m[3]));
  const endUtc = Date.UTC(year, 11, 31);
  const MS = 24 * 60 * 60 * 1000;
  const horizonDays = Math.max(1, Math.round((endUtc - startUtc) / MS) + 1);
  return { horizonDays, endCivil };
}

/** Padrão da visão ampliada: 01/01 → 31/12 do ano civil de hoje (America/Sao_Paulo). */
export function defaultScenarioExpandedPeriod(todayCivil: string): {
  startCivil: string;
  endCivil: string;
} {
  const year = /^(\d{4})-\d{2}-\d{2}$/.exec(todayCivil.trim())?.[1];
  if (!year) return { startCivil: todayCivil, endCivil: todayCivil };
  return { startCivil: `${year}-01-01`, endCivil: `${year}-12-31` };
}

export type ScenarioExpandedPeriodPlan =
  | {
      ok: true;
      startCivil: string;
      endCivil: string;
      /** Anos com realizado a carregar (início → último dia anterior a hoje dentro do período). */
      historyYears: number[];
      /**
       * Dias inclusivos de hoje até a data final. `null` quando o período
       * termina antes de hoje — não há projeção, só realizado.
       */
      horizonDays: number | null;
      /** Último dia civil que o motor alcança a partir de hoje (inclusivo). */
      maxHorizonEndCivil: string;
      /**
       * true só quando a janela prospectiva passa de 31/12 do ano da âncora.
       * O serviço só então lê as estimativas por vencimento do ano seguinte.
       * Recortes de 7/15/30/60/90 não enviam este sinal.
       */
      extendDueEstimatesBeyondAnchorYear: boolean;
      /** Anos estritamente posteriores ao da âncora, cobertos pelo horizonte. */
      estimateYears: number[];
    }
  | {
      ok: false;
      code:
        | "MISSING_START"
        | "MISSING_END"
        | "INVALID_START"
        | "INVALID_END"
        | "END_BEFORE_START"
        | "HORIZON_EXCEEDED"
        | "TOO_MANY_YEARS";
      message: string;
      proposal: string | null;
    };

function civilYear(civil: string): number {
  return Number(civil.slice(0, 4));
}

function yearsInclusive(fromYear: number, toYear: number): number[] {
  const years: number[] = [];
  for (let year = fromYear; year <= toYear; year += 1) years.push(year);
  return years;
}

/**
 * Plano de carregamento do período pedido. Não busca dados e não altera
 * saldo: só decide quais boards anuais e qual horizonte o modal pode pedir
 * aos endpoints que já existem. Fora do que o motor cobre, recusa.
 */
export function planScenarioExpandedPeriod(input: {
  todayCivil: string;
  startCivil: string;
  endCivil: string;
}): ScenarioExpandedPeriodPlan {
  const startCivil = input.startCivil.trim();
  const endCivil = input.endCivil.trim();
  const todayCivil = input.todayCivil.trim();

  if (startCivil === "") {
    return {
      ok: false,
      code: "MISSING_START",
      message: "Informe a data inicial.",
      proposal: null,
    };
  }
  if (endCivil === "") {
    return {
      ok: false,
      code: "MISSING_END",
      message: "Informe a data final.",
      proposal: null,
    };
  }
  if (!isTreasuryCivilDate(startCivil) || !isTreasuryCivilDate(todayCivil)) {
    return {
      ok: false,
      code: "INVALID_START",
      message:
        "Data inicial inválida. Use uma data civil válida no fuso America/Sao_Paulo.",
      proposal: null,
    };
  }
  if (!isTreasuryCivilDate(endCivil)) {
    return {
      ok: false,
      code: "INVALID_END",
      message:
        "Data final inválida. Use uma data civil válida no fuso America/Sao_Paulo.",
      proposal: null,
    };
  }
  if (endCivil < startCivil) {
    return {
      ok: false,
      code: "END_BEFORE_START",
      message: "A data final não pode ser anterior à data inicial.",
      proposal: null,
    };
  }

  const maxHorizonEndCivil = addCivilDays(
    todayCivil,
    SCENARIO_EXPANDED_MAX_HORIZON_DAYS - 1
  );
  const horizonDays =
    endCivil < todayCivil ? null : diffCivilDays(todayCivil, endCivil) + 1;
  if (horizonDays != null && horizonDays > SCENARIO_EXPANDED_MAX_HORIZON_DAYS) {
    return {
      ok: false,
      code: "HORIZON_EXCEEDED",
      message:
        `O motor de cenários projeta no máximo ${SCENARIO_EXPANDED_MAX_HORIZON_DAYS} dias corridos a partir de hoje ` +
        `(${todayCivil}), até ${maxHorizonEndCivil}, no fuso America/Sao_Paulo. ` +
        `O período termina em ${endCivil}. A projeção não foi gerada e não foi truncada.`,
      proposal:
        "Para ir além desse teto é preciso medir o tempo de getBoard e de computeTreasuryCaixaScenarios " +
        "e só então subir MAX_HORIZON_DAYS, carregando um board por ano civil adicional. " +
        "O teto atual cabe num ano civil inteiro (366 em bissexto) e permanece intacto nos recortes de 7, 15, 30, 60 e 90 dias.",
    };
  }

  const yesterdayCivil = addCivilDays(todayCivil, -1);
  const historyEnd =
    endCivil < todayCivil ? endCivil : yesterdayCivil;
  const historyYears =
    historyEnd < startCivil
      ? []
      : yearsInclusive(civilYear(startCivil), civilYear(historyEnd));

  const anchorYear = civilYear(todayCivil);
  const anchorYearEnd = `${anchorYear}-12-31`;
  const estimateYears =
    horizonDays == null || endCivil <= anchorYearEnd
      ? []
      : yearsInclusive(anchorYear + 1, civilYear(endCivil));

  const coveredYears = new Set<number>(historyYears);
  if (horizonDays != null) coveredYears.add(anchorYear);
  for (const year of estimateYears) coveredYears.add(year);
  if (coveredYears.size > SCENARIO_EXPANDED_MAX_CIVIL_YEARS) {
    return {
      ok: false,
      code: "TOO_MANY_YEARS",
      message:
        `Este intervalo cobre ${coveredYears.size} anos civis. Cada ano é um board oficial completo da Caixa; ` +
        `a visão ampliada carrega no máximo ${SCENARIO_EXPANDED_MAX_CIVIL_YEARS} anos por geração. ` +
        "A projeção não foi gerada e não foi truncada.",
      proposal:
        "Uma série diária contínua (realizado + estimativas por vencimento), paginada, substituiria um getBoard completo por ano civil.",
    };
  }

  return {
    ok: true,
    startCivil,
    endCivil,
    historyYears,
    horizonDays,
    maxHorizonEndCivil,
    extendDueEstimatesBeyondAnchorYear: estimateYears.length > 0,
    estimateYears,
  };
}

/** true quando as datas do formulário diferem do período já desenhado. */
export function scenarioExpandedDraftIsStale(
  draft: { startCivil: string; endCivil: string },
  loaded: { startCivil: string; endCivil: string } | null
): boolean {
  if (loaded == null) return false;
  return (
    draft.startCivil !== loaded.startCivil || draft.endCivil !== loaded.endCivil
  );
}

/**
 * Índices inclusivos da série já montada que caem em [start, end].
 * Datas fora do período permanecem na série quando o encadeamento do saldo
 * precisa delas; o gráfico abre neste recorte.
 */
export function rangeCoveringCivilDates(
  civilDates: readonly string[],
  startCivil: string,
  endCivil: string
): TreasuryCaixaAnnualRange | null {
  if (civilDates.length === 0) return null;
  let startIndex = -1;
  let endIndex = -1;
  for (let i = 0; i < civilDates.length; i += 1) {
    const date = civilDates[i]!;
    if (date < startCivil || date > endCivil) continue;
    if (startIndex < 0) startIndex = i;
    endIndex = i;
  }
  if (startIndex < 0 || endIndex < 0) return null;
  return { startIndex, endIndex };
}

export type TreasuryScenarioExpandedPreset = {
  key: "full" | "d30" | "d60" | "d90" | "d180";
  label: string;
  /** null = janela inteira; N = primeiros N dias a partir de hoje. */
  days: number | null;
};

/**
 * Presets PROSPECTIVOS (adaptação documentada: o motor não projeta passado,
 * então trimestres civis não se aplicam — os recortes úteis são janelas a
 * partir de hoje, alinhadas aos horizontes que o card já oferece).
 */
export const TREASURY_SCENARIO_EXPANDED_PRESETS: readonly TreasuryScenarioExpandedPreset[] =
  [
    { key: "full", label: "Até 31/12", days: null },
    { key: "d30", label: "30 dias", days: 30 },
    { key: "d60", label: "60 dias", days: 60 },
    { key: "d90", label: "90 dias", days: 90 },
    { key: "d180", label: "180 dias", days: 180 },
  ];

export function resolveScenarioExpandedPresetRange(
  pointCount: number,
  preset: TreasuryScenarioExpandedPreset
): TreasuryCaixaAnnualRange {
  if (pointCount <= 0) return { startIndex: 0, endIndex: 0 };
  const end =
    preset.days == null
      ? pointCount - 1
      : Math.min(pointCount - 1, preset.days - 1);
  return { startIndex: 0, endIndex: Math.max(0, end) };
}

export function matchScenarioExpandedPreset(
  pointCount: number,
  range: TreasuryCaixaAnnualRange
): TreasuryScenarioExpandedPreset["key"] | null {
  for (const preset of TREASURY_SCENARIO_EXPANDED_PRESETS) {
    const r = resolveScenarioExpandedPresetRange(pointCount, preset);
    if (r.startIndex === range.startIndex && r.endIndex === range.endIndex) {
      return preset.key;
    }
  }
  return null;
}

/**
 * Converte data civil digitada em índice DIÁRIO da janela carregada.
 * Fora da janela → clamp ao limite; não-parseável → null.
 */
export function civilDateToScenarioIndex(
  civilDates: readonly string[],
  civil: string
): number | null {
  if (civilDates.length === 0) return null;
  const value = civil.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value <= civilDates[0]!) return 0;
  const last = civilDates[civilDates.length - 1]!;
  if (value >= last) return civilDates.length - 1;
  const idx = civilDates.findIndex((d) => d >= value);
  return idx >= 0 ? idx : civilDates.length - 1;
}

/* ------------------------------------------------------------------ */
/*  Prefixo do PASSADO REALIZADO (frontend; motor de cenários intacto)  */
/* ------------------------------------------------------------------ */

/**
 * O motor de cenários acumula saldo sequencialmente a partir da âncora de
 * HOJE — estender a janela dele para trás faria a projeção futura divergir
 * do card (a âncora oficial deixaria de valer). Por isso o passado entra
 * como PREFIXO montado da série canônica da Linha do tempo (a MESMA
 * composição da Visão Anual da Evolução do saldo): dias < asOf viram linhas
 * onde os três cenários coincidem com o REALIZADO — exatamente como o motor
 * trata passado ("dia < asOf usa realizado; sem projeção").
 */

export type TreasuryScenarioPastTimelineRow = {
  civilDate: string;
  opening: number | null;
  closing: number | null;
  inflows: number;
  outflows: number;
  /**
   * Fechamento INFORMADO canônico (`closingInformed` da linha do tempo).
   * `null`/ausente = sem âncora factual. Não inferir por valor ou divergência.
   */
  closingInformed?: number | null;
};

/** Subconjunto do ScenarioChartRow que o prefixo precisa produzir. */
export type TreasuryScenarioPrefixRow = {
  civilDate: string;
  label: string;
  opt: number | null;
  real: number | null;
  pes: number | null;
  optNeg: number | null;
  realNeg: number | null;
  pesNeg: number | null;
  sim: number | null;
  simNeg: number | null;
  bandLow: number | null;
  bandRange: number | null;
  isPast: boolean;
  openingShown: number | null;
};

/** Dia sintético para o tooltip (mesmo shape do TreasuryScenarioDay). */
export type TreasuryScenarioPrefixDay = {
  civilDate: string;
  openingBalance: number | null;
  realizedInflows: number;
  realizedOutflows: number;
  otherInflows: number;
  otherOutflows: number;
  optimistic: TreasuryScenarioPrefixDayFacts;
  realistic: TreasuryScenarioPrefixDayFacts;
  pessimistic: TreasuryScenarioPrefixDayFacts;
  warnings: string[];
  /**
   * Delta de apresentação deste dia civil (não é inflow factual).
   * 0 quando a ponte não move este ponto.
   */
  presentationAdjustment: number;
};

type TreasuryScenarioPrefixDayFacts = {
  receivableInflows: number;
  payableOutflows: number;
  receivableCount: number;
  payableCount: number;
  receivableProjections: never[];
  payableProjections: never[];
  closingBalance: number | null;
};

function shortDayLabel(civilDate: string): string {
  return `${civilDate.slice(8, 10)}/${civilDate.slice(5, 7)}`;
}

function roundPresentationMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function carriedCanonicalClosing(
  date: string,
  factual: readonly TreasuryScenarioPastTimelineRow[]
): number | null {
  for (let i = factual.length - 1; i >= 0; i -= 1) {
    const row = factual[i]!;
    if (row.civilDate < date && row.closing != null) return row.closing;
  }
  for (const row of factual) {
    if (row.civilDate > date && row.opening != null) return row.opening;
  }
  return null;
}

/**
 * Prefixo histórico do gráfico de projeção.
 *
 * `row.closing` canônico NÃO é mutado. O Y desenhado é
 * displayClosing = canonicalClosing + presentationAdjustmentRunning,
 * com reset do running quando `closingInformed` é autoridade factual.
 * Inflows/outflows permanecem factuais. A ponte NÃO alimenta o motor de
 * cenários nem a tabela diária.
 */
export function buildScenarioPastPrefix(input: {
  timelineRows: readonly TreasuryScenarioPastTimelineRow[];
  asOfCivilDate: string;
  presentationBridge?: TreasuryCaixaHistoricalArPresentationBridge | null;
}): { rows: TreasuryScenarioPrefixRow[]; days: TreasuryScenarioPrefixDay[] } {
  const factual = input.timelineRows
    .filter((r) => r.civilDate < input.asOfCivilDate)
    .slice()
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));
  const factualByDate = new Map(factual.map((r) => [r.civilDate, r]));
  const adj = input.presentationBridge?.adjustmentByCivilDate ?? {};

  const dates = new Set(factual.map((r) => r.civilDate));
  for (const date of Object.keys(adj)) {
    if (date < input.asOfCivilDate) dates.add(date);
  }
  const orderedDates = [...dates].sort((a, b) => a.localeCompare(b));

  let running = roundPresentationMoney(
    input.presentationBridge?.openingAdjustment ?? 0
  );
  const rows: TreasuryScenarioPrefixRow[] = [];
  const days: TreasuryScenarioPrefixDay[] = [];

  for (const date of orderedDates) {
    const source = factualByDate.get(date);
    const dayAdj = roundPresentationMoney(adj[date] ?? 0);

    let opening: number | null;
    let closing: number | null;
    let inflows: number;
    let outflows: number;
    if (source) {
      opening = source.opening;
      closing = source.closing;
      inflows = source.inflows;
      outflows = source.outflows;
    } else {
      const carried = carriedCanonicalClosing(date, factual);
      if (carried == null) {
        running = roundPresentationMoney(running + dayAdj);
        continue;
      }
      opening = carried;
      closing = carried;
      inflows = 0;
      outflows = 0;
    }

    const displayOpening =
      opening == null ? null : roundPresentationMoney(opening + running);
    running = roundPresentationMoney(running + dayAdj);
    const informedClosing =
      source != null &&
      source.closingInformed != null &&
      Number.isFinite(source.closingInformed);
    if (informedClosing) {
      running = 0;
    }
    const displayClosing =
      closing == null ? null : roundPresentationMoney(closing + running);
    const neg =
      displayClosing != null && displayClosing <= 0 ? displayClosing : null;

    rows.push({
      civilDate: date,
      label: shortDayLabel(date),
      // Passado: os três cenários coincidem com o Y de apresentação.
      opt: displayClosing,
      real: displayClosing,
      pes: displayClosing,
      optNeg: neg,
      realNeg: neg,
      pesNeg: neg,
      sim: null,
      simNeg: null,
      bandLow: null,
      bandRange: null,
      isPast: true,
      openingShown: displayOpening,
    });
    const facts: TreasuryScenarioPrefixDayFacts = {
      receivableInflows: 0,
      payableOutflows: 0,
      receivableCount: 0,
      payableCount: 0,
      receivableProjections: [],
      payableProjections: [],
      closingBalance: displayClosing,
    };
    days.push({
      civilDate: date,
      openingBalance: displayOpening,
      realizedInflows: inflows,
      realizedOutflows: outflows,
      otherInflows: 0,
      otherOutflows: 0,
      optimistic: facts,
      realistic: { ...facts },
      pessimistic: { ...facts },
      warnings: [],
      presentationAdjustment: dayAdj,
    });
  }
  return { rows, days };
}

export type TreasuryScenarioFullPreset = {
  key: "year" | "future" | "f90" | "f180";
  label: string;
};

/**
 * Presets da janela COMPLETA (passado realizado + futuro projetado):
 * ano civil inteiro, só o futuro, e janelas futuras de 90/180 dias.
 */
export const TREASURY_SCENARIO_FULL_PRESETS: readonly TreasuryScenarioFullPreset[] =
  [
    { key: "year", label: "Ano completo" },
    { key: "future", label: "Hoje → 31/12" },
    { key: "f90", label: "Próx. 90 dias" },
    { key: "f180", label: "Próx. 180 dias" },
  ];

export function resolveScenarioFullPresetRange(
  pointCount: number,
  pastCount: number,
  preset: TreasuryScenarioFullPreset
): TreasuryCaixaAnnualRange {
  if (pointCount <= 0) return { startIndex: 0, endIndex: 0 };
  const last = pointCount - 1;
  const todayIdx = Math.min(Math.max(0, pastCount), last);
  switch (preset.key) {
    case "year":
      return { startIndex: 0, endIndex: last };
    case "future":
      return { startIndex: todayIdx, endIndex: last };
    case "f90":
      return { startIndex: todayIdx, endIndex: Math.min(todayIdx + 89, last) };
    case "f180":
      return { startIndex: todayIdx, endIndex: Math.min(todayIdx + 179, last) };
  }
}

export function matchScenarioFullPreset(
  pointCount: number,
  pastCount: number,
  range: TreasuryCaixaAnnualRange
): TreasuryScenarioFullPreset["key"] | null {
  for (const preset of TREASURY_SCENARIO_FULL_PRESETS) {
    const r = resolveScenarioFullPresetRange(pointCount, pastCount, preset);
    if (r.startIndex === range.startIndex && r.endIndex === range.endIndex) {
      return preset.key;
    }
  }
  return null;
}

/** Linha mínima necessária para os KPIs (subset do ScenarioChartRow). */
export type TreasuryScenarioExpandedKpiRow = {
  civilDate: string;
  real: number | null;
  opt: number | null;
  pes: number | null;
  openingShown: number | null;
};

export type TreasuryScenarioExpandedKpis = {
  /** Abertura exibida do 1º dia do recorte (mesma fonte do tooltip). */
  initialBalance: number | null;
  /** Menor saldo do REALISTA dentro do recorte. */
  minRealistic: number | null;
  minRealisticDate: string | null;
  /** Fechamentos do último dia com valor, por cenário. */
  finalRealistic: number | null;
  finalOptimistic: number | null;
  finalPessimistic: number | null;
};

function lastNonNull(
  rows: readonly TreasuryScenarioExpandedKpiRow[],
  pick: (r: TreasuryScenarioExpandedKpiRow) => number | null
): number | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = pick(rows[i]!);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * KPIs derivados EXCLUSIVAMENTE das linhas já desenhadas (mesmo `buildRows`
 * do gráfico) — zero query, zero fórmula própria de cenário.
 */
export function deriveScenarioExpandedKpis(
  rows: readonly TreasuryScenarioExpandedKpiRow[]
): TreasuryScenarioExpandedKpis {
  const first = rows.find(
    (r) => r.openingShown != null || r.real != null
  );

  let minRealistic: number | null = null;
  let minRealisticDate: string | null = null;
  for (const r of rows) {
    if (r.real == null || !Number.isFinite(r.real)) continue;
    if (minRealistic == null || r.real < minRealistic) {
      minRealistic = r.real;
      minRealisticDate = r.civilDate;
    }
  }

  return {
    initialBalance: first?.openingShown ?? first?.real ?? null,
    minRealistic,
    minRealisticDate,
    finalRealistic: lastNonNull(rows, (r) => r.real),
    finalOptimistic: lastNonNull(rows, (r) => r.opt),
    finalPessimistic: lastNonNull(rows, (r) => r.pes),
  };
}
