/**
 * Normalização, hash estável e sanitização.
 * Não usar JSON.stringify de objeto solto como fingerprint.
 */

import { createHash } from "node:crypto";
import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";

const SECRET_KEY =
  /authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|secret|on[-_ ]?behalf[-_ ]?of|^cpf$|cpfcompleto/i;

export function normalizeExposureCnpj(value: string | null | undefined): string | null {
  const digits = normalizeCnpj(value);
  if (!isValidCnpj(digits)) return null;
  return digits;
}

/** Número CNJ: 20 dígitos. Formatação só na apresentação. */
export function normalizeProcessNumber(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 20) return null;
  return digits;
}

export function formatProcessNumber(value: string | null | undefined): string {
  const digits = normalizeProcessNumber(value) ?? String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 20) return String(value ?? "").trim() || "—";
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

export function normalizeLegalName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(",")}}`;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function looksLikeCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  return value.trim() === digits || /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(value.trim());
}

export function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = sanitizePayload(nested, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && looksLikeCpf(value)) return "[redacted]";
  return value;
}

export function sanitizeErrorMessage(message: string | null | undefined): string {
  return String(message ?? "")
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[redacted]")
    .replace(/client[_-]?secret\s*[=:]\s*\S+/gi, "client_secret=[redacted]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[cpf]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function movementFingerprint(input: {
  processNumberNormalized: string;
  sourceCode: string | null;
  name: string;
  occurredAt: string | null;
  courtUnit: string | null;
  complements: unknown;
}): string {
  return stableHash({
    processNumberNormalized: input.processNumberNormalized,
    sourceCode: input.sourceCode,
    name: normalizeLegalName(input.name),
    occurredAt: input.occurredAt,
    courtUnit: input.courtUnit?.trim() || null,
    complements: sanitizePayload(input.complements),
  });
}
