/**
 * Projeção do caixa — cenários — VISÃO AMPLIADA (apresentação).
 *
 * NÃO é um segundo motor: o modal pede ao MESMO endpoint dos cenários um
 * horizonte maior (o serviço já aceita e clampa `horizonDays` até 365) e
 * desenha com o MESMO componente/`buildRows`. Este arquivo só resolve o
 * horizonte prospectivo, o recorte local (slicer) e os KPIs derivados —
 * nenhuma fórmula financeira vive aqui.
 *
 * SEMÂNTICA TEMPORAL (motor real): a projeção é PROSPECTIVA — janela civil
 * de asOf (hoje) até asOf + horizonDays. Não existe projeção retroativa; o
 * board que alimenta o motor cobre o ANO CIVIL do asOf. Por isso a visão
 * ampliada projeta HOJE → 31/12 do ano corrente (o máximo semanticamente
 * rico), e os presets/datas/brush RECORTAM localmente essa janela diária.
 *
 * Datas são strings civis (YYYY-MM-DD) de ponta a ponta — nada de
 * `new Date("YYYY-MM-DD")` deslocando dia por timezone.
 */

import { normalizeAnnualRange } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import type { TreasuryCaixaAnnualRange } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";

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

export function buildScenarioPastPrefix(input: {
  timelineRows: readonly TreasuryScenarioPastTimelineRow[];
  asOfCivilDate: string;
}): { rows: TreasuryScenarioPrefixRow[]; days: TreasuryScenarioPrefixDay[] } {
  const past = input.timelineRows
    .filter((r) => r.civilDate < input.asOfCivilDate)
    .slice()
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));

  const rows: TreasuryScenarioPrefixRow[] = [];
  const days: TreasuryScenarioPrefixDay[] = [];
  for (const r of past) {
    const closing = r.closing;
    const neg = closing != null && closing <= 0 ? closing : null;
    rows.push({
      civilDate: r.civilDate,
      label: shortDayLabel(r.civilDate),
      // Passado: os três cenários SÃO o realizado (linhas coincidem).
      opt: closing,
      real: closing,
      pes: closing,
      optNeg: neg,
      realNeg: neg,
      pesNeg: neg,
      sim: null,
      simNeg: null,
      bandLow: null,
      bandRange: null,
      isPast: true,
      openingShown: r.opening,
    });
    const facts: TreasuryScenarioPrefixDayFacts = {
      receivableInflows: 0,
      payableOutflows: 0,
      receivableCount: 0,
      payableCount: 0,
      receivableProjections: [],
      payableProjections: [],
      closingBalance: closing,
    };
    days.push({
      civilDate: r.civilDate,
      openingBalance: r.opening,
      realizedInflows: r.inflows,
      realizedOutflows: r.outflows,
      otherInflows: 0,
      otherOutflows: 0,
      optimistic: facts,
      realistic: { ...facts },
      pessimistic: { ...facts },
      warnings: [],
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
