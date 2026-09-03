/**
 * Datas de calendário da Tesouraria: estritamente YYYY-MM-DD (client-safe).
 * Não aceita datetime completo em campos civis.
 */

import { TreasuryContractError } from "./treasuryErrorCodes.js";

const CIVIL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fuso canônico da operação de caixa (civil date). */
export const TREASURY_CIVIL_DATE_TIMEZONE = "America/Sao_Paulo" as const;

export type TreasuryCivilDate = string;

export function isTreasuryCivilDate(value: unknown): value is TreasuryCivilDate {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const match = CIVIL_DATE_RE.exec(trimmed);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function parseTreasuryCivilDate(
  value: unknown,
  field = "civilDate"
): TreasuryCivilDate {
  if (value == null || value === "") {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      `${field} é obrigatório.`,
      field
    );
  }
  if (typeof value !== "string") {
    throw new TreasuryContractError(
      "INVALID_CIVIL_DATE",
      `${field} deve ser string YYYY-MM-DD.`,
      field
    );
  }
  const trimmed = value.trim();
  if (!isTreasuryCivilDate(trimmed)) {
    throw new TreasuryContractError(
      "INVALID_CIVIL_DATE",
      `${field} inválido (esperado YYYY-MM-DD).`,
      field
    );
  }
  return trimmed;
}

export function parseOptionalTreasuryCivilDate(
  value: unknown,
  field = "civilDate"
): TreasuryCivilDate | null {
  if (value == null || value === "") return null;
  return parseTreasuryCivilDate(value, field);
}

/**
 * "Hoje" operacional em America/Sao_Paulo (não UTC).
 * Usar em defaults de dashboard/fechamento/UI.
 */
export function todayTreasuryCivilDateInSaoPaulo(
  instant: Date = new Date()
): TreasuryCivilDate {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TreasuryContractError(
      "INVALID_CIVIL_DATE",
      "Instante inválido para data civil America/Sao_Paulo.",
      "civilDate"
    );
  }
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: TREASURY_CIVIL_DATE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parseTreasuryCivilDate(formatted, "civilDate");
}

/**
 * BUCKETING CANÔNICO: dia civil America/Sao_Paulo de um instante
 * (`referenceAt`, `createdAt`, …). Único ponto de conversão instante→dia
 * civil da Tesouraria — nunca `toISOString().slice(0, 10)` (UTC) nem
 * componentes locais do servidor. 21:00 em São Paulo (= 00:00Z do dia
 * seguinte) continua sendo o MESMO dia civil. Reaproveita
 * {@link todayTreasuryCivilDateInSaoPaulo}, que já resolve isso via
 * `Intl.DateTimeFormat` (timezone-aware de verdade, não offset fixo).
 */
export function civilDateFromInstantInSaoPaulo(instant: Date): TreasuryCivilDate {
  return todayTreasuryCivilDateInSaoPaulo(instant);
}

/**
 * America/Sao_Paulo não observa horário de verão desde a extinção nacional
 * em 2019 — o offset é -03:00 o ano inteiro. Usado só para CONSTRUIR os
 * limites gte/lt de uma janela a partir de uma data civil (a direção
 * inversa, instante→dia civil, usa `Intl.DateTimeFormat` acima, que é
 * timezone-aware de verdade e não depende desta constante).
 */
const SAO_PAULO_UTC_OFFSET_HOURS = 3;

function civilDateToUtcMidnightPlusOffset(civilDate: TreasuryCivilDate): Date {
  const parsed = parseTreasuryCivilDate(civilDate);
  const match = CIVIL_DATE_RE.exec(parsed)!;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day, SAO_PAULO_UTC_OFFSET_HOURS, 0, 0, 0));
}

/**
 * Janela de instantes [gte, lt) que cobre os dias civis [from, to] em
 * America/Sao_Paulo — para filtrar colunas TIMESTAMPTZ (`referenceAt`) no
 * banco sem depender do fuso do servidor. Para colunas DATE use
 * {@link civilDateRangeForDbDate}.
 */
export function civilDateRangeInSaoPaulo(
  fromCivilDate: TreasuryCivilDate,
  toCivilDate: TreasuryCivilDate
): { gte: Date; lt: Date } {
  const gte = civilDateToUtcMidnightPlusOffset(fromCivilDate);
  const toStart = civilDateToUtcMidnightPlusOffset(toCivilDate);
  const lt = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

/**
 * Janela [gte, lt) para colunas `@db.Date` (Prisma entrega meia-noite UTC):
 * `Date.UTC` puro, sem fuso.
 */
export function civilDateRangeForDbDate(
  fromCivilDate: TreasuryCivilDate,
  toCivilDate: TreasuryCivilDate
): { gte: Date; lt: Date } {
  const from = parseTreasuryCivilDate(fromCivilDate);
  const fromMatch = CIVIL_DATE_RE.exec(from)!;
  const gte = new Date(
    Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]))
  );
  const to = parseTreasuryCivilDate(toCivilDate);
  const toMatch = CIVIL_DATE_RE.exec(to)!;
  const toStart = new Date(
    Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]))
  );
  const lt = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}
