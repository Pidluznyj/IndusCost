/**
 * Motor puro do DRE Gerencial — sem I/O.
 * Entradas já vêm dos motores oficiais (NF-e, CC, margem).
 */

import type {
  FinanceDreInformativeItem,
  FinanceDreKpis,
  FinanceDreLine,
  FinanceDreLineId,
  FinanceDreMonthValues,
  FinanceDreQualityAlert,
  FinanceDreSourceCheck,
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
  embalagens: number[];
  despesasAdmin: number[];
  /** Informativo — não entra no resultado */
  despesasPessoal: number[];
  /** Informativo — CC Imposto (AP), não entra no resultado */
  impostosCc: number[];
  /** Informativo — CC Matéria-prima (AP), não entra no resultado */
  materiaPrimaCc: number[];
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

  const custosAbs = sumSeries(sumSeries(input.cmv, input.fretes), input.embalagens);
  const custosNeg = negateSeries(custosAbs);
  const lucroBruto = subSeries(receitaLiquida, custosAbs);

  const adminNeg = negateSeries(input.despesasAdmin);

  // Resultado operacional = lucro bruto − admin (pessoal/imposto CC/MP CC NÃO entram)
  const resultado = subSeries(lucroBruto, input.despesasAdmin);
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
      sourceNote: "CMV (margem oficial) + Fretes (CC Logística) + Embalagens (CC)",
    }),
    line("cmv", "Custo das mercadorias vendidas", "detail", "custos", negateSeries(input.cmv), m, netHighlight, {
      sourceNote: "Custo gerencial oficial da parcela faturada, alocado ao mês da NF-e",
    }),
    line("fretes", "Fretes e carretos", "detail", "custos", negateSeries(input.fretes), m, netHighlight, {
      sourceNote: "AP alocado em centros de custo Logística/Expedição",
    }),
    line(
      "embalagens",
      "Embalagens",
      "detail",
      "custos",
      negateSeries(input.embalagens),
      m,
      netHighlight,
      {
        sourceNote: "AP alocado em centros de custo Embalagens",
      }
    ),
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
        sourceNote:
          "CC exceto Folha, Benefícios, Montagem, Mão de obra, Imposto, MP, Logística e Embalagens",
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
      message:
        "Há títulos AP sem centro de custo — valores incluídos provisoriamente em Despesas administrativas.",
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

/** Checklist de fontes oficiais aplicadas no DRE. */
export function buildFinanceDreSourceChecks(input: {
  unlinkedNfeCount: number;
  taxSummaryGapCount: number;
  unclassifiedYtd: number;
}): FinanceDreSourceCheck[] {
  return [
    {
      id: "receita_nfe",
      label: "Receita bruta (NF-e)",
      officialMotor: "financeBillingNfeDashboard.queryMonthlyFiscalNfe",
      appliedToResult: true,
      status: "ok",
      note: "MARKET_REVENUE autorizada · valorLiquido · competência emissão",
    },
    {
      id: "deducoes_fiscais",
      label: "Deduções fiscais (PIS/COFINS/ICMS/ST/IPI/devoluções)",
      officialMotor: "financeDreNfeQueries.queryMonthlyFiscalNfeDeductions",
      appliedToResult: true,
      status: input.taxSummaryGapCount > 0 ? "gap" : "ok",
      note:
        input.taxSummaryGapCount > 0
          ? `${input.taxSummaryGapCount} NF-e sem resumo fiscal completo`
          : "Totais do NomusNfeFiscalSummary + devoluções finalidade=4",
    },
    {
      id: "cmv_margem",
      label: "CMV (custo gerencial da parcela faturada)",
      officialMotor: "salesOrderMarginService.calculateSalesOrderMarginsForOrders",
      appliedToResult: true,
      status: input.unlinkedNfeCount > 0 ? "gap" : "ok",
      note:
        input.unlinkedNfeCount > 0
          ? `${input.unlinkedNfeCount} NF-e sem vínculo com pedido (CMV incompleto)`
          : "VERSIONED_PRODUCTION_COST alocado ao mês da NF-e",
    },
    {
      id: "fretes_cc",
      label: "Fretes (CC Logística/Expedição)",
      officialMotor: "financeCostCenterDashboard.monthlySeries.byCostCenter",
      appliedToResult: true,
      status: "ok",
      note: "AP alocado — entra em Custos",
    },
    {
      id: "embalagens_cc",
      label: "Embalagens (CC Embalagens)",
      officialMotor: "financeCostCenterDashboard.monthlySeries.byCostCenter",
      appliedToResult: true,
      status: "ok",
      note: "AP alocado — entra em Custos",
    },
    {
      id: "admin_cc",
      label: "Despesas administrativas (demais CCs)",
      officialMotor: "financeCostCenterDashboard.monthlySeries.byCostCenter",
      appliedToResult: true,
      status: input.unclassifiedYtd > 0.009 ? "gap" : "ok",
      note:
        input.unclassifiedYtd > 0.009
          ? "Inclui AP sem CC de forma provisória"
          : "Exclui Folha, Benefícios, Montagem, MO, Imposto, MP, Logística, Embalagens",
    },
    {
      id: "pessoal_cc",
      label: "Pessoal (Folha/Benefícios/Montagem/MO)",
      officialMotor: "financeCostCenterDashboard.monthlySeries.byCostCenter",
      appliedToResult: false,
      status: "info",
      note: "Não entra no resultado — já embutido no CMV da ficha",
    },
    {
      id: "financeiro_ir",
      label: "Resultado financeiro + IR/CSLL",
      officialMotor: "n/a (fora do escopo v1)",
      appliedToResult: false,
      status: "info",
      note: "Não disponíveis no IndusCost como DRE contábil — ficam no relatório informativo",
    },
  ];
}

