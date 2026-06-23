import React from "react";
import { Loader2, Search, Users, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { CrmCustomerListFilter, CrmCustomerListItem } from "@/src/lib/crmCustomersListTypes";
import type { SellerOption } from "@/src/components/crmSellerDashboardTypes";
import {
  SELLER_KEY_ALL,
  buildSellerOptionKey,
  formatSellerOptionLabel,
} from "@/src/components/crmSellerDashboardUi";
import {
  CRM_PORTFOLIO_FILTER_CHIPS,
  buildActivePortfolioFilterChips,
  buildCustomerListStatusTags,
  computePortfolioEmptySummary,
} from "@/src/components/crm/crmCustomerPortfolioUi";
import {
  CrmCustomerAccountCockpit,
  CrmCustomerPortfolioEmptyState,
  type CrmAccountCockpitActivity,
  type CrmAccountCockpitProfile,
} from "@/src/components/crm/CrmCustomerAccountCockpit";
import type { CrmCommercialIntelResponse } from "@/src/lib/crmCommercialIntelligence";

export type CrmCustomerPortfolioSectionProps = {
  isOwnSellerOnly: boolean;
  showSellerFilter: boolean;
  sellerOptions: SellerOption[];
  portfolioSellerKey: string;
  onPortfolioSellerChange: (key: string) => void;
  scopeLabel: string;
  searchInput: string;
  appliedSearch: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onClearSearch: () => void;
  onClearAllFilters: () => void;
  crmCustomerFilter: CrmCustomerListFilter;
  onFilterChange: (filter: CrmCustomerListFilter) => void;
  customers: CrmCustomerListItem[];
  customersLoading: boolean;
  customersError: string | null;
  listHasMore: boolean;
  selectedId: string | null;
  onSelectCustomer: (id: string) => void;
  selectedCustomer: CrmCustomerListItem | null;
  intel: CrmCommercialIntelResponse | null;
  intelLoading: boolean;
  intelError: string | null;
  onIntelRetry: () => void;
  profile: CrmAccountCockpitProfile | null;
  activities: CrmAccountCockpitActivity[];
  activitiesLoading: boolean;
  intelligencePath: string;
  onRegisterContact: () => void;
  onEditProfile: () => void;
  formatters: {
    formatDateShortPt: (iso: string | null | undefined) => string;
    formatDateTimePt: (iso: string | null | undefined) => string;
    formatIntelCurrency: (v: unknown) => string;
    formatCommercialStatusLabel: (raw: string | null | undefined) => string;
    displayLine: (v: unknown) => string;
    getCustomerDisplayName: (c: CrmCustomerListItem) => string;
    getCustomerTaxId: (c: CrmCustomerListItem) => string;
    formatCityState: (city: unknown, state: unknown) => string;
  };
  children?: React.ReactNode;
};

export const CrmCustomerPortfolioSection: React.FC<CrmCustomerPortfolioSectionProps> = ({
  isOwnSellerOnly,
  showSellerFilter,
  sellerOptions,
  portfolioSellerKey,
  onPortfolioSellerChange,
  scopeLabel,
  searchInput,
  appliedSearch,
  onSearchInputChange,
  onSearchSubmit,
  onClearSearch,
  onClearAllFilters,
  crmCustomerFilter,
  onFilterChange,
  customers,
  customersLoading,
  customersError,
  listHasMore,
  selectedId,
  onSelectCustomer,
  selectedCustomer,
  intel,
  intelLoading,
  intelError,
  onIntelRetry,
  profile,
  activities,
  activitiesLoading,
  intelligencePath,
  onRegisterContact,
  onEditProfile,
  formatters,
  children,
}) => {
  const emptySummary = computePortfolioEmptySummary(customers);

  const selectedSellerLabel =
    portfolioSellerKey !== SELLER_KEY_ALL
      ? (() => {
          const opt = sellerOptions.find((o) => buildSellerOptionKey(o) === portfolioSellerKey);
          return opt ? formatSellerOptionLabel(opt) : null;
        })()
      : null;

  const activeChips = buildActivePortfolioFilterChips({
    sellerLabel: selectedSellerLabel,
    searchTerm: appliedSearch,
    filter: crmCustomerFilter,
  });

  const onClearChip = (key: "seller" | "search" | "filter") => {
    if (key === "seller") onPortfolioSellerChange(SELLER_KEY_ALL);
    else if (key === "search") onClearSearch();
    else onFilterChange("all");
  };

  return (
    <section className="space-y-6" aria-label="Carteira de clientes">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">Carteira de Clientes</h3>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
            Gestão comercial estilo account manager: busque clientes, acompanhe relacionamento e
            opere o cockpit do cliente selecionado.
          </p>
          <p className="text-xs text-muted-foreground mt-1 italic">{scopeLabel}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5 xl:sticky xl:top-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Lista da carteira</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isOwnSellerOnly
                  ? "Somente clientes do seu escopo comercial."
                  : "Clientes conforme escopo e filtro de vendedor."}
              </p>
            </div>

            {showSellerFilter ? (
              <div>
                <label
                  htmlFor="crm-portfolio-seller-filter"
                  className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Filtrar por vendedor
                </label>
                <select
                  id="crm-portfolio-seller-filter"
                  value={portfolioSellerKey}
                  onChange={(e) => onPortfolioSellerChange(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  <option value={SELLER_KEY_ALL}>Todos os vendedores</option>
                  {sellerOptions.map((opt) => {
                    const key = buildSellerOptionKey(opt);
                    return (
                      <option key={key} value={key}>
                        {formatSellerOptionLabel(opt)}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}

            <form onSubmit={onSearchSubmit} className="space-y-3">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Buscar
              </label>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Nome, fantasia, CNPJ/CPF, cidade ou UF…"
                  className="w-full pl-11 pr-3 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={searchInput}
                  onChange={(e) => onSearchInputChange(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <Search className="h-4 w-4" />
                Buscar
              </button>
            </form>

            {activeChips.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Filtros ativos
                  </p>
                  <button
                    type="button"
                    onClick={onClearAllFilters}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Limpar filtros
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeChips.map((chip) => (
                    <span
                      key={chip.key}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {chip.label}
                      <button
                        type="button"
                        onClick={() => onClearChip(chip.key)}
                        className="rounded-full p-0.5 hover:bg-primary/20"
                        aria-label={`Remover filtro ${chip.label}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Filtros rápidos
              </p>
              <div className="flex flex-wrap gap-2">
                {CRM_PORTFOLIO_FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => onFilterChange(chip.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      crmCustomerFilter === chip.value
                        ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/25 shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {customersLoading ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                Buscando clientes…
              </div>
            ) : customersError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {customersError}
              </div>
            ) : customers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <p className="text-sm font-semibold text-foreground">Nenhum cliente encontrado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {activeChips.length > 0
                    ? "Nenhum cliente encontrado para este vendedor com os filtros aplicados."
                    : "Ajuste a busca ou os filtros. O escopo do seu usuário também limita os resultados."}
                </p>
                {activeChips.length > 0 ? (
                  <button
                    type="button"
                    onClick={onClearAllFilters}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                  >
                    <X className="h-3.5 w-3.5" />
                    Limpar filtros
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="space-y-2 max-h-[min(720px,75vh)] overflow-y-auto pr-1">
                {customers.map((c) => {
                  const active = c.id === selectedId;
                  const tags = buildCustomerListStatusTags(c).slice(0, 2);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onSelectCustomer(c.id)}
                        className={cn(
                          "w-full text-left rounded-xl border px-4 py-3.5 transition-all",
                          active
                            ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20"
                            : "border-border/80 bg-background hover:border-primary/30 hover:bg-accent/40"
                        )}
                      >
                        <p className="font-semibold text-sm text-foreground leading-snug line-clamp-2">
                          {formatters.getCustomerDisplayName(c)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                          {formatters.getCustomerTaxId(c) !== "—"
                            ? formatters.getCustomerTaxId(c)
                            : "Documento não informado"}
                        </p>
                        {formatters.formatCityState(c.city, c.state) !== "—" ? (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatters.formatCityState(c.city, c.state)}
                          </p>
                        ) : null}
                        {!isOwnSellerOnly && c.primarySellerResponsible?.trim() ? (
                          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                            {c.primarySellerResponsible.trim()}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground mt-2">
                          Último contato:{" "}
                          <span className="font-medium text-foreground">
                            {formatters.formatDateShortPt(c.lastContactAt)}
                          </span>
                        </p>
                        {tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {tags.map((tag) => (
                              <span
                                key={tag.key}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase",
                                  tag.className
                                )}
                              >
                                {tag.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {!customersLoading && !customersError && listHasMore ? (
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Há mais resultados. Refine a busca ou use filtros.
              </p>
            ) : null}
          </div>
        </aside>

        <main className="space-y-6 min-w-0">
          {!selectedCustomer ? (
            <CrmCustomerPortfolioEmptyState summary={emptySummary} scopeLabel={scopeLabel} />
          ) : (
            <>
              <CrmCustomerAccountCockpit
                customer={selectedCustomer}
                showSellerColumn={!isOwnSellerOnly}
                intel={intel}
                intelLoading={intelLoading}
                intelError={intelError}
                onIntelRetry={onIntelRetry}
                profile={profile}
                activities={activities}
                activitiesLoading={activitiesLoading}
                intelligencePath={intelligencePath}
                onRegisterContact={onRegisterContact}
                onEditProfile={onEditProfile}
                formatters={formatters}
              />
              {children}
            </>
          )}
        </main>
      </div>
    </section>
  );
};
