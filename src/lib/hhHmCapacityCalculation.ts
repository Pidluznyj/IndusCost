/**
 * Capacidade produtiva HH/HM — horas teóricas e ajustadas por eficiência.
 * Extraído da simulação simples para reuso na simulação por centro de custo.
 * Sem Prisma, sem custo oficial.
 */

export const HH_HM_CAPACITY_DEFAULT_HOURS_PER_UNIT = "180";
export const HH_HM_CAPACITY_DEFAULT_EFFICIENCY_PERCENT = "80";

export const HH_HM_CAPACITY_HH_INPUT_HINT =
  "Informe pessoas/horas/eficiência válidas para calcular a taxa HH.";

export const HH_HM_CAPACITY_HM_INPUT_HINT =
  "Informe máquinas/horas/eficiência válidas para calcular a taxa HM.";

export type HhHmCapacityEfficiencyParseResult = {
  value: number | null;
  error?: string;
};

export type HhHmCapacityHoursResult = {
  theoreticalHours: number | null;
  adjustedHours: number | null;
  efficiencyPercent: number | null;
  efficiencyError?: string;
};

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function isPositive(value: number | null): value is number {
  return value != null && value > 0;
}

/** Eficiência em %: obrigatória quando informada; deve ser > 0 e ≤ 100. */
export function parseHhHmCapacityEfficiencyPercent(
  raw: string
): HhHmCapacityEfficiencyParseResult {
  const parsed = parseNumber(raw);
  if (parsed == null) return { value: null };
  if (parsed <= 0) return { value: null, error: "Eficiência deve ser maior que 0%." };
  if (parsed > 100) return { value: null, error: "Eficiência não pode ser maior que 100%." };
  return { value: parsed };
}

/** Horas teóricas = quantidade × horas por unidade. */
export function computeHhHmTheoreticalHours(
  unitCount: number | null,
  hoursPerUnit: number | null
): number | null {
  if (!isPositive(unitCount) || !isPositive(hoursPerUnit)) return null;
  return unitCount * hoursPerUnit;
}

/** Horas ajustadas = teóricas × eficiência / 100. */
export function computeHhHmAdjustedHours(
  theoreticalHours: number | null,
  efficiencyPercent: number | null
): number | null {
  if (!isPositive(theoreticalHours) || efficiencyPercent == null) return null;
  if (efficiencyPercent <= 0 || efficiencyPercent > 100) return null;
  return theoreticalHours * (efficiencyPercent / 100);
}

/**
 * Calcula horas teóricas e ajustadas a partir de strings de formulário
 * (mesma regra da simulação simples de transformação).
 */
export function computeHhHmCapacityHours(input: {
  unitCount: string;
  hoursPerUnit: string;
  efficiencyPercent: string;
}): HhHmCapacityHoursResult {
  const unitCount = parseNumber(input.unitCount);
  const hoursPerUnit = parseNumber(input.hoursPerUnit);
  const efficiency = parseHhHmCapacityEfficiencyPercent(input.efficiencyPercent);
  const theoreticalHours = computeHhHmTheoreticalHours(
    isPositive(unitCount) ? unitCount : null,
    isPositive(hoursPerUnit) ? hoursPerUnit : null
  );
  const adjustedHours = computeHhHmAdjustedHours(theoreticalHours, efficiency.value);
  return {
    theoreticalHours,
    adjustedHours,
    efficiencyPercent: efficiency.value,
    efficiencyError: efficiency.error,
  };
}

export function parsePositiveCapacityNumber(raw: string): number | null {
  const value = parseNumber(raw);
  if (value == null || value <= 0) return null;
  return value;
}

/**
 * Taxa horária = média mensal ÷ horas ajustadas (denominador da taxa).
 * Retorna null se não houver divisão válida.
 */
export function calculateHhHmHourlyRate(
  monthlyAverageAmount: number | null,
  adjustedHours: number | null
): number | null {
  if (monthlyAverageAmount == null || adjustedHours == null) return null;
  if (!(adjustedHours > 0) || !Number.isFinite(monthlyAverageAmount)) return null;
  return Math.round((monthlyAverageAmount / adjustedHours) * 100) / 100;
}

/**
 * Denominador da taxa: horas ajustadas pela eficiência, ou horas base manuais
 * somente quando a configuração avançada está marcada.
 */
export function resolveHhHmRateDenominatorHours(input: {
  useManualBaseHours: boolean;
  manualBaseHours: number | null;
  adjustedHours: number | null;
}): number | null {
  if (input.useManualBaseHours) {
    return input.manualBaseHours != null && input.manualBaseHours > 0
      ? input.manualBaseHours
      : null;
  }
  return input.adjustedHours != null && input.adjustedHours > 0
    ? input.adjustedHours
    : null;
}
