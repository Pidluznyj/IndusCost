export type OnePageDashboardPayload = {
  updatedAt: string;
  year: number;
  month: number;
  monthLabel: string;
  periodLabel: string;
  faturamento: {
    liquido: number | null;
    liquidoFormatted: string;
    liquidoGrowthPercent: number | null;
    liquidoGrowthPercentFormatted: string;
    ytd: number | null;
    ytdFormatted: string;
    ytdPrevious: number | null;
    ytdPreviousFormatted: string;
    ytdDiff: number | null;
    ytdDiffFormatted: string;
    ytdVariation: number | null;
    ytdVariationFormatted: string;
    meta: number | null;
    metaFormatted: string;
    atingimento: number | null;
    atingimentoFormatted: string;
    chartData: Array<{
      month: number;
      monthLabel: string;
      previousYear: number | null;
      currentYear: number | null;
      target: number | null;
      projected: number | null;
    }>;
  };
  pedidoVenda: {
    total: number | null;
    totalFormatted: string;
    totalGrowthPercent: number | null;
    totalGrowthPercentFormatted: string;
    margem: number | null;
    margemFormatted: string;
    /** Escopo temporal da margem exibida (ex.: "Jan–Ago/2026 (YTD)" ou "Ago/2026"). */
    margemPeriodLabel: string;
    ytd: number | null;
    ytdFormatted: string;
    ytdPrevious: number | null;
    ytdPreviousFormatted: string;
    ytdDiff: number | null;
    ytdDiffFormatted: string;
    ytdVariation: number | null;
    ytdVariationFormatted: string;
    backlog: number | null;
    backlogFormatted: string;
    chartData: Array<{
      month: number;
      monthLabel: string;
      previousYear: number | null;
      currentYear: number | null;
      target: number | null;
      projected: number | null;
    }>;
  };
  leituraExecutiva: string[];
  /**
   * DRE Gerencial — resumo do período, EXCLUSIVAMENTE do snapshot canônico da
   * DRE (nenhum motor pesado roda no request do One Page). Valores numéricos
   * carregam o sinal canônico das linhas (deduções/custos negativos);
   * `*Formatted` já vem pronto para exibição executiva.
   */
  dre: {
    available: boolean;
    /** fresh | stale (atualização pendente) | null quando indisponível. */
    freshness: "fresh" | "stale" | null;
    computedAt: string | null;
    updatedAtLabel: string | null;
    periodLabel: string;
    receitaBruta: number | null;
    receitaBrutaFormatted: string;
    receitaLiquida: number | null;
    receitaLiquidaFormatted: string;
    deducoes: number | null;
    deducoesFormatted: string;
    despesasOperacionais: number | null;
    despesasOperacionaisFormatted: string;
    custos: number | null;
    custosFormatted: string;
    cmv: number | null;
    cmvFormatted: string;
    fretes: number | null;
    fretesFormatted: string;
    embalagens: number | null;
    embalagensFormatted: string;
    lucroBruto: number | null;
    lucroBrutoFormatted: string;
    margemBrutaPct: number | null;
    margemBrutaPctFormatted: string;
    resultadoOperacional: number | null;
    resultadoOperacionalFormatted: string;
    margemOperacionalPct: number | null;
    margemOperacionalPctFormatted: string;
    quality: {
      status: "ok" | "warning" | "critical" | null;
      label: string;
    };
  };
};
