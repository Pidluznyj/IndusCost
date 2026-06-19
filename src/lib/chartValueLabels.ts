import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";

/** Label compacto para gráficos — sem NaN/Infinity. */
export function formatChartCurrencyLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  if (value === 0) return "";
  const formatted = formatFinanceKpiCurrency(value);
  return value < 0 ? `- ${formatted.replace(/^-/, "")}` : formatted;
}

export function shouldShowChartValueLabel(value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return value !== 0;
}

export type ChartLabelPoint = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number | string;
};

function toNumber(value: number | string | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Label acima (positivo) ou abaixo (negativo) de barras Recharts. */
export function getChartBarLabelPosition(
  x: number,
  y: number,
  width: number,
  value: number
): { cx: number; cy: number; anchor: "middle" | "start" | "end" } {
  const cx = x + width / 2;
  if (value < 0) {
    return { cx, cy: y + 12, anchor: "middle" };
  }
  return { cx, cy: y - 5, anchor: "middle" };
}

export function buildChartBarLabelProps(point: ChartLabelPoint): {
  x: number;
  y: number;
  text: string;
  fill: string;
} | null {
  const value = toNumber(point.value);
  if (!shouldShowChartValueLabel(value)) return null;
  const x = point.x ?? 0;
  const y = point.y ?? 0;
  const width = point.width ?? 0;
  const pos = getChartBarLabelPosition(x, y, width, value!);
  return {
    x: pos.cx,
    y: pos.cy,
    text: formatChartCurrencyLabel(value),
    fill: value! < 0 ? "#B91C1C" : "#334155",
  };
}

/** Label acima de pontos de linha. */
export function buildChartLineLabelProps(point: ChartLabelPoint): {
  x: number;
  y: number;
  text: string;
} | null {
  const value = toNumber(point.value);
  if (!shouldShowChartValueLabel(value)) return null;
  return {
    x: (point.x ?? 0) + 2,
    y: (point.y ?? 0) - 6,
    text: formatChartCurrencyLabel(value),
  };
}
