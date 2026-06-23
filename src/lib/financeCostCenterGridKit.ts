import type { UnclassifiedCauseUi } from "@/src/lib/financeUnclassifiedPayablesUi";
import {
  getSortDefaultDirection,
  sortRows,
  toggleSortState,
  type SortAccessor,
  type SortDirection,
  type SortState,
} from "@/src/lib/soldProductsTableSort";
import type { UnclassifiedGroupedBySupplierRow } from "@/src/lib/financeUnclassifiedPayablesGrouping";

export type { SortDirection, SortState };
export { toggleSortState, getSortDefaultDirection };

export const FINANCE_COST_CENTER_GRID_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const FINANCE_COST_CENTER_GRID_DEFAULT_PAGE_SIZE = 50;

export type FinanceGridPagination = {
  page: number;
  pageSize: number;
};

export type FinanceGridTotals = {
  rowCount: number;
  amountSum?: number;
};

export type FinanceGridEmptyStateCopy = {
  title: string;
  description: string;
};

export function paginateFinanceGridRows<T>(
  rows: T[],
  pagination: FinanceGridPagination
): { pageRows: T[]; totalPages: number; total: number } {
  const total = rows.length;
  const pageSize = Math.max(1, pagination.pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, pagination.page), totalPages);
  const start = (page - 1) * pageSize;
  return {
    pageRows: rows.slice(start, start + pageSize),
    totalPages,
    total,
  };
}

export function clampFinanceGridPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, Math.max(1, totalPages));
}

export function normalizeFinanceGridSearch(term: string): string {
  return term.trim().toLowerCase();
}

export function matchesFinanceGridSearch(haystack: string, query: string): boolean {
  const term = normalizeFinanceGridSearch(query);
  if (!term) return true;
  return haystack.toLowerCase().includes(term);
}

export function buildFinanceGridEmptyState(
  hasBaseData: boolean,
  hasActiveFilters: boolean,
  noData: FinanceGridEmptyStateCopy,
  filteredOut: FinanceGridEmptyStateCopy
): FinanceGridEmptyStateCopy {
  if (!hasBaseData) return noData;
  if (hasActiveFilters) return filteredOut;
  return noData;
}

export function sumFinanceGridAmount(rows: Array<{ amount?: number }>): number {
  return rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
}

export function readFinanceGridUrlInt(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min = 1,
  max = 10_000
): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readFinanceGridUrlString(params: URLSearchParams, key: string, fallback = ""): string {
  return params.get(key) ?? fallback;
}

export function readFinanceGridUrlSort<K extends string>(
  params: URLSearchParams,
  sortKey: string,
  sortDirKey: string,
  allowedKeys: readonly K[],
  defaultSort: SortState<K>
): SortState<K> {
  const keyRaw = params.get(sortKey);
  const dirRaw = params.get(sortDirKey);
  const key = allowedKeys.includes(keyRaw as K) ? (keyRaw as K) : defaultSort.key;
  const direction: SortDirection = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultSort.direction;
  return { key, direction };
}

export function writeFinanceGridUrlParams(
  params: URLSearchParams,
  entries: Record<string, string | number | boolean | null | undefined>
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined || value === "" || value === false) {
      next.delete(key);
      continue;
    }
    next.set(key, String(value));
  }
  return next;
}

// ——— Centros de custo (CRUD) ———

export type CostCenterCrudSortKey = "code" | "name" | "status" | "updatedAt";

export type CostCenterCrudGridRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  updatedAt: string | null;
};

export const COST_CENTER_CRUD_SORT_ACCESSORS: SortAccessor<
  CostCenterCrudGridRow,
  CostCenterCrudSortKey
> = {
  code: { get: (r) => r.code, kind: "text", defaultDirection: "asc" },
  name: { get: (r) => r.name, kind: "text", defaultDirection: "asc" },
  status: { get: (r) => r.status, kind: "text", defaultDirection: "asc" },
  updatedAt: { get: (r) => r.updatedAt, kind: "date", defaultDirection: "desc" },
};

export const DEFAULT_COST_CENTER_CRUD_SORT: SortState<CostCenterCrudSortKey> = {
  key: "code",
  direction: "asc",
};

