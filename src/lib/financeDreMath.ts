/**
 * Motor puro do DRE Gerencial — sem I/O.
 * Entradas já vêm dos motores oficiais (NF-e, custo de produtos, CC).
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
import {
  buildEstimatedCorporateTaxSeriesFromSingleBase,
  type FinanceDreEstimatedCorporateTaxesBlock,
} from "@/src/lib/financeDreEstimatedCorporateTaxes.js";

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
    missingItemsNfeCount?: number;
    missingProductLineCount?: number;
    missingCostLineCount?: number;
    pricedLineCount?: number;
  };
  /**
   * Quando informado (ex.: consolidação por PJ), usa estas provisões em vez de
   * calcular sobre a base consolidada com um único limite de adicional.
   */
  estimatedCorporateTaxesOverride?: FinanceDreEstimatedCorporateTaxesBlock;
};

/**
 * Base estimada de IRPJ/CSLL = resultado antes dos tributos.
 * Na DRE atual não há resultado financeiro após o operacional → usa resultado operacional.
 */
export function computeFinanceDreEstimatedTaxBaseSeries(
  input: Pick<
    FinanceDreMathInput,
    | "receitaBruta"
    | "cofins"
    | "icms"
    | "icmsSt"
    | "ipi"
    | "pis"
    | "devolucoes"
    | "cmv"
    | "fretes"
    | "embalagens"
    | "despesasAdmin"
  >
): number[] {
  const deducoesAbs = sumSeries(
    sumSeries(
      sumSeries(sumSeries(sumSeries(input.cofins, input.icms), input.icmsSt), input.ipi),
      input.pis
    ),
    input.devolucoes
  );
  const receitaLiquida = subSeries(input.receitaBruta, deducoesAbs);
  const custosAbs = sumSeries(sumSeries(input.cmv, input.fretes), input.embalagens);
  const lucroBruto = subSeries(receitaLiquida, custosAbs);
  return subSeries(lucroBruto, input.despesasAdmin);
}

