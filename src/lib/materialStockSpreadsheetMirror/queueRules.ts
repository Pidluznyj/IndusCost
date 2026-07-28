/**
 * Regras puras — backoff, dedupe, payload, upsert por chave (sem descrição).
 */
import { roundMaterialStockQuantity } from "../materialStockConferenceMath.js";
import {
  MATERIAL_STOCK_SPREADSHEET_FORBIDDEN_PAYLOAD_KEYS,
  type MaterialStockSpreadsheetMirrorEventType,
  type MaterialStockSpreadsheetMirrorPayload,
} from "./types.js";

export const MATERIAL_STOCK_SPREADSHEET_MIRROR_DEFAULT_MAX_ATTEMPTS = 5;

/** Backoff exponencial após falha: 5s, 10s, 20s… cap 5min (padrão Tesouraria). */
export function computeMaterialStockSpreadsheetMirrorBackoffMs(
  attempts: number
): number {
  const safe = Math.max(1, Math.floor(attempts));
  const base = 5_000 * 2 ** (safe - 1);
  return Math.min(base, 300_000);
}

export function computeMaterialStockSpreadsheetMirrorAvailableAt(
  now: Date,
  attempts: number
): Date {
  return new Date(
    now.getTime() + computeMaterialStockSpreadsheetMirrorBackoffMs(attempts)
  );
}

export function buildMaterialStockSpreadsheetMirrorDeduplicationKey(
  materialId: string
): string {
  return materialId.trim().toLowerCase();
}

function toNumber(value: unknown): number {
  const n = roundMaterialStockQuantity(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = roundMaterialStockQuantity(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export type MaterialStockSpreadsheetMirrorSourceRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: unknown;
  contingencyQuantity: unknown;
  minimumQuantity: unknown;
  recommendedQuantity: unknown;
  lastStockConferenceAt: Date | string | null;
  stockConferenceVersion: number;
  status?: string | null;
};

export function buildMaterialStockSpreadsheetMirrorPayload(input: {
  eventId: string;
  idempotencyKey: string;
  eventType: MaterialStockSpreadsheetMirrorEventType;
  occurredAt?: Date;
  material: MaterialStockSpreadsheetMirrorSourceRow;
}): MaterialStockSpreadsheetMirrorPayload {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  return {
    operation: "UPSERT",
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
    eventType: input.eventType,
    occurredAt,
    materialId: input.material.id,
    code: input.material.code.trim(),
    description: input.material.description,
    unit: input.material.unit,
    currentQuantity: toNumber(input.material.quantity),
    contingencyQuantity: toNullableNumber(input.material.contingencyQuantity),
    minimumQuantity: toNullableNumber(input.material.minimumQuantity),
    recommendedQuantity: toNullableNumber(input.material.recommendedQuantity),
    lastStockConferenceAt: toIso(input.material.lastStockConferenceAt),
    stockConferenceVersion: input.material.stockConferenceVersion,
    materialStatus: input.material.status?.trim() || null,
  };
}

export function assertMirrorPayloadHasNoCosts(
  payload: Record<string, unknown>
): { ok: true } | { ok: false; keys: string[] } {
  const keys = MATERIAL_STOCK_SPREADSHEET_FORBIDDEN_PAYLOAD_KEYS.filter((k) =>
    Object.prototype.hasOwnProperty.call(payload, k)
  );
  return keys.length === 0 ? { ok: true } : { ok: false, keys: [...keys] };
}

/**
 * Localiza linha na planilha somente por materialId ou code (nunca só descrição).
 * Simula o contrato que o Automate deve seguir.
 */
export function resolveSpreadsheetUpsertTarget(
  rows: Array<{ materialId?: string | null; code?: string | null; description?: string | null }>,
  key: { materialId: string; code: string }
): { action: "update"; index: number } | { action: "insert" } {
  const id = key.materialId.trim().toLowerCase();
  const code = key.code.trim().toLowerCase();
  const byId = rows.findIndex(
    (r) => (r.materialId ?? "").trim().toLowerCase() === id
  );
  if (byId >= 0) return { action: "update", index: byId };
  const byCode = rows.findIndex(
    (r) => (r.code ?? "").trim().toLowerCase() === code
  );
  if (byCode >= 0) return { action: "update", index: byCode };
  return { action: "insert" };
}

export function applySpreadsheetUpsert(
  rows: Array<{
    materialId: string;
    code: string;
    description: string;
    currentQuantity: number;
  }>,
  next: {
    materialId: string;
    code: string;
    description: string;
    currentQuantity: number;
  }
): Array<{
  materialId: string;
  code: string;
  description: string;
  currentQuantity: number;
}> {
  const target = resolveSpreadsheetUpsertTarget(rows, next);
  if (target.action === "insert") {
    return [...rows, { ...next }];
  }
  return rows.map((row, i) => (i === target.index ? { ...next } : row));
}
