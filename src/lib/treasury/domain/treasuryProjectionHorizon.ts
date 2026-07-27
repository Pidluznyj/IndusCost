/**
 * Limite configurável de horizonte de projeção/agenda (puro).
 */

import { diffCivilDays } from "@/src/lib/financeCivilDate.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export const TREASURY_PROJECTION_MAX_HORIZON_DAYS_ENV =
  "TREASURY_PROJECTION_MAX_HORIZON_DAYS";
export const TREASURY_PROJECTION_DEFAULT_MAX_HORIZON_DAYS = 90;

export function resolveTreasuryProjectionMaxHorizonDays(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env[TREASURY_PROJECTION_MAX_HORIZON_DAYS_ENV]?.trim();
  if (!raw) return TREASURY_PROJECTION_DEFAULT_MAX_HORIZON_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return TREASURY_PROJECTION_DEFAULT_MAX_HORIZON_DAYS;
  }
  return Math.min(Math.floor(n), 3660);
}

/** Dias inclusivos no intervalo [baseDate, endDate]. */
export function countTreasuryProjectionHorizonDays(
  baseDate: string,
  endDate: string
): number {
  return diffCivilDays(baseDate, endDate) + 1;
}

export function assertTreasuryProjectionHorizon(input: {
  baseDate: string;
  endDate: string;
  maxHorizonDays?: number;
  field?: string;
}): number {
  if (input.baseDate > input.endDate) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "baseDate não pode ser posterior a endDate.",
      input.field ?? "baseDate"
    );
  }
  const days = countTreasuryProjectionHorizonDays(
    input.baseDate,
    input.endDate
  );
  const max =
    input.maxHorizonDays ?? resolveTreasuryProjectionMaxHorizonDays();
  if (days > max) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Horizonte de ${days} dias excede o máximo configurável de ${max} dias.`,
      input.field ?? "endDate"
    );
  }
  return days;
}
