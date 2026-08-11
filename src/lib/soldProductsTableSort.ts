import type {
  SoldProductsCustomerMixRow,
  SoldProductsDetailRow,
  SoldProductsMonthlyEvolutionRow,
  SoldProductsRankingRow,
} from "@/src/lib/salesProductRankingTypes.js";

export type SortDirection = "asc" | "desc";

export type SortState<TSortKey extends string> = {
  key: TSortKey;
  direction: SortDirection;
};

export type SortValueKind = "text" | "number" | "date";

export type SortAccessor<T, TSortKey extends string> = Record<
  TSortKey,
  { get: (row: T) => unknown; kind: SortValueKind; defaultDirection?: SortDirection }
>;

export type RankingSortKey =
  | "rank"
  | "productCode"
  | "productName"
  | "ncm"
  | "quantitySold"
  | "amountSold"
  | "averageUnitPrice"
  | "ordersCount"
  | "customersCount"
  | "lastSaleDate"
  | "quantitySharePercent"
  | "amountSharePercent";

export type CustomerMixSortKey =
  | "productName"
  | "customerName"
  | "quantitySold"
  | "amountSold"
  | "customerSharePercent";

export type MonthlySortKey = "productName" | "period" | "quantitySold" | "amountSold";

export type DetailSortKey =
  | "orderDate"
  | "orderCode"
  | "customerName"
  | "customerTaxId"
  | "productName"
  | "quantity"
  | "unitPrice"
  | "lineAmount"
  | "companyLabel"
  | "sellerName"
  | "orderStatusLabel";

export const DEFAULT_RANKING_SORT: SortState<RankingSortKey> = {
  key: "quantitySold",
  direction: "desc",
};

export const DEFAULT_CUSTOMER_MIX_SORT: SortState<CustomerMixSortKey> = {
  key: "quantitySold",
  direction: "desc",
};

export const DEFAULT_MONTHLY_SORT: SortState<MonthlySortKey> = {
  key: "period",
  direction: "asc",
};

export const DEFAULT_DETAIL_SORT: SortState<DetailSortKey> = {
  key: "orderDate",
  direction: "desc",
};

export function toggleSortState<TSortKey extends string>(
  current: SortState<TSortKey>,
  key: TSortKey,
  defaultDirection: SortDirection = "asc"
): SortState<TSortKey> {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: defaultDirection };
}

export function isEmptySortValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number" && !Number.isFinite(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

export function parseSortDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return new Date(Number.NaN);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
    return Number.isNaN(d.getTime()) ? new Date(Number.NaN) : d;
  }
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? new Date(Number.NaN) : d;
  }
  const d = new Date(raw);
  return d;
}

export function compareNullableValues(
  a: unknown,
  b: unknown,
  kind: SortValueKind,
  direction: SortDirection
): number {
  const emptyA = isEmptySortValue(a);
  const emptyB = isEmptySortValue(b);
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;

  let cmp = 0;
  if (kind === "number") {
    cmp = Number(a) - Number(b);
  } else if (kind === "date") {
    cmp = parseSortDate(a).getTime() - parseSortDate(b).getTime();
  } else {
    cmp = String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true });
  }

  if (cmp === 0) return 0;
  return direction === "asc" ? cmp : -cmp;
}

export function sortRows<T, TSortKey extends string>(
  rows: T[],
  sortState: SortState<TSortKey>,
  accessors: SortAccessor<T, TSortKey>,
  tieBreak?: (a: T, b: T) => number
): T[] {
  const accessor = accessors[sortState.key];
  if (!accessor) return [...rows];

  return [...rows].sort((a, b) => {
    const primary = compareNullableValues(
      accessor.get(a),
      accessor.get(b),
      accessor.kind,
      sortState.direction
    );
    if (primary !== 0) return primary;
    return tieBreak ? tieBreak(a, b) : 0;
  });
}

export const RANKING_SORT_ACCESSORS: SortAccessor<SoldProductsRankingRow, RankingSortKey> = {
  rank: { get: (r) => r.rank, kind: "number", defaultDirection: "asc" },
  productCode: { get: (r) => r.productCode, kind: "text", defaultDirection: "asc" },
  productName: { get: (r) => r.productName, kind: "text", defaultDirection: "asc" },
  ncm: { get: (r) => r.ncm, kind: "text", defaultDirection: "asc" },
  quantitySold: { get: (r) => r.quantitySold, kind: "number", defaultDirection: "desc" },
  amountSold: { get: (r) => r.amountSold, kind: "number", defaultDirection: "desc" },
  averageUnitPrice: { get: (r) => r.averageUnitPrice, kind: "number", defaultDirection: "desc" },
  ordersCount: { get: (r) => r.ordersCount, kind: "number", defaultDirection: "desc" },
  customersCount: { get: (r) => r.customersCount, kind: "number", defaultDirection: "desc" },
  lastSaleDate: { get: (r) => r.lastSaleDate, kind: "date", defaultDirection: "desc" },
  quantitySharePercent: { get: (r) => r.quantitySharePercent, kind: "number", defaultDirection: "desc" },
  amountSharePercent: { get: (r) => r.amountSharePercent, kind: "number", defaultDirection: "desc" },
};

