import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  FinanceApScrollableTable,
  FinanceApStickyTableHead,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  FINANCE_COST_CENTER_GRID_DEFAULT_PAGE_SIZE,
  FINANCE_COST_CENTER_GRID_PAGE_SIZE_OPTIONS,
  type FinanceGridEmptyStateCopy,
  type FinanceGridPagination,
  type FinanceGridTotals,
  type SortDirection,
  type SortState,
} from "@/src/lib/financeCostCenterGridKit";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { formatFinanceCurrency, formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

export function FinanceCostCenterSortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground cursor-pointer select-none whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        className
      )}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "justify-end w-full")}>
        {label}
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUp className="h-3 w-3 text-primary" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </span>
    </th>
  );
}

export function FinanceCostCenterGridSearchBar({
  value,
  onChange,
  placeholder = "Buscar…",
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="block min-w-[200px] flex-1 space-y-1">
      <span className={financeModuleFilterLabelClass()}>Busca</span>
      <input
        data-testid={testId}
        className={financeModuleFilterFieldClass()}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

export function FinanceCostCenterGridActiveFilters({
  chips,
  onClear,
}: {
  chips: Array<{ key: string; label: string; onRemove?: () => void }>;
  onClear?: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="finance-cc-grid-active-filters">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium"
        >
          {chip.label}
          {chip.onRemove ? (
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-muted"
              aria-label={`Remover filtro ${chip.label}`}
              onClick={chip.onRemove}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      {onClear ? (
        <button
          type="button"
          data-testid="finance-cc-grid-clear-filters"
          className="text-xs font-semibold text-primary hover:underline"
          onClick={onClear}
        >
          Limpar filtros
        </button>
      ) : null}
    </div>
  );
}

export function FinanceCostCenterGridSummary({
  totals,
  filteredCount,
  page,
  totalPages,
  amountLabel = "Valor filtrado",
}: {
  totals: FinanceGridTotals;
  filteredCount: number;
  page: number;
  totalPages: number;
  amountLabel?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
      data-testid="finance-cc-grid-summary"
    >
      <span>
        {formatFinanceInteger(filteredCount)} registro(s)
        {totals.amountSum != null ? (
          <>
            {" "}
            · {amountLabel}: <span className="font-semibold text-foreground">{formatFinanceCurrency(totals.amountSum)}</span>
          </>
        ) : null}
      </span>
      <span>
        Página {page} de {totalPages}
      </span>
    </div>
  );
}

export function FinanceCostCenterGridPagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2"
      data-testid="finance-cc-grid-pagination"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {onPageSizeChange ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Por página
          <select
            className="rounded-md border px-2 py-1 text-xs"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {FINANCE_COST_CENTER_GRID_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function FinanceCostCenterGridTableShell({
  head,
  children,
  footer,
  className,
  tableClassName,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  tableClassName?: string;
}) {
  return (
    <div className={cn(financeBiCardClass, "overflow-hidden", className)} data-testid="finance-cc-grid-table">
      <FinanceApScrollableTable tableClassName={cn("min-w-[640px]", tableClassName)}>
        <FinanceApStickyTableHead>{head}</FinanceApStickyTableHead>
        <tbody>{children}</tbody>
      </FinanceApScrollableTable>
      {footer}
    </div>
  );
}

export function useFinanceCostCenterGridPagination(
  initialPageSize = FINANCE_COST_CENTER_GRID_DEFAULT_PAGE_SIZE
): [FinanceGridPagination, (patch: Partial<FinanceGridPagination>) => void] {
  const [pagination, setPagination] = React.useState<FinanceGridPagination>({
    page: 1,
    pageSize: initialPageSize,
  });
  const update = React.useCallback((patch: Partial<FinanceGridPagination>) => {
    setPagination((prev) => ({ ...prev, ...patch }));
  }, []);
  return [pagination, update];
}

export function financeCostCenterGridEmptyCopy(
  copy: FinanceGridEmptyStateCopy
): FinanceGridEmptyStateCopy {
  return copy;
}

export type { SortDirection, SortState };
