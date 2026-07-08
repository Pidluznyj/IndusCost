/**
 * Cotações manuais de mercado — Inteligência de Mercado (Suprimentos).
 * Cada registro é append-only; nunca sobrescreve histórico anterior.
 */

import {
  MATERIAL_MARKET_QUOTE_EXCHANGE_ORIGIN_LABELS,
  type MaterialMarketQuoteExchangeOrigin,
  type MaterialMarketQuotePtaxStatus,
} from "./materialMarketQuoteExchange.js";
import {
  MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_LABELS,
  parseMaterialMarketQuoteOfficialStatus,
  type MaterialMarketQuoteOfficialStatus,
} from "./materialMarketQuoteGovernance.js";
import {
  MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS,
  parseMaterialMarketQuoteReliabilityLevel,
  type MaterialMarketQuoteReliabilityLevel,
} from "./materialMarketQuoteReliability.js";

export {
  MATERIAL_MARKET_QUOTE_MANUAL_EXCHANGE_PERMISSION,
  canManualMaterialMarketQuoteExchange,
} from "./materialMarketQuoteExchange.js";

export {
  MATERIAL_MARKET_QUOTE_APPROVE_PERMISSION,
  MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_LABELS,
  canApproveMaterialMarketQuote,
  canShowApproveRejectActions,
  canShowSetOfficialAction,
  canShowSubmitForApprovalAction,
  isCriticalMaterialForQuoteApproval,
  parseMaterialMarketQuoteOfficialStatus,
  type MaterialMarketQuoteOfficialStatus,
} from "./materialMarketQuoteGovernance.js";

export const MATERIAL_MARKET_QUOTE_STATUS_VALUES = [
  "DRAFT",
  "ACTIVE",
  "EXPIRED",
  "CANCELLED",
] as const;

export type MaterialMarketQuoteStatus = (typeof MATERIAL_MARKET_QUOTE_STATUS_VALUES)[number];

export const DEFAULT_MATERIAL_MARKET_QUOTE_CURRENCY = "BRL";

export const MATERIAL_MARKET_QUOTE_STATUS_LABELS: Record<MaterialMarketQuoteStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
};

export type MaterialMarketQuoteInput = {
  supplierId?: unknown;
  supplierName?: unknown;
  quoteDate?: unknown;
  price?: unknown;
  currency?: unknown;
  unit?: unknown;
  origin?: unknown;
  manufacturer?: unknown;
  freightValue?: unknown;
  taxValue?: unknown;
  paymentTerms?: unknown;
  proposalValidityDate?: unknown;
  notes?: unknown;
  status?: unknown;
  manualExchangeRate?: unknown;
  manualExchangeJustification?: unknown;
  forceManualExchange?: unknown;
};

export type MaterialMarketQuotePersistFields = {
  supplierId: string | null;
  supplierName: string | null;
  quoteDate: Date;
  price: number;
  currency: string;
  unit: string;
  origin: string | null;
  manufacturer: string | null;
  freightValue: number | null;
  taxValue: number | null;
  netPrice: number;
  paymentTerms: string | null;
  proposalValidityDate: Date | null;
  notes: string | null;
  status: MaterialMarketQuoteStatus;
};

