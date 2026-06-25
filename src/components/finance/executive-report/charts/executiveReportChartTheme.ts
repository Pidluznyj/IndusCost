/** Tipografia e layout compartilhados dos gráficos do Relatório Presidencial. */

export const EXECUTIVE_CHART_HEIGHT = 440;

/** Altura mínima do frame em impressão/PDF (A4 paisagem). */
export const EXECUTIVE_CHART_PRINT_FRAME_HEIGHT = "105mm";

/** Recharts: desativar animação em relatório executivo (impressão/PDF). */
export const EXECUTIVE_CHART_IS_ANIMATION_ACTIVE = false;

export const EXECUTIVE_CHART_MARGIN = {
  top: 36,
  right: 20,
  left: 12,
  bottom: 16,
} as const;

export const EXECUTIVE_CHART_X_TICK = {
  fontSize: 13,
  fill: "#475569",
} as const;

export const EXECUTIVE_CHART_X_TICK_EMPHASIS = {
  fontSize: 13,
  fill: "#334155",
  fontWeight: 600,
} as const;

export const EXECUTIVE_CHART_Y_TICK = {
  fontSize: 13,
  fill: "#475569",
} as const;

export const EXECUTIVE_CHART_LEGEND = {
  fontSize: 13,
  paddingTop: 10,
} as const;

export const EXECUTIVE_CHART_Y_AXIS_WIDTH = 100;

export const EXECUTIVE_CHART_BAR_LABEL_SIZE = 11;

export const EXECUTIVE_CHART_LINE_LABEL_SIZE = 10;