export function filterCostCenterCrudRows(
  rows: CostCenterCrudGridRow[],
  search: string
): CostCenterCrudGridRow[] {
  const term = normalizeFinanceGridSearch(search);
  if (!term) return rows;
  return rows.filter((row) =>
    matchesFinanceGridSearch(`${row.code} ${row.name} ${row.status}`, term)
  );
}

export function prepareCostCenterCrudGridRows(
  rows: CostCenterCrudGridRow[],
  search: string,
  sort: SortState<CostCenterCrudSortKey>
): CostCenterCrudGridRow[] {
  return sortRows(filterCostCenterCrudRows(rows, search), sort, COST_CENTER_CRUD_SORT_ACCESSORS);
}

// ——— Fornecedores ———

export type SupplierGridSortKey =
  | "name"
  | "document"
  | "titlesCount"
  | "amount"
  | "costCenterName"
  | "ruleStatus";

export type SupplierGridRow = {
  supplierId: string | null;
  name: string;
  document: string | null;
  titlesCount: number;
  amount: number;
  costCenterName: string;
  ruleStatus: string;
  hasActiveRule: boolean;
  aliasesCount: number;
};

export type SupplierGridFilters = {
  search: string;
  ruleFilter: "all" | "with_rule" | "without_rule";
  minAmount?: number;
  maxAmount?: number;
};

export const SUPPLIER_GRID_SORT_ACCESSORS: SortAccessor<SupplierGridRow, SupplierGridSortKey> = {
  name: { get: (r) => r.name, kind: "text", defaultDirection: "asc" },
  document: { get: (r) => r.document, kind: "text", defaultDirection: "asc" },
  titlesCount: { get: (r) => r.titlesCount, kind: "number", defaultDirection: "desc" },
  amount: { get: (r) => r.amount, kind: "number", defaultDirection: "desc" },
  costCenterName: { get: (r) => r.costCenterName, kind: "text", defaultDirection: "asc" },
  ruleStatus: { get: (r) => r.ruleStatus, kind: "text", defaultDirection: "asc" },
};

export const DEFAULT_SUPPLIER_GRID_SORT: SortState<SupplierGridSortKey> = {
  key: "amount",
  direction: "desc",
};

export function filterSupplierGridRows(
  rows: SupplierGridRow[],
  filters: SupplierGridFilters
): SupplierGridRow[] {
  return rows.filter((row) => {
    if (filters.ruleFilter === "with_rule" && !row.hasActiveRule) return false;
    if (filters.ruleFilter === "without_rule" && row.hasActiveRule) return false;
    if (filters.minAmount != null && row.amount < filters.minAmount) return false;
    if (filters.maxAmount != null && row.amount > filters.maxAmount) return false;
    if (!matchesFinanceGridSearch(`${row.name} ${row.document ?? ""} ${row.costCenterName}`, filters.search)) {
      return false;
    }
    return true;
  });
}

export function prepareSupplierGridRows(
  rows: SupplierGridRow[],
  filters: SupplierGridFilters,
  sort: SortState<SupplierGridSortKey>
): SupplierGridRow[] {
  return sortRows(filterSupplierGridRows(rows, filters), sort, SUPPLIER_GRID_SORT_ACCESSORS);
}

export function supplierGridTotals(rows: SupplierGridRow[]): FinanceGridTotals {
  return {
    rowCount: rows.length,
    amountSum: rows.reduce((sum, row) => sum + row.amount, 0),
  };
}

// ——— Regras ———

export type RuleGridSortKey =
  | "supplier"
  | "costCenter"
  | "status"
  | "percentage"
  | "updatedAt";

export type RuleGridRow = {
  id: string;
  supplierId: string;
  supplierName: string | null;
  supplierDocument: string | null;
  costCenterId: string;
  costCenterLabel: string;
  percentage: number;
  autoApply: boolean;
  isActive: boolean;
  updatedAt: string | null;
};

export type RuleGridFilters = {
  search: string;
  status: "all" | "active" | "inactive";
  costCenterId: string;
};

