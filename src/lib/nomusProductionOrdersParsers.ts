/**
 * Parsers e normalização do payload Nomus `/rest/ordens` (OP-03).
 * Reutiliza `parseNomusPtBrNumber` e padrões de string/int do parser AR.
 * Sem I/O de rede e sem gravação em banco.
 */

import { createHash } from "node:crypto";
import { asString, toInt } from "@/src/lib/nomusAccountsReceivableParser.js";
import { parseNomusPtBrNumber } from "@/scripts/nomusNumberParser.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_PRODUCTION_ORDER_TIMEZONE = "America/Sao_Paulo" as const;

/** Chaves que nunca entram no hash (segredos / timestamps locais de sync). */
const HASH_EXCLUDED_KEY_PATTERN =
  /^(authorization|token|password|secret|api[_-]?key|syncedAt|firstSeenAt|lastSeenAt|lastChangedAt|createdAt|updatedAt)$/i;

export type NomusProductionOrderDateParseResult =
  | { ok: true; value: Date | null; absent: boolean }
  | { ok: false; error: string; raw: string };

export type NomusProductionOrderDecimalParseResult =
  | { ok: true; value: number | null; absent: boolean }
  | { ok: false; error: string; raw: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function readTzParts(
  date: Date,
  timeZone: string
): { y: number; m: number; d: number; h: number; mi: number; s: number } | null {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number | null => {
    const raw = parts.find((p) => p.type === type)?.value;
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  };
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");
  if (y == null || m == null || d == null || h == null || mi == null || s == null) return null;
  return { y, m, d, h, mi, s };
}

/**
 * Converte relógio de parede em `America/Sao_Paulo` para instante UTC (`Date`).
 */
export function wallTimeInTimeZoneToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone?: string;
}): Date | null {
  const timeZone = input.timeZone ?? NOMUS_PRODUCTION_ORDER_TIMEZONE;
  const { year, month, day, hour, minute, second } = input;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  // Validação civil básica (ex.: 31/02).
  const civilProbe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    civilProbe.getUTCFullYear() !== year ||
    civilProbe.getUTCMonth() !== month - 1 ||
    civilProbe.getUTCDate() !== day
  ) {
    return null;
  }

  // Chute inicial: America/Sao_Paulo ≈ UTC−3 (sem DST desde 2019).
  let utcMs = Date.UTC(year, month - 1, day, hour + 3, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const parts = readTzParts(new Date(utcMs), timeZone);
    if (!parts) return null;
    const asUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    utcMs += wanted - asUtc;
  }

  const result = new Date(utcMs);
  const verify = readTzParts(result, timeZone);
  if (
    !verify ||
    verify.y !== year ||
    verify.m !== month ||
    verify.d !== day ||
    verify.h !== hour ||
    verify.mi !== minute ||
    verify.s !== second
  ) {
    return null;
  }
  return result;
}

/**
 * Datas Nomus: `dd/MM/yyyy[ HH:mm[:ss]]` interpretadas em America/Sao_Paulo.
 * - null / "" → ausente (ok, value null)
 * - inválida → erro controlado (ok: false)
 */
export function parseNomusProductionOrderDateTime(
  input: unknown
): NomusProductionOrderDateParseResult {
  if (input == null) return { ok: true, value: null, absent: true };
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      return { ok: false, error: "INVALID_DATE_OBJECT", raw: String(input) };
    }
    return { ok: true, value: input, absent: false };
  }
  if (typeof input !== "string") {
    return { ok: false, error: "INVALID_DATE_TYPE", raw: String(input) };
  }

  const raw = input.trim();
  if (!raw) return { ok: true, value: null, absent: true };

  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!br) {
    return { ok: false, error: "INVALID_DATE_FORMAT", raw };
  }

  const day = Number.parseInt(br[1]!, 10);
  const month = Number.parseInt(br[2]!, 10);
  const yearRaw = Number.parseInt(br[3]!, 10);
  const year = br[3]!.length === 2 ? 2000 + yearRaw : yearRaw;
  const hour = Number.parseInt(br[4] ?? "0", 10);
  const minute = Number.parseInt(br[5] ?? "0", 10);
  const second = Number.parseInt(br[6] ?? "0", 10);

  const value = wallTimeInTimeZoneToUtc({
    year,
    month,
    day,
    hour,
    minute,
    second,
    timeZone: NOMUS_PRODUCTION_ORDER_TIMEZONE,
  });
  if (!value) {
    return {
      ok: false,
      error: "INVALID_DATE_VALUE",
      raw: `${pad2(day)}/${pad2(month)}/${year} ${pad2(hour)}:${pad2(minute)}:${pad2(second)} (${NOMUS_PRODUCTION_ORDER_TIMEZONE})`,
    };
  }
  return { ok: true, value, absent: false };
}

