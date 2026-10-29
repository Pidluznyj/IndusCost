/**
 * Inteligência Fiscal 360° — motor de projeção tributária. Função PURA sobre agregados persistidos.
 *
 * Determinística: obrigações conhecidas em aberto (guias/títulos AP), por mês de vencimento.
 * Estimada: receita externa projetada × razão efetiva HISTÓRICA por CNPJ × tributo
 *           (obrigação da competência ÷ faturamento oficial). Nunca um percentual único genérico.
 *           Parâmetros explícitos (FiscalRuleVersion fiscal360.tax-parameters, com vigência e fonte
 *           normativa) substituem a razão histórica apenas dentro da vigência.
 * Sem base suficiente → availability = UNAVAILABLE com motivo (nunca zero silencioso).
 * Metodologia completa: docs/finance/fiscal-intelligence-360-forecast.md
 */
import {
  addFiscal360Months,
  FISCAL360_RULE_VERSIONS,
  roundFiscal360,
} from "./fiscal360Constants.js";

export type ForecastHistoryRow = {
  companyCnpj: string;
  month: string;
  /** "*" para receita. */
  taxType: string;
  officialRevenue: number;
  apurationAmountDue: number;
  obligationAmountDue: number;
};

export type ForecastOpenObligation = {
  companyCnpj: string;
  taxType: string;
  competenceMonth: string;
  dueDate: string | null;
  openBalance: number;
  anchorKey: string;
};

export type ForecastLagSample = { taxType: string; competenceMonth: string; paidMonth: string };

export type ForecastTaxParameter = {
  companyCnpj: string;
  taxType: string;
  /** Alíquota efetiva sobre a receita externa (fração: 0.0365 = 3,65%). */
  rate: number;
  /** Crédito estimado (fração) sobre compras creditáveis mensais informadas. */
  creditRate?: number | null;
  purchasesMonthly?: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  normativeSource: string;
  ruleVersionId: string;
};

export type ForecastAssumptions = {
  /** Crescimento anual da receita externa (%, ex.: 10 = +10% a.a.). */
  revenueGrowthPct: number;
  /** Ajuste direto da receita projetada (%, ex.: -10). */
  revenueShiftPct: number;
  /** Percentil da razão histórica: P25 | MEDIAN | P75. */
  ratioPercentile: "P25" | "MEDIAN" | "P75";
  /** Ajuste nas compras creditáveis (%) — afeta somente parâmetros com creditRate. */
  purchasesShiftPct: number;
  /** Defasagem competência → pagamento (meses). null = histórica observada. */
  paymentLagMonths: number | null;
  horizonMonths: number;
};

export const FISCAL360_SYSTEM_SCENARIOS: Array<{
  systemKey: "BASE" | "CONSERVATIVE" | "EXPANSION";
  name: string;
  description: string;
  assumptions: ForecastAssumptions;
}> = [
  {
    systemKey: "BASE",
    name: "Base",
    description: "Receita na média recente com sazonalidade; razão tributária mediana do histórico.",
    assumptions: { revenueGrowthPct: 0, revenueShiftPct: 0, ratioPercentile: "MEDIAN", purchasesShiftPct: 0, paymentLagMonths: null, horizonMonths: 6 },
  },
  {
    systemKey: "CONSERVATIVE",
    name: "Conservador",
    description: "Premissa de caixa prudente: receita −10% e razão tributária no percentil 75 (mais imposto).",
    assumptions: { revenueGrowthPct: 0, revenueShiftPct: -10, ratioPercentile: "P75", purchasesShiftPct: -10, paymentLagMonths: null, horizonMonths: 6 },
  },
  {
    systemKey: "EXPANSION",
    name: "Expansão",
    description: "Receita crescendo 15% a.a. com razão tributária mediana.",
    assumptions: { revenueGrowthPct: 15, revenueShiftPct: 0, ratioPercentile: "MEDIAN", purchasesShiftPct: 10, paymentLagMonths: null, horizonMonths: 6 },
  },
];

