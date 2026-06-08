import { parseNomusPtBrNumber } from "@/scripts/nomusNumberParser.js";

export function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "sim", "s", "yes"].includes(normalized)) return true;
    if (["false", "0", "nao", "não", "n", "no"].includes(normalized)) return false;
  }
  return null;
}

/** Moeda BR opcional — null para ausente/vazio; preserva zero. */
export function parseNomusOptionalMoney(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && !input.trim()) return null;
  const parsed = parseNomusPtBrNumber(input);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Data/hora BR `dd/MM/yyyy[ HH:mm[:ss]]` ou ISO. */
export function parseNomusBrDateTime(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (br) {
    const dd = Number.parseInt(br[1], 10);
    const mm = Number.parseInt(br[2], 10);
    const yearRaw = Number.parseInt(br[3], 10);
    const yyyy = br[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const hh = Number.parseInt(br[4] ?? "0", 10);
    const mi = Number.parseInt(br[5] ?? "0", 10);
    const ss = Number.parseInt(br[6] ?? "0", 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const parsed = new Date(yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/** Data BR sem hora — meia-noite local. */
export function parseNomusBrDate(input: unknown): Date | null {
  const dt = parseNomusBrDateTime(input);
  if (!dt) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}
