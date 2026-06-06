/** Paleta alinhada ao BI gerencial (Pedidos vs Faturamento). */

export const EXECUTIVE_CHART_COLORS = {
  salesOrders: {
    previousYearBar: "#ED7D31",
    currentYearBar: "#1B5E20",
    targetLine: "#43A047",
  },
  billing: {
    previousYearBar: "#D4A017",
    currentYearBar: "#ED7D31",
    targetLine: "#C62828",
    projectedLine: "#1565C0",
  },
} as const;

export type ExecutiveChartKind = keyof typeof EXECUTIVE_CHART_COLORS;

export function getExecutiveChartColors(kind: ExecutiveChartKind) {
  return EXECUTIVE_CHART_COLORS[kind];
}
