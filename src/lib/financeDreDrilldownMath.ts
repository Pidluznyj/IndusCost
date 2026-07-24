/**
 * Helpers puros do drill-down DRE — composição de linhas e reconciliação de totais.
 */

import type { FinanceDreLineId } from "@/src/lib/financeDreTypes.js";
import { roundDreMoney } from "@/src/lib/financeDreMath.js";

const LINE_LABELS: Record<FinanceDreLineId, string> = {
  receita_bruta: "Receita bruta",
  venda_mercadorias: "Venda de mercadorias",
  deducoes: "Deduções da receita bruta",
  cofins: "COFINS sobre vendas",
  icms: "ICMS sobre vendas",
  icms_st: "ICMS substituição tributária",
  ipi: "IPI sobre vendas",
  pis: "PIS sobre vendas",
  devolucoes: "Devoluções de vendas",
  receita_liquida: "Receita líquida",
  custos: "Custos",
  cmv: "Custo das mercadorias vendidas",
  fretes: "Fretes e carretos",
  embalagens: "Embalagens",
  lucro_bruto: "Lucro bruto",
  despesas_operacionais: "Despesas operacionais",
  despesas_administrativas: "Despesas administrativas",
  resultado_operacional: "Resultado operacional",
  lucro_liquido_aproximado: "Lucro líquido aproximado",
};

/** Linhas com detalhe de origem (NF-e, CMV ou CC). */
const SOURCE_LINES = new Set<FinanceDreLineId>([
  "receita_bruta",
  "venda_mercadorias",
  "cofins",
  "icms",
  "icms_st",
  "ipi",
  "pis",
  "devolucoes",
  "cmv",
  "fretes",
  "embalagens",
  "despesas_administrativas",
]);

/** Composição (totais/resultados) — filhos na mesma métrica do DRE. */
const COMPOSITION: Partial<Record<FinanceDreLineId, FinanceDreLineId[]>> = {
  deducoes: ["cofins", "icms", "icms_st", "ipi", "pis", "devolucoes"],
  custos: ["cmv", "fretes", "embalagens"],
  despesas_operacionais: ["despesas_administrativas"],
  receita_liquida: ["receita_bruta", "deducoes"],
  lucro_bruto: ["receita_liquida", "custos"],
  resultado_operacional: ["lucro_bruto", "despesas_operacionais"],
  lucro_liquido_aproximado: ["resultado_operacional"],
};

export function financeDreLineLabel(lineId: FinanceDreLineId): string {
  return LINE_LABELS[lineId] ?? lineId;
}

export function isFinanceDreDrillableLine(lineId: string): lineId is FinanceDreLineId {
  return lineId in LINE_LABELS;
}

export function financeDreCompositionChildren(
  lineId: FinanceDreLineId
): FinanceDreLineId[] | null {
  const children = COMPOSITION[lineId];
  return children ? [...children] : null;
}

export function isFinanceDreSourceDrillLine(lineId: FinanceDreLineId): boolean {
  return SOURCE_LINES.has(lineId);
}

export function sumDreDrilldownAmounts(amounts: readonly number[]): number {
  let sum = 0;
  for (const value of amounts) {
    if (Number.isFinite(value)) sum += value;
  }
  return roundDreMoney(sum);
}

/** Reconcilia detalhe × linha DRE (centavos). */
export function dreDrilldownTotalsMatch(
  expectedTotal: number,
  rowsTotal: number,
  tolerance = 0.02
): boolean {
  return Math.abs(roundDreMoney(expectedTotal) - roundDreMoney(rowsTotal)) <= tolerance;
}

export function scopeMonthRange(
  scope: "highlight" | "ytd",
  highlightMonth: number
): { fromMonth: number; toMonth: number } {
  const m = Math.min(12, Math.max(1, highlightMonth));
  if (scope === "ytd") return { fromMonth: 1, toMonth: m };
  return { fromMonth: m, toMonth: m };
}

export function amountInMonthRange(
  byMonth: readonly number[],
  fromMonth: number,
  toMonth: number
): number {
  let sum = 0;
  for (let month = fromMonth; month <= toMonth; month += 1) {
    sum += byMonth[month - 1] ?? 0;
  }
  return roundDreMoney(sum);
}
