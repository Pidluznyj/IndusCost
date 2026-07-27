/**
 * Timestamps da Tesouraria: ISO-8601 com offset explícito (Z ou ±HH:MM).
 * Client-safe — sem Prisma.
 */

import { TreasuryContractError } from "./treasuryErrorCodes.js";

export type TreasuryTimestampIso = string;

/**
 * Ex.: 2026-07-27T12:00:00.000Z | 2026-07-27T09:00:00-03:00 | 2026-07-27T12:00:00+00:00
 * Rejeita data civil pura e ISO sem zona.
 */
const TIMESTAMP_WITH_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isTreasuryTimestampIso(
  value: unknown
): value is TreasuryTimestampIso {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!TIMESTAMP_WITH_OFFSET_RE.test(trimmed)) return false;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms);
}

/**
 * Formata Date como ISO-8601 UTC com offset explícito (+00:00).
 * Preferido em DTOs de resposta (Z também é aceito na entrada).
 */
export function formatTreasuryTimestampIso(value: Date): TreasuryTimestampIso {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TreasuryContractError(
      "INVALID_TIMESTAMP",
      "Date inválida para timestamp Tesouraria."
    );
  }
  return value.toISOString().replace(/Z$/, "+00:00");
}

export function parseTreasuryTimestampIso(
  value: unknown,
  field = "timestamp"
): TreasuryTimestampIso {
  if (value == null || value === "") {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      `${field} é obrigatório.`,
      field
    );
  }
  if (typeof value !== "string" || !isTreasuryTimestampIso(value)) {
    throw new TreasuryContractError(
      "INVALID_TIMESTAMP",
      `${field} deve ser ISO-8601 com offset (Z ou ±HH:MM).`,
      field
    );
  }
  return value.trim();
}

export function parseOptionalTreasuryTimestampIso(
  value: unknown,
  field = "timestamp"
): TreasuryTimestampIso | null {
  if (value == null || value === "") return null;
  return parseTreasuryTimestampIso(value, field);
}
