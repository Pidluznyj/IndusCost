/**
 * Resumo executivo da DRE para o One Page (puro, sem I/O).
 *
 * Extrai valores EXCLUSIVAMENTE das linhas/KPIs canônicos do FinanceDreReport
 * montado pelo motor oficial — nenhuma fórmula própria: receita líquida,
 * deduções, custos (CMV/fretes/embalagens), lucro bruto, resultado operacional
 * e margens vêm das linhas/KPIs com os MESMOS ids da tela da DRE. Os valores
 * carregam o sinal canônico das linhas (deduções/custos negativos).
 */

import type {
  FinanceDreLineId,
  FinanceDreQualityAlert,
  FinanceDreReport,
} from "@/src/lib/financeDreTypes.js";

export type FinanceDreOnePagePeriodMode = "ytd" | "month";

export type FinanceDreOnePageQuality = {
  alertCount: number;
  maxSeverity: FinanceDreQualityAlert["severity"] | null;
};

export type FinanceDreOnePageSummaryValues = {
  periodMode: FinanceDreOnePagePeriodMode;
  /** Valores assinados como nas linhas canônicas (deduções/custos negativos). */
  receitaBruta: number;
  receitaLiquida: number;
  deducoes: number;
  despesasOperacionais: number;
  custos: number;
  cmv: number;
  fretes: number;
  embalagens: number;
  lucroBruto: number;
  resultadoOperacional: number;
  margemBrutaPct: number | null;
  margemOperacionalPct: number | null;
  quality: FinanceDreOnePageQuality;
};

/** Resultado da leitura do snapshot para o One Page (nunca computa live). */
export type FinanceDreOnePageSummaryResult =
  | {
      available: true;
      freshness: "fresh" | "stale";
      computedAt: string | null;
      values: FinanceDreOnePageSummaryValues;
    }
  | {
      available: false;
      freshness: null;
      computedAt: null;
      values: null;
    };

const SEVERITY_ORDER: Record<FinanceDreQualityAlert["severity"], number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

function lineValue(
  report: FinanceDreReport,
  id: FinanceDreLineId,
  mode: FinanceDreOnePagePeriodMode
): number | null {
  const line = report.lines.find((l) => l.id === id);
  if (!line) return null;
  return mode === "ytd" ? line.values.ytd : line.values.highlight;
}

/**
 * Extrai o resumo executivo do report canônico.
 * `null` quando alguma linha esperada não existir (contrato quebrado).
 */
export function extractFinanceDreOnePageSummaryValues(
  report: FinanceDreReport,
  mode: FinanceDreOnePagePeriodMode
): FinanceDreOnePageSummaryValues | null {
  const receitaBruta = lineValue(report, "receita_bruta", mode);
  const receitaLiquida = lineValue(report, "receita_liquida", mode);
  const deducoes = lineValue(report, "deducoes", mode);
  const despesasOperacionais = lineValue(report, "despesas_operacionais", mode);
  const custos = lineValue(report, "custos", mode);
  const cmv = lineValue(report, "cmv", mode);
  const fretes = lineValue(report, "fretes", mode);
  const embalagens = lineValue(report, "embalagens", mode);
  const lucroBruto = lineValue(report, "lucro_bruto", mode);
  const resultadoOperacional = lineValue(report, "resultado_operacional", mode);
  if (
    receitaBruta == null ||
    receitaLiquida == null ||
    deducoes == null ||
    despesasOperacionais == null ||
    custos == null ||
    cmv == null ||
    fretes == null ||
    embalagens == null ||
    lucroBruto == null ||
    resultadoOperacional == null
  ) {
    return null;
  }

  const kpiSet = mode === "ytd" ? report.kpis.ytd : report.kpis;

  let maxSeverity: FinanceDreQualityAlert["severity"] | null = null;
  for (const alert of report.qualityAlerts) {
    if (maxSeverity == null || SEVERITY_ORDER[alert.severity] > SEVERITY_ORDER[maxSeverity]) {
      maxSeverity = alert.severity;
    }
  }

  return {
    periodMode: mode,
    receitaBruta,
    receitaLiquida,
    deducoes,
    despesasOperacionais,
    custos,
    cmv,
    fretes,
    embalagens,
    lucroBruto,
    resultadoOperacional,
    margemBrutaPct: kpiSet.margemBrutaPct,
    margemOperacionalPct: kpiSet.margemOperacionalPct,
    quality: {
      alertCount: report.qualityAlerts.length,
      maxSeverity,
    },
  };
}

export const FINANCE_DRE_ONE_PAGE_UNAVAILABLE: FinanceDreOnePageSummaryResult = {
  available: false,
  freshness: null,
  computedAt: null,
  values: null,
};
