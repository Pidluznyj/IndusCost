import type { SoldProductCustomersActivityFilter, SoldProductCustomersQueryFilters, SoldProductCustomersSortBy, SoldProductCustomersSortDirection } from "./soldProductCustomersTypes.js";

export class SoldProductCustomersFilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoldProductCustomersFilterParseError";
  }
}

const SORT_BY_VALUES = new Set<SoldProductCustomersSortBy>([
  "customerName",
  "totalRevenue",
  "quantity",
  "lastPurchaseDate",
  "averageUnitPrice",
  "daysSinceLastPurchase",
]);

const ACTIVITY_VALUES = new Set<SoldProductCustomersActivityFilter>(["all", "active", "inactive"]);

function parseOptionalNumber(value: unknown, field: string, min = 0): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) {
    throw new SoldProductCustomersFilterParseError(`${field} inválido.`);
  }
  return n;
}

function parseBoolean(value: unknown): boolean {
  if (value === true || value === "true" || value === "1") return true;
  return false;
}

function parseTopN(value: unknown): number | null {
  if (value == null || value === "" || value === "all") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new SoldProductCustomersFilterParseError("topN inválido.");
  }
  return Math.floor(n);
}

export function parseSoldProductCustomersQueryFilters(
  query: Record<string, unknown>
): SoldProductCustomersQueryFilters {
  const sortByRaw = String(query.sortBy ?? "totalRevenue").trim() as SoldProductCustomersSortBy;
  const sortBy = SORT_BY_VALUES.has(sortByRaw) ? sortByRaw : "totalRevenue";

  const dirRaw = String(query.sortDirection ?? "desc").trim().toLowerCase();
  const sortDirection: SoldProductCustomersSortDirection = dirRaw === "asc" ? "asc" : "desc";

  const activityRaw = String(query.activityFilter ?? "all").trim() as SoldProductCustomersActivityFilter;
  const activityFilter = ACTIVITY_VALUES.has(activityRaw) ? activityRaw : "all";

  const state = typeof query.state === "string" && query.state.trim() ? query.state.trim() : undefined;
  const region = typeof query.region === "string" && query.region.trim() ? query.region.trim() : undefined;

  return {
    minQuantity: parseOptionalNumber(query.minQuantity, "minQuantity"),
    minRevenue: parseOptionalNumber(query.minRevenue, "minRevenue"),
    minDaysSinceLastPurchase: parseOptionalNumber(
      query.minDaysSinceLastPurchase,
      "minDaysSinceLastPurchase"
    ),
    maxDaysSinceLastPurchase: parseOptionalNumber(
      query.maxDaysSinceLastPurchase,
      "maxDaysSinceLastPurchase"
    ),
    state,
    region,
    activityFilter,
    onlyWithoutOverdue: parseBoolean(query.onlyWithoutOverdue),
    sortBy,
    sortDirection,
    topN: parseTopN(query.topN),
  };
}

export function buildSoldProductCustomersQuery(
  productId: string,
  soldProductsQuery: string,
  extra?: Partial<Record<string, string | number | boolean>>
): string {
  const q = new URLSearchParams(soldProductsQuery);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === "" || value == null) q.delete(key);
      else q.set(key, String(value));
    }
  }
  return `/api/commercial/sold-products/${encodeURIComponent(productId)}/customers?${q.toString()}`;
}
