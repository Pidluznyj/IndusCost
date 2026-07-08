/**
 * Cotação oficial de matéria-prima — seleção única + auditoria.
 */

import { computeMaterialQuotePriceBRL } from "./materialMarketPriceHistory.js";

export type MaterialOfficialQuoteRow = {
  id: string;
  materialId: string;
  isOfficialReference?: boolean | null;
  supplierName?: string | null;
  quoteDate?: Date | string | null;
  currency?: string | null;
  netPrice?: number | string | null | { toString(): string };
  netPriceBrl?: number | string | null | { toString(): string };
  ptaxVenda?: number | string | null | { toString(): string };
  price?: number | string | null | { toString(): string };
};

export type MaterialOfficialQuotePlan = {
  materialId: string;
  previousQuoteId: string | null;
  newQuoteId: string;
};

export type MaterialOfficialQuoteSummary = {
  id: string;
  materialId: string;
  supplierName: string | null;
  quoteDate: string | null;
  priceBrl: number | null;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
  }
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

export function countMaterialOfficialQuotes(
  quotes: Array<{ isOfficialReference?: boolean | null }>
): number {
  return quotes.filter((q) => q.isOfficialReference === true).length;
}

export function resolveMaterialOfficialQuoteRow<T extends MaterialOfficialQuoteRow>(
  quotes: T[]
): T | null {
  return quotes.find((q) => q.isOfficialReference === true) ?? null;
}

export function planSetMaterialOfficialQuote(input: {
  materialId: string;
  quoteId: string;
  quotes: MaterialOfficialQuoteRow[];
}):
  | { ok: true; plan: MaterialOfficialQuotePlan }
  | { ok: false; code: "QUOTE_NOT_FOUND"; message: string } {
  const quote = input.quotes.find(
    (q) => q.id === input.quoteId && q.materialId === input.materialId
  );
  if (!quote) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  const previous = resolveMaterialOfficialQuoteRow(input.quotes);

  return {
    ok: true,
    plan: {
      materialId: input.materialId,
      previousQuoteId: previous && previous.id !== quote.id ? previous.id : previous?.id ?? null,
      newQuoteId: quote.id,
    },
  };
}

export function resolveMaterialOfficialQuotePriceBrl(row: {
  currency?: string | null;
  netPrice?: number | string | null | { toString(): string };
  netPriceBrl?: number | string | null | { toString(): string };
  ptaxVenda?: number | string | null | { toString(): string };
  price?: number | string | null | { toString(): string };
}): number | null {
  const netBrl = toNumber(row.netPriceBrl);
  if (netBrl != null) return netBrl;

  const currency = (row.currency ?? "BRL").toUpperCase();
  const net = toNumber(row.netPrice) ?? toNumber(row.price);
  if (net == null) return null;
  if (currency === "BRL") return net;

  return computeMaterialQuotePriceBRL({
    currency,
    netPrice: net,
    netPriceBrl: row.netPriceBrl,
    ptaxVenda: row.ptaxVenda,
  });
}

export function buildMaterialOfficialQuoteSummary(
  row: MaterialOfficialQuoteRow | null | undefined
): MaterialOfficialQuoteSummary | null {
  if (!row || row.isOfficialReference !== true) return null;
  return {
    id: row.id,
    materialId: row.materialId,
    supplierName: row.supplierName?.trim() || null,
    quoteDate: toIsoDateOnly(row.quoteDate ?? null),
    priceBrl: resolveMaterialOfficialQuotePriceBrl(row),
  };
}

export function buildMaterialOfficialQuoteAuditRecord(input: {
  materialId: string;
  previousQuoteId: string | null;
  newQuoteId: string;
  changedBy: string | null;
  changedAt: Date | string;
  action?: string;
  reason?: string | null;
}) {
  return {
    materialId: input.materialId,
    action: input.action ?? "SET_OFFICIAL",
    previousQuoteId: input.previousQuoteId,
    newQuoteId: input.newQuoteId,
    changedBy: input.changedBy,
    changedAt:
      typeof input.changedAt === "string" ? input.changedAt : input.changedAt.toISOString(),
    reason: input.reason?.trim() || null,
  };
}
