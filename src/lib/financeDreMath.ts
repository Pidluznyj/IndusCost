/**
 * Motor puro do DRE Gerencial — sem I/O.
 * Entradas já vêm dos motores oficiais (NF-e, CC, margem).
 */

import type {
  FinanceDreKpis,
  FinanceDreLine,
  FinanceDreLineId,
  FinanceDreMonthValues,
  FinanceDreQualityAlert,
} from "@/src/lib/financeDreTypes.js";
import { createEmptyMonthlySeries } from "@/src/lib/financeDreCostCenterRoles.js";

const MONTH_LABELS_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export function financeDreMonthLabels(): string[] {
  return [...MONTH_LABELS_PT];
}

export function roundDreMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function ytdThroughMonth(byMonth: number[], highlightMonth: number): number {
  const end = Math.min(12, Math.max(1, highlightMonth));
  let sum = 0;
  for (let i = 0; i < end; i += 1) sum += byMonth[i] ?? 0;
  return roundDreMoney(sum);
}

export function toMonthValues(byMonth: number[], highlightMonth: number): FinanceDreMonthValues {
  const normalized = Array.from({ length: 12 }, (_, i) => roundDreMoney(byMonth[i] ?? 0));
  return {
    byMonth: normalized,
    ytd: ytdThroughMonth(normalized, highlightMonth),
    highlight: roundDreMoney(normalized[highlightMonth - 1] ?? 0),
  };
}

function negateSeries(byMonth: number[]): number[] {
  return byMonth.map((v) => roundDreMoney(-(v ?? 0)));
}

function sumSeries(a: number[], b: number[]): number[] {
  return Array.from({ length: 12 }, (_, i) => roundDreMoney((a[i] ?? 0) + (b[i] ?? 0)));
}

function subSeries(a: number[], b: number[]): number[] {
  return Array.from({ length: 12 }, (_, i) => roundDreMoney((a[i] ?? 0) - (b[i] ?? 0)));
}

function safePct(part: number, base: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(base) || base === 0) return null;
  return roundDreMoney((part / base) * 100);
}

export type FinanceDreMathInput = {
  highlightMonth: number;
  receitaBruta: number[];
  cofins: number[];
  icms: number[];
  icmsSt: number[];
  ipi: number[];
  pis: number[];
  devolucoes: number[];
  cmv: number[];
  fretes: number[];
  despesasAdmin: number[];
  /** Informativo — não entra no resultado */
  despesasPessoal: number[];
  unclassifiedCcAmount: number[];
  quality: {
    unlinkedNfeCount: number;
    unlinkedNfeRevenue: number;
    taxSummaryGapCount: number;
  };
};

function line(
  id: FinanceDreLineId,
  label: string,
  kind: FinanceDreLine["kind"],
  parentId: FinanceDreLineId | null,
  byMonth: number[],
  highlightMonth: number,
  netRevenueHighlight: number,
  opts?: Partial<Pick<FinanceDreLine, "expandable" | "informativeOnly" | "sourceNote">>
): FinanceDreLine {
  const values = toMonthValues(byMonth, highlightMonth);
  return {
    id,
    label,
    kind,
    parentId,
    values,
    pctOfNetRevenue: safePct(values.highlight, netRevenueHighlight),
    expandable: opts?.expandable ?? false,
    informativeOnly: opts?.informativeOnly,
    sourceNote: opts?.sourceNote,
  };
}

/**
 * Monta as linhas do DRE gerencial a partir das séries mensais oficiais.
 * Sinais: deduções/custos/despesas como valores negativos na grade.
 */
