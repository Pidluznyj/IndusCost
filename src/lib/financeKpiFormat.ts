/** Formatação compacta padrão dos KPIs executivos financeiros (puro, sem backend). */

function formatPtBr(value: number, decimals: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatPtBrCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Moeda compacta para cards executivos:
 * - &lt; 10 mil: R$ 942,81
 * - 10 mil a &lt; 1 Mi: R$ 827,5 mil
 * - ≥ 1 Mi: R$ 5,83 Mi
 */
export function formatFinanceKpiCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R$\u00a0${formatPtBr(value / 1_000_000, 2)}\u00a0Mi`;
  }
  if (abs >= 10_000) {
    return `R$\u00a0${formatPtBr(value / 1_000, 1)}\u00a0mil`;
  }
  return formatPtBrCurrency(value);
}

/** Variação percentual com sinal explícito para KPIs comparativos. */
export function formatFinanceKpiVariationPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Sem base comparativa";
  const formatted = formatPtBr(value, 1);
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatted}%`;
}