export type ForecastRow = {
  companyCnpj: string;
  month: string;
  taxType: string;
  kind: "DETERMINISTIC" | "ESTIMATED";
  availability: "AVAILABLE" | "UNAVAILABLE";
  unavailableReason: string | null;
  amount: number | null;
  lowAmount: number | null;
  highAmount: number | null;
  revenueBase: number | null;
  ratioUsed: number | null;
  cashMonth: string | null;
  methodology: string;
  /** Parte do valor determinístico já vencida (atraso): sai do caixa agora, mas não é tributo da competência futura. */
  overdueAmount?: number | null;
  details: Record<string, unknown> | null;
};

export const FISCAL360_FORECAST_MIN_POINTS = 3;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function sanitizeForecastAssumptions(raw: Partial<ForecastAssumptions> | null | undefined): ForecastAssumptions {
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const pct = raw?.ratioPercentile;
  return {
    revenueGrowthPct: num(raw?.revenueGrowthPct, 0, -90, 300),
    revenueShiftPct: num(raw?.revenueShiftPct, 0, -90, 300),
    ratioPercentile: pct === "P25" || pct === "P75" ? pct : "MEDIAN",
    purchasesShiftPct: num(raw?.purchasesShiftPct, 0, -90, 300),
    paymentLagMonths: raw?.paymentLagMonths == null ? null : Math.round(num(raw.paymentLagMonths, 1, 0, 6)),
    horizonMonths: Math.round(num(raw?.horizonMonths, 6, 1, 18)),
  };
}

function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

