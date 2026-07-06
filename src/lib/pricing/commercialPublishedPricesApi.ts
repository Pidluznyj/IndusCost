import type {
  CommercialPublishedPriceGridQuery,
  CommercialPublishedPriceGridSnapshot,
  CommercialPublishedPriceGridSort,
} from "./commercialPublishedPrices.server.js";

export const NO_PUBLISHED_COMMERCIAL_PRICE_TABLES_MESSAGE =
  "Nenhuma tabela comercial publicada vigente encontrada.";

export type CommercialPublishedPricesApiResponse = CommercialPublishedPriceGridSnapshot & {
  message: string | null;
};

const SORT_VALUES: CommercialPublishedPriceGridSort[] = [
  "SKU_ASC",
  "SKU_DESC",
  "NAME_ASC",
  "NAME_DESC",
  "LAST_PUBLISHED_DESC",
];

function readQueryString(query: Record<string, unknown>, key: string): string | undefined {
  const raw = query[key];
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseSort(raw: string | undefined): CommercialPublishedPriceGridSort {
  if (!raw) return "SKU_ASC";
  const normalized = raw.trim().toUpperCase();
  if ((SORT_VALUES as string[]).includes(normalized)) {
    return normalized as CommercialPublishedPriceGridSort;
  }
  if (normalized === "MARGIN_DESC" || normalized === "MARGIN_ASC") {
    return "SKU_ASC";
  }
  return "SKU_ASC";
}

export function parseCommercialPublishedPricesQuery(
  query: Record<string, unknown>
): CommercialPublishedPriceGridQuery {
  const page = parsePositiveInt(query.page, 1);
  const pageSize = parsePositiveInt(query.pageSize ?? query.limit, 50);

  return {
    search: readQueryString(query, "search") ?? null,
    taxRuleId: readQueryString(query, "taxRuleId") ?? null,
    marginRuleId: readQueryString(query, "marginRuleId") ?? null,
    commissionRuleId: readQueryString(query, "commissionRuleId") ?? null,
    tableId: readQueryString(query, "tableId") ?? null,
    page,
    limit: pageSize,
    sort: parseSort(readQueryString(query, "sort")),
  };
}

export function buildCommercialPublishedPricesApiResponse(
  snapshot: CommercialPublishedPriceGridSnapshot
): CommercialPublishedPricesApiResponse {
  return {
    ...snapshot,
    message:
      snapshot.tables.length === 0 ? NO_PUBLISHED_COMMERCIAL_PRICE_TABLES_MESSAGE : null,
  };
}
