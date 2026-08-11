import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import { cn, formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";
import {
  CUSTOMER_MIX_SORT_ACCESSORS,
  DEFAULT_CUSTOMER_MIX_SORT,
  DEFAULT_DETAIL_SORT,
  DEFAULT_MONTHLY_SORT,
  DEFAULT_RANKING_SORT,
  DETAIL_SORT_ACCESSORS,
  getSortDefaultDirection,
  MONTHLY_SORT_ACCESSORS,
  prepareRankingTableRows,
  RANKING_SORT_ACCESSORS,
  sortCustomerMixRows,
  sortDetailRows,
  sortIndicator,
  sortMonthlyEvolutionRows,
  toggleSortState,
  type CustomerMixSortKey,
  type DetailSortKey,
  type MonthlySortKey,
  type RankingSortKey,
  type SortState,
} from "@/src/lib/soldProductsTableSort.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
import {
  financeBiButtonAccentClass,
  financeBiButtonOutlineClass,
  financeBiCardClass,
  financeBiKpiLabelClass,
  financeBiKpiValueClass,
} from "@/src/lib/financeBiDashboardTheme";
import {
  buildSoldProductsDashboardQuery,
  buildSoldProductsYearOptions,
  createDefaultSoldProductsUiFilters,
  formatSoldProductsIsoDateDisplay,
  isDefaultSoldProductsUiFilters,
  normalizeSoldProductsUiFilters,
  SOLD_PRODUCTS_COMPANY_OPTIONS,
  SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS,
  SOLD_PRODUCTS_DATE_BASIS_OPTIONS,
  SOLD_PRODUCTS_MONTH_OPTIONS,
  SOLD_PRODUCTS_ORDER_STATUS_OPTIONS,
  SOLD_PRODUCTS_SORT_OPTIONS,
  SOLD_PRODUCTS_TOP_N_OPTIONS,
} from "@/src/lib/salesProductRankingFilters.js";
import { SearchableSelect, type SelectOption } from "@/src/components/shared/SearchableSelect";
import {
  buildSoldProductsProductSelectOptions,
  buildSoldProductsSellerSelectOptions,
  buildSoldProductsTaxIdSelectOptions,
  resolveSoldProductsCustomerChipLabel,
  resolveSoldProductsProductChipLabel,
  soldProductsCustomerIdPatch,
  soldProductsProductIdPatch,
  syncCustomerIdFromTaxId,
} from "@/src/lib/soldProductsFilterOptions.js";
import type {
  SoldProductsDashboardPayload,
  SoldProductsFilterOptionsPayload,
  SoldProductsRankingRow,
  SoldProductsUiFilters,
} from "@/src/lib/salesProductRankingTypes.js";
import { SoldProductsPrintDocument } from "@/src/components/commercial/SoldProductsPrintDocument";
import { buildSoldProductCustomersPath } from "@/src/lib/soldProductCustomersNavigation";
import "@/src/components/commercial/sold-products-print.css";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";

type TabId = "overview" | "customerMix" | "monthly" | "ncm" | "detail";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Visão Geral" },
  { id: "customerMix", label: "Produto x Cliente" },
  { id: "monthly", label: "Evolução Mensal" },
  { id: "ncm", label: "NCM x Produto" },
  { id: "detail", label: "Detalhamento" },
];

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
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
      >
        {options.map((o) => (
          <option key={o.value || "__all"} value={o.value}>
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
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === "date" ? undefined : placeholder}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
      />
    </label>
  );
}

function FilterSearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  searchInputPlaceholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchInputPlaceholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder ?? "Selecione…"}
        searchInputPlaceholder={searchInputPlaceholder ?? "Pesquisar…"}
        pinOptionValues={[""]}
        disabled={disabled}
        className="[&_button]:rounded-lg [&_button]:border-[#E5E7EB] [&_button]:bg-white [&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:text-[#111827] [&_button]:shadow-none"
      />
    </label>
  );
}

