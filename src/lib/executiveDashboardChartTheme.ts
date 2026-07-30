/** Paleta centralizada — legendas, tooltips e gráficos usam as mesmas cores por série/ano. */

export const EXECUTIVE_DASHBOARD_SERIES_COLORS = {
  salesOrders: {
    /** Ano anterior (barra) — laranja */
    previousYearBar: "#ED7D31",
    /** Ano selecionado / YTD (barra) — verde escuro */
    currentYearBar: "#1B5E20",
    /** Meta mensal (+20%) — linha verde */
    targetLine: "#43A047",
    /** Projeção acumulada — azul */
    projectedLine: "#1565C0",
  },
  billing: {
    /** Ano anterior (barra) — dourado */
    previousYearBar: "#D4A017",
    /** Ano selecionado / YTD (barra) — verde (distinto do dourado e da projeção azul) */
    currentYearBar: "#2E7D32",
    /** Meta mensal (+20%) — linha vermelha / alerta */
    targetLine: "#C62828",
    /** Projeção — azul */
    projectedLine: "#1565C0",
  },
} as const;

/** @deprecated Use EXECUTIVE_DASHBOARD_SERIES_COLORS */
export const EXECUTIVE_CHART_COLORS = EXECUTIVE_DASHBOARD_SERIES_COLORS;

export type ExecutiveChartKind = keyof typeof EXECUTIVE_DASHBOARD_SERIES_COLORS;

export function getExecutiveChartColors(kind: ExecutiveChartKind) {
  return EXECUTIVE_DASHBOARD_SERIES_COLORS[kind];
}

/** Garante que cada série comparativa tenha cor própria (sem duplicatas). */
export function assertDistinctSeriesColors(colors: Record<string, string | undefined>): boolean {
  const values = Object.values(colors).filter((c): c is string => Boolean(c));
  return new Set(values).size === values.length;
}
