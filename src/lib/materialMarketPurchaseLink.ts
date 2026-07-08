/**
 * Vínculo cotação de mercado → compra real (manual).
 *
 * Não há módulo PurchaseOrder formal: purchaseOrderId é opcional e sem FK.
 * Moeda de cálculo: BRL (mesma base de netPriceBrl da cotação).
 *
 * Fórmula:
 *   estimatedSavings = (referenceUnitPriceBrl - negotiatedPrice) × quantityPurchased
 *
 * referenceUnitPriceBrl (ordem):
 *   1. netPriceBrl da cotação vinculada
 *   2. netPrice da cotação quando currency = BRL
 *   3. Material.currentCost
 */

export const MATERIAL_MARKET_PURCHASE_LINK_CURRENCY = "BRL";

export const MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA =
  "estimatedSavings = (referenceUnitPriceBrl - negotiatedPrice) × quantityPurchased";

export type MaterialMarketPurchaseLinkQuoteInput = {
  id: string;
  materialId: string;
  currency?: string | null;
  price?: number | string | null | { toString(): string };
  netPrice?: number | string | null | { toString(): string };
  priceBrl?: number | string | null | { toString(): string };
  netPriceBrl?: number | string | null | { toString(): string };
  supplierName?: string | null;
  isOfficialReference?: boolean;
};

export type MaterialMarketPurchaseLinkInput = {
  quoteId?: unknown;
  purchaseOrderId?: unknown;
  purchaseOrderNumber?: unknown;
  supplierName?: unknown;
  quantityPurchased?: unknown;
  negotiatedPrice?: unknown;
  purchaseDate?: unknown;
  choiceReason?: unknown;
};

export type MaterialMarketPurchaseLinkPersistFields = {
  quoteId: string;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  supplierName: string;
  quantityPurchased: number;
  negotiatedPrice: number;
  purchaseDate: Date;
  choiceReason: string | null;
};

export type MaterialMarketPurchaseLinkApiItem = {
  id: string;
  materialId: string;
  quoteId: string;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  supplierName: string;
  quantityPurchased: number;
  negotiatedPrice: number;
  purchaseDate: string;
  choiceReason: string | null;
  estimatedSavings: number;
  referenceUnitPriceBrl: number;
  currency: string;
  createdBy: string | null;
  createdAt: string;
  unitSavings: number;
  hasSavings: boolean;
};

export type MaterialMarketPurchaseLinkParseResult =
  | { ok: true; value: MaterialMarketPurchaseLinkPersistFields }
  | { ok: false; field: string; message: string };