/** Relatório final dos custos/itens não aplicados (ou provisórios). */
export function buildFinanceDreInformativeReport(input: {
  highlightMonth: number;
  despesasPessoal: number[];
  impostosCc: number[];
  materiaPrimaCc: number[];
  unclassifiedCcAmount: number[];
  unlinkedNfeRevenueByMonth: number[];
  unlinkedNfeCount: number;
}): {
  title: string;
  subtitle: string;
  items: FinanceDreInformativeItem[];
  totalNotAppliedHighlight: number;
  totalNotAppliedYtd: number;
} {
  const m = Math.min(12, Math.max(1, input.highlightMonth || 1));
  const items: FinanceDreInformativeItem[] = [];

  const pushSeries = (
    id: FinanceDreInformativeItem["id"],
    label: string,
    reason: string,
    source: string,
    series: number[],
    appliedToResult: boolean,
    count?: number
  ) => {
    const highlightAmount = roundDreMoney(series[m - 1] ?? 0);
    const ytdAmount = ytdThroughMonth(series, m);
    if (Math.abs(highlightAmount) < 0.005 && Math.abs(ytdAmount) < 0.005 && !count) return;
    items.push({
      id,
      label,
      reason,
      source,
      appliedToResult,
      highlightAmount,
      ytdAmount,
      count,
    });
  };

  pushSeries(
    "pessoal_cc",
    "Despesas com pessoal (CC)",
    "Não entra no resultado operacional — custo de mão de obra já compõe o CMV da ficha de produção.",
    "Centros de custo: Folha + Benefícios + Montagem + Mão de obra",
    input.despesasPessoal,
    false
  );
  pushSeries(
    "impostos_cc",
    "Impostos via centro de custo (AP)",
    "Não entra no resultado — deduções oficiais vêm dos impostos destacados na NF-e.",
    "Centro de custo Imposto / Tributos",
    input.impostosCc,
    false
  );
  pushSeries(
    "materia_prima_cc",
    "Matéria-prima via centro de custo (AP)",
    "Não entra no resultado — matéria-prima do produto vendido já está no CMV gerencial.",
    "Centro de custo Matéria-prima",
    input.materiaPrimaCc,
    false
  );

  const unlinkedHighlight = roundDreMoney(input.unlinkedNfeRevenueByMonth[m - 1] ?? 0);
  const unlinkedYtd = ytdThroughMonth(input.unlinkedNfeRevenueByMonth, m);
  if (input.unlinkedNfeCount > 0 || unlinkedHighlight > 0.009 || unlinkedYtd > 0.009) {
    items.push({
      id: "receita_sem_cmv",
      label: "Receita de NF-e sem CMV (sem vínculo com pedido)",
      reason:
        "Receita entrou no DRE, mas o CMV correspondente não pôde ser calculado — resultado pode estar otimista.",
      source: "NF-e MARKET_REVENUE sem SalesOrderNfeLink",
      appliedToResult: false,
      highlightAmount: unlinkedHighlight,
      ytdAmount: unlinkedYtd,
      count: input.unlinkedNfeCount,
    });
  }

  pushSeries(
    "ap_sem_cc_provisorio",
    "AP sem centro de custo (provisório)",
    "Incluído provisoriamente em Despesas administrativas para não omitir gasto.",
    "financeCostCenterDashboard.monthlySeries.totals.unclassifiedAmount",
    input.unclassifiedCcAmount,
    true
  );

  items.push({
    id: "resultado_financeiro_fora_escopo",
    label: "Resultado financeiro (juros, tarifas, IOF…)",
    reason: "Fora do escopo do DRE gerencial v1 — não há motor contábil de resultado financeiro.",
    source: "Não aplicável no IndusCost",
    appliedToResult: false,
    highlightAmount: 0,
    ytdAmount: 0,
  });
  items.push({
    id: "ir_csll_fora_escopo",
    label: "Provisão de IRPJ / CSLL",
    reason: "Fora do escopo do DRE gerencial v1 — lucro líquido é aproximado.",
    source: "Não aplicável no IndusCost",
    appliedToResult: false,
    highlightAmount: 0,
    ytdAmount: 0,
  });

  const notApplied = items.filter((i) => !i.appliedToResult && (i.highlightAmount > 0 || i.ytdAmount > 0));
  const totalNotAppliedHighlight = roundDreMoney(
    notApplied.reduce((acc, i) => acc + Math.abs(i.highlightAmount), 0)
  );
  const totalNotAppliedYtd = roundDreMoney(
    notApplied.reduce((acc, i) => acc + Math.abs(i.ytdAmount), 0)
  );

  return {
    title: "Relatório informativo — custos não aplicados ao resultado",
    subtitle:
      "Itens abaixo foram identificados nas fontes oficiais, mas não reduzem o lucro líquido aproximado (exceto quando marcados como provisórios).",
    items,
    totalNotAppliedHighlight,
    totalNotAppliedYtd,
  };
}

