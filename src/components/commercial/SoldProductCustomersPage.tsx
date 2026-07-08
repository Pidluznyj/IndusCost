import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Brain,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  UserRound,
  Users,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  formatCommercialCompactCurrency,
  formatCommercialCompactNumber,
  formatCommercialKpiValueWithTitle,
  formatCommercialShortDate,
} from "@/src/lib/commercialKpiFormat";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  financeBiCardClass,
} from "@/src/lib/financeBiDashboardTheme";
import {
  buildSoldProductsDashboardQuery,
  createDefaultSoldProductsUiFilters,
  isDefaultSoldProductsUiFilters,
  normalizeSoldProductsUiFilters,
  SOLD_PRODUCTS_COMPANY_OPTIONS,
  SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS,
  SOLD_PRODUCTS_DATE_BASIS_OPTIONS,
  SOLD_PRODUCTS_ORDER_STATUS_OPTIONS,
} from "@/src/lib/salesProductRankingFilters.js";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";
import {
  buildCustomerRegistrationPath,
  buildSoldProductCustomersApiPath,
} from "@/src/lib/soldProductCustomersNavigation";
import {
  buildSoldProductCustomersCsv,
  soldProductCustomersExportFilename,
} from "@/src/lib/soldProductCustomersExport";
import type { SoldProductCustomersPayload } from "@/src/lib/soldProductCustomersTypes";
import type { SoldProductsUiFilters } from "@/src/lib/salesProductRankingTypes.js";
import "@/src/components/commercial/sold-product-customers.css";

function kpiCurrency(value: number | null | undefined, label: string) {
  return formatCommercialKpiValueWithTitle(formatCommercialCompactCurrency(value), label);
}

function kpiNumber(value: number | null | undefined, label: string) {
  return formatCommercialKpiValueWithTitle(formatCommercialCompactNumber(value), label);
}

function kpiDate(iso: string | null | undefined, label: string) {
  const formatted = formatCommercialShortDate(iso);
  return formatCommercialKpiValueWithTitle(formatted, label);
}

function CommercialKpiMoney({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: number | null | undefined;
  icon?: React.ElementType;
  hint?: string;
}) {
  const formatted = kpiCurrency(value, label);
  return (
    <FinanceExecutiveTotalizerCard
      label={label}
      value={formatted.value}
      valueTitle={formatted.valueTitle}
      icon={icon}
      hint={hint}
    />
  );
}

function CommercialKpiQty({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ElementType;
}) {
  const formatted = kpiNumber(value, label);
  return (
    <FinanceExecutiveTotalizerCard
      label={label}
      value={formatted.value}
      valueTitle={formatted.valueTitle}
      icon={icon}
    />
  );
}

