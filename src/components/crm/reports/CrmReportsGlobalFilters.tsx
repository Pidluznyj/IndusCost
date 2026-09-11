import React from "react";
import { Filter, RotateCcw } from "lucide-react";
import { formatCrmReportsInteger } from "@/src/lib/commercial/crmReportsFormat";
import type { CrmReportsUiFilters } from "@/src/lib/commercial/crmReportsUiState";
import type { searchCrmReportsCustomerOptions } from "@/src/lib/commercial/crmReportsClient";
import type { CrmReportsFilterOptionsResponse } from "@/src/lib/commercial/crmReportsTypes";
import { CrmCustomerPicker } from "./CrmCustomerSelectionFilter";

/** Rótulos explícitos — os dois eixos de pessoa NUNCA se confundem. */
export const CRM_REPORTS_FILTER_LABELS = {
  customer: "Cliente",
  commercialOwner: "Responsável Comercial",
  lastOrderSeller: "Vendedor do último pedido",
  city: "Cidade",
  state: "UF",
} as const;

export const CRM_REPORTS_FILTER_HINTS = {
  commercialOwner: "Dono da carteira do cliente — define o escopo.",
  lastOrderSeller: "Vendedor Nomus do último pedido — só auditoria/filtro; não define carteira.",
} as const;

export type CrmReportsGlobalFiltersProps = {
  filters: CrmReportsUiFilters;
  options: CrmReportsFilterOptionsResponse | null;
  optionsLoading: boolean;
  optionsError: string | null;
  filtersActive: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<CrmReportsUiFilters>) => void;
  onClearAll: () => void;
  search?: typeof searchCrmReportsCustomerOptions;
};

const SELECT_CLASS =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export function CrmReportsGlobalFilters({
  filters,
  options,
  optionsLoading,
  optionsError,
  filtersActive,
  disabled,
  onChange,
  onClearAll,
  search,
}: CrmReportsGlobalFiltersProps) {
  const ownerEnabled = options?.commercialOwnerFilterEnabled ?? true;
  const selectsDisabled = disabled || optionsLoading || options == null;
  const placeholder = optionsLoading ? "Carregando…" : options == null ? "Indisponível" : null;
  // Filtro aplicado (ex.: restaurado da sessão) que não está nas opções atuais continua visível.
  const ownerOrphan =
    filters.commercialOwner && !options?.commercialOwners.some((o) => o.key === filters.commercialOwner!.key)
      ? filters.commercialOwner
      : null;
  const sellerOrphan =
    filters.lastOrderSeller && !options?.lastOrderSellers.some((o) => o.sellerKey === filters.lastOrderSeller!.sellerKey)
      ? filters.lastOrderSeller
      : null;
  const cityOrphan = filters.city && !options?.cities.some((o) => o.value === filters.city) ? filters.city : null;
  const stateOrphan = filters.state && !options?.states.some((o) => o.value === filters.state) ? filters.state : null;

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      aria-label="Filtros globais"
      data-testid="crm-reports-filters"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
            <Filter className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-foreground">Filtros</h3>
            <p className="text-xs text-muted-foreground">Valem para cards, listas, relatório personalizado e exportação.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          disabled={!filtersActive || disabled}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Limpar filtros
        </button>
      </div>

      {optionsError ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {optionsError} Os filtros de lista ficam indisponíveis; o relatório continua funcionando.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
        <CrmCustomerPicker
          label={CRM_REPORTS_FILTER_LABELS.customer}
          placeholder="Nome, fantasia ou CNPJ"
          chips={filters.customers}
          disabled={disabled}
          search={search}
          onAdd={(chip) => onChange({ customers: [...filters.customers.filter((c) => c.id !== chip.id), chip] })}
          onRemove={(id) => onChange({ customers: filters.customers.filter((c) => c.id !== id) })}
          onClear={() => onChange({ customers: [] })}
        />

        <div className="space-y-1">
          <label htmlFor="crm-reports-filter-owner" className="block text-xs font-semibold text-foreground">
            {CRM_REPORTS_FILTER_LABELS.commercialOwner}
          </label>
          {ownerEnabled ? (
            <select
              id="crm-reports-filter-owner"
              className={SELECT_CLASS}
              disabled={selectsDisabled}
              value={filters.commercialOwner?.key ?? ""}
              onChange={(e) => {
                const option = options?.commercialOwners.find((o) => o.key === e.target.value);
                onChange({
                  commercialOwner: option ? { key: option.key, label: option.label, filter: option.filter } : null,
                });
              }}
            >
              <option value="">{placeholder ?? "Todos os responsáveis"}</option>
              {ownerOrphan ? <option value={ownerOrphan.key}>{ownerOrphan.label}</option> : null}
              {options?.commercialOwners.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} ({formatCrmReportsInteger(option.customerCount)})
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Sua carteira
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {ownerEnabled
              ? CRM_REPORTS_FILTER_HINTS.commercialOwner
              : "Escopo próprio: a carteira é a do Responsável Comercial vinculado ao seu usuário."}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="crm-reports-filter-seller" className="block text-xs font-semibold text-foreground">
            {CRM_REPORTS_FILTER_LABELS.lastOrderSeller}
          </label>
          <select
            id="crm-reports-filter-seller"
            className={SELECT_CLASS}
            disabled={selectsDisabled}
            value={filters.lastOrderSeller?.sellerKey ?? ""}
            onChange={(e) => {
              const option = options?.lastOrderSellers.find((o) => o.sellerKey === e.target.value);
              onChange({ lastOrderSeller: option ? { sellerKey: option.sellerKey, label: option.label } : null });
            }}
          >
            <option value="">{placeholder ?? "Todos os vendedores"}</option>
            {sellerOrphan ? <option value={sellerOrphan.sellerKey}>{sellerOrphan.label}</option> : null}
            {options?.lastOrderSellers.map((option) => (
              <option key={option.sellerKey} value={option.sellerKey}>
                {option.label} · {formatCrmReportsInteger(option.orderCount)} pedido(s)
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">{CRM_REPORTS_FILTER_HINTS.lastOrderSeller}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="crm-reports-filter-city" className="block text-xs font-semibold text-foreground">
            {CRM_REPORTS_FILTER_LABELS.city}
          </label>
          <select
            id="crm-reports-filter-city"
            className={SELECT_CLASS}
            disabled={selectsDisabled}
            value={filters.city ?? ""}
            onChange={(e) => onChange({ city: e.target.value || null })}
          >
            <option value="">{placeholder ?? "Todas as cidades"}</option>
            {cityOrphan ? <option value={cityOrphan}>{cityOrphan}</option> : null}
            {options?.cities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} ({formatCrmReportsInteger(option.customerCount)})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="crm-reports-filter-state" className="block text-xs font-semibold text-foreground">
            {CRM_REPORTS_FILTER_LABELS.state}
          </label>
          <select
            id="crm-reports-filter-state"
            className={SELECT_CLASS}
            disabled={selectsDisabled}
            value={filters.state ?? ""}
            onChange={(e) => onChange({ state: e.target.value || null })}
          >
            <option value="">{placeholder ?? "Todas as UFs"}</option>
            {stateOrphan ? <option value={stateOrphan}>{stateOrphan}</option> : null}
            {options?.states.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} ({formatCrmReportsInteger(option.customerCount)})
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