export type MaterialMarketQuoteApiItem = {
  id: string;
  materialId: string;
  supplierId: string | null;
  supplierName: string | null;
  quoteDate: string;
  price: number;
  currency: string;
  /** Alias estável: moeda original informada na cotação. */
  originalCurrency: string;
  /** Alias estável: preço base na moeda original. */
  originalPrice: number;
  unit: string;
  origin: string | null;
  manufacturer: string | null;
  freightValue: number | null;
  taxValue: number | null;
  netPrice: number;
  paymentTerms: string | null;
  proposalValidityDate: string | null;
  notes: string | null;
  status: MaterialMarketQuoteStatus;
  statusLabel: string;
  exchangeOrigin: MaterialMarketQuoteExchangeOrigin | null;
  exchangeOriginLabel: string | null;
  ptaxVenda: number | null;
  /** Alias: taxa usada na conversão (PTAX venda ou manual); null para BRL. */
  exchangeRateUsed: number | null;
  ptaxReferenceDate: string | null;
  ptaxFetchStatus: MaterialMarketQuotePtaxStatus | null;
  ptaxFetchFailureReason: string | null;
  priceBrl: number | null;
  /** Alias: preço base convertido para BRL (congelado no save). */
  convertedPriceBRL: number | null;
  netPriceBrl: number | null;
  manualExchangeJustification: string | null;
  manualExchangeBy: string | null;
  manualExchangeAt: string | null;
  isManualExchange: boolean;
  isOfficialReference: boolean;
  officialStatus: MaterialMarketQuoteOfficialStatus;
  officialStatusLabel: string;
  rejectionReason: string | null;
  submittedForApprovalBy: string | null;
  submittedForApprovalAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  setOfficialBy: string | null;
  setOfficialAt: string | null;
  setOfficialByName: string | null;
  reliabilityLevel: MaterialMarketQuoteReliabilityLevel;
  reliabilityLevelLabel: string;
  reliabilitySuggestedLevel: MaterialMarketQuoteReliabilityLevel | null;
  reliabilitySuggestedLabel: string | null;
  reliabilityOverrideReason: string | null;
  suggestedReliabilityLevel: MaterialMarketQuoteReliabilityLevel | null;
  suggestedReliabilityLabel: string | null;
  attachmentCount: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialMarketQuoteSourceRow = {
  id: string;
  materialId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  quoteDate: Date | string;
  price: number | string | { toString(): string };
  currency: string;
  unit: string;
  origin?: string | null;
  manufacturer?: string | null;
  freightValue?: number | string | null | { toString(): string };
  taxValue?: number | string | null | { toString(): string };
  netPrice: number | string | { toString(): string };
  paymentTerms?: string | null;
  proposalValidityDate?: Date | string | null;
  notes?: string | null;
  status: string;
  exchangeOrigin?: string | null;
  ptaxVenda?: number | string | null | { toString(): string };
  ptaxReferenceDate?: Date | string | null;
  ptaxFetchStatus?: string | null;
  ptaxFetchFailureReason?: string | null;
  priceBrl?: number | string | null | { toString(): string };
  netPriceBrl?: number | string | null | { toString(): string };
  manualExchangeJustification?: string | null;
  manualExchangeBy?: string | null;
  manualExchangeAt?: Date | string | null;
  isOfficialReference?: boolean;
  officialStatus?: string | null;
  rejectionReason?: string | null;
  submittedForApprovalBy?: string | null;
  submittedForApprovalAt?: Date | string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  setOfficialBy?: string | null;
  setOfficialAt?: Date | string | null;
  suggestedReliabilityLevel?: string | null;
  _count?: { Attachments?: number };
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** Preço líquido = preço base + frete + impostos (quando informados). */
export function calculateMaterialMarketQuoteNetPrice(input: {
  price: number;
  freightValue?: number | null;
  taxValue?: number | null;
}): number {
  const freight = input.freightValue ?? 0;
  const tax = input.taxValue ?? 0;
  return roundMarketQuoteMoney(input.price + freight + tax);
}

function roundMarketQuoteMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseOptionalDecimal(value: unknown, field: string):
  | { ok: true; value: number | null }
  | { ok: false; field: string; message: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, field, message: `${field} deve ser um número não negativo.` };
  }
  return { ok: true, value: roundMarketQuoteMoney(n) };
}

function parseRequiredDecimal(value: unknown, field: string):
  | { ok: true; value: number }
  | { ok: false; field: string; message: string } {
  if (value == null || value === "") {
    return { ok: false, field, message: `${field} é obrigatório.` };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, field, message: `${field} deve ser um número não negativo.` };
  }
  return { ok: true, value: roundMarketQuoteMoney(n) };
}

function parseOptionalDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseRequiredDate(value: unknown, field: string):
  | { ok: true; value: Date }
  | { ok: false; field: string; message: string } {
  const d = parseOptionalDate(value);
  if (!d) {
    return { ok: false, field, message: `${field} é obrigatória e deve ser uma data válida.` };
  }
  return { ok: true, value: d };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeUuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function isMaterialMarketQuoteStatus(value: unknown): value is MaterialMarketQuoteStatus {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_QUOTE_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketQuoteInput(
  input: MaterialMarketQuoteInput,
  defaults?: { unit?: string }
):
  | { ok: true; value: MaterialMarketQuotePersistFields }
  | { ok: false; message: string; field?: string } {
  const quoteDateParsed = parseRequiredDate(input.quoteDate, "quoteDate");
  if (quoteDateParsed.ok === false) {
    return { ok: false, field: quoteDateParsed.field, message: quoteDateParsed.message };
  }

  const priceParsed = parseRequiredDecimal(input.price, "price");
  if (priceParsed.ok === false) {
    return { ok: false, field: priceParsed.field, message: priceParsed.message };
  }

  const freightParsed = parseOptionalDecimal(input.freightValue, "freightValue");
  if (freightParsed.ok === false) {
    return { ok: false, field: freightParsed.field, message: freightParsed.message };
  }

  const taxParsed = parseOptionalDecimal(input.taxValue, "taxValue");
  if (taxParsed.ok === false) {
    return { ok: false, field: taxParsed.field, message: taxParsed.message };
  }

  const unit = normalizeOptionalString(input.unit) ?? defaults?.unit?.trim() ?? "";
  if (!unit) {
    return { ok: false, field: "unit", message: "Unidade é obrigatória." };
  }

  const supplierId = normalizeUuidOrNull(input.supplierId);
  const supplierName = normalizeOptionalString(input.supplierName);
  if (!supplierId && !supplierName) {
    return {
      ok: false,
      field: "supplierName",
      message: "Informe o fornecedor (nome ou ID).",
    };
  }

  const currency =
    normalizeOptionalString(input.currency)?.toUpperCase() ??
    DEFAULT_MATERIAL_MARKET_QUOTE_CURRENCY;

  const statusRaw = input.status;
  const status = isMaterialMarketQuoteStatus(statusRaw) ? statusRaw : "ACTIVE";

  const netPrice = calculateMaterialMarketQuoteNetPrice({
    price: priceParsed.value,
    freightValue: freightParsed.value,
    taxValue: taxParsed.value,
  });

  return {
    ok: true,
    value: {
      supplierId,
      supplierName,
      quoteDate: quoteDateParsed.value,
      price: priceParsed.value,
      currency,
      unit,
      origin: normalizeOptionalString(input.origin),
      manufacturer: normalizeOptionalString(input.manufacturer),
      freightValue: freightParsed.value,
      taxValue: taxParsed.value,
      netPrice,
      paymentTerms: normalizeOptionalString(input.paymentTerms),
      proposalValidityDate: parseOptionalDate(input.proposalValidityDate),
      notes: normalizeOptionalString(input.notes),
      status,
    },
  };
}

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toNumber(value: number | string | { toString(): string }): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toOptionalNumber(
  value: number | string | null | undefined | { toString(): string }
): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseExchangeOrigin(value: unknown): MaterialMarketQuoteExchangeOrigin | null {
  if (value === "BCB_PTAX" || value === "MANUAL") return value;
  return null;
}

function parsePtaxStatus(value: unknown): MaterialMarketQuotePtaxStatus | null {
  if (value === "SUCCESS" || value === "FAILED" || value === "SKIPPED") return value;
  return null;
}

function parseReliabilityLevel(value: unknown): MaterialMarketQuoteReliabilityLevel | null {
  return parseMaterialMarketQuoteReliabilityLevel(value);
}

export function serializeMaterialMarketQuoteForApi(
  row: MaterialMarketQuoteSourceRow,
  options?: {
    userNamesById?: Map<string, string>;
  }
): MaterialMarketQuoteApiItem {
  const status = isMaterialMarketQuoteStatus(row.status) ? row.status : "ACTIVE";
  const exchangeOrigin = parseExchangeOrigin(row.exchangeOrigin);
  const officialStatus = parseMaterialMarketQuoteOfficialStatus(row.officialStatus);
  const userNames = options?.userNamesById;
  const approvedByName =
    row.approvedBy && userNames?.get(row.approvedBy) ? userNames.get(row.approvedBy)! : null;
  const setOfficialByName =
    row.setOfficialBy && userNames?.get(row.setOfficialBy)
      ? userNames.get(row.setOfficialBy)!
      : null;
  const price = toNumber(row.price);
  const currency = row.currency;
  const ptaxVenda = toOptionalNumber(row.ptaxVenda);
  const priceBrl = toOptionalNumber(row.priceBrl);
  const suggestedReliabilityLevel = parseReliabilityLevel(row.suggestedReliabilityLevel);
  const appliedLevel = suggestedReliabilityLevel ?? "MANUAL";
  return {
    id: row.id,
    materialId: row.materialId,
    supplierId: row.supplierId ?? null,
    supplierName: row.supplierName?.trim() || null,
    quoteDate: toIsoDateOnly(row.quoteDate),
    price,
    currency,
    originalCurrency: currency,
    originalPrice: price,
    unit: row.unit,
    origin: row.origin?.trim() || null,
    manufacturer: row.manufacturer?.trim() || null,
    freightValue: row.freightValue != null ? toNumber(row.freightValue) : null,
    taxValue: row.taxValue != null ? toNumber(row.taxValue) : null,
    netPrice: toNumber(row.netPrice),
    paymentTerms: row.paymentTerms?.trim() || null,
    proposalValidityDate: row.proposalValidityDate
      ? toIsoDateOnly(row.proposalValidityDate)
      : null,
    notes: row.notes?.trim() || null,
    status,
    statusLabel: MATERIAL_MARKET_QUOTE_STATUS_LABELS[status],
    exchangeOrigin,
    exchangeOriginLabel: exchangeOrigin
      ? MATERIAL_MARKET_QUOTE_EXCHANGE_ORIGIN_LABELS[exchangeOrigin]
      : null,
    ptaxVenda,
    exchangeRateUsed: ptaxVenda,
    ptaxReferenceDate: row.ptaxReferenceDate ? toIsoDateOnly(row.ptaxReferenceDate) : null,
    ptaxFetchStatus: parsePtaxStatus(row.ptaxFetchStatus),
    ptaxFetchFailureReason: row.ptaxFetchFailureReason?.trim() || null,
    priceBrl,
    convertedPriceBRL: priceBrl,
    netPriceBrl: toOptionalNumber(row.netPriceBrl),
    manualExchangeJustification: row.manualExchangeJustification?.trim() || null,
    manualExchangeBy: row.manualExchangeBy ?? null,
    manualExchangeAt: row.manualExchangeAt
      ? new Date(row.manualExchangeAt).toISOString()
      : null,
    isManualExchange: exchangeOrigin === "MANUAL",
    isOfficialReference: row.isOfficialReference === true,
    officialStatus,
    officialStatusLabel: MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_LABELS[officialStatus],
    rejectionReason: row.rejectionReason?.trim() || null,
    submittedForApprovalBy: row.submittedForApprovalBy ?? null,
    submittedForApprovalAt: row.submittedForApprovalAt
      ? new Date(row.submittedForApprovalAt).toISOString()
      : null,
    approvedBy: row.approvedBy ?? null,
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : null,
    approvedByName,
    setOfficialBy: row.setOfficialBy ?? null,
    setOfficialAt: row.setOfficialAt ? new Date(row.setOfficialAt).toISOString() : null,
    setOfficialByName,
    reliabilityLevel: appliedLevel,
    reliabilityLevelLabel: MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[appliedLevel],
    reliabilitySuggestedLevel: suggestedReliabilityLevel,
    reliabilitySuggestedLabel: suggestedReliabilityLevel
      ? MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[suggestedReliabilityLevel]
      : null,
    reliabilityOverrideReason: null,
    suggestedReliabilityLevel,
    suggestedReliabilityLabel: suggestedReliabilityLevel
      ? MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[suggestedReliabilityLevel]
      : null,
    attachmentCount: row._count?.Attachments ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Ordenação cronológica decrescente (mais recente primeiro). */
export function sortMaterialMarketQuotesChronologically<T extends { quoteDate: string | Date; createdAt: string | Date }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const dateA = new Date(a.quoteDate).getTime();
    const dateB = new Date(b.quoteDate).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function buildMaterialMarketQuoteListResponse(
  rows: MaterialMarketQuoteSourceRow[],
  options?: {
    userNamesById?: Map<string, string>;
  }
): { items: MaterialMarketQuoteApiItem[]; total: number } {
  const sorted = sortMaterialMarketQuotesChronologically(rows);
  const items = sorted.map((row) =>
    serializeMaterialMarketQuoteForApi(row, { userNamesById: options?.userNamesById })
  );
  return { items, total: items.length };
}

export function collectMaterialMarketQuoteUserIds(
  rows: MaterialMarketQuoteSourceRow[]
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.approvedBy) ids.add(row.approvedBy);
    if (row.setOfficialBy) ids.add(row.setOfficialBy);
    if (row.submittedForApprovalBy) ids.add(row.submittedForApprovalBy);
  }
  return [...ids];
}
