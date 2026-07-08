/**
 * Atualização parcial de cotações de mercado — com detecção de alterações para auditoria.
 */

import {
  calculateMaterialMarketQuoteNetPrice,
  isMaterialMarketQuoteStatus,
  type MaterialMarketQuoteStatus,
} from "./materialMarketQuote.js";

export type MaterialMarketQuotePatchInput = {
  price?: unknown;
  freightValue?: unknown;
  taxValue?: unknown;
  supplierId?: unknown;
  supplierName?: unknown;
  currency?: unknown;
  status?: unknown;
  notes?: unknown;
  reason?: unknown;
};

export type MaterialMarketQuotePatchFields = {
  price?: number;
  freightValue?: number | null;
  taxValue?: number | null;
  supplierId?: string | null;
  supplierName?: string | null;
  currency?: string;
  netPrice?: number;
  status?: MaterialMarketQuoteStatus;
  notes?: string | null;
  reason?: string | null;
};

function parseOptionalDecimal(value: unknown):
  | { ok: true; value: number | null | undefined }
  | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: "Valor numérico inválido." };
  }
  return { ok: true, value: Math.round(n * 1_000_000) / 1_000_000 };
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseMaterialMarketQuotePatch(
  input: MaterialMarketQuotePatchInput
):
  | { ok: true; value: MaterialMarketQuotePatchFields; hasChanges: boolean }
  | { ok: false; message: string; field?: string } {
  const value: MaterialMarketQuotePatchFields = {};
  let hasChanges = false;

  if (input.price !== undefined) {
    const parsed = parseOptionalDecimal(input.price);
    if (parsed.ok === false) return { ok: false, field: "price", message: parsed.message };
    if (parsed.value === undefined || parsed.value === null) {
      return { ok: false, field: "price", message: "Preço é obrigatório quando informado." };
    }
    value.price = parsed.value;
    hasChanges = true;
  }

  if (input.freightValue !== undefined) {
    const parsed = parseOptionalDecimal(input.freightValue);
    if (parsed.ok === false) return { ok: false, field: "freightValue", message: parsed.message };
    value.freightValue = parsed.value ?? null;
    hasChanges = true;
  }

  if (input.taxValue !== undefined) {
    const parsed = parseOptionalDecimal(input.taxValue);
    if (parsed.ok === false) return { ok: false, field: "taxValue", message: parsed.message };
    value.taxValue = parsed.value ?? null;
    hasChanges = true;
  }

  if (input.supplierId !== undefined) {
    value.supplierId = normalizeOptionalString(input.supplierId) ?? null;
    hasChanges = true;
  }

  if (input.supplierName !== undefined) {
    value.supplierName = normalizeOptionalString(input.supplierName);
    hasChanges = true;
  }

  if (input.currency !== undefined) {
    const currency = normalizeOptionalString(input.currency);
    if (!currency) {
      return { ok: false, field: "currency", message: "Moeda inválida." };
    }
    value.currency = currency.toUpperCase();
    hasChanges = true;
  }

  if (input.status !== undefined) {
    if (!isMaterialMarketQuoteStatus(input.status)) {
      return { ok: false, field: "status", message: "Status de cotação inválido." };
    }
    value.status = input.status;
    hasChanges = true;
  }

  if (input.notes !== undefined) {
    value.notes = normalizeOptionalString(input.notes) ?? null;
    hasChanges = true;
  }

  if (input.reason !== undefined) {
    value.reason = normalizeOptionalString(input.reason) ?? null;
  }

  if (!hasChanges) {
    return { ok: false, message: "Nenhum campo para atualizar foi informado." };
  }

  return { ok: true, value, hasChanges };
}

export function buildMaterialMarketQuotePatchData<T extends {
  price: number | string | { toString(): string };
  freightValue?: number | string | null;
  taxValue?: number | string | null;
}>(
  existing: T,
  patch: MaterialMarketQuotePatchFields
): Record<string, unknown> {
  const price =
    patch.price ??
    Number(typeof existing.price === "object" ? existing.price.toString() : existing.price);
  const freightValue =
    patch.freightValue !== undefined
      ? patch.freightValue
      : existing.freightValue != null
        ? Number(existing.freightValue)
        : null;
  const taxValue =
    patch.taxValue !== undefined
      ? patch.taxValue
      : existing.taxValue != null
        ? Number(existing.taxValue)
        : null;

  const data: Record<string, unknown> = { ...patch };
  delete data.reason;

  if (patch.price != null || patch.freightValue !== undefined || patch.taxValue !== undefined) {
    data.netPrice = calculateMaterialMarketQuoteNetPrice({
      price,
      freightValue,
      taxValue,
    });
  }

  return data;
}
