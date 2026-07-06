/**
 * Rótulos de período da seção Fluxo de Caixa / Agenda — Relatório Executivo.
 * Apenas apresentação; deriva do mesmo payload/filtros do relatório (sem alterar cálculos).
 */
import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import { executiveReportMonthLabelPt } from "./financeExecutiveReportPresentation.js";
import { formatExecutiveReportPresentationCurrency } from "./financeExecutiveReportPresentation.js";

export type ExecutiveReportCashFlowPeriodCopy = {
  year: number;
  /** Jan–Dez/AAAA */
  cardsPeriodShort: string;
  /** 01/01/AAAA a 31/12/AAAA */
  cardsPeriodRange: string;
  dataBaseLabel: string;
  viewKindLabel: string;
  /** Linha única abaixo do subtítulo da seção */
  metadataLine: string;
  chartTitle: string;
  chartSubtitle: string;
  highlightMonthLabel: string | null;
  cardSubs: {
    inflow: string;
    outflow: string;
    net: string;
    accumulated: string;
  };
  cardHints: {
    inflow: string;
    outflow: string;
    net: string;
    accumulated: string;
  };
};

function buildYearRangeLabel(year: number): string {
  return `01/01/${year} a 31/12/${year}`;
}

/**
 * Cards, gráfico e linha do tempo mensal usam carga anual Jan–Dez (ignora filtro de mês do relatório).
 * Data-base: cover.reportDateLabel (referenceDate do relatório).
 */
export function buildExecutiveReportCashFlowPeriodCopy(
  report: Pick<FinanceExecutiveReport, "year" | "month" | "cover" | "calendarAgenda">
): ExecutiveReportCashFlowPeriodCopy {
  const year = report.calendarAgenda.annualChart?.year ?? report.year;
  const cardsPeriodShort = `Jan–Dez/${year}`;
  const cardsPeriodRange = buildYearRangeLabel(year);
  const dataBaseLabel = report.cover.reportDateLabel;
  const viewKindLabel = "Fluxo previsto (vencimentos AR/AP)";

  const highlightMonth =
    report.calendarAgenda.annualChart?.highlightMonth ?? report.month ?? null;
  const highlightMonthLabel =
    highlightMonth != null && highlightMonth >= 1 && highlightMonth <= 12
      ? `${executiveReportMonthLabelPt(highlightMonth)}/${year}`
      : null;

  const metadataParts = [
    `Período dos cards: ${cardsPeriodShort}`,
    `Período do gráfico: ${cardsPeriodShort}`,
    `Data-base: ${dataBaseLabel}`,
    viewKindLabel,
  ];
  if (highlightMonthLabel) {
    metadataParts.splice(2, 0, `Mês destacado no gráfico: ${highlightMonthLabel}`);
  }

  const chartSubtitle = `Saldo líquido mensal e acumulado de jan/${year} a dez/${year}. ${viewKindLabel}.`;

  return {
    year,
    cardsPeriodShort,
    cardsPeriodRange,
    dataBaseLabel,
    viewKindLabel,
    metadataLine: metadataParts.join(" · "),
    chartTitle: `Fluxo de caixa planejado — ${year}`,
    chartSubtitle,
    highlightMonthLabel,
    cardSubs: {
      inflow: `${cardsPeriodShort} · previstas`,
      outflow: `${cardsPeriodShort} · previstas`,
      net: "Entradas − Saídas no ano",
      accumulated: `Até dez/${year}`,
    },
    cardHints: {
      inflow: `Entradas previstas de jan a dez/${year} (por vencimento).`,
      outflow: `Saídas previstas de jan a dez/${year} (por vencimento).`,
      net: `Entradas previstas menos saídas previstas em ${cardsPeriodShort}.`,
      accumulated: `Saldo acumulado previsto até o fim de dez/${year}.`,
    },
  };
}

/** Leitura executiva do cenário — prefixo com período + narrativa do gráfico (sem alterar números). */
export function buildExecutiveReportCashFlowScenarioReading(input: {
  periodCopy: ExecutiveReportCashFlowPeriodCopy;
  netTotal: number;
  chartNarrative: string;
}): string {
  const { periodCopy, netTotal, chartNarrative } = input;
  const period = periodCopy.cardsPeriodShort;
  const netFormatted = formatExecutiveReportPresentationCurrency(netTotal);

  let lead: string;
  if (netTotal < 0) {
    lead = `Em ${period}, as saídas previstas superam as entradas previstas, gerando saldo líquido negativo de ${netFormatted}.`;
  } else if (netTotal > 0) {
    lead = `Em ${period}, as entradas previstas superam as saídas previstas, com saldo líquido positivo de ${netFormatted}.`;
  } else {
    lead = `Em ${period}, entradas e saídas previstas se equilibram no saldo líquido do ano.`;
  }

  const narrative = chartNarrative.trim();
  if (!narrative) return lead;
  if (narrative.startsWith(lead.slice(0, 20))) return narrative;
  return `${lead} ${narrative}`;
}