export type MaterialMarketPurchaseSavingsResult = {
  referenceUnitPriceBrl: number;
  referenceSource: "quoteNetPriceBrl" | "quoteNetPrice" | "currentCost" | "officialQuote";
  negotiatedPrice: number;
  quantityPurchased: number;
  unitSavings: number;
  estimatedSavings: number;
  hasSavings: boolean;
  currency: string;
  formula: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toNumber(value: number | string | null | undefined | { toString(): string }): number {
  if (value == null) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function toOptionalNumber(
  value: number | string | null | undefined | { toString(): string }
): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function parseOptionalUuid(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    return null;
  }
  return trimmed;
}

function parseRequiredDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const d = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function resolveMaterialMarketPurchaseReferencePriceBrl(input: {
  quote: MaterialMarketPurchaseLinkQuoteInput;
  currentCost?: number | string | null | { toString(): string };
  officialQuote?: MaterialMarketPurchaseLinkQuoteInput | null;
}): { price: number; source: MaterialMarketPurchaseSavingsResult["referenceSource"] } | null {
  if (input.officialQuote) {
    const officialBrl = toOptionalNumber(input.officialQuote.netPriceBrl);
    if (officialBrl != null && officialBrl > 0) {
      return { price: roundMoney(officialBrl), source: "officialQuote" };
    }
    const officialCurrency = input.officialQuote.currency?.trim().toUpperCase() ?? "BRL";
    if (officialCurrency === "BRL") {
      const officialNet = toOptionalNumber(
        input.officialQuote.netPrice ?? input.officialQuote.price
      );
      if (officialNet != null && officialNet > 0) {
        return { price: roundMoney(officialNet), source: "officialQuote" };
      }
    }
  }

  const netBrl = toOptionalNumber(input.quote.netPriceBrl);
  if (netBrl != null && netBrl > 0) {
    return { price: roundMoney(netBrl), source: "quoteNetPriceBrl" };
  }

  const currency = input.quote.currency?.trim().toUpperCase() ?? "BRL";
  if (currency === "BRL") {
    const net = toOptionalNumber(input.quote.netPrice ?? input.quote.price);
    if (net != null && net > 0) {
      return { price: roundMoney(net), source: "quoteNetPrice" };
    }
  }

  const current = toOptionalNumber(input.currentCost);
  if (current != null && current > 0) {
    return { price: roundMoney(current), source: "currentCost" };
  }

  return null;
}

export function computeMaterialMarketPurchaseEstimatedSavings(input: {
  referenceUnitPriceBrl: number;
  negotiatedPrice: number;
  quantityPurchased: number;
}): MaterialMarketPurchaseSavingsResult {
  const referenceUnitPriceBrl = roundMoney(input.referenceUnitPriceBrl);
  const negotiatedPrice = roundMoney(input.negotiatedPrice);
  const quantityPurchased = roundMoney(input.quantityPurchased);
  const unitSavings = roundMoney(referenceUnitPriceBrl - negotiatedPrice);
  const estimatedSavings = roundMoney(unitSavings * quantityPurchased);

  return {
    referenceUnitPriceBrl,
    referenceSource: "quoteNetPriceBrl",
    negotiatedPrice,
    quantityPurchased,
    unitSavings,
    estimatedSavings,
    hasSavings: estimatedSavings > 0,
    currency: MATERIAL_MARKET_PURCHASE_LINK_CURRENCY,
    formula: MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA,
  };
}

export function computeMaterialMarketPurchaseSavingsFromContext(input: {
  quote: MaterialMarketPurchaseLinkQuoteInput;
  negotiatedPrice: number;
  quantityPurchased: number;
  currentCost?: number | string | null | { toString(): string };
  officialQuote?: MaterialMarketPurchaseLinkQuoteInput | null;
}):
  | { ok: true; value: MaterialMarketPurchaseSavingsResult }
  | { ok: false; message: string } {
  const reference = resolveMaterialMarketPurchaseReferencePriceBrl({
    quote: input.quote,
    currentCost: input.currentCost,
    officialQuote: input.officialQuote,
  });

  if (!reference) {
    return {
      ok: false,
      message: "Preço de referência em BRL indisponível para calcular a economia.",
    };
  }

  const savings = computeMaterialMarketPurchaseEstimatedSavings({
    referenceUnitPriceBrl: reference.price,
    negotiatedPrice: input.negotiatedPrice,
    quantityPurchased: input.quantityPurchased,
  });

  return {
    ok: true,
    value: {
      ...savings,
      referenceSource: reference.source,
    },
  };
}

export function parseMaterialMarketPurchaseLinkInput(
  body: MaterialMarketPurchaseLinkInput
): MaterialMarketPurchaseLinkParseResult {
  const quoteId = parseOptionalUuid(body.quoteId);
  if (!quoteId) {
    return { ok: false, field: "quoteId", message: "Cotação é obrigatória." };
  }

  let purchaseOrderId: string | null = null;
  if (body.purchaseOrderId != null && String(body.purchaseOrderId).trim()) {
    purchaseOrderId = parseOptionalUuid(body.purchaseOrderId);
    if (!purchaseOrderId) {
      return {
        ok: false,
        field: "purchaseOrderId",
        message: "ID do pedido de compra inválido (UUID opcional, sem vínculo formal).",
      };
    }
  }

  const purchaseOrderNumber =
    typeof body.purchaseOrderNumber === "string" && body.purchaseOrderNumber.trim()
      ? body.purchaseOrderNumber.trim().slice(0, 120)
      : null;

  const supplierName =
    typeof body.supplierName === "string" ? body.supplierName.trim() : "";
  if (!supplierName) {
    return { ok: false, field: "supplierName", message: "Fornecedor da compra é obrigatório." };
  }

  const quantityPurchased = toNumber(body.quantityPurchased as never);
  if (!Number.isFinite(quantityPurchased) || quantityPurchased <= 0) {
    return {
      ok: false,
      field: "quantityPurchased",
      message: "Quantidade comprada deve ser um número maior que zero.",
    };
  }

  const negotiatedPrice = toNumber(body.negotiatedPrice as never);
  if (!Number.isFinite(negotiatedPrice) || negotiatedPrice < 0) {
    return {
      ok: false,
      field: "negotiatedPrice",
      message: "Preço negociado em BRL é obrigatório e não pode ser negativo.",
    };
  }

  const purchaseDate = parseRequiredDate(body.purchaseDate);
  if (!purchaseDate) {
    return {
      ok: false,
      field: "purchaseDate",
      message: "Data da compra inválida (use AAAA-MM-DD).",
    };
  }

  const choiceReason =
    typeof body.choiceReason === "string" && body.choiceReason.trim()
      ? body.choiceReason.trim().slice(0, 2000)
      : null;

  return {
    ok: true,
    value: {
      quoteId,
      purchaseOrderId,
      purchaseOrderNumber,
      supplierName: supplierName.slice(0, 200),
      quantityPurchased: roundMoney(quantityPurchased),
      negotiatedPrice: roundMoney(negotiatedPrice),
      purchaseDate,
      choiceReason,
    },
  };
}

export function serializeMaterialMarketPurchaseLinkForApi(row: {
  id: string;
  materialId: string;
  quoteId: string;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  supplierName: string;
  quantityPurchased: number | string | { toString(): string };
  negotiatedPrice: number | string | { toString(): string };
  purchaseDate: Date | string;
  choiceReason?: string | null;
  estimatedSavings: number | string | { toString(): string };
  referenceUnitPriceBrl: number | string | { toString(): string };
  currency?: string | null;
  createdBy?: string | null;
  createdAt: Date | string;
}): MaterialMarketPurchaseLinkApiItem {
  const quantityPurchased = roundMoney(toNumber(row.quantityPurchased));
  const negotiatedPrice = roundMoney(toNumber(row.negotiatedPrice));
  const referenceUnitPriceBrl = roundMoney(toNumber(row.referenceUnitPriceBrl));
  const estimatedSavings = roundMoney(toNumber(row.estimatedSavings));
  const unitSavings = roundMoney(referenceUnitPriceBrl - negotiatedPrice);

  return {
    id: row.id,
    materialId: row.materialId,
    quoteId: row.quoteId,
    purchaseOrderId: row.purchaseOrderId ?? null,
    purchaseOrderNumber: row.purchaseOrderNumber ?? null,
    supplierName: row.supplierName,
    quantityPurchased,
    negotiatedPrice,
    purchaseDate: toIsoDateOnly(row.purchaseDate),
    choiceReason: row.choiceReason ?? null,
    estimatedSavings,
    referenceUnitPriceBrl,
    currency: row.currency?.trim() || MATERIAL_MARKET_PURCHASE_LINK_CURRENCY,
    createdBy: row.createdBy ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    unitSavings,
    hasSavings: estimatedSavings > 0,
  };
}

export function buildMaterialMarketPurchaseLinkListResponse(
  rows: Parameters<typeof serializeMaterialMarketPurchaseLinkForApi>[0][]
): { items: MaterialMarketPurchaseLinkApiItem[]; total: number } {
  const items = rows.map(serializeMaterialMarketPurchaseLinkForApi);
  return { items, total: items.length };
}

export function buildPurchaseLinkTimelineEvent(link: MaterialMarketPurchaseLinkApiItem): {
  id: string;
  type: "PURCHASE_LINKED";
  occurredAt: string;
  purchaseDate: string;
  title: string;
  description: string;
  estimatedSavings: number;
  hasSavings: boolean;
  supplierName: string;
  quoteId: string;
  purchaseOrderNumber: string | null;
} {
  const po = link.purchaseOrderNumber ? ` · PC ${link.purchaseOrderNumber}` : "";
  return {
    id: link.id,
    type: "PURCHASE_LINKED",
    occurredAt: link.createdAt,
    purchaseDate: link.purchaseDate,
    title: "Compra vinculada",
    description: `${link.supplierName}${po} — qty ${link.quantityPurchased} a ${link.negotiatedPrice} BRL`,
    estimatedSavings: link.estimatedSavings,
    hasSavings: link.hasSavings,
    supplierName: link.supplierName,
    quoteId: link.quoteId,
    purchaseOrderNumber: link.purchaseOrderNumber,
  };
}

export function buildMaterialMarketPurchaseTimeline(links: MaterialMarketPurchaseLinkApiItem[]): {
  items: ReturnType<typeof buildPurchaseLinkTimelineEvent>[];
  totalEstimatedSavings: number;
} {
  const items = [...links]
    .sort((a, b) => {
      const byDate = b.purchaseDate.localeCompare(a.purchaseDate);
      if (byDate !== 0) return byDate;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .map(buildPurchaseLinkTimelineEvent);

  const totalEstimatedSavings = roundMoney(
    items.reduce((sum, item) => sum + (item.hasSavings ? item.estimatedSavings : 0), 0)
  );

  return { items, totalEstimatedSavings };
}