/**
 * Decimal brasileiro para quantidades/valores de OP.
 * Regra explícita: null e string vazia → null (ausente); não vira 0.
 */
export function parseNomusProductionOrderDecimal(
  input: unknown
): NomusProductionOrderDecimalParseResult {
  if (input == null) return { ok: true, value: null, absent: true };
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return { ok: false, error: "INVALID_DECIMAL_NUMBER", raw: String(input) };
    }
    return { ok: true, value: input, absent: false };
  }
  if (typeof input !== "string") {
    return { ok: false, error: "INVALID_DECIMAL_TYPE", raw: String(input) };
  }
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null, absent: true };

  const parsed = parseNomusPtBrNumber(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: "INVALID_DECIMAL_VALUE", raw: trimmed };
  }
  // parseNomusPtBrNumber devolve 0 para lixo residual — distinguir "0" legítimo.
  const cleaned = trimmed.replace(/[^\d,.\-]/g, "");
  if (!cleaned) {
    return { ok: false, error: "INVALID_DECIMAL_VALUE", raw: trimmed };
  }
  return { ok: true, value: parsed, absent: false };
}

/** Alias semântico para quantidade (mesma regra decimal). */
export function parseNomusProductionQuantity(input: unknown): number | null {
  const parsed = parseNomusProductionOrderDecimal(input);
  return parsed.ok ? parsed.value : null;
}

/**
 * String Nomus: trim; vazio → null.
 * Não altera códigos oficiais além do trim (preserva case/espaços internos).
 */
export function normalizeNomusProductionOrderString(value: unknown): string | null {
  return asString(value);
}

/** Preserva texto original relevante com trim; útil para códigos oficiais. */
export function normalizeNomusProductionOrderCode(value: unknown): string | null {
  return asString(value);
}

export function normalizeNomusProductionOrderInt(value: unknown): number | null {
  return toInt(value);
}

function shouldExcludeHashKey(key: string): boolean {
  return HASH_EXCLUDED_KEY_PATTERN.test(key);
}

/** Serialização canônica: chaves ordenadas, recursiva; exclui segredos e timestamps locais. */
export function canonicalizeNomusProductionOrderValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeNomusProductionOrderValue(item));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    if (shouldExcludeHashKey(key)) continue;
    out[key] = canonicalizeNomusProductionOrderValue(obj[key]);
  }
  return out;
}

export function stableSerializeNomusProductionOrderPayload(raw: JsonObject): string {
  return JSON.stringify(canonicalizeNomusProductionOrderValue(raw));
}

/** Hash SHA-256 determinístico do payload Nomus (sem segredos / timestamps locais). */
export function stableNomusProductionOrderPayloadHash(raw: JsonObject): string {
  return createHash("sha256").update(stableSerializeNomusProductionOrderPayload(raw)).digest("hex");
}

export function asNomusProductionOrderObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/**
 * Validação mínima do payload de OP: objeto com id externo.
 * Campos desconhecidos são ignorados (não quebram).
 */
export function validateNomusProductionOrderPayload(raw: unknown): {
  ok: boolean;
  externalId: number | null;
  reasons: string[];
  payload: JsonObject | null;
} {
  const payload = asNomusProductionOrderObject(raw);
  if (!payload) {
    return { ok: false, externalId: null, reasons: ["INVALID_PAYLOAD_OBJECT"], payload: null };
  }
  const externalId =
    normalizeNomusProductionOrderInt(payload.id) ??
    normalizeNomusProductionOrderInt(payload.idOrdem) ??
    normalizeNomusProductionOrderInt(payload.idOrdemProducao);
  if (externalId == null) {
    return { ok: false, externalId: null, reasons: ["MISSING_EXTERNAL_ID"], payload };
  }
  return { ok: true, externalId, reasons: [], payload };
}
