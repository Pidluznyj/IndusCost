/**
 * Helpers de filtro monetário (faixa De/Até) — pt-BR.
 * Valores canônicos na query: número decimal com ponto (ex.: "1500.5").
 */

export type MoneyRangePreset = {
  id: string;
  label: string;
  minValue: string;
  maxValue: string;
};

/** Atalhos visuais para Contas a Receber / filtros analíticos. */
export const MONEY_RANGE_PRESETS: readonly MoneyRangePreset[] = [
  { id: "upto-1k", label: "Até 1 mil", minValue: "", maxValue: "1000" },
  { id: "upto-10k", label: "Até 10 mil", minValue: "", maxValue: "10000" },
  { id: "upto-50k", label: "Até 50 mil", minValue: "", maxValue: "50000" },
  { id: "upto-100k", label: "Até 100 mil", minValue: "", maxValue: "100000" },
  { id: "from-50k", label: "Acima de 50 mil", minValue: "50000", maxValue: "" },
] as const;

/**
 * Interpreta digitação pt-BR / en-US.
 * Exemplos: "1.500,50" → 1500.5 | "1500,5" → 1500.5 | "1500.5" → 1500.5 | "1.500" → 1500
 */
export function parseMoneyAmountInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/R\$\s?/gi, "").trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/\s/g, "");

  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    // milhares BR sem decimais: 1.500 / 12.345.678
    normalized = normalized.replace(/\./g, "");
  }

  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Formata valor canônico (ou número) para exibição no input (sem R$). */
export function formatMoneyAmountInput(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const n =
    typeof value === "number" ? value : parseMoneyAmountInput(String(value));
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Valor canônico para query/API a partir da digitação do usuário. */
export function moneyAmountToFilterParam(raw: string): string {
  const n = parseMoneyAmountInput(raw);
  if (n == null || n <= 0) return "";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

export function resolveActiveMoneyRangePreset(
  minValue: string,
  maxValue: string
): string | null {
  const min = moneyAmountToFilterParam(minValue);
  const max = moneyAmountToFilterParam(maxValue);
  for (const preset of MONEY_RANGE_PRESETS) {
    if (preset.minValue === min && preset.maxValue === max) return preset.id;
  }
  return null;
}

export function formatMoneyRangeSummary(minValue: string, maxValue: string): string | null {
  const min = parseMoneyAmountInput(minValue);
  const max = parseMoneyAmountInput(maxValue);
  const hasMin = min != null && min > 0;
  const hasMax = max != null && max > 0;
  if (!hasMin && !hasMax) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  if (hasMin && hasMax) return `${fmt(min!)} — ${fmt(max!)}`;
  if (hasMin) return `A partir de ${fmt(min!)}`;
  return `Até ${fmt(max!)}`;
}