function CommercialKpiDate({ label, iso }: { label: string; iso: string | null | undefined }) {
  const formatted = kpiDate(iso, label);
  return (
    <FinanceExecutiveTotalizerCard label={label} value={formatted.value} valueTitle={formatted.valueTitle} />
  );
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function uiFiltersFromSearchParams(params: URLSearchParams): SoldProductsUiFilters {
  const defaults = createDefaultSoldProductsUiFilters();
  return normalizeSoldProductsUiFilters({
    startDate: params.get("startDate") ?? defaults.startDate,
    endDate: params.get("endDate") ?? defaults.endDate,
    year: params.get("year") ?? defaults.year,
    month: params.get("month") ?? defaults.month,
    dateBasis: (params.get("dateBasis") as SoldProductsUiFilters["dateBasis"]) ?? defaults.dateBasis,
    customerName: params.get("customerName") ?? "",
    customerTaxId: params.get("customerTaxId") ?? "",
    customerId: params.get("customerId") ?? "",
    productId: params.get("productId") ?? "",
    productCode: params.get("productCode") ?? "",
    productName: params.get("productName") ?? "",
    sellerKey: params.get("sellerKey") ?? "",
    company: (params.get("company") as SoldProductsUiFilters["company"]) ?? defaults.company,
    orderStatus:
      (params.get("orderStatus") as SoldProductsUiFilters["orderStatus"]) ?? defaults.orderStatus,
    customerScope:
      (params.get("customerScope") as SoldProductsUiFilters["customerScope"]) ??
      defaults.customerScope,
    sortBy: defaults.sortBy,
    topN: defaults.topN,
  });
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-xs font-medium text-[#374151]">
      {label}
      <select
        className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs font-medium text-[#374151]">
      {label}
      <input
        type={type}
        className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SoldProductCustomersPage() {
  const { productId = "" } = useParams<{ productId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [appliedFilters, setAppliedFilters] = useState<SoldProductsUiFilters>(() =>
    uiFiltersFromSearchParams(searchParams)
  );
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [minQuantity, setMinQuantity] = useState(searchParams.get("minQuantity") ?? "");
  const [minRevenue, setMinRevenue] = useState(searchParams.get("minRevenue") ?? "");
  const [minDays, setMinDays] = useState(searchParams.get("minDaysSinceLastPurchase") ?? "");
  const [maxDays, setMaxDays] = useState(searchParams.get("maxDaysSinceLastPurchase") ?? "");
  const [stateFilter, setStateFilter] = useState(searchParams.get("state") ?? "");
  const [activityFilter, setActivityFilter] = useState(
    searchParams.get("activityFilter") ?? "all"
  );
  const [onlyWithoutOverdue, setOnlyWithoutOverdue] = useState(
    searchParams.get("onlyWithoutOverdue") === "true"
  );
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") ?? "totalRevenue");
  const [sortDirection, setSortDirection] = useState(searchParams.get("sortDirection") ?? "desc");

  const [data, setData] = useState<SoldProductCustomersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const extraQuery = useMemo(() => {
    const q = new URLSearchParams();
    if (minQuantity.trim()) q.set("minQuantity", minQuantity.trim());
    if (minRevenue.trim()) q.set("minRevenue", minRevenue.trim());
    if (minDays.trim()) q.set("minDaysSinceLastPurchase", minDays.trim());
    if (maxDays.trim()) q.set("maxDaysSinceLastPurchase", maxDays.trim());
    if (stateFilter.trim()) q.set("state", stateFilter.trim());
    if (activityFilter !== "all") q.set("activityFilter", activityFilter);
    if (onlyWithoutOverdue) q.set("onlyWithoutOverdue", "true");
    if (sortBy !== "totalRevenue") q.set("sortBy", sortBy);
    if (sortDirection !== "desc") q.set("sortDirection", sortDirection);
    return q.toString();
  }, [
    minQuantity,
    minRevenue,
    minDays,
    maxDays,
    stateFilter,
    activityFilter,
    onlyWithoutOverdue,
    sortBy,
    sortDirection,
  ]);

  const apiQuery = useMemo(() => {
    const base = buildSoldProductsDashboardQuery({ ...appliedFilters, topN: "all" });
    return extraQuery ? `${base}&${extraQuery}` : base;
  }, [appliedFilters, extraQuery]);

  const loadData = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<SoldProductCustomersPayload>(
        buildSoldProductCustomersApiPath(productId, apiQuery)
      );
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar os clientes compradores.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [productId, apiQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const syncSearchParams = (normalized: SoldProductsUiFilters) => {
    const qs = new URLSearchParams(buildSoldProductsDashboardQuery({ ...normalized, topN: "all" }));
    if (minQuantity.trim()) qs.set("minQuantity", minQuantity.trim());
    if (minRevenue.trim()) qs.set("minRevenue", minRevenue.trim());
    if (minDays.trim()) qs.set("minDaysSinceLastPurchase", minDays.trim());
    if (maxDays.trim()) qs.set("maxDaysSinceLastPurchase", maxDays.trim());
    if (stateFilter.trim()) qs.set("state", stateFilter.trim());
    if (activityFilter !== "all") qs.set("activityFilter", activityFilter);
    if (onlyWithoutOverdue) qs.set("onlyWithoutOverdue", "true");
    if (sortBy !== "totalRevenue") qs.set("sortBy", sortBy);
    if (sortDirection !== "desc") qs.set("sortDirection", sortDirection);
    setSearchParams(qs, { replace: true });
  };

  const applyFilters = () => {
    const normalized = normalizeSoldProductsUiFilters(draftFilters);
    setAppliedFilters(normalized);
    syncSearchParams(normalized);
  };

  const clearFilters = () => {
    const defaults = createDefaultSoldProductsUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(normalizeSoldProductsUiFilters(defaults));
    setMinQuantity("");
    setMinRevenue("");
    setMinDays("");
    setMaxDays("");
    setStateFilter("");
    setActivityFilter("all");
    setOnlyWithoutOverdue(false);
    setSortBy("totalRevenue");
    setSortDirection("desc");
    setSearchParams({}, { replace: true });
  };

  const normalizedDraft = useMemo(() => normalizeSoldProductsUiFilters(draftFilters), [draftFilters]);
  const hasPending =
    buildSoldProductsDashboardQuery(normalizedDraft) !==
      buildSoldProductsDashboardQuery(appliedFilters) ||
    minQuantity !== (searchParams.get("minQuantity") ?? "") ||
    minRevenue !== (searchParams.get("minRevenue") ?? "") ||
    minDays !== (searchParams.get("minDaysSinceLastPurchase") ?? "") ||
    maxDays !== (searchParams.get("maxDaysSinceLastPurchase") ?? "") ||
    stateFilter !== (searchParams.get("state") ?? "") ||
    activityFilter !== (searchParams.get("activityFilter") ?? "all") ||
    onlyWithoutOverdue !== (searchParams.get("onlyWithoutOverdue") === "true") ||
    sortBy !== (searchParams.get("sortBy") ?? "totalRevenue") ||
    sortDirection !== (searchParams.get("sortDirection") ?? "desc");

  const filtersActive = !isDefaultSoldProductsUiFilters(appliedFilters) || extraQuery.length > 0;
  const filterStatus = resolveFinanceBiFilterStatus(filtersActive, hasPending);

  const handleExport = () => {
    if (!data) return;
    downloadTextFile(
      soldProductCustomersExportFilename(data.product.code),
      buildSoldProductCustomersCsv(data)
    );
  };

  return (
    <FinanceBiDashboardShell className="sold-product-customers-page">
      <FinanceBiExecutiveHeader
        eyebrow="Comercial · Produtos Vendidos"
        title="Clientes compradores do produto"
        subtitle="Inteligência comercial por produto vendido — pedidos válidos e filtros herdados do ranking."
        filterStatus={filterStatus}
        meta={
          data
            ? [
                {
                  label: "Produto",
                  value: data.product.code
                    ? `${data.product.code} — ${data.product.name}`
                    : data.product.name,
                },
              ]
            : []
        }
        actions={[
          {
            id: "back",
            label: "Produtos Vendidos",
            onClick: () => {
              window.location.href = `/sales-orders/sold-products?${buildSoldProductsDashboardQuery(appliedFilters)}`;
            },
            icon: <ArrowLeft className="h-4 w-4" />,
          },
          {
            id: "refresh",
            label: "Atualizar",
            onClick: () => void loadData(),
            disabled: loading,
            loading,
            icon: loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />,
          },
          {
            id: "export",
            label: "Exportar lista",
            onClick: handleExport,
            disabled: !data || data.customers.length === 0,
            variant: "accent" as const,
            icon: <Download className="h-4 w-4" />,
          },
        ]}
      />

      {data ? (
        <div className={cn(financeBiCardClass, "p-4 mb-4")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Produto analisado</p>
              <h2 className="text-lg font-bold text-[#111827]">
                {data.product.code ? `${data.product.code} — ` : ""}
                {data.product.name}
              </h2>
            </div>
            <Link
              to={`/sales-orders/sold-products?${buildSoldProductsDashboardQuery(appliedFilters)}`}
              className="text-sm text-[#2563EB] hover:underline inline-flex items-center gap-1"
            >
              Voltar ao ranking
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : null}

      <FinanceFilterScopeBanner active={filtersActive} />

      <FinanceBiFilterPanel
        title="Filtros"
        expanded={showAdvancedFilters}
        onToggle={() => setShowAdvancedFilters((v) => !v)}
        filterStatus={filterStatus}
        onApply={applyFilters}
        onClear={clearFilters}
        applyDisabled={!hasPending || loading}
        alwaysVisible={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <FilterInput
              label="Ano"
              value={draftFilters.year}
              onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
            />
            <FilterInput label="Data inicial" type="date" value={draftFilters.startDate} onChange={(v) => setDraftFilters((f) => ({ ...f, startDate: v }))} />
            <FilterInput label="Data final" type="date" value={draftFilters.endDate} onChange={(v) => setDraftFilters((f) => ({ ...f, endDate: v }))} />
            <FilterInput label="UF" value={stateFilter} onChange={(v) => setStateFilter(v.toUpperCase())} />
            <FilterSelect
              label="Atividade"
              value={activityFilter}
              onChange={setActivityFilter}
              options={[
                { value: "all", label: "Todos" },
                { value: "active", label: "Somente ativos" },
                { value: "inactive", label: "Somente inativos" },
              ]}
            />
            <FilterSelect
              label="Ordenar por"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "totalRevenue", label: "Receita" },
                { value: "quantity", label: "Quantidade" },
                { value: "lastPurchaseDate", label: "Última compra" },
                { value: "averageUnitPrice", label: "Preço médio" },
                { value: "daysSinceLastPurchase", label: "Dias sem comprar" },
                { value: "customerName", label: "Cliente" },
              ]}
            />
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <FilterSelect
            label="Base de data"
            value={draftFilters.dateBasis}
            onChange={(v) =>
              setDraftFilters((f) => ({ ...f, dateBasis: v as SoldProductsUiFilters["dateBasis"] }))
            }
            options={SOLD_PRODUCTS_DATE_BASIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect
            label="Escopo cliente"
            value={draftFilters.customerScope}
            onChange={(v) =>
              setDraftFilters((f) => ({
                ...f,
                customerScope: v as SoldProductsUiFilters["customerScope"],
              }))
            }
            options={SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect
            label="Empresa"
            value={draftFilters.company}
            onChange={(v) =>
              setDraftFilters((f) => ({ ...f, company: v as SoldProductsUiFilters["company"] }))
            }
            options={SOLD_PRODUCTS_COMPANY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect
            label="Status pedido"
            value={draftFilters.orderStatus}
            onChange={(v) =>
              setDraftFilters((f) => ({
                ...f,
                orderStatus: v as SoldProductsUiFilters["orderStatus"],
              }))
            }
            options={SOLD_PRODUCTS_ORDER_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterInput label="Qtd mínima" value={minQuantity} onChange={setMinQuantity} />
          <FilterInput label="Receita mínima" value={minRevenue} onChange={setMinRevenue} />
          <FilterInput label="Dias sem compra (mín.)" value={minDays} onChange={setMinDays} />
          <FilterInput label="Dias sem compra (máx.)" value={maxDays} onChange={setMaxDays} />
          <FilterSelect
            label="Direção"
            value={sortDirection}
            onChange={setSortDirection}
            options={[
              { value: "desc", label: "Decrescente" },
              { value: "asc", label: "Crescente" },
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-[#374151] mt-6">
            <input
              type="checkbox"
              checked={onlyWithoutOverdue}
              onChange={(e) => setOnlyWithoutOverdue(e.target.checked)}
            />
            Somente sem inadimplência
          </label>
        </div>
      </FinanceBiFilterPanel>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      ) : null}

      {data ? (
        <ExecutiveSummarySection
          title="Resumo de clientes compradores"
          eyebrow="Clientes compradores do produto"
          testId="sold-product-customers-kpi-summary"
          className="mb-4"
        >
          <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
            <FinanceExecutiveTotalizerCard label="Clientes" value={String(data.summary.customersCount)} icon={Users} />
            <CommercialKpiQty label="Quantidade" value={data.summary.totalQuantity} icon={Package} />
            <CommercialKpiMoney label="Receita" value={data.summary.totalRevenue} />
            <CommercialKpiMoney label="Preço médio" value={data.summary.averageUnitPrice} />
            <CommercialKpiMoney label="Menor preço" value={data.summary.minUnitPrice} />
            <CommercialKpiMoney label="Maior preço" value={data.summary.maxUnitPrice} />
            <CommercialKpiDate label="Última venda" iso={data.summary.lastSaleDate} />
            <FinanceExecutiveTotalizerCard
              label="Inativos"
              value={String(data.summary.inactiveCustomersCount)}
              hint="> 180 dias sem comprar"
            />
          </SummaryKpiGrid>
        </ExecutiveSummarySection>
      ) : null}

      <div className={cn(financeBiCardClass, "p-4")}>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#6B7280]">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Carregando clientes…
          </div>
        ) : !data || data.customers.length === 0 ? (
          <FinanceBiEmptyState
            title="Nenhum cliente comprador"
            description="Não há clientes para este produto com os filtros aplicados."
          />
        ) : (
          <div className="overflow-x-auto -mx-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#E5E7EB]">
            <table className="min-w-full text-sm sold-product-customers-table">
              <thead className="sticky top-0 z-10 bg-[#F9FAFB] shadow-[0_1px_0_#E5E7EB]">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  <th className="px-3 py-3 col-customer">Cliente</th>
                  <th className="px-3 py-3 col-cnpj">CNPJ</th>
                  <th className="px-3 py-3 col-city">Cidade/UF</th>
                  <th className="px-3 py-3">Responsável</th>
                  <th className="px-3 py-3 text-right">Pedidos</th>
                  <th className="px-3 py-3 text-right col-price">Qtd</th>
                  <th className="px-3 py-3 col-money">Receita</th>
                  <th className="px-3 py-3 col-price">Preço médio</th>
                  <th className="px-3 py-3 col-price">Último preço</th>
                  <th className="px-3 py-3 col-date">Última compra</th>
                  <th className="px-3 py-3 text-right">Dias s/ compra</th>
                  <th className="px-3 py-3 col-money">Carteira</th>
                  <th className="px-3 py-3 col-money">Vencido</th>
                  <th className="px-3 py-3 col-suggested">Ação sugerida</th>
                  <th className="px-3 py-3 col-actions col-actions-sticky">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((row) => {
                  const qty = formatCommercialCompactNumber(row.quantity);
                  const revenue = formatCommercialCompactCurrency(row.totalRevenue);
                  const avgPrice = formatCommercialCompactCurrency(row.averageUnitPrice);
                  const lastPrice = formatCommercialCompactCurrency(row.lastUnitPrice);
                  const portfolio = formatCommercialCompactCurrency(row.openPortfolioAmount);
                  const overdue = formatCommercialCompactCurrency(row.overdueAmount);
                  const lastPurchase = formatCommercialShortDate(row.lastPurchaseDate);
                  const location = [row.city, row.state].filter(Boolean).join(" / ") || "—";

                  return (
                  <tr key={row.customerId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                    <td
                      className="px-3 py-2.5 font-medium text-[#111827] col-customer cell-ellipsis"
                      title={row.customerName}
                    >
                      {row.customerName}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs col-cnpj">{row.customerCnpj ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#6B7280] col-city" title={location}>
                      {location}
                    </td>
                    <td className="px-3 py-2.5 text-[#6B7280]">{row.commercialOwner ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.ordersCount}</td>
                    <td
                      className="px-3 py-2.5 text-right cell-money col-price"
                      title={qty.title ?? undefined}
                    >
                      {qty.display}
                    </td>
                    <td
                      className="px-3 py-2.5 cell-money col-money"
                      title={revenue.title ?? undefined}
                    >
                      {revenue.display}
                    </td>
                    <td
                      className="px-3 py-2.5 cell-money col-price"
                      title={avgPrice.title ?? undefined}
                    >
                      {avgPrice.display}
                    </td>
                    <td
                      className="px-3 py-2.5 cell-money col-price"
                      title={lastPrice.title ?? undefined}
                    >
                      {lastPrice.display}
                    </td>
                    <td
                      className="px-3 py-2.5 col-date"
                      title={lastPurchase.title ?? undefined}
                    >
                      {lastPurchase.display}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.daysSinceLastPurchase ?? "—"}</td>
                    <td
                      className="px-3 py-2.5 cell-money col-money"
                      title={portfolio.title ?? undefined}
                    >
                      {portfolio.display}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 cell-money col-money",
                        (row.overdueAmount ?? 0) > 0 && "text-[#DC2626] font-semibold"
                      )}
                      title={overdue.title ?? undefined}
                    >
                      {overdue.display}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#374151] col-suggested">{row.suggestedAction}</td>
                    <td className="px-3 py-2.5 col-actions col-actions-sticky">
                      <div className="flex items-center gap-1">
                        <Link
                          to={buildCustomerRegistrationPath(row.customerId)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-xs font-medium hover:bg-[#F9FAFB]"
                          title="Abrir cadastro"
                        >
                          <UserRound className="h-3.5 w-3.5" />
                          Cadastro
                        </Link>
                        <Link
                          to={buildCustomerIntelligencePath(row.customerId)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#DBEAFE]"
                          title="Inteligência do Cliente"
                        >
                          <Brain className="h-3.5 w-3.5" />
                          Inteligência
                        </Link>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FinanceBiDashboardShell>
  );
}