function buildSoldProductsFilterChips(
  filters: SoldProductsUiFilters,
  onRemove: (field: keyof SoldProductsUiFilters) => void,
  filterOptions: SoldProductsFilterOptionsPayload
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof SoldProductsUiFilters, label: string) => {
    chips.push({ id, label, onRemove: () => onRemove(id) });
  };
  if (filters.year.trim()) push("year", `Ano: ${filters.year}`);
  if (filters.month.trim()) {
    const m = SOLD_PRODUCTS_MONTH_OPTIONS.find((o) => o.value === filters.month)?.label ?? filters.month;
    push("month", `Mês: ${m}`);
  }
  if (filters.startDate.trim()) {
    push("startDate", `De: ${formatSoldProductsIsoDateDisplay(filters.startDate)}`);
  }
  if (filters.endDate.trim()) {
    push("endDate", `Até: ${formatSoldProductsIsoDateDisplay(filters.endDate)}`);
  }
  if (filters.dateBasis !== "issueDate") {
    push(
      "dateBasis",
      SOLD_PRODUCTS_DATE_BASIS_OPTIONS.find((o) => o.value === filters.dateBasis)?.label ?? filters.dateBasis
    );
  }
  if (filters.customerName.trim()) push("customerName", `Cliente: ${filters.customerName}`);
  if (filters.customerId.trim()) {
    push("customerId", resolveSoldProductsCustomerChipLabel(filters.customerId, filterOptions.customers));
  }
  if (filters.customerTaxId.trim()) push("customerTaxId", `CNPJ: ${filters.customerTaxId}`);
  if (filters.productId.trim()) {
    push("productId", resolveSoldProductsProductChipLabel(filters.productId, filterOptions.products));
  }
  if (filters.productCode.trim()) push("productCode", `Código: ${filters.productCode}`);
  if (filters.productName.trim()) push("productName", `Produto: ${filters.productName}`);
  if (filters.sellerKey.trim()) {
    const sellerLabel =
      filterOptions.sellers.find((s) => s.key === filters.sellerKey)?.label ??
      filters.sellerKey.replace(/^r:/, "").replace(/^id:/, "ID ");
    push("sellerKey", `Vendedor: ${sellerLabel}`);
  }
  if (filters.company !== "all") {
    push("company", SOLD_PRODUCTS_COMPANY_OPTIONS.find((o) => o.value === filters.company)?.label ?? filters.company);
  }
  if (filters.orderStatus !== "valid") {
    push(
      "orderStatus",
      SOLD_PRODUCTS_ORDER_STATUS_OPTIONS.find((o) => o.value === filters.orderStatus)?.label ?? filters.orderStatus
    );
  }
  if (filters.customerScope !== "external") {
    push(
      "customerScope",
      SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS.find((o) => o.value === filters.customerScope)?.label ??
        filters.customerScope
    );
  }
  if (filters.sortBy !== "quantity") {
    push("sortBy", SOLD_PRODUCTS_SORT_OPTIONS.find((o) => o.value === filters.sortBy)?.label ?? filters.sortBy);
  }
  if (filters.topN !== "all") {
    push("topN", SOLD_PRODUCTS_TOP_N_OPTIONS.find((o) => o.value === filters.topN)?.label ?? filters.topN);
  }
  return chips;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRankingCsv(rows: SoldProductsRankingRow[]): string {
  const headers = [
    "Posição",
    "Código",
    "Produto",
    "Quantidade vendida",
    "Valor vendido",
    "Preço médio",
    "Pedidos",
    "Clientes",
    "Última venda",
    "% participação qtd",
    "% participação valor",
  ];
  const lines = rows.map((r) =>
    [
      r.rank,
      r.productCode ?? "",
      `"${r.productName.replace(/"/g, '""')}"`,
      r.quantitySold,
      r.amountSold,
      r.averageUnitPrice ?? "",
      r.ordersCount,
      r.customersCount,
      r.lastSaleDate ?? "",
      r.quantitySharePercent,
      r.amountSharePercent,
    ].join(";")
  );
  return `\uFEFF${headers.join(";")}\n${lines.join("\n")}`;
}