export function buildFiscal360Forecast(input: {
  referenceMonth: string;
  history: ForecastHistoryRow[];
  openObligations: ForecastOpenObligation[];
  lagSamples: ForecastLagSample[];
  parameters: ForecastTaxParameter[];
  assumptions: ForecastAssumptions;
}): ForecastRow[] {
  const a = input.assumptions;
  const months = Array.from({ length: a.horizonMonths }, (_, i) => addFiscal360Months(input.referenceMonth, i));
  const lastClosed = addFiscal360Months(input.referenceMonth, -1);
  const out: ForecastRow[] = [];

  // Defasagem observada por tributo (mediana) — sem amostras, 1 mês declarado como padrão.
  const lagByTax = new Map<string, number[]>();
  for (const s of input.lagSamples) {
    const d = monthDiff(s.competenceMonth, s.paidMonth);
    if (d < 0 || d > 12) continue;
    const arr = lagByTax.get(s.taxType) ?? [];
    arr.push(d);
    lagByTax.set(s.taxType, arr);
  }
  const lagFor = (taxType: string): { lag: number; source: string } => {
    if (a.paymentLagMonths != null) return { lag: a.paymentLagMonths, source: "PREMISSA" };
    const samples = (lagByTax.get(taxType) ?? []).sort((x, y) => x - y);
    if (samples.length >= FISCAL360_FORECAST_MIN_POINTS) return { lag: Math.round(percentile(samples, 0.5)), source: "HISTORICO" };
    return { lag: 1, source: "PADRAO_1_MES" };
  };

  // 1) Determinística.
  const known = new Set<string>();
  const detGroups = new Map<string, { companyCnpj: string; taxType: string; month: string; amount: number; overdue: number; anchors: string[] }>();
  for (const o of input.openObligations) {
    if (o.openBalance <= 0) continue;
    known.add(`${o.companyCnpj}|${o.taxType}|${o.competenceMonth}`);
    const dueMonth = o.dueDate ? o.dueDate.slice(0, 7) : input.referenceMonth;
    const month = dueMonth < input.referenceMonth ? input.referenceMonth : dueMonth;
    if (monthDiff(input.referenceMonth, month) >= a.horizonMonths) continue;
    const key = `${o.companyCnpj}|${o.taxType}|${month}`;
    const g = detGroups.get(key) ?? { companyCnpj: o.companyCnpj, taxType: o.taxType, month, amount: 0, overdue: 0, anchors: [] };
    g.amount += o.openBalance;
    if (dueMonth < input.referenceMonth) g.overdue += o.openBalance;
    if (g.anchors.length < 20) g.anchors.push(o.anchorKey);
    detGroups.set(key, g);
  }
  for (const g of detGroups.values()) {
    out.push({
      companyCnpj: g.companyCnpj,
      month: g.month,
      taxType: g.taxType,
      kind: "DETERMINISTIC",
      availability: "AVAILABLE",
      unavailableReason: null,
      amount: roundFiscal360(g.amount),
      lowAmount: roundFiscal360(g.amount),
      highAmount: roundFiscal360(g.amount),
      revenueBase: null,
      ratioUsed: null,
      cashMonth: g.month,
      methodology: "Saldo em aberto de guias e títulos tributários conhecidos, pelo mês de vencimento (vencidos no mês corrente).",
      overdueAmount: roundFiscal360(g.overdue),
      details: { overdueAmount: roundFiscal360(g.overdue), anchors: g.anchors },
    });
  }

  // 2) Estimada por empresa × tributo.
  const revenue = new Map<string, Map<string, number>>();
  const due = new Map<string, Map<string, { apuration: number; obligation: number }>>();
  for (const h of input.history) {
    if (h.month > lastClosed) continue;
    if (h.taxType === "*") {
      const m = revenue.get(h.companyCnpj) ?? new Map<string, number>();
      m.set(h.month, (m.get(h.month) ?? 0) + h.officialRevenue);
      revenue.set(h.companyCnpj, m);
    } else {
      const key = `${h.companyCnpj}|${h.taxType}`;
      const m = due.get(key) ?? new Map();
      const cur = m.get(h.month) ?? { apuration: 0, obligation: 0 };
      cur.apuration += h.apurationAmountDue;
      cur.obligation += h.obligationAmountDue;
      m.set(h.month, cur);
      due.set(key, m);
    }
  }

  const projectedRevenue = (companyCnpj: string): Map<string, number> | { unavailable: string } => {
    const rev = revenue.get(companyCnpj);
    const recent = [1, 2, 3].map((k) => rev?.get(addFiscal360Months(input.referenceMonth, -k)) ?? 0).filter((v) => v > 0);
    if (recent.length < FISCAL360_FORECAST_MIN_POINTS) {
      return { unavailable: "Faturamento externo oficial insuficiente nos últimos 3 meses fechados." };
    }
    const base = recent.reduce((s, v) => s + v, 0) / recent.length;
    const trailing = Array.from({ length: 12 }, (_, i) => rev?.get(addFiscal360Months(input.referenceMonth, -(i + 1))) ?? 0);
    const trailingAvg = trailing.filter((v) => v > 0).length >= 12 ? trailing.reduce((s, v) => s + v, 0) / 12 : null;
    const result = new Map<string, number>();
    months.forEach((m, i) => {
      let seasonal = 1;
      const lastYear = rev?.get(addFiscal360Months(m, -12));
      if (trailingAvg && lastYear && lastYear > 0) seasonal = Math.min(1.5, Math.max(0.5, lastYear / trailingAvg));
      const growth = Math.pow(1 + a.revenueGrowthPct / 100, (i + 1) / 12);
      result.set(m, base * seasonal * growth * (1 + a.revenueShiftPct / 100));
    });
    return result;
  };

  const companyRevenue = new Map<string, ReturnType<typeof projectedRevenue>>();
  for (const key of due.keys()) {
    const [companyCnpj, taxType] = key.split("|") as [string, string];
    if (!companyRevenue.has(companyCnpj)) companyRevenue.set(companyCnpj, projectedRevenue(companyCnpj));
    const proj = companyRevenue.get(companyCnpj)!;
    const series = due.get(key)!;
    const useApuration = [...series.values()].some((v) => v.apuration > 0);
    const source = useApuration ? "apuração" : "obrigações (guias/títulos)";
    const rev = revenue.get(companyCnpj);
    const ratios: number[] = [];
    let activeMonths12 = 0;
    let due12 = 0;
    let rev12 = 0;
    for (let k = 1; k <= 24; k += 1) {
      const m = addFiscal360Months(input.referenceMonth, -k);
      const r = rev?.get(m) ?? 0;
      const d = series.get(m);
      const value = d ? (useApuration ? d.apuration : d.obligation) : 0;
      if (k <= 12) {
        rev12 += r;
        due12 += value;
        if (value > 0) activeMonths12 += 1;
      }
      if (r > 0 && value > 0) ratios.push(value / r);
    }
    ratios.sort((x, y) => x - y);
    const periodic = activeMonths12 > 0 && activeMonths12 < 6;
    const lag = lagFor(taxType);

    for (const m of months) {
      if (known.has(`${companyCnpj}|${taxType}|${m}`)) continue;
      const param = input.parameters.find(
        (p) => p.companyCnpj === companyCnpj && p.taxType === taxType && p.effectiveFrom.slice(0, 7) <= m && (!p.effectiveTo || p.effectiveTo.slice(0, 7) >= m)
      );
      const base = {
        companyCnpj,
        month: m,
        taxType,
        kind: "ESTIMATED" as const,
        cashMonth: addFiscal360Months(m, lag.lag),
      };
      if ("unavailable" in proj) {
        out.push({ ...base, availability: "UNAVAILABLE", unavailableReason: proj.unavailable, amount: null, lowAmount: null, highAmount: null, revenueBase: null, ratioUsed: null, cashMonth: null, methodology: "Projeção indisponível.", details: null });
        continue;
      }
      const revenueBase = proj.get(m) ?? 0;
      if (param) {
        const credits = (param.creditRate ?? 0) * (param.purchasesMonthly ?? 0) * (1 + a.purchasesShiftPct / 100);
        const amount = Math.max(0, revenueBase * param.rate - credits);
        out.push({
          ...base,
          availability: "AVAILABLE",
          unavailableReason: null,
          amount: roundFiscal360(amount),
          lowAmount: roundFiscal360(amount),
          highAmount: roundFiscal360(amount),
          revenueBase: roundFiscal360(revenueBase),
          ratioUsed: param.rate,
          methodology: `Paramétrica: receita projetada × alíquota ${(param.rate * 100).toFixed(4)}% − créditos estimados (fonte: ${param.normativeSource}).`,
          details: { ruleVersionId: param.ruleVersionId, credits: roundFiscal360(credits), lagSource: lag.source },
        });
        continue;
      }
      if (periodic) {
        const lastYear = series.get(addFiscal360Months(m, -12));
        const lastYearValue = lastYear ? (useApuration ? lastYear.apuration : lastYear.obligation) : 0;
        if (!(lastYearValue > 0) || rev12 <= 0) continue; // tributo periódico sem ocorrência neste mês no ano anterior
        const ratio = due12 / rev12;
        // Meses anteriores ao de referência usam a receita REALIZADA (a projeção só cobre o horizonte).
        const window = [0, 1, 2].reduce((s, k) => {
          const mm = addFiscal360Months(m, -k);
          return s + (proj.get(mm) ?? rev?.get(mm) ?? 0);
        }, 0);
        const amount = ratio * window;
        out.push({
          ...base,
          availability: "AVAILABLE",
          unavailableReason: null,
          amount: roundFiscal360(amount),
          lowAmount: roundFiscal360(amount * 0.8),
          highAmount: roundFiscal360(amount * 1.2),
          revenueBase: roundFiscal360(window),
          ratioUsed: Number(ratio.toFixed(6)),
          methodology: `Tributo periódico: razão anual (${source} 12m ÷ faturamento 12m) × receita projetada do trimestre; faixa ±20%.`,
          details: { activeMonths12, lagSource: lag.source },
        });
        continue;
      }
      if (ratios.length < FISCAL360_FORECAST_MIN_POINTS) {
        out.push({
          ...base,
          availability: "UNAVAILABLE",
          unavailableReason: `Menos de ${FISCAL360_FORECAST_MIN_POINTS} competências com faturamento e ${source} para este tributo.`,
          amount: null,
          lowAmount: null,
          highAmount: null,
          revenueBase: roundFiscal360(revenueBase),
          ratioUsed: null,
          cashMonth: null,
          methodology: "Projeção indisponível.",
          details: { points: ratios.length },
        });
        continue;
      }
      const p = a.ratioPercentile === "P25" ? 0.25 : a.ratioPercentile === "P75" ? 0.75 : 0.5;
      const ratio = percentile(ratios, p);
      out.push({
        ...base,
        availability: "AVAILABLE",
        unavailableReason: null,
        amount: roundFiscal360(revenueBase * ratio),
        lowAmount: roundFiscal360(revenueBase * percentile(ratios, 0.25)),
        highAmount: roundFiscal360(revenueBase * percentile(ratios, 0.75)),
        revenueBase: roundFiscal360(revenueBase),
        ratioUsed: Number(ratio.toFixed(6)),
        methodology: `Razão histórica (${source} ÷ faturamento externo oficial), ${a.ratioPercentile === "MEDIAN" ? "mediana" : a.ratioPercentile} de ${ratios.length} competências; faixa P25–P75.`,
        details: { points: ratios.length, lagSource: lag.source },
      });
    }
  }

  return out.sort((x, y) =>
    x.month === y.month
      ? x.companyCnpj === y.companyCnpj
        ? x.taxType === y.taxType
          ? x.kind.localeCompare(y.kind)
          : x.taxType.localeCompare(y.taxType)
        : x.companyCnpj.localeCompare(y.companyCnpj)
      : x.month.localeCompare(y.month)
  );
}

