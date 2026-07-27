/**
 * Hash estável das fontes da projeção (sourceVersion).
 */

import { createHash } from "node:crypto";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableSerialize(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`)
    .join(",")}}`;
}

/** SHA-256 hex das partes de fonte (ordenado, determinístico). */
export function buildTreasuryProjectionSourceVersion(
  parts: Record<string, unknown>
): string {
  return createHash("sha256").update(stableSerialize(parts)).digest("hex");
}
