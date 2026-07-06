import type { PublishedPriceSourceTraceQuery } from "./publishedPriceSourceTrace.js";

export function parsePublishedPriceSourceTraceQuery(
  query: Record<string, unknown>
): PublishedPriceSourceTraceQuery {
  const read = (key: string): string | undefined => {
    const raw = query[key];
    if (raw == null) return undefined;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const text = String(value).trim();
    return text === "" ? undefined : text;
  };

  const priceItemId = read("priceItemId");
  if (!priceItemId) {
    throw new Error("Parâmetro priceItemId é obrigatório.");
  }

  return {
    priceItemId,
    tableId: read("tableId") ?? null,
    versionId: read("versionId") ?? null,
    productId: read("productId") ?? null,
  };
}

export function buildPublishedPriceSourceTraceUrl(input: PublishedPriceSourceTraceQuery): string {
  const params = new URLSearchParams();
  params.set("priceItemId", input.priceItemId);
  if (input.tableId) params.set("tableId", input.tableId);
  if (input.versionId) params.set("versionId", input.versionId);
  if (input.productId) params.set("productId", input.productId);
  return `/api/pricing/published-price-source-trace?${params.toString()}`;
}
