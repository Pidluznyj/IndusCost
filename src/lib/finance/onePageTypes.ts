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
};