function ReportSection({
  title,
  description,
  actions,
  children,
  id,
}: {
  id?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`${financeBiCardClass} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-[#E5E7EB] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-bold text-[#111827]">{title}</h2>
          {description ? <p className="text-sm text-[#6B7280]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function PeriodContextBar({
  periodLabel,
  productCount,
  loading,
}: {
  periodLabel?: string;
  productCount?: number;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#2563EB]/20 bg-gradient-to-r from-[#EFF6FF] to-white px-5 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
        <BarChart3 className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#2563EB]">Análise do período</p>
        <p className="text-sm font-medium text-[#111827]">
          {loading ? "Carregando…" : periodLabel ?? "—"}
          {!loading && productCount != null ? (
            <span className="text-[#6B7280]"> · {productCount} produtos no ranking</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 min-w-[140px]">
      <p className={financeBiKpiLabelClass}>{label}</p>
      <p className={`${financeBiKpiValueClass} text-xl mt-1`}>{value}</p>
    </div>
  );
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
  if (rank === 2) return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  if (rank === 3) return "bg-orange-50 text-orange-800 ring-1 ring-orange-200";
  return "bg-[#F3F4F6] text-[#6B7280]";
}

function SortableTh<TSortKey extends string>({
  label,
  sortKey,
  sortState,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  sortKey: TSortKey;
  sortState: SortState<TSortKey>;
  onSort: (key: TSortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortState.key === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-3 cursor-pointer select-none transition-colors hover:bg-[#EFF6FF]/60",
        align === "right" && "text-right",
        active && "bg-[#EFF6FF]/80 text-[#2563EB]",
        className
      )}
      title="Clique para ordenar"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {sortIndicator(sortState, sortKey)}
    </th>
  );
}

export function SoldProductsReportPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [draftFilters, setDraftFilters] = useState<SoldProductsUiFilters>(() =>
    createDefaultSoldProductsUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<SoldProductsUiFilters>(() =>
    normalizeSoldProductsUiFilters(createDefaultSoldProductsUiFilters())
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [data, setData] = useState<SoldProductsDashboardPayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<SoldProductsFilterOptionsPayload>({
    customers: [],
    products: [],
    sellers: [],
  });
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [rankingSort, setRankingSort] = useState(DEFAULT_RANKING_SORT);
  const [rankingSearch, setRankingSearch] = useState("");
  const [customerMixSort, setCustomerMixSort] = useState(DEFAULT_CUSTOMER_MIX_SORT);
  const [monthlySort, setMonthlySort] = useState(DEFAULT_MONTHLY_SORT);
  const [detailSort, setDetailSort] = useState(DEFAULT_DETAIL_SORT);
  const printCleanupRef = useRef<number | null>(null);

  const normalizedDraft = useMemo(() => normalizeSoldProductsUiFilters(draftFilters), [draftFilters]);

  const rankingQueryString = useMemo(() => {
    const qs = new URLSearchParams(buildSoldProductsDashboardQuery({ ...appliedFilters, topN: "all" }));
    qs.set("detailPage", "1");
    qs.set("detailLimit", "1");
    return qs.toString();
  }, [appliedFilters]);

  const detailQueryString = useMemo(() => {
    const qs = new URLSearchParams(buildSoldProductsDashboardQuery(appliedFilters));
    qs.set("detailPage", String(detailPage));
    qs.set("detailLimit", "100");
    return qs.toString();
  }, [appliedFilters, detailPage]);

  const hasPending = useMemo(
    () => buildSoldProductsDashboardQuery(normalizedDraft) !== buildSoldProductsDashboardQuery(appliedFilters),
    [normalizedDraft, appliedFilters]
  );

  const filtersActive = !isDefaultSoldProductsUiFilters(appliedFilters);
  const filterStatus = useMemo(
    () => resolveFinanceBiFilterStatus(filtersActive, hasPending),
    [filtersActive, hasPending]
  );

  const yearOptions = useMemo(() => buildSoldProductsYearOptions(), []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rankingUrl = `/api/commercial/sold-products?${rankingQueryString}`;
      const rankingPayload = await fetchJsonOk<SoldProductsDashboardPayload>(rankingUrl);

      let detailPayload = rankingPayload;
      if (activeTab === "detail") {
        detailPayload = await fetchJsonOk<SoldProductsDashboardPayload>(
          `/api/commercial/sold-products?${detailQueryString}`
        );
      }

      setData({
        ...rankingPayload,
        detailRows: detailPayload.detailRows,
        detailPagination: detailPayload.detailPagination,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o relatório.");
    } finally {
      setLoading(false);
    }
  }, [rankingQueryString, detailQueryString, activeTab]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    setFilterOptionsLoading(true);
    void fetchJsonOk<SoldProductsFilterOptionsPayload>("/api/commercial/sold-products/filter-options")
      .then((payload) =>
        setFilterOptions({
          customers: Array.isArray(payload.customers) ? payload.customers : [],
          products: Array.isArray(payload.products) ? payload.products : [],
          sellers: Array.isArray(payload.sellers) ? payload.sellers : [],
        })
      )
      .catch(() =>
        setFilterOptions({
          customers: [],
          products: [],
          sellers: [],
        })
      )
      .finally(() => setFilterOptionsLoading(false));
  }, []);

  const handleApply = () => {
    setAppliedFilters(normalizedDraft);
    setDetailPage(1);
  };

  const handleClear = () => {
    const defaults = createDefaultSoldProductsUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(normalizeSoldProductsUiFilters(defaults));
    setDetailPage(1);
  };

  const handleRemoveChip = useCallback(
    (field: keyof SoldProductsUiFilters) => {
      const next = { ...appliedFilters };
      if (field === "year") next.year = String(new Date().getFullYear());
      else if (field === "dateBasis") next.dateBasis = "issueDate";
      else if (field === "orderStatus") next.orderStatus = "valid";
      else if (field === "customerScope") next.customerScope = "external";
      else if (field === "company") next.company = "all";
      else if (field === "sortBy") next.sortBy = "quantity";
      else if (field === "topN") next.topN = "all";
      else if (field === "customerId") {
        next.customerId = "";
        next.customerTaxId = "";
      } else if (field === "customerTaxId") {
        next.customerTaxId = "";
        next.customerId = "";
      } else if (field === "productId") {
        next.productId = "";
      } else next[field] = "";
      const normalized = normalizeSoldProductsUiFilters(next);
      setDraftFilters(normalized);
      setAppliedFilters(normalized);
      setDetailPage(1);
    },
    [appliedFilters]
  );

  const taxIdSelectOptions = useMemo(
    () => buildSoldProductsTaxIdSelectOptions(filterOptions.customers),
    [filterOptions.customers]
  );
  const productSelectOptions = useMemo(
    () => buildSoldProductsProductSelectOptions(filterOptions.products),
    [filterOptions.products]
  );
  const sellerSelectOptions = useMemo(
    () => buildSoldProductsSellerSelectOptions(filterOptions.sellers),
    [filterOptions.sellers]
  );

  const chips = useMemo(
    () => buildSoldProductsFilterChips(appliedFilters, handleRemoveChip, filterOptions),
    [appliedFilters, handleRemoveChip, filterOptions]
  );

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const qs = buildSoldProductsDashboardQuery({ ...appliedFilters, topN: "all" });
      const res = await fetch(
        `/api/commercial/sold-products/export.xlsx${qs ? `?${qs}` : ""}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Falha ao exportar Excel.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `produtos-vendidos-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exportar.");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = useCallback(() => {
    if (printing || loading || !data) return;

    const clearPrintRoute = () => {
      if (printCleanupRef.current != null) {
        window.clearTimeout(printCleanupRef.current);
        printCleanupRef.current = null;
      }
      document.body.classList.remove("sold-products-print-route");
      setPrinting(false);
    };

    setPrinting(true);
    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      clearPrintRoute();
    };
    window.addEventListener("afterprint", onAfterPrint);
    printCleanupRef.current = window.setTimeout(() => {
      window.removeEventListener("afterprint", onAfterPrint);
      clearPrintRoute();
    }, 60_000);

    document.body.classList.add("sold-products-print-route");
    document.title = "Produtos Vendidos";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => window.print(), 200);
      });
    });
  }, [data, loading, printing]);

  const chartData = useMemo(() => {
    return (data?.ranking ?? []).slice(0, 10).map((r) => ({
      name: r.productCode ?? r.productName.slice(0, 20),
      quantity: r.quantitySold,
      fullName: r.productName,
    }));
  }, [data?.ranking]);

  const summary = data?.summary;
  const applied = data?.filters;
  const rankingRows = data?.ranking ?? [];

  const displayedRankingRows = useMemo(
    () => prepareRankingTableRows(rankingRows, rankingSearch, rankingSort),
    [rankingRows, rankingSearch, rankingSort]
  );

  const displayedCustomerMixRows = useMemo(
    () => sortCustomerMixRows(data?.customerMix ?? [], customerMixSort),
    [data?.customerMix, customerMixSort]
  );

  const displayedMonthlyRows = useMemo(
    () => sortMonthlyEvolutionRows(data?.monthlyEvolution ?? [], monthlySort),
    [data?.monthlyEvolution, monthlySort]
  );

  const displayedDetailRows = useMemo(
    () => sortDetailRows(data?.detailRows ?? [], detailSort),
    [data?.detailRows, detailSort]
  );

  const handleRankingSort = useCallback((key: RankingSortKey) => {
    setRankingSort((current) =>
      toggleSortState(current, key, getSortDefaultDirection(RANKING_SORT_ACCESSORS, key))
    );
  }, []);

  const handleCustomerMixSort = useCallback((key: CustomerMixSortKey) => {
    setCustomerMixSort((current) =>
      toggleSortState(current, key, getSortDefaultDirection(CUSTOMER_MIX_SORT_ACCESSORS, key))
    );
  }, []);

  const handleMonthlySort = useCallback((key: MonthlySortKey) => {
    setMonthlySort((current) =>
      toggleSortState(current, key, getSortDefaultDirection(MONTHLY_SORT_ACCESSORS, key))
    );
  }, []);

  const handleDetailSort = useCallback((key: DetailSortKey) => {
    setDetailSort((current) =>
      toggleSortState(current, key, getSortDefaultDirection(DETAIL_SORT_ACCESSORS, key))
    );
  }, []);

  const handleExportRankingCsv = () => {
    if (!displayedRankingRows.length) return;
    downloadTextFile(
      `ranking-produtos-vendidos-${new Date().toISOString().slice(0, 10)}.csv`,
      buildRankingCsv(displayedRankingRows),
      "text/csv;charset=utf-8"
    );
  };

  const exportRankingActions = (
    <>
      <button
        type="button"
        onClick={handleExportRankingCsv}
        disabled={!displayedRankingRows.length || loading}
        className={financeBiButtonOutlineClass}
      >
        <Download className="h-4 w-4" />
        CSV do ranking
      </button>
      <button
        type="button"
        onClick={() => void handleExportExcel()}
        disabled={exporting || loading}
        className={financeBiButtonAccentClass}
      >
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Excel completo
      </button>
    </>
  );

  return (
    <>
      <FinanceBiDashboardShell className="sold-products-no-print">
        <FinanceBiExecutiveHeader
          eyebrow="Comercial · Relatórios"
          title="Produtos Vendidos"
          subtitle="Ranking de produtos por quantidade vendida com base em pedidos de venda."
          filterStatus={filterStatus}
          meta={
            applied
              ? [
                  { label: "Período", value: applied.periodLabel },
                  { label: "Base", value: applied.dateBasisLabel },
                ]
              : []
          }
          actions={[
            {
              id: "refresh",
              label: "Atualizar",
              onClick: () => void loadDashboard(),
              disabled: loading,
              loading,
              icon: loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />,
            },
            {
              id: "export",
              label: "Exportar Excel",
              onClick: () => void handleExportExcel(),
              disabled: exporting || loading,
              loading: exporting,
              variant: "accent" as const,
              icon: exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />,
            },
            {
              id: "print",
              label: printing ? "Preparando PDF…" : "Imprimir / PDF",
              onClick: handlePrint,
              disabled: printing || loading || !data,
              loading: printing,
              icon: printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />,
            },
          ]}
        />

        <FinanceFilterScopeBanner active={filtersActive} />

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        <FinanceBiFilterPanel
          title="Filtros"
          expanded={showAdvancedFilters}
          onToggle={() => setShowAdvancedFilters((v) => !v)}
          filterStatus={filterStatus}
          chips={chips}
          onApply={handleApply}
          onClear={handleClear}
          applyDisabled={!hasPending || loading}
          alwaysVisible={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <FilterSelect
                label="Ano"
                value={draftFilters.year}
                onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
                options={yearOptions}
              />
              <FilterSelect
                label="Mês"
                value={draftFilters.month}
                onChange={(v) => setDraftFilters((f) => ({ ...f, month: v }))}
                options={SOLD_PRODUCTS_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Tipo de data"
                value={draftFilters.dateBasis}
                onChange={(v) =>
                  setDraftFilters((f) => ({
                    ...f,
                    dateBasis: v as SoldProductsUiFilters["dateBasis"],
                  }))
                }
                options={SOLD_PRODUCTS_DATE_BASIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Ordenação"
                value={draftFilters.sortBy}
                onChange={(v) =>
                  setDraftFilters((f) => ({ ...f, sortBy: v as SoldProductsUiFilters["sortBy"] }))
                }
                options={SOLD_PRODUCTS_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Top N (gráfico)"
                value={draftFilters.topN}
                onChange={(v) =>
                  setDraftFilters((f) => ({ ...f, topN: v as SoldProductsUiFilters["topN"] }))
                }
                options={SOLD_PRODUCTS_TOP_N_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterInput
              label="Data inicial"
              type="date"
              value={draftFilters.startDate}
              onChange={(v) => setDraftFilters((f) => ({ ...f, startDate: v }))}
            />
            <FilterInput
              label="Data final"
              type="date"
              value={draftFilters.endDate}
              onChange={(v) => setDraftFilters((f) => ({ ...f, endDate: v }))}
            />
            <CustomerAutocompleteFilter
              label="Cliente"
              value={
                draftFilters.customerId
                  ? {
                      id: draftFilters.customerId,
                      name:
                        filterOptions.customers.find((c) => c.id === draftFilters.customerId)
                          ?.name ?? draftFilters.customerName ?? draftFilters.customerId,
                      taxId: draftFilters.customerTaxId || null,
                      source: "induscost",
                    }
                  : null
              }
              placeholder="Todos os clientes"
              onChange={(sel) =>
                setDraftFilters((f) => ({
                  ...f,
                  ...soldProductsCustomerIdPatch(sel?.id ?? ""),
                  customerTaxId: sel?.taxId ?? "",
                }))
              }
              onClear={() =>
                setDraftFilters((f) => ({
                  ...f,
                  customerId: "",
                  customerName: "",
                  customerTaxId: "",
                }))
              }
            />
            <FilterSearchableSelect
              label="CNPJ/CPF cliente"
              value={draftFilters.customerTaxId}
              onChange={(customerTaxId) =>
                setDraftFilters((f) => ({
                  ...f,
                  customerTaxId,
                  customerName: "",
                  customerId: syncCustomerIdFromTaxId(customerTaxId, filterOptions.customers),
                }))
              }
              options={taxIdSelectOptions}
              placeholder="Todos os CNPJ/CPF"
              searchInputPlaceholder="Buscar documento…"
              disabled={filterOptionsLoading}
            />
            <FilterSearchableSelect
              label="Produto"
              value={draftFilters.productId}
              onChange={(productId) =>
                setDraftFilters((f) => ({
                  ...f,
                  ...soldProductsProductIdPatch(productId),
                }))
              }
              options={productSelectOptions}
              placeholder="Todos os produtos"
              searchInputPlaceholder="Buscar código ou nome…"
              disabled={filterOptionsLoading}
            />
            <FilterSearchableSelect
              label="Vendedor / responsável"
              value={draftFilters.sellerKey}
              onChange={(sellerKey) => setDraftFilters((f) => ({ ...f, sellerKey }))}
              options={sellerSelectOptions}
              placeholder="Todos os vendedores"
              searchInputPlaceholder="Buscar vendedor…"
              disabled={filterOptionsLoading}
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
              label="Tipo de cliente"
              value={draftFilters.customerScope}
              onChange={(v) =>
                setDraftFilters((f) => ({
                  ...f,
                  customerScope: v as SoldProductsUiFilters["customerScope"],
                }))
              }
              options={SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
        </FinanceBiFilterPanel>

        <FinanceDetailTabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

        {activeTab === "overview" ? (
          <div className="space-y-5">
            <PeriodContextBar
              periodLabel={applied?.periodLabel}
              productCount={summary?.productsCount}
              loading={loading}
            />

            <ExecutiveSummarySection
              title="Resumo de produtos vendidos"
              eyebrow="Indicadores consolidados do período filtrado"
              testId="sold-products-kpi-summary"
            >
              <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
                <FinanceExecutiveTotalizerCard
                  icon={Package}
                  label="Quantidade total vendida"
                  value="—"
                  amount={loading ? undefined : summary?.totalQuantity}
                  amountFormat="number"
                  loading={loading}
                />
                <FinanceExecutiveTotalizerCard
                  icon={TrendingUp}
                  label="Valor total vendido"
                  value="—"
                  amount={loading ? undefined : summary?.totalAmount}
                  amountFormat="currency"
                  loading={loading}
                />
                <FinanceExecutiveTotalizerCard
                  icon={BarChart3}
                  label="Produtos no ranking"
                  value="—"
                  amount={loading ? undefined : summary?.productsCount}
                  amountFormat="number"
                  loading={loading}
                />
                <FinanceExecutiveTotalizerCard
                  icon={Users}
                  label="Clientes compradores"
                  value="—"
                  amount={loading ? undefined : summary?.customersCount}
                  amountFormat="number"
                  loading={loading}
                />
              </SummaryKpiGrid>
            </ExecutiveSummarySection>

            <div className="flex gap-3 overflow-x-auto pb-1">
              <SecondaryStat label="Pedidos" value={String(summary?.ordersCount ?? "—")} />
              <SecondaryStat
                label="Preço médio"
                value={summary?.averageUnitPrice != null ? fmtMoney(summary.averageUnitPrice) : "—"}
              />
              <SecondaryStat
                label="Líder em qtd"
                value={summary?.topProductByQuantity?.productCode ?? "—"}
              />
              <SecondaryStat
                label="Líder em valor"
                value={summary?.topProductByAmount?.productCode ?? "—"}
              />
            </div>

            <ReportSection
              title="Top 10 por quantidade"
              description="Visualização rápida dos produtos com maior volume no período."
            >
              {chartData.length === 0 ? (
                <FinanceBiEmptyState title="Sem dados" description="Ajuste os filtros para ver o gráfico." />
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 24, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => formatNumberAdaptive(v)}
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 11, fill: "#374151" }}
                    />
                    <Tooltip
                      cursor={{ fill: "#F3F4F6" }}
                      formatter={(v: number) => [fmtQty(v), "Quantidade"]}
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                      }
                    />
                    <Bar dataKey="quantity" fill="#2563EB" radius={[0, 6, 6, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ReportSection>

            <ReportSection
              id="ranking-completo"
              title="Ranking completo de produtos"
              description={`${displayedRankingRows.length} produtos · clique nos cabeçalhos para ordenar`}
              actions={exportRankingActions}
            >
              <div className="mb-4 max-w-md">
                <FilterInput
                  label="Busca rápida no ranking"
                  value={rankingSearch}
                  onChange={setRankingSearch}
                  placeholder="Filtrar por código ou nome do produto…"
                />
              </div>
              <RankingTable
                rows={displayedRankingRows}
                loading={loading}
                sortState={rankingSort}
                onSort={handleRankingSort}
                appliedFilters={appliedFilters}
              />
            </ReportSection>
          </div>
        ) : null}

        {activeTab === "customerMix" ? (
          <ReportSection title="Produto x Cliente" description="Principais clientes por produto no período.">
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                    <SortableTh
                      label="Produto"
                      sortKey="productName"
                      sortState={customerMixSort}
                      onSort={handleCustomerMixSort}
                    />
                    <SortableTh
                      label="Cliente"
                      sortKey="customerName"
                      sortState={customerMixSort}
                      onSort={handleCustomerMixSort}
                    />
                    <SortableTh
                      label="Quantidade"
                      sortKey="quantitySold"
                      sortState={customerMixSort}
                      onSort={handleCustomerMixSort}
                      align="right"
                    />
                    <SortableTh
                      label="Valor"
                      sortKey="amountSold"
                      sortState={customerMixSort}
                      onSort={handleCustomerMixSort}
                      align="right"
                    />
                    <SortableTh
                      label="% no produto"
                      sortKey="customerSharePercent"
                      sortState={customerMixSort}
                      onSort={handleCustomerMixSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {displayedCustomerMixRows.map((r, i) => (
                    <tr key={`${r.productId}-${r.customerId}-${i}`} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                      <td className="px-3 py-2.5">{r.productName}</td>
                      <td className="px-3 py-2.5">{r.customerName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantitySold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.amountSold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.customerSharePercent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && displayedCustomerMixRows.length === 0 ? (
              <FinanceBiEmptyState title="Sem mix" description="Nenhum produto/cliente no período." />
            ) : null}
          </ReportSection>
        ) : null}

        {activeTab === "monthly" ? (
          <ReportSection title="Evolução mensal" description="Quantidade e valor por produto e mês.">
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                    <SortableTh
                      label="Produto"
                      sortKey="productName"
                      sortState={monthlySort}
                      onSort={handleMonthlySort}
                    />
                    <SortableTh
                      label="Mês/Ano"
                      sortKey="period"
                      sortState={monthlySort}
                      onSort={handleMonthlySort}
                    />
                    <SortableTh
                      label="Quantidade"
                      sortKey="quantitySold"
                      sortState={monthlySort}
                      onSort={handleMonthlySort}
                      align="right"
                    />
                    <SortableTh
                      label="Valor"
                      sortKey="amountSold"
                      sortState={monthlySort}
                      onSort={handleMonthlySort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {displayedMonthlyRows.map((r, i) => (
                    <tr key={`${r.productId}-${r.year}-${r.month}-${i}`} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                      <td className="px-3 py-2.5">{r.productName}</td>
                      <td className="px-3 py-2.5">
                        {String(r.month).padStart(2, "0")}/{r.year}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantitySold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.amountSold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>
        ) : null}

        {activeTab === "ncm" ? (
          <ReportSection
            title="NCM x Produto"
            description={
              data
                ? `${data.ncmSummary.productsCount} produto(s) · Qtd. ${fmtQty(
                    data.ncmSummary.totalQuantity
                  )} · ${fmtMoney(data.ncmSummary.totalSoldValue)}${
                    data.ncmSummary.productsWithoutNcmCount > 0
                      ? ` · ${data.ncmSummary.productsWithoutNcmCount} produto(s) sem NCM`
                      : ""
                  }`
                : "NCM cadastral atual (sync Nomus) por produto vendido no período."
            }
          >
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                    <th className="px-3 py-2.5">NCM</th>
                    <th className="px-3 py-2.5">Produto</th>
                    <th className="px-3 py-2.5 text-right">Quantidade Vendida</th>
                    <th className="px-3 py-2.5 text-right">Valor Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.ncmByProduct ?? []).map((r, i) => (
                    <tr
                      key={`${r.productId ?? r.sku}-${i}`}
                      className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]"
                    >
                      <td className="px-3 py-2.5 tabular-nums">
                        {r.ncm ?? (
                          <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[11px] font-semibold text-[#92400E]">
                            Sem NCM
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.sku} · {r.productName}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantitySold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.soldValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && (data?.ncmByProduct ?? []).length === 0 ? (
              <FinanceBiEmptyState
                title="Sem produtos"
                description="Nenhum produto vendido no período filtrado."
              />
            ) : null}
          </ReportSection>
        ) : null}

        {activeTab === "detail" ? (
          <ReportSection
            title="Detalhamento analítico"
            description="Itens de pedido que compõem o relatório."
            actions={exportRankingActions}
          >
            <DetailTable
              rows={displayedDetailRows}
              loading={loading}
              sortState={detailSort}
              onSort={handleDetailSort}
            />
            {data?.detailPagination ? (
              <div className="mt-4 flex items-center justify-between text-sm text-[#6B7280]">
                <span>
                  Página {data.detailPagination.page} de {data.detailPagination.totalPages} ·{" "}
                  {data.detailPagination.total} itens
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={detailPage <= 1 || loading}
                    onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                    className={financeBiButtonOutlineClass}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={detailPage >= data.detailPagination.totalPages || loading}
                    onClick={() => setDetailPage((p) => p + 1)}
                    className={financeBiButtonOutlineClass}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            ) : null}
          </ReportSection>
        ) : null}
      </FinanceBiDashboardShell>

      {data && typeof document !== "undefined"
        ? createPortal(
            <SoldProductsPrintDocument payload={data} branding={branding} />,
            document.body
          )
        : null}
    </>
  );
}

function RankingTable({
  rows,
  loading,
  sortState,
  onSort,
  appliedFilters,
}: {
  rows: SoldProductsRankingRow[];
  loading: boolean;
  sortState: SortState<RankingSortKey>;
  onSort: (key: RankingSortKey) => void;
  appliedFilters: SoldProductsUiFilters;
}) {
  if (!loading && rows.length === 0) {
    return <FinanceBiEmptyState title="Sem ranking" description="Nenhum produto vendido no período." />;
  }

  return (
    <div className="overflow-x-auto -mx-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#F9FAFB] shadow-[0_1px_0_#E5E7EB]">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            <SortableTh label="#" sortKey="rank" sortState={sortState} onSort={onSort} className="w-12" />
            <SortableTh label="Código" sortKey="productCode" sortState={sortState} onSort={onSort} className="w-28" />
            <SortableTh label="Produto" sortKey="productName" sortState={sortState} onSort={onSort} className="min-w-[220px]" />
            <SortableTh label="Qtd vendida" sortKey="quantitySold" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Valor vendido" sortKey="amountSold" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Preço médio" sortKey="averageUnitPrice" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Pedidos" sortKey="ordersCount" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Clientes" sortKey="customersCount" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Última venda" sortKey="lastSaleDate" sortState={sortState} onSort={onSort} />
            <SortableTh label="% qtd" sortKey="quantitySharePercent" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="% valor" sortKey="amountSharePercent" sortState={sortState} onSort={onSort} align="right" />
            <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] w-28">
              Ação
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F3F4F6] animate-pulse">
                  <td colSpan={12} className="px-3 py-4">
                    <div className="h-4 bg-[#F3F4F6] rounded w-full" />
                  </td>
                </tr>
              ))
            : rows.map((r) => (
                <tr key={r.productId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold ${rankBadgeClass(r.rank)}`}
                    >
                      {r.rank}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-[#374151]">{r.productCode ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      to={buildSoldProductCustomersPath(r.productId, appliedFilters)}
                      className="font-medium text-[#111827] leading-snug hover:text-[#2563EB] hover:underline"
                      title="Ver clientes compradores"
                    >
                      {r.productName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#111827]">
                    {fmtQty(r.quantitySold)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.amountSold)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.averageUnitPrice != null ? fmtMoney(r.averageUnitPrice) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.ordersCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.customersCount}</td>
                  <td className="px-3 py-2.5 text-[#6B7280] whitespace-nowrap">{r.lastSaleDate ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.quantitySharePercent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.amountSharePercent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      to={buildSoldProductCustomersPath(r.productId, appliedFilters)}
                      className="inline-flex items-center rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1 text-xs font-semibold text-[#2563EB] hover:bg-[#DBEAFE] transition-colors"
                    >
                      Ver clientes
                    </Link>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailTable({
  rows,
  loading,
  sortState,
  onSort,
}: {
  rows: SoldProductsDashboardPayload["detailRows"];
  loading: boolean;
  sortState: SortState<DetailSortKey>;
  onSort: (key: DetailSortKey) => void;
}) {
  if (!loading && rows.length === 0) {
    return <FinanceBiEmptyState title="Sem detalhamento" description="Nenhum item no período." />;
  }
  return (
    <div className="overflow-x-auto -mx-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#F9FAFB] shadow-[0_1px_0_#E5E7EB]">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            <SortableTh label="Data" sortKey="orderDate" sortState={sortState} onSort={onSort} />
            <SortableTh label="Pedido" sortKey="orderCode" sortState={sortState} onSort={onSort} />
            <SortableTh label="Cliente" sortKey="customerName" sortState={sortState} onSort={onSort} />
            <SortableTh label="CNPJ/CPF" sortKey="customerTaxId" sortState={sortState} onSort={onSort} />
            <SortableTh label="Produto" sortKey="productName" sortState={sortState} onSort={onSort} />
            <SortableTh label="Qtd" sortKey="quantity" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Unit." sortKey="unitPrice" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Total" sortKey="lineAmount" sortState={sortState} onSort={onSort} align="right" />
            <SortableTh label="Empresa" sortKey="companyLabel" sortState={sortState} onSort={onSort} />
            <SortableTh label="Vendedor" sortKey="sellerName" sortState={sortState} onSort={onSort} />
            <SortableTh label="Status" sortKey="orderStatusLabel" sortState={sortState} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.orderId}-${r.productCode}-${i}`} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
              <td className="px-3 py-2.5 whitespace-nowrap">{r.orderDate}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{r.orderCode}</td>
              <td className="px-3 py-2.5">{r.customerName}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-[#6B7280]">{r.customerTaxId ?? "—"}</td>
              <td className="px-3 py-2.5">
                {r.productCode ? (
                  <span className="font-mono text-xs text-[#6B7280] mr-1">[{r.productCode}]</span>
                ) : null}
                {r.productName}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantity)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.unitPrice)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmtMoney(r.lineAmount)}</td>
              <td className="px-3 py-2.5 text-[#6B7280]">{r.companyLabel ?? "—"}</td>
              <td className="px-3 py-2.5 text-[#6B7280]">{r.sellerName ?? "—"}</td>
              <td className="px-3 py-2.5 text-[#6B7280]">{r.orderStatusLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