export type ForecastEffects = {
  taxesDue: number;
  cashOut: number;
  revenue: number;
  taxBurdenPct: number | null;
  /** Tributo de competência do horizonte que só sai do caixa depois dele (financiamento pela defasagem). */
  workingCapitalFromLag: number;
  /** Atrasos já vencidos incluídos no desembolso (não entram em "tributos devidos" nem na carga). */
  arrears: number;
  unavailableCount: number;
};

/** Efeitos agregados de um conjunto de linhas (para comparação cenário × base). */
export function summarizeFiscal360Forecast(rows: ForecastRow[], horizon: string[]): ForecastEffects {
  const horizonSet = new Set(horizon);
  const revenueByKey = new Map<string, number>();
  let taxesDue = 0;
  let cashOut = 0;
  let workingCapitalFromLag = 0;
  let arrears = 0;
  let unavailableCount = 0;
  for (const r of rows) {
    if (r.availability === "UNAVAILABLE") {
      unavailableCount += 1;
      continue;
    }
    const amount = r.amount ?? 0;
    const late = r.overdueAmount ?? 0;
    arrears += late;
    if (horizonSet.has(r.month)) taxesDue += amount - late;
    if (r.cashMonth && horizonSet.has(r.cashMonth)) cashOut += amount;
    if (horizonSet.has(r.month) && r.cashMonth && !horizonSet.has(r.cashMonth)) workingCapitalFromLag += amount;
    if (r.kind === "ESTIMATED" && r.revenueBase != null && !String(r.methodology).startsWith("Tributo periódico")) {
      revenueByKey.set(`${r.companyCnpj}|${r.month}`, r.revenueBase);
    }
  }
  const revenue = [...revenueByKey.values()].reduce((s, v) => s + v, 0);
  return {
    taxesDue: roundFiscal360(taxesDue),
    cashOut: roundFiscal360(cashOut),
    revenue: roundFiscal360(revenue),
    taxBurdenPct: revenue > 0 ? Number(((taxesDue / revenue) * 100).toFixed(2)) : null,
    workingCapitalFromLag: roundFiscal360(workingCapitalFromLag),
    arrears: roundFiscal360(arrears),
    unavailableCount,
  };
}

export const FISCAL360_FORECAST_VERSION = FISCAL360_RULE_VERSIONS.forecast;