function taxLineValues(
  byMonthAbs: number[],
  ytdAbs: number,
  highlightMonth: number,
  netRevenueHighlight: number,
  asNegative: boolean
): { values: FinanceDreMonthValues; pctOfNetRevenue: number | null } {
  const signedMonth = asNegative ? negateSeries(byMonthAbs) : byMonthAbs.map((v) => roundDreMoney(v));
  const signedYtd = asNegative ? roundDreMoney(-ytdAbs) : roundDreMoney(ytdAbs);
  const values: FinanceDreMonthValues = {
    byMonth: signedMonth,
    ytd: signedYtd,
    highlight: roundDreMoney(signedMonth[highlightMonth - 1] ?? 0),
  };
  return {
    values,
    pctOfNetRevenue: safePct(values.highlight, netRevenueHighlight),
  };
}

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
  estimatedCorporateTaxes: FinanceDreEstimatedCorporateTaxesBlock;
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
  // Sem resultado financeiro na DRE atual → base estimada IRPJ/CSLL = resultado operacional.
  const resultado = subSeries(lucroBruto, input.despesasAdmin);

  const estimatedCorporateTaxes =
    input.estimatedCorporateTaxesOverride ??
    buildEstimatedCorporateTaxSeriesFromSingleBase(resultado, m);

  const provisionNegByMonth = negateSeries(estimatedCorporateTaxes.provisionByMonth);
  const lucroAprox = Array.from({ length: 12 }, (_, i) =>
    roundDreMoney((resultado[i] ?? 0) + (provisionNegByMonth[i] ?? 0))
  );
  const resultadoYtd = ytdThroughMonth(resultado, m);
  const lucroAproxYtd = roundDreMoney(resultadoYtd - estimatedCorporateTaxes.provisionYtd);

  const netHighlight = roundDreMoney(receitaLiquida[m - 1] ?? 0);
  const lucroBrutoH = roundDreMoney(lucroBruto[m - 1] ?? 0);
  const resultadoH = roundDreMoney(resultado[m - 1] ?? 0);
  const lucroAproxH = roundDreMoney(lucroAprox[m - 1] ?? 0);

  const provisionVals = taxLineValues(
    estimatedCorporateTaxes.provisionByMonth,
    estimatedCorporateTaxes.provisionYtd,
    m,
    netHighlight,
    true
  );
  const csllVals = taxLineValues(
    estimatedCorporateTaxes.csllByMonth,
    estimatedCorporateTaxes.csllYtd,
    m,
    netHighlight,
    true
  );
  const irpjVals = taxLineValues(
    estimatedCorporateTaxes.irpjByMonth,
    estimatedCorporateTaxes.irpjYtd,
    m,
    netHighlight,
    true
  );
  const lucroAproxValues: FinanceDreMonthValues = {
    byMonth: lucroAprox,
    ytd: lucroAproxYtd,
    highlight: lucroAproxH,
  };

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
      sourceNote: "CMV (NF-e × custo vigente) + Fretes (CC Logística) + Embalagens (CC)",
    }),
    line("cmv", "Custo das mercadorias vendidas", "detail", "custos", negateSeries(input.cmv), m, netHighlight, {
      sourceNote:
        "Quantidade faturada na NF-e × custo vigente na data de emissão (tabela de custo de produtos)",
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
    {
      id: "provisoes_estimadas_irpj_csll",
      label: "(-) Provisões estimadas para IRPJ e CSLL",
      kind: "total",
      parentId: null,
      values: provisionVals.values,
      pctOfNetRevenue: provisionVals.pctOfNetRevenue,
      expandable: true,
      sourceNote:
        "Provisão gerencial estimada — não substitui a apuração fiscal (adições, exclusões, prejuízos, incentivos).",
    },
    {
      id: "csll_estimada",
      label: "(-) CSLL estimada",
      kind: "detail",
      parentId: "provisoes_estimadas_irpj_csll",
      values: csllVals.values,
      pctOfNetRevenue: csllVals.pctOfNetRevenue,
      expandable: false,
      sourceNote: "Estimativa gerencial: 9% sobre a base positiva antes do IRPJ/CSLL.",
    },
    {
      id: "irpj_estimado",
      label: "(-) IRPJ estimado",
      kind: "detail",
      parentId: "provisoes_estimadas_irpj_csll",
      values: irpjVals.values,
      pctOfNetRevenue: irpjVals.pctOfNetRevenue,
      expandable: false,
      sourceNote:
        "Estimativa gerencial: 15% + adicional de 10% sobre o excedente de R$ 20.000 × meses do período.",
    },
    {
      id: "lucro_liquido_aproximado",
      label: "Lucro líquido após IRPJ e CSLL — aproximado",
      kind: "result",
      parentId: null,
      values: lucroAproxValues,
      pctOfNetRevenue: safePct(lucroAproxH, netHighlight),
      expandable: false,
      sourceNote:
        "Resultado operacional − provisões estimadas de IRPJ e CSLL. Valor aproximado — estimativa gerencial.",
    },
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
  if ((input.quality.missingItemsNfeCount ?? 0) > 0) {
    qualityAlerts.push({
      code: "CMV_MISSING_ITEMS",
      severity: "warning",
      message: `${input.quality.missingItemsNfeCount} NF-e sem itens parseáveis — CMV incompleto nessas notas.`,
      count: input.quality.missingItemsNfeCount,
    });
  }
  if ((input.quality.missingProductLineCount ?? 0) > 0) {
    qualityAlerts.push({
      code: "CMV_MISSING_PRODUCT",
      severity: "warning",
      message: `${input.quality.missingProductLineCount} itens de NF-e sem produto local resolvido.`,
      count: input.quality.missingProductLineCount,
    });
  }
  if ((input.quality.missingCostLineCount ?? 0) > 0) {
    qualityAlerts.push({
      code: "CMV_MISSING_COST",
      severity: "warning",
      message: `${input.quality.missingCostLineCount} itens sem custo vigente na data da nota.`,
      count: input.quality.missingCostLineCount,
    });
  }
  if (
    input.quality.unlinkedNfeCount > 0 &&
    !(input.quality.missingItemsNfeCount ||
      input.quality.missingProductLineCount ||
      input.quality.missingCostLineCount)
  ) {
    qualityAlerts.push({
      code: "CMV_GAP",
      severity: "warning",
      message: `Há lacunas de CMV (receita associada ≈ ${roundDreMoney(input.quality.unlinkedNfeRevenue)}).`,
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

  return { lines, kpis, qualityAlerts, estimatedCorporateTaxes };
}

/** Checklist de fontes oficiais aplicadas no DRE. */
export function buildFinanceDreSourceChecks(input: {
  unlinkedNfeCount: number;
  taxSummaryGapCount: number;
  unclassifiedYtd: number;
  pricedLineCount?: number;
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
      id: "cmv_nfe_custo",
      label: "CMV (item NF-e × custo vigente na data da nota)",
      officialMotor:
        "financeDreCmvFromNfe.loadMonthlyCmvFromNfeProductCosts + getEffectiveProductProductionCostsForPairs",
      appliedToResult: true,
      status: input.unlinkedNfeCount > 0 ? "gap" : "ok",
      note:
        input.unlinkedNfeCount > 0
          ? `${input.pricedLineCount ?? 0} linhas precificadas; ${input.unlinkedNfeCount} lacuna(s) de item/produto/custo`
          : `Tabela de custo vigente na emissão · ${input.pricedLineCount ?? 0} linha(s) precificada(s)`,
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
      label: "Resultado financeiro + IR/CSLL estimado",
      officialMotor: "financeDreEstimatedCorporateTaxes.calculateEstimatedCorporateIncomeTaxes",
      appliedToResult: true,
      status: "info",
      note:
        "Resultado financeiro continua fora do escopo. IRPJ/CSLL entram como provisão gerencial estimada no lucro líquido aproximado (não é apuração fiscal).",
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
  missingItemsNfeCount?: number;
  missingItemsRevenueByMonth?: number[];
  missingProductLineCount?: number;
  missingProductRevenueByMonth?: number[];
  missingCostLineCount?: number;
  missingCostRevenueByMonth?: number[];
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

  const missingItems = input.missingItemsRevenueByMonth ?? emptyDreSeries();
  const missingProduct = input.missingProductRevenueByMonth ?? emptyDreSeries();
  const missingCost = input.missingCostRevenueByMonth ?? emptyDreSeries();

  pushSeries(
    "nfe_sem_itens",
    "NF-e sem itens parseáveis",
    "Receita entrou no DRE, mas não foi possível ler produtos/quantidades do payload nem do documento de estoque.",
    "NomusNfe.rawPayload / NomusStockDocumentItem",
    missingItems,
    false,
    input.missingItemsNfeCount
  );
  pushSeries(
    "item_sem_produto",
    "Itens de NF-e sem produto local",
    "Quantidade faturada existe, mas o produto não foi resolvido no cadastro IndusCost (idProduto/SKU).",
    "Product.sourceExternalId / Product.sku / NomusProductCatalog",
    missingProduct,
    false,
    input.missingProductLineCount
  );
  pushSeries(
    "item_sem_custo",
    "Itens sem custo vigente na data da nota",
    "Produto resolvido, porém sem tabela de custo PUBLISHED/SUPERSEDED vigente na data de emissão da NF-e.",
    "getEffectiveProductProductionCostsForPairs(referenceDate = emissão NF-e)",
    missingCost,
    false,
    input.missingCostLineCount
  );

  const unlinkedHighlight = roundDreMoney(input.unlinkedNfeRevenueByMonth[m - 1] ?? 0);
  const unlinkedYtd = ytdThroughMonth(input.unlinkedNfeRevenueByMonth, m);
  const detailedGaps =
    (input.missingItemsNfeCount ?? 0) +
    (input.missingProductLineCount ?? 0) +
    (input.missingCostLineCount ?? 0);
  if (
    detailedGaps === 0 &&
    (input.unlinkedNfeCount > 0 || unlinkedHighlight > 0.009 || unlinkedYtd > 0.009)
  ) {
    items.push({
      id: "receita_sem_cmv",
      label: "Receita de NF-e sem CMV",
      reason:
        "Receita entrou no DRE, mas o CMV correspondente não pôde ser calculado — resultado pode estar otimista.",
      source: "NF-e MARKET_REVENUE sem custo de item resolvido",
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
    id: "ir_csll_estimativa_gerencial",
    label: "Provisão estimada de IRPJ / CSLL",
    reason:
      "Estimativa gerencial aplicada ao lucro líquido aproximado — não substitui a apuração fiscal (adições, exclusões, prejuízos, incentivos e retenções).",
    source: "financeDreEstimatedCorporateTaxes (base = resultado operacional)",
    appliedToResult: true,
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
      "Itens abaixo foram identificados nas fontes oficiais, mas não reduzem o resultado operacional (exceto quando marcados como provisórios). IRPJ/CSLL estimados entram no lucro líquido aproximado.",
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