export const RULE_GRID_SORT_ACCESSORS: SortAccessor<RuleGridRow, RuleGridSortKey> = {
  supplier: { get: (r) => r.supplierName ?? r.supplierId, kind: "text", defaultDirection: "asc" },
  costCenter: { get: (r) => r.costCenterLabel, kind: "text", defaultDirection: "asc" },
  status: { get: (r) => (r.isActive ? "Ativa" : "Inativa"), kind: "text", defaultDirection: "asc" },
  percentage: { get: (r) => r.percentage, kind: "number", defaultDirection: "desc" },
  updatedAt: { get: (r) => r.updatedAt, kind: "date", defaultDirection: "desc" },
};

export const DEFAULT_RULE_GRID_SORT: SortState<RuleGridSortKey> = {
  key: "supplier",
  direction: "asc",
};

export function filterRuleGridRows(rows: RuleGridRow[], filters: RuleGridFilters): RuleGridRow[] {
  return rows.filter((row) => {
    if (filters.status === "active" && !row.isActive) return false;
    if (filters.status === "inactive" && row.isActive) return false;
    if (filters.costCenterId && row.costCenterId !== filters.costCenterId) return false;
    if (
      !matchesFinanceGridSearch(
        `${row.supplierName ?? ""} ${row.supplierDocument ?? ""} ${row.costCenterLabel}`,
        filters.search
      )
    ) {
      return false;
    }
    return true;
  });
}

export function prepareRuleGridRows(
  rows: RuleGridRow[],
  filters: RuleGridFilters,
  sort: SortState<RuleGridSortKey>
): RuleGridRow[] {
  return sortRows(filterRuleGridRows(rows, filters), sort, RULE_GRID_SORT_ACCESSORS);
}

// ——— Títulos sem classificação (agrupado por fornecedor) ———

export type UnclassifiedGroupedSortKey = "name" | "titlesCount" | "amount" | "cause";

export type UnclassifiedGroupedFilters = {
  search: string;
  cause: UnclassifiedCauseUi | "all";
};

export const UNCLASSIFIED_GROUPED_SORT_ACCESSORS: SortAccessor<
  UnclassifiedGroupedBySupplierRow,
  UnclassifiedGroupedSortKey
> = {
  name: { get: (r) => r.name, kind: "text", defaultDirection: "asc" },
  titlesCount: { get: (r) => r.titlesCount, kind: "number", defaultDirection: "desc" },
  amount: { get: (r) => r.amount, kind: "number", defaultDirection: "desc" },
  cause: { get: (r) => r.cause, kind: "text", defaultDirection: "asc" },
};

export const DEFAULT_UNCLASSIFIED_GROUPED_SORT: SortState<UnclassifiedGroupedSortKey> = {
  key: "amount",
  direction: "desc",
};

export function filterUnclassifiedGroupedRows(
  rows: UnclassifiedGroupedBySupplierRow[],
  filters: UnclassifiedGroupedFilters
): UnclassifiedGroupedBySupplierRow[] {
  return rows.filter((row) => {
    if (filters.cause !== "all" && row.cause !== filters.cause) return false;
    if (!matchesFinanceGridSearch(`${row.name} ${row.supplierName ?? ""}`, filters.search)) {
      return false;
    }
    return true;
  });
}

export function prepareUnclassifiedGroupedRows(
  rows: UnclassifiedGroupedBySupplierRow[],
  filters: UnclassifiedGroupedFilters,
  sort: SortState<UnclassifiedGroupedSortKey>
): UnclassifiedGroupedBySupplierRow[] {
  return sortRows(
    filterUnclassifiedGroupedRows(rows, filters),
    sort,
    UNCLASSIFIED_GROUPED_SORT_ACCESSORS
  );
}

export function unclassifiedGroupedTotals(rows: UnclassifiedGroupedBySupplierRow[]): FinanceGridTotals {
  return {
    rowCount: rows.reduce((sum, row) => sum + row.titlesCount, 0),
    amountSum: rows.reduce((sum, row) => sum + row.amount, 0),
  };
}

/** Totais do grid agrupado usam quantidade de fornecedores na paginação. */
export function unclassifiedGroupedSupplierCount(rows: UnclassifiedGroupedBySupplierRow[]): number {
  return rows.length;
}
