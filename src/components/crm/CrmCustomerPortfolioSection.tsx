import React, { useEffect, useRef } from "react";
import { Search, Users, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type {
  CrmCustomerListFilter,
  CrmCustomerListItem,
  CrmCustomersListResponse,
} from "@/src/lib/crmCustomersListTypes";
import type { SellerOption } from "@/src/components/crmSellerDashboardTypes";
import {
  SELLER_KEY_ALL,
  buildSellerOptionKey,
  formatSellerOptionLabel,
} from "@/src/components/crmSellerDashboardUi";
import {
  CRM_PORTFOLIO_FILTER_CHIPS,
  buildActivePortfolioFilterChips,
  computePortfolioEmptySummary,
} from "@/src/components/crm/crmCustomerPortfolioUi";
import {
  CrmCustomerAccountCockpit,
  CrmCustomerPortfolioEmptyState,
  type CrmAccountCockpitActivity,
  type CrmAccountCockpitProfile,
} from "@/src/components/crm/CrmCustomerAccountCockpit";
import { CrmCustomerPortfolioTable } from "@/src/components/crm/CrmCustomerPortfolioTable";
import { CrmPeriodFilterBar } from "@/src/components/crm/CrmPeriodFilterBar";
import type { CrmPeriodFilter } from "@/src/components/crm/crmPeriodFilter";
import type { CrmCommercialIntelResponse } from "@/src/lib/crmCommercialIntelligence";
import {
  CRM_PORTFOLIO_NO_ORDERS_IN_PERIOD_NOTE,
  CRM_UI_TOOLTIPS,
  crmPortfolioListEmptyCopy,
  resolveCrmPortfolioListEmptyKind,
} from "@/src/components/crm/crmCommercialUiConcepts";
import {
  CrmCommercialAuditStrip,
  CrmCommercialSourceInfoNote,
} from "@/src/components/crm/CrmCommercialSourceInfoNote";

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
  sourceInfo?: CrmCustomersListResponse["sourceInfo"] | null;
  totals?: CrmCustomersListResponse["totals"] | null;
  period?: CrmCustomersListResponse["period"] | null;
  /** Filtro de período controlado (Ano/Mês) — distinto de `period`, que é o recorte já aplicado pela API. */
  periodFilter: CrmPeriodFilter;
  onPeriodFilterChange: (next: CrmPeriodFilter) => void;
  periodYearOptions: number[];
  /** Paginação real da tabela. */
  offset: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  formatNumberPt?: (v: number | null | undefined) => string;
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
  sourceInfo = null,
  totals = null,
  period = null,
  periodFilter,
  onPeriodFilterChange,
  periodYearOptions,
  offset,
  onNextPage,
  onPrevPage,
  formatNumberPt,
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
  const fmt = formatNumberPt ?? ((v: number | null | undefined) => String(v ?? 0));

  // Ao abrir um cliente na tabela, o cockpit some visualmente logo abaixo —
  // rola até ele para não parecer que "não aconteceu nada".
  const cockpitRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedId) {
      cockpitRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

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

  const listEmptyKind = resolveCrmPortfolioListEmptyKind({
    loading: customersLoading,
    error: customersError,
    customerCount: customers.length,
    sellerFilterActive: portfolioSellerKey !== SELLER_KEY_ALL,
    hasOtherFilters: Boolean(appliedSearch.trim()) || crmCustomerFilter !== "all",
    hasSourceInfo: Boolean(sourceInfo),
  });
  const listEmptyCopy = listEmptyKind ? crmPortfolioListEmptyCopy(listEmptyKind) : null;

  // A lista é paginada: só é possível afirmar "nenhum pedido no período" quando
  // a página exibida É o universo inteiro do filtro. Caso contrário o cliente
  // com pedido pode estar na página seguinte.
  const listIsWholeScope =
    totals != null && totals.totalCustomersInScope <= customers.length;
  const customersWithoutPeriodOrders =
    customers.length > 0 &&
    listIsWholeScope &&
    customers.every((c) => (c.periodOrdersCount ?? 0) === 0);

  const auditMetrics = totals
    ? [
        {
          key: "scope-total",
          label: "Total de clientes no filtro",
          value: fmt(totals.totalCustomersInScope),
          hint: "Universo completo do filtro aplicado — não é a contagem da página exibida.",
        },
        {
          key: "no-owner",
          label: "Clientes sem responsável comercial",
          value: fmt(totals.customersWithoutCommercialOwner),
          hint: CRM_UI_TOOLTIPS.commercialOwner,
        },
        {
          key: "no-purchase",
          label: "Clientes sem compra",
          value: fmt(totals.customersWithoutPurchase),
          hint: "Clientes do filtro sem nenhum pedido válido no histórico (independe do período).",
        },
        {
          key: "no-nomus",
          label: "Clientes com pedido sem vendedor Nomus",
          value: fmt(totals.customersWithOrderWithoutNomusSeller),
          hint: CRM_UI_TOOLTIPS.orderSeller,
        },
        {
          key: "divergence",
          label: "Clientes com responsável ≠ vendedor do pedido",
          value: fmt(totals.customersWithOwnerSellerDivergence),
          hint: "O pedido permanece na carteira do responsável comercial; o vendedor Nomus é auditoria/comissão.",
        },
      ]
    : [];

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
            Gestão comercial por responsável da carteira: busque clientes, acompanhe relacionamento e
            opere o cockpit do cliente selecionado. O vendedor do pedido (Nomus) é só auditoria.
          </p>
          <p className="text-xs text-muted-foreground mt-1 italic">{scopeLabel}</p>
          {period?.dateFrom || period?.dateTo ? (
            <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
              Valor de pedidos no período: {period.dateFrom ?? "…"} → {period.dateTo ?? "…"}
            </p>
          ) : null}
        </div>
      </div>

      <CrmPeriodFilterBar
        period={periodFilter}
        onChange={onPeriodFilterChange}
        yearOptions={periodYearOptions}
        testIdPrefix="crm-portfolio"
        note="O período filtra as colunas “Pedidos”/“Venda no período” da tabela. Os totais de cadastro (universo, sem responsável, sem compra, divergência) são sempre do histórico completo do filtro, não deste período."
      />

      <CrmCommercialSourceInfoNote sourceInfo={sourceInfo} />
      {totals?.qualityTotalsTruncated ? (
        <p
          data-testid="crm-portfolio-truncated-warning"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
        >
          O filtro tem mais clientes com responsável do que o teto de avaliação:
          apenas o indicador "responsável ≠ vendedor do pedido" cobre parte do
          universo e está subestimado. Os demais números desta faixa são exatos.
          Refine o filtro para fechar também esse indicador.
        </p>
      ) : null}
      {totals ? <CrmCommercialAuditStrip metrics={auditMetrics} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5 xl:sticky xl:top-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Lista da carteira</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isOwnSellerOnly
                  ? "Somente clientes sob sua responsabilidade comercial."
                  : "Clientes agrupados pelo responsável comercial da carteira."}
              </p>
            </div>

            {showSellerFilter ? (
              <div>
                <label
                  htmlFor="crm-portfolio-seller-filter"
                  className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  title={CRM_UI_TOOLTIPS.commercialOwner}
                >
                  Responsável da carteira
                </label>
                <select
                  id="crm-portfolio-seller-filter"
                  value={portfolioSellerKey}
                  onChange={(e) => onPortfolioSellerChange(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  title={CRM_UI_TOOLTIPS.commercialOwner}
                >
                  <option value={SELLER_KEY_ALL}>Todos os responsáveis</option>
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

            {customersWithoutPeriodOrders && !customersLoading && !customersError ? (
              <div
                className="rounded-lg border border-sky-200/80 bg-sky-50/60 px-3 py-2 text-[11px] text-sky-950 leading-relaxed"
                role="status"
              >
                {CRM_PORTFOLIO_NO_ORDERS_IN_PERIOD_NOTE}
              </div>
            ) : null}

          </div>
        </aside>

        <main className="space-y-6 min-w-0">
          <CrmCustomerPortfolioTable
            customers={customers}
            loading={listEmptyKind === "loading"}
            error={listEmptyKind === "error" ? customersError : null}
            emptyTitle={listEmptyCopy?.title ?? "Nenhum cliente encontrado"}
            emptyBody={listEmptyCopy?.body ?? "Ajuste os filtros para ver clientes da carteira."}
            hasActiveFilters={activeChips.length > 0}
            onClearFilters={onClearAllFilters}
            selectedId={selectedId}
            onSelectCustomer={onSelectCustomer}
            showSellerColumn={!isOwnSellerOnly}
            listHasMore={listHasMore}
            offset={offset}
            onNextPage={onNextPage}
            onPrevPage={onPrevPage}
            formatDateShortPt={formatters.formatDateShortPt}
            formatIntelCurrency={formatters.formatIntelCurrency}
            formatNumberPt={fmt}
            getCustomerDisplayName={formatters.getCustomerDisplayName}
            getCustomerTaxId={formatters.getCustomerTaxId}
          />

          {!selectedCustomer ? (
            <CrmCustomerPortfolioEmptyState summary={emptySummary} scopeLabel={scopeLabel} />
          ) : (
            <div ref={cockpitRef} className="scroll-mt-4 space-y-6">
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
            </div>
          )}
        </main>
      </div>
    </section>
  );
};