export const CUSTOMER_MIX_SORT_ACCESSORS: SortAccessor<SoldProductsCustomerMixRow, CustomerMixSortKey> =
  {
    productName: { get: (r) => r.productName, kind: "text", defaultDirection: "asc" },
    customerName: { get: (r) => r.customerName, kind: "text", defaultDirection: "asc" },
    quantitySold: { get: (r) => r.quantitySold, kind: "number", defaultDirection: "desc" },
    amountSold: { get: (r) => r.amountSold, kind: "number", defaultDirection: "desc" },
    customerSharePercent: {
      get: (r) => r.customerSharePercent,
      kind: "number",
      defaultDirection: "desc",
    },
  };

export const MONTHLY_SORT_ACCESSORS: SortAccessor<
  SoldProductsMonthlyEvolutionRow,
  MonthlySortKey
> = {
  productName: { get: (r) => r.productName, kind: "text", defaultDirection: "asc" },
  period: { get: (r) => r.year * 100 + r.month, kind: "number", defaultDirection: "asc" },
  quantitySold: { get: (r) => r.quantitySold, kind: "number", defaultDirection: "desc" },
  amountSold: { get: (r) => r.amountSold, kind: "number", defaultDirection: "desc" },
};

export const DETAIL_SORT_ACCESSORS: SortAccessor<SoldProductsDetailRow, DetailSortKey> = {
  orderDate: { get: (r) => r.orderDate, kind: "date", defaultDirection: "desc" },
  orderCode: { get: (r) => r.orderCode, kind: "text", defaultDirection: "asc" },
  customerName: { get: (r) => r.customerName, kind: "text", defaultDirection: "asc" },
  customerTaxId: { get: (r) => r.customerTaxId, kind: "text", defaultDirection: "asc" },
  productName: {
    get: (r) => `${r.productCode ?? ""} ${r.productName}`.trim(),
    kind: "text",
    defaultDirection: "asc",
  },
  quantity: { get: (r) => r.quantity, kind: "number", defaultDirection: "desc" },
  unitPrice: { get: (r) => r.unitPrice, kind: "number", defaultDirection: "desc" },
  lineAmount: { get: (r) => r.lineAmount, kind: "number", defaultDirection: "desc" },
  companyLabel: { get: (r) => r.companyLabel, kind: "text", defaultDirection: "asc" },
  sellerName: { get: (r) => r.sellerName, kind: "text", defaultDirection: "asc" },
  orderStatusLabel: { get: (r) => r.orderStatusLabel, kind: "text", defaultDirection: "asc" },
};

export function sortRankingRows(
  rows: SoldProductsRankingRow[],
  sortState: SortState<RankingSortKey>
): SoldProductsRankingRow[] {
  return sortRows(rows, sortState, RANKING_SORT_ACCESSORS);
}

export function sortCustomerMixRows(
  rows: SoldProductsCustomerMixRow[],
  sortState: SortState<CustomerMixSortKey>
): SoldProductsCustomerMixRow[] {
  return sortRows(rows, sortState, CUSTOMER_MIX_SORT_ACCESSORS);
}

export function sortMonthlyEvolutionRows(
  rows: SoldProductsMonthlyEvolutionRow[],
  sortState: SortState<MonthlySortKey>
): SoldProductsMonthlyEvolutionRow[] {
  return sortRows(rows, sortState, MONTHLY_SORT_ACCESSORS, (a, b) => {
    if (sortState.key !== "period") return 0;
    return b.quantitySold - a.quantitySold;
  });
}

export function sortDetailRows(
  rows: SoldProductsDetailRow[],
  sortState: SortState<DetailSortKey>
): SoldProductsDetailRow[] {
  return sortRows(rows, sortState, DETAIL_SORT_ACCESSORS);
}

export function filterRankingRowsBySearch(
  rows: SoldProductsRankingRow[],
  query: string
): SoldProductsRankingRow[] {
  const term = query.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) => {
    const haystack = [row.productName, row.productCode ?? "", row.ncm ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

export function prepareRankingTableRows(
  rows: SoldProductsRankingRow[],
  query: string,
  sortState: SortState<RankingSortKey>
): SoldProductsRankingRow[] {
  return sortRankingRows(filterRankingRowsBySearch(rows, query), sortState);
}

export function getSortDefaultDirection<TSortKey extends string, T>(
  accessors: SortAccessor<T, TSortKey>,
  key: TSortKey
): SortDirection {
  return accessors[key]?.defaultDirection ?? "asc";
}

export function sortIndicator(sortState: SortState<string>, key: string): string {
  if (sortState.key !== key) return "";
  return sortState.direction === "asc" ? " ↑" : " ↓";
}