export function emptyDreSeries(): number[] {
  return createEmptyMonthlySeries();
}

/**
 * Custo do pedido atribuível às NF-e vinculadas no ano.
 * Evita jogar 100% do CMV do pedido quando só parte foi faturada.
 */
export function resolveBilledOrderCmv(input: {
  orderTotalCost: number;
  orderNetRevenue: number;
  linkedNfeValorLiquidoSum: number;
}): number {
  const cost = Number.isFinite(input.orderTotalCost) ? Math.max(0, input.orderTotalCost) : 0;
  if (cost <= 0) return 0;
  const billed = Math.max(0, input.linkedNfeValorLiquidoSum || 0);
  const orderNet = Math.max(0, input.orderNetRevenue || 0);
  if (orderNet <= 0) {
    // Sem receita do pedido: usa o menor entre custo e o que as NF-e sugerem proporcionalmente
    return roundDreMoney(cost);
  }
  const ratio = Math.min(1, billed / orderNet);
  return roundDreMoney(cost * ratio);
}

/** Aloca CMV do pedido às NF-e do ano por peso do valorLiquido. */
export function allocateOrderCmvToNfeMonths(input: {
  orderTotalCost: number;
  orderNetRevenue?: number;
  nfes: Array<{ month: number; valorLiquido: number }>;
}): number[] {
  const series = createEmptyMonthlySeries();
  const linkedSum = input.nfes.reduce((acc, n) => acc + Math.max(0, n.valorLiquido || 0), 0);
  const cost = resolveBilledOrderCmv({
    orderTotalCost: input.orderTotalCost,
    orderNetRevenue: input.orderNetRevenue ?? 0,
    linkedNfeValorLiquidoSum: linkedSum,
  });
  if (cost <= 0 || input.nfes.length === 0) return series;

  if (linkedSum <= 0) {
    const first = input.nfes[0];
    if (first) addMonth(series, first.month, cost);
    return series;
  }

  for (const nfe of input.nfes) {
    const share = (Math.max(0, nfe.valorLiquido || 0) / linkedSum) * cost;
    addMonth(series, nfe.month, share);
  }
  return series.map(roundDreMoney);
}

function addMonth(series: number[], month: number, amount: number): void {
  if (month < 1 || month > 12 || !Number.isFinite(amount)) return;
  series[month - 1] += amount;
}
