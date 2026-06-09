/**
 * Paleta centralizada para gráficos de Faturamento.
 * Cores alinhadas ao Power BI da empresa — não hardcodar em componentes.
 */

/** Cores fixas por ano (referência Power BI). */
export const FINANCE_BILLING_YEAR_COLORS: Record<number, string> = {
  2024: "#D4A017",
  2025: "#ED7D31",
  2026: "#2E7D32",
};

/** Cores semânticas para séries especiais. */
export const FINANCE_BILLING_SERIES_COLORS = {
  projection: "#1565C0",
  target: "#C62828",
  targetDashed: "#E65100",
  positive: "#2E7D32",
  negative: "#C62828",
  neutral: "#64748b",
} as const;

const FALLBACK_YEAR_COLOR = "#94a3b8";

export function getFinanceBillingYearColor(year: number): string {
  return FINANCE_BILLING_YEAR_COLORS[year] ?? FALLBACK_YEAR_COLOR;
}

/** Retorna anos ordenados para comparação (ex.: [2024, 2025, 2026]). */
export function resolveFinanceBillingComparisonYears(
  selectedYear: number,
  span = 3
): number[] {
  const start = selectedYear - (span - 1);
  const years: number[] = [];
  for (let y = start; y <= selectedYear; y += 1) {
    if (y >= 2020) years.push(y);
  }
  return years;
}
