/**
 * Atualização parcial de cotações de mercado — com detecção de alterações para auditoria.
 */

import {
  calculateMaterialMarketQuoteNetPrice,
  isMaterialMarketQuoteStatus,
  parseMaterialMarketQuoteInput,
  type MaterialMarketQuoteInput,
  type MaterialMarketQuotePersistFields,
} from "./materialMarketQuote.js";
import { parseMaterialMarketQuoteOfficialStatus } from "./materialMarketQuoteGovernance.js";

export type MaterialMarketQuotePatchInput = MaterialMarketQuoteInput & {
  reason?: unknown;
};

export type MaterialMarketQuotePatchFields = Partial<MaterialMarketQuotePersistFields> & {
  reason?: string | null;
};

export type MaterialMarketQuoteMutationGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string; httpStatus: 409 };

function toIsoDateInput(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function guardMaterialMarketQuoteEdit(input: {
  status: string;
  isOfficialReference: boolean;
  officialStatus: string | null | undefined;
}): MaterialMarketQuoteMutationGuardResult {
  if (input.status === "CANCELLED") {
    return {
      ok: false,
      code: "QUOTE_CANCELLED",
      message: "Esta cotação já foi removida.",
      httpStatus: 409,
    };
  }
  const officialStatus = parseMaterialMarketQuoteOfficialStatus(input.officialStatus);
  if (input.isOfficialReference || officialStatus === "OFFICIAL") {
    return {
      ok: false,
      code: "QUOTE_OFFICIAL_LOCKED",
      message:
        "Cotações oficiais não podem ser editadas por esta ação. Use o fluxo de governança.",
      httpStatus: 409,
    };
  }
  return { ok: true };
}

export function guardMaterialMarketQuoteDelete(input: {
  status: string;
  isOfficialReference: boolean;
  officialStatus: string | null | undefined;
  purchaseLinkCount: number;
}): MaterialMarketQuoteMutationGuardResult {
  const editGuard = guardMaterialMarketQuoteEdit(input);
  if (editGuard.ok === false) return editGuard;
  if (input.purchaseLinkCount > 0) {
    return {
      ok: false,
      code: "QUOTE_HAS_PURCHASE_LINK",
      message: "Cotação vinculada a uma compra real não pode ser excluída.",
      httpStatus: 409,
    };
  }
  return { ok: true };
}

export function mergeMaterialMarketQuoteEditBody(
  existing: {
    supplierId: string | null;
    supplierName: string | null;
    quoteDate: Date | string;
    price: number | string | { toString(): string };
    currency: string;
    unit: string;
    origin: string | null;
    manufacturer: string | null;
    freightValue: number | string | null | { toString(): string };
    taxValue: number | string | null | { toString(): string };
    paymentTerms: string | null;
    proposalValidityDate: Date | string | null;
    notes: string | null;
    status: string;
  },
  body: MaterialMarketQuoteInput,
  defaults?: { unit?: string }
):
  | { ok: true; value: MaterialMarketQuotePersistFields }
  | { ok: false; message: string; field?: string } {
  const mergedInput: MaterialMarketQuoteInput = {
    supplierId: body.supplierId !== undefined ? body.supplierId : existing.supplierId,
    supplierName:
      body.supplierName !== undefined ? body.supplierName : existing.supplierName ?? "",
    quoteDate:
      body.quoteDate !== undefined ? body.quoteDate : toIsoDateInput(existing.quoteDate),
    price: body.price !== undefined ? body.price : Number(existing.price),
    currency: body.currency !== undefined ? body.currency : existing.currency,
    unit: body.unit !== undefined ? body.unit : existing.unit,
    origin: body.origin !== undefined ? body.origin : existing.origin,
    manufacturer: body.manufacturer !== undefined ? body.manufacturer : existing.manufacturer,
    freightValue:
      body.freightValue !== undefined ? body.freightValue : existing.freightValue,
    taxValue: body.taxValue !== undefined ? body.taxValue : existing.taxValue,
    paymentTerms:
      body.paymentTerms !== undefined ? body.paymentTerms : existing.paymentTerms,
    proposalValidityDate:
      body.proposalValidityDate !== undefined
        ? body.proposalValidityDate
        : existing.proposalValidityDate
          ? toIsoDateInput(existing.proposalValidityDate)
          : null,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    status: body.status !== undefined ? body.status : existing.status,
  };
  return parseMaterialMarketQuoteInput(mergedInput, defaults);
}

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

  data.netPrice = calculateMaterialMarketQuoteNetPrice({
    price,
    freightValue,
    taxValue,
  });

  return data;
}

export function shouldRecalculateMaterialMarketQuoteExchange(input: {
  body: MaterialMarketQuoteInput;
  existing: { currency: string; quoteDate: Date | string; price: number | string };
}): boolean {
  if (input.body.currency !== undefined) return true;
  if (input.body.quoteDate !== undefined) return true;
  if (input.body.price !== undefined) return true;
  if (input.body.freightValue !== undefined) return true;
  if (input.body.taxValue !== undefined) return true;
  if (input.body.manualExchangeRate !== undefined) return true;
  if (input.body.manualExchangeJustification !== undefined) return true;
  if (input.body.forceManualExchange !== undefined) return true;
  const currency = (input.body.currency ?? input.existing.currency).trim().toUpperCase();
  return currency === "USD";
}