export function buildFinanceDreLines(input: FinanceDreMathInput): {
  lines: FinanceDreLine[];
  kpis: FinanceDreKpis;
  qualityAlerts: FinanceDreQualityAlert[];
} {
  const m = Math.min(12, Math.max(1, input.highlightMonth || 1));

  const deducoesAbs = sumSeries(
    sumSeries(
      sumSeries(sumSeries(sumSeries(input.cofins, input.icms), input.icmsSt), input.ipi),
      input.pis
    ),
    input.devolucoes
  );
  const deducoesNeg = negateSeries(deducoesAbs);
  const receitaLiquida = subSeries(input.receitaBruta, deducoesAbs);

  const custosAbs = sumSeries(input.cmv, input.fretes);
  const custosNeg = negateSeries(custosAbs);
  const lucroBruto = subSeries(receitaLiquida, custosAbs);

  const adminNeg = negateSeries(input.despesasAdmin);
  const pessoalNeg = negateSeries(input.despesasPessoal);

  // Resultado operacional = lucro bruto − admin (pessoal NÃO entra)
  const resultado = subSeries(lucroBruto, input.despesasAdmin);
  // Lucro líquido aproximado = mesmo do operacional no v1
  const lucroAprox = resultado;

  const netHighlight = roundDreMoney(receitaLiquida[m - 1] ?? 0);
  const lucroBrutoH = roundDreMoney(lucroBruto[m - 1] ?? 0);
  const resultadoH = roundDreMoney(resultado[m - 1] ?? 0);
  const lucroAproxH = roundDreMoney(lucroAprox[m - 1] ?? 0);

  const lines: FinanceDreLine[] = [
    line("receita_bruta", "Receita bruta", "total", null, input.receitaBruta, m, netHighlight, {
      expandable: true,
      sourceNote: "NF-e MARKET_REVENUE · valorLiquido (motor Faturamento)",
    }),
    line(
      "venda_mercadorias",
      "Venda de mercadorias",
      "detail",
      "receita_bruta",
      input.receitaBruta,
      m,
      netHighlight
    ),
    line("deducoes", "Deduções da receita bruta", "total", null, deducoesNeg, m, netHighlight, {
      expandable: true,
      sourceNote: "Impostos destacados + devoluções (XML fiscal)",
    }),
    line("cofins", "(-) COFINS sobre vendas", "detail", "deducoes", negateSeries(input.cofins), m, netHighlight),
    line("icms", "(-) ICMS sobre vendas", "detail", "deducoes", negateSeries(input.icms), m, netHighlight),
    line("icms_st", "(-) ICMS substituição tributária", "detail", "deducoes", negateSeries(input.icmsSt), m, netHighlight),
    line("ipi", "(-) IPI sobre vendas", "detail", "deducoes", negateSeries(input.ipi), m, netHighlight),
    line("pis", "(-) PIS sobre vendas", "detail", "deducoes", negateSeries(input.pis), m, netHighlight),
    line(
      "devolucoes",
      "(-) Devoluções de vendas",
      "detail",
      "deducoes",
      negateSeries(input.devolucoes),
      m,
      netHighlight
    ),
    line("receita_liquida", "Receita líquida", "result", null, receitaLiquida, m, netHighlight),
    line("custos", "Custos", "total", null, custosNeg, m, netHighlight, {
      expandable: true,
      sourceNote: "CMV (margem oficial) + Fretes (CC Logística)",
    }),
    line("cmv", "Custo das mercadorias vendidas", "detail", "custos", negateSeries(input.cmv), m, netHighlight, {
      sourceNote: "Custo gerencial oficial alocado ao mês da NF-e",
    }),
    line("fretes", "Fretes e carretos", "detail", "custos", negateSeries(input.fretes), m, netHighlight, {
      sourceNote: "AP alocado em centros de custo Logística",
    }),
    line("lucro_bruto", "Lucro bruto", "result", null, lucroBruto, m, netHighlight),
    line(
      "despesas_operacionais",
      "Despesas operacionais",
      "total",
      null,
      adminNeg,
      m,
      netHighlight,
      {
        expandable: true,
        sourceNote: "Despesas administrativas (pessoal não entra no cálculo)",
      }
    ),
    line(
      "despesas_administrativas",
      "Despesas administrativas",
      "detail",
      "despesas_operacionais",
      adminNeg,
      m,
      netHighlight,
      {
        sourceNote: "CC exceto Folha, Benefícios, Montagem, Mão de obra, Imposto, MP, Logística",
      }
    ),
    line(
      "despesas_pessoal_info",
      "Despesas com pessoal (informativo)",
      "informative",
      null,
      pessoalNeg,
      m,
      netHighlight,
      {
        informativeOnly: true,
        sourceNote: "Folha + Benefícios + Montagem + Mão de obra — já no CMV; só exibição",
      }
    ),
    line("resultado_operacional", "Resultado operacional", "result", null, resultado, m, netHighlight),
    line(
      "lucro_liquido_aproximado",
      "Lucro líquido do exercício aproximado",
      "result",
      null,
      lucroAprox,
      m,
      netHighlight,
      {
        sourceNote: "Sem resultado financeiro e sem IR/CSLL no v1",
      }
    ),
  ];

  const kpis: FinanceDreKpis = {
    receitaLiquida: netHighlight,
    lucroBruto: lucroBrutoH,
    margemBrutaPct: safePct(lucroBrutoH, netHighlight),
    resultadoOperacional: resultadoH,
    margemOperacionalPct: safePct(resultadoH, netHighlight),
    lucroLiquidoAproximado: lucroAproxH,
  };

  const qualityAlerts: FinanceDreQualityAlert[] = [];
  if (input.quality.unlinkedNfeCount > 0) {
    qualityAlerts.push({
      code: "CMV_UNLINKED_NFE",
      severity: "warning",
      message: `${input.quality.unlinkedNfeCount} NF-e sem vínculo com pedido — CMV pode estar incompleto.`,
      count: input.quality.unlinkedNfeCount,
      amount: roundDreMoney(input.quality.unlinkedNfeRevenue),
    });
  }
  const unclassifiedYtd = ytdThroughMonth(input.unclassifiedCcAmount, m);
  if (unclassifiedYtd > 0.009) {
    qualityAlerts.push({
      code: "CC_UNCLASSIFIED",
      severity: "warning",
      message: "Há títulos AP sem centro de custo no período — despesas administrativas podem estar subestimadas.",
      amount: unclassifiedYtd,
    });
  }
  if (input.quality.taxSummaryGapCount > 0) {
    qualityAlerts.push({
      code: "TAX_SUMMARY_GAP",
      severity: "info",
      message: `${input.quality.taxSummaryGapCount} NF-e sem resumo fiscal completo — deduções podem estar parciais.`,
      count: input.quality.taxSummaryGapCount,
    });
  }

  return { lines, kpis, qualityAlerts };
}

export function emptyDreSeries(): number[] {
  return createEmptyMonthlySeries();
}

/** Aloca CMV do pedido às NF-e do ano por peso do valorLiquido. */
export function allocateOrderCmvToNfeMonths(input: {
  orderTotalCost: number;
  nfes: Array<{ month: number; valorLiquido: number }>;
}): number[] {
  const series = createEmptyMonthlySeries();
  const cost = Number.isFinite(input.orderTotalCost) ? input.orderTotalCost : 0;
  if (cost <= 0 || input.nfes.length === 0) return series;

  const weightSum = input.nfes.reduce((acc, n) => acc + Math.max(0, n.valorLiquido || 0), 0);
  if (weightSum <= 0) {
    // Sem peso: joga no mês da primeira NF-e
    const first = input.nfes[0];
    if (first) addMonth(series, first.month, cost);
    return series;
  }

  for (const nfe of input.nfes) {
    const share = (Math.max(0, nfe.valorLiquido || 0) / weightSum) * cost;
    addMonth(series, nfe.month, share);
  }
  return series.map(roundDreMoney);
}

function addMonth(series: number[], month: number, amount: number): void {
  if (month < 1 || month > 12 || !Number.isFinite(amount)) return;
  series[month - 1] += amount;
}
