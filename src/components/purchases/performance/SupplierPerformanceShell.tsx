/**
 * Casca comum das sub-abas de Compras → Performance: navegação interna
 * (Visão geral / Classificação de fornecedores) e painel de filtros da
 * população.
 *
 * Vive em módulo próprio para que as duas sub-abas compartilhem o mesmo
 * cabeçalho e os MESMOS filtros sem import circular entre elas. Apresentação
 * pura: não busca dados e não calcula métrica.
 */
import React, { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import type {
  DashboardMaterialOption,
  SupplierPerformanceDashboardFilters,
  SupplierPerformanceDashboardReadModel,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import { searchSupplierPerformanceMaterialOptions } from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  DASHBOARD_PERIOD_PRESET_OPTIONS,
  SUPPLIER_PERFORMANCE_VIEWS,
  describeDashboardPeriodSelection,
  periodSelectionCustom,
  periodSelectionFromPreset,
  periodSelectionFromYear,
  type DashboardPeriodSelection,
  type SupplierPerformanceViewId,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";

/** Controle de formulário com foco visível (acessibilidade). */
export const PERFORMANCE_CONTROL_CLASS =
  "h-9 w-full rounded-md border border-border bg-white px-2.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1";

export const PERFORMANCE_FIELD_LABEL_CLASS =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

const CONTROL_CLASS = PERFORMANCE_CONTROL_CLASS;
const FIELD_LABEL_CLASS = PERFORMANCE_FIELD_LABEL_CLASS;

/** Opções que o painel de filtros precisa — servidas por qualquer um dos read models. */
export type PerformanceFilterOptions = {
  suppliers: Array<{ supplierExternalId: number; name: string; orderCount: number }>;
  materialGroups: Array<{ group: string; lineCount: number }>;
  currencies: Array<{ currency: string; orderCount: number }>;
  availableYears: number[];
  selectedCurrency: string | null;
};

export const EMPTY_PERFORMANCE_FILTER_OPTIONS: PerformanceFilterOptions = {
  suppliers: [],
  materialGroups: [],
  currencies: [],
  availableYears: [],
  selectedCurrency: null,
};

export function filterOptionsFromDashboard(
  data: SupplierPerformanceDashboardReadModel | null
): PerformanceFilterOptions {
  if (!data) return EMPTY_PERFORMANCE_FILTER_OPTIONS;
  return {
    suppliers: data.filterOptions.suppliers,
    materialGroups: data.filterOptions.materialGroups,
    currencies: data.filterOptions.currencies,
    availableYears: data.metadata.availableYears,
    selectedCurrency: data.metadata.currency.selected,
  };
}

/* ------------------------------------------------------------------ *
 * Sub-abas
 * ------------------------------------------------------------------ */

export function SupplierPerformanceViewNav({
  current,
  onChange,
}: {
  current: SupplierPerformanceViewId;
  onChange: (next: SupplierPerformanceViewId) => void;
}) {
  return (
    <nav
      aria-label="Vistas de Performance"
      role="tablist"
      data-testid="performance-view-nav"
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {SUPPLIER_PERFORMANCE_VIEWS.map((view) => {
        const active = view.id === current;
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(view.id)}
            data-testid={`performance-view-tab-${view.id}`}
            className={
              active
                ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-white/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            }
          >
            {view.label}
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ *
 * Filtros — painel compacto, separado do conteúdo
 * ------------------------------------------------------------------ */

export function SupplierPerformanceFilters({
  selection,
  filters,
  options,
  materialOption,
  onSelectionChange,
  onFiltersChange,
  onMaterialOptionChange,
  onRefresh,
  loading,
}: {
  selection: DashboardPeriodSelection;
  filters: SupplierPerformanceDashboardFilters;
  options: PerformanceFilterOptions;
  materialOption: DashboardMaterialOption | null;
  onSelectionChange: (next: DashboardPeriodSelection) => void;
  onFiltersChange: (next: Partial<SupplierPerformanceDashboardFilters>) => void;
  onMaterialOptionChange: (next: DashboardMaterialOption | null) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [materialTerm, setMaterialTerm] = useState("");
  const [materialOptions, setMaterialOptions] = useState<DashboardMaterialOption[]>([]);
  const [materialSearching, setMaterialSearching] = useState(false);
  const { suppliers, materialGroups: groups, currencies, availableYears: years } = options;

  useEffect(() => {
    const term = materialTerm.trim();
    if (term.length < 2) {
      setMaterialOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setMaterialSearching(true);
      searchSupplierPerformanceMaterialOptions(filters, term, controller.signal)
        .then((payload) => {
          if (!controller.signal.aborted) setMaterialOptions(payload.materials);
        })
        .catch(() => {
          if (!controller.signal.aborted) setMaterialOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setMaterialSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialTerm, filters.period.from, filters.period.to, filters.includeCanceled]);

  const periodValue =
    selection.mode === "preset" ? selection.preset : selection.mode === "year" ? `year:${selection.year}` : "custom";

  return (
    <section
      aria-label="Filtros da performance de fornecedores"
      className="rounded-lg border border-border bg-muted/30"
      data-testid="performance-filters"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filtros</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground" data-testid="performance-filters-period-label">
            {describeDashboardPeriodSelection(selection)}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-white px-2.5 text-xs font-medium disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            data-testid="performance-refresh"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />
            Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>Período</span>
          <select
            value={periodValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "custom") onSelectionChange(periodSelectionCustom(filters.period));
              else if (value.startsWith("year:")) onSelectionChange(periodSelectionFromYear(Number(value.slice(5))));
              else
                onSelectionChange(
                  periodSelectionFromPreset(value as Exclude<typeof selection, { mode: "custom" | "year" }>["preset"])
                );
            }}
            className={CONTROL_CLASS}
            data-testid="performance-filter-period"
          >
            {DASHBOARD_PERIOD_PRESET_OPTIONS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {years.map((year) => (
              <option key={year} value={`year:${year}`}>
                Ano {year}
              </option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
        </label>

        {selection.mode === "custom" ? (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>De</span>
              <input
                type="date"
                value={filters.period.from ?? ""}
                onChange={(event) =>
                  onSelectionChange(
                    periodSelectionCustom({ from: event.target.value || null, to: filters.period.to })
                  )
                }
                className={CONTROL_CLASS}
                data-testid="performance-filter-from"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>Até</span>
              <input
                type="date"
                value={filters.period.to ?? ""}
                onChange={(event) =>
                  onSelectionChange(
                    periodSelectionCustom({ from: filters.period.from, to: event.target.value || null })
                  )
                }
                className={CONTROL_CLASS}
                data-testid="performance-filter-to"
              />
            </label>
          </div>
        ) : null}

        <label className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>Fornecedor</span>
          <select
            value={filters.supplierExternalId ?? ""}
            onChange={(event) =>
              onFiltersChange({ supplierExternalId: event.target.value ? Number(event.target.value) : null })
            }
            className={CONTROL_CLASS}
            data-testid="performance-filter-supplier"
          >
            <option value="">Todos os fornecedores</option>
            {suppliers.map((supplier) => (
              <option key={supplier.supplierExternalId} value={supplier.supplierExternalId}>
                {supplier.name} ({supplier.orderCount})
              </option>
            ))}
          </select>
        </label>

        <div className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>Matéria-prima</span>
          {materialOption ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-white px-2.5 text-sm text-foreground">
              <span className="min-w-0 flex-1 truncate" title={materialOption.description ?? undefined}>
                {materialOption.productCode ?? materialOption.description ?? materialOption.materialKey}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={() => onMaterialOptionChange(null)}
                data-testid="performance-filter-material-clear"
              >
                limpar
              </button>
            </div>
          ) : (
            <div className="relative min-w-0">
              <input
                value={materialTerm}
                onChange={(event) => setMaterialTerm(event.target.value)}
                placeholder="Código ou descrição (mín. 2 letras)"
                className={CONTROL_CLASS}
                data-testid="performance-filter-material"
              />
              {materialSearching ? (
                <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
              ) : null}
              {materialOptions.length > 0 ? (
                <ul
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-white text-sm shadow-lg"
                  role="listbox"
                >
                  {materialOptions.map((option) => (
                    <li key={option.materialKey}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-primary/5 focus:outline-none focus-visible:bg-primary/10"
                        onClick={() => {
                          onMaterialOptionChange(option);
                          setMaterialTerm("");
                          setMaterialOptions([]);
                        }}
                      >
                        <span className="font-medium">{option.productCode ?? option.materialKey}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.description ?? "—"} · {option.lineCount} linhas
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        <label className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>Grupo de material</span>
          <select
            value={filters.materialGroup ?? ""}
            onChange={(event) => onFiltersChange({ materialGroup: event.target.value || null })}
            className={CONTROL_CLASS}
            data-testid="performance-filter-group"
          >
            <option value="">Todos os grupos</option>
            {groups.map((group) => (
              <option key={group.group} value={group.group}>
                {group.group} ({group.lineCount})
              </option>
            ))}
          </select>
        </label>

        {currencies.length > 1 ? (
          <label className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Moeda</span>
            <select
              value={filters.currency ?? options.selectedCurrency ?? ""}
              onChange={(event) => onFiltersChange({ currency: event.target.value || null })}
              className={CONTROL_CLASS}
              data-testid="performance-filter-currency"
            >
              {currencies.map((currency) => (
                <option key={currency.currency} value={currency.currency}>
                  {currency.currency} ({currency.orderCount})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex min-w-0 items-center gap-2 self-end pb-1 text-sm">
          <input
            type="checkbox"
            checked={filters.includeCanceled}
            onChange={(event) => onFiltersChange({ includeCanceled: event.target.checked })}
            className="h-4 w-4 rounded border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            data-testid="performance-filter-canceled"
          />
          Incluir cancelados
        </label>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Casca comum das sub-abas
 * ------------------------------------------------------------------ */

export function SupplierPerformanceShell({
  view,
  onViewChange,
  title,
  description,
  filtersSlot,
  children,
}: {
  view: SupplierPerformanceViewId;
  onViewChange: (next: SupplierPerformanceViewId) => void;
  title: string;
  description: string;
  filtersSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5" data-testid="supplier-performance-dashboard">
      <PurchaseChainViewNav current="performance" variant="nomus" />
      <header>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      <SupplierPerformanceViewNav current={view} onChange={onViewChange} />
      {filtersSlot}
      {children}
    </div>
  );
}
