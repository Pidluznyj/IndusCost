import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency } from "@/src/lib/utils";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import {
  SalesOrderManagementKpiDashboard,
  type SalesOrderManagementKpiFilterHandlers,
} from "@/src/components/sales/SalesOrderManagementKpiDashboard";
import type {
  SalesOrderManagementCardAmounts,
  SalesOrderManagementCards,
  SalesOrderManagementMarginEconomics,
  SalesOrderManagementRow,
  SalesOrderManagementSummary,
} from "@/src/lib/salesOrderManagementTypes";
import type {
  SalesOrderManagementOfficialMetrics,
  SalesOrderManagementSourceAudit,
} from "@/src/lib/salesOrderManagementMetrics";
import {
  getSalesOrderIntelligenceApiPath,
  getSalesOrderManagementApiPath,
} from "@/src/lib/salesOrderManagementTypes";
import type { SalesOrderIntelligencePayload } from "@/src/lib/salesOrderIntelligence";
import {
  buildManagementDashboardCardsFromAggregates,
  emptyManagementStatusCardAmounts,
  emptyManagementStatusCardCounts,
  getManagementStatusFilterLabel,
  type ManagementDashboardCard,
  type ManagementStatusCardId,
} from "@/src/lib/salesOrderManagementStatus";
import {
  COMPLETION_STATUS_LABELS,
  formatDeadlineBadge,
  formatInvoiceBadge,
  formatProductionBadge,
  formatSalesOrderDate,
  formatSalesOrderPercent,
} from "@/src/lib/salesOrderManagementUi";
import type {
  SalesOrderFulfillmentCharts,
  SalesOrderFulfillmentKpis,
  SalesOrderManagementSortKey,
} from "@/src/lib/salesOrderManagementFulfillment";
const SalesOrderManagementFulfillmentChartsLazy = lazy(async () => {
  const mod = await import("@/src/components/sales/SalesOrderManagementFulfillmentPanel");
  return { default: mod.SalesOrderManagementFulfillmentCharts };
});

function FulfillmentChartsSkeleton() {
  return (
    <div
      className="rounded-xl border border-border bg-card shadow-sm p-4 min-h-[280px] animate-pulse"
      data-testid="sales-order-fulfillment-charts-skeleton"
      aria-hidden
    />
  );
}
import { cn } from "@/src/lib/utils";
import { SalesOrderIntelligenceDrawer } from "@/src/components/sales/SalesOrderIntelligenceDrawer";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import {
  pickSalesOrderListMarginPercent,
  pickSalesOrderListMarginValue,
} from "@/src/lib/salesOrderMarginDisplay";
import {
  downloadInternalMarginExport,
  getSalesOrderManagementInternalMarginExportUrl,
} from "@/src/lib/salesOrderInternalMarginExportUi";
import { SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER } from "@/src/lib/salesOrderInternalMarginExport";
import { SalesOrderManagementFiltersBar } from "@/src/components/sales/SalesOrderManagementFiltersBar";
import type { SalesOrderMarginStatusFilter } from "@/src/lib/salesOrderManagementMargin";
import { SALES_ORDER_MARGIN_STATUS_FILTER_OPTIONS } from "@/src/lib/salesOrderManagementMargin";
import {
  buildAdvancedFilterChips,
  countActiveAdvancedFilters,
  type SalesOrderManagementAdvancedFilterChip,
} from "@/src/lib/salesOrderManagementFilterUx";

const TABLE_COLSPAN = 23;

type ManagementResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  cards: SalesOrderManagementCards;
  cardAmounts?: SalesOrderManagementCardAmounts;
  dashboardCards?: ManagementDashboardCard[];
  summary?: SalesOrderManagementSummary;
  fulfillmentKpis?: SalesOrderFulfillmentKpis;
  fulfillmentCharts?: SalesOrderFulfillmentCharts;
  marginEconomics?: SalesOrderManagementMarginEconomics;
  officialMetrics?: SalesOrderManagementOfficialMetrics;
  sourceAudit?: SalesOrderManagementSourceAudit;
  rows: SalesOrderManagementRow[];
};

const PAGE_SIZE = 20;

const EMPTY_CARDS = emptyManagementStatusCardCounts();
const EMPTY_CARD_AMOUNTS = emptyManagementStatusCardAmounts();

function badgeClass(kind: "status" | "deadline" | "invoice" | "op" | "risk"): string {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";
  if (kind === "risk") return `${base} bg-red-100 text-red-800`;
  if (kind === "deadline") return `${base} bg-amber-100 text-amber-900`;
  if (kind === "invoice") return `${base} bg-blue-100 text-blue-900`;
  if (kind === "op") return `${base} bg-violet-100 text-violet-900`;
  return `${base} bg-slate-100 text-slate-800`;
}

export function SalesOrderManagementPage() {
  const currentYear = new Date().getFullYear();
  const [rows, setRows] = useState<SalesOrderManagementRow[]>([]);
  const [cards, setCards] = useState<SalesOrderManagementCards>(EMPTY_CARDS);
  const [cardAmounts, setCardAmounts] = useState<SalesOrderManagementCardAmounts>(EMPTY_CARD_AMOUNTS);
  const [dashboardCards, setDashboardCards] = useState<ManagementDashboardCard[]>([]);
  const [managementSummary, setManagementSummary] = useState<SalesOrderManagementSummary | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(
    null
  );
  const [responsible, setResponsible] = useState("");
  const [companyIssuer, setCompanyIssuer] = useState("");
  const [operationalStatus, setOperationalStatus] = useState("");
  const [deadlineStatus, setDeadlineStatus] = useState("");
  const [completionStatus, setCompletionStatus] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [productionFilter, setProductionFilter] = useState("");
  const [withRisk, setWithRisk] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [invoiceAfterDeadline, setInvoiceAfterDeadline] = useState(false);
  const [partialOrCut, setPartialOrCut] = useState(false);
  const [noProductionOrder, setNoProductionOrder] = useState(false);
  const [productionLate, setProductionLate] = useState(false);
  const [selectedManagementStatus, setSelectedManagementStatus] =
    useState<ManagementStatusCardId | "">("");
  const [deliveryYear, setDeliveryYear] = useState("");
  const [deliveryMonth, setDeliveryMonth] = useState("");
  const [nfeYear, setNfeYear] = useState("");
  const [nfeMonth, setNfeMonth] = useState("");
  const [prazoFilter, setPrazoFilter] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("");
  const [invoiceCoverage, setInvoiceCoverage] = useState("");
  const [reviewDataFilter, setReviewDataFilter] = useState("");
  const [cutFilter, setCutFilter] = useState("");
  const [marginStatusFilter, setMarginStatusFilter] = useState<SalesOrderMarginStatusFilter>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SalesOrderManagementSortKey>("issueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [fulfillmentKpis, setFulfillmentKpis] = useState<SalesOrderFulfillmentKpis | null>(null);
  const [fulfillmentCharts, setFulfillmentCharts] = useState<SalesOrderFulfillmentCharts | null>(
    null
  );
  const [marginEconomics, setMarginEconomics] =
    useState<SalesOrderManagementMarginEconomics | null>(null);
  const [officialMetrics, setOfficialMetrics] =
    useState<SalesOrderManagementOfficialMetrics | null>(null);
  const [sourceAudit, setSourceAudit] = useState<SalesOrderManagementSourceAudit | null>(null);
  const [exportingInternal, setExportingInternal] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<SalesOrderManagementRow | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [intelPayload, setIntelPayload] = useState<SalesOrderIntelligencePayload | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchDraft]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    if (customerId) params.set("customerId", customerId);
    if (responsible.trim()) params.set("responsible", responsible.trim());
    if (companyIssuer.trim()) params.set("companyIssuer", companyIssuer.trim());
    if (operationalStatus) params.set("operationalStatus", operationalStatus);
    if (deadlineStatus) params.set("deadlineStatus", deadlineStatus);
    if (completionStatus) params.set("completionStatus", completionStatus);
    if (billingStatus) params.set("billingStatus", billingStatus);
    if (invoiceFilter === "true") params.set("hasInvoice", "true");
    if (invoiceFilter === "false") params.set("hasInvoice", "false");
    if (productionFilter === "true") params.set("hasProductionOrder", "true");
    if (productionFilter === "false") params.set("hasProductionOrder", "false");
    if (productionFilter === "late") params.set("productionLate", "true");
    if (withRisk) params.set("withRisk", "true");
    if (overdueOnly) params.set("overdueOnly", "true");
    if (invoiceAfterDeadline) params.set("invoiceAfterDeadline", "true");
    if (partialOrCut) params.set("partialOrCut", "true");
    if (noProductionOrder) params.set("noProductionOrder", "true");
    if (productionLate) params.set("productionLate", "true");
    if (selectedManagementStatus) params.set("logisticStatus", selectedManagementStatus);
    if (deliveryYear) params.set("deliveryYear", deliveryYear);
    if (deliveryMonth) params.set("deliveryMonth", deliveryMonth);
    if (nfeYear) params.set("nfeYear", nfeYear);
    if (nfeMonth) params.set("nfeMonth", nfeMonth);
    if (prazoFilter) params.set("prazoFilter", prazoFilter);
    if (fulfillmentFilter) params.set("fulfillmentFilter", fulfillmentFilter);
    if (invoiceCoverage) params.set("invoiceCoverage", invoiceCoverage);
    if (reviewDataFilter === "true") params.set("needsDataReview", "true");
    if (reviewDataFilter === "false") params.set("needsDataReview", "false");
    if (cutFilter === "true") params.set("hasCut", "true");
    if (cutFilter === "false") params.set("hasCut", "false");
    if (marginStatusFilter) params.set("marginStatus", marginStatusFilter);
    if (invoiceNumber.trim()) params.set("invoiceNumber", invoiceNumber.trim());
    if (search) params.set("q", search);
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    return params.toString();
  }, [
    page,
    year,
    month,
    customerId,
    responsible,
    companyIssuer,
    operationalStatus,
    deadlineStatus,
    completionStatus,
    billingStatus,
    invoiceFilter,
    productionFilter,
    withRisk,
    overdueOnly,
    invoiceAfterDeadline,
    partialOrCut,
    noProductionOrder,
    productionLate,
    selectedManagementStatus,
    deliveryYear,
    deliveryMonth,
    nfeYear,
    nfeMonth,
    prazoFilter,
    fulfillmentFilter,
    invoiceCoverage,
    reviewDataFilter,
    cutFilter,
    marginStatusFilter,
    invoiceNumber,
    search,
    sortBy,
    sortDir,
  ]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJsonOk<ManagementResponse>(
        getSalesOrderManagementApiPath(queryString),
        { signal }
      );
      setRows(data.rows ?? []);
      setCards(data.cards ?? EMPTY_CARDS);
      setCardAmounts(data.cardAmounts ?? EMPTY_CARD_AMOUNTS);
      setDashboardCards(data.dashboardCards ?? []);
      setManagementSummary(data.summary ?? null);
      setFulfillmentKpis(data.fulfillmentKpis ?? null);
      setFulfillmentCharts(data.fulfillmentCharts ?? null);
      setMarginEconomics(data.marginEconomics ?? null);
      setOfficialMetrics(data.officialMetrics ?? null);
      setSourceAudit(data.sourceAudit ?? null);
      setTotal(data.total ?? 0);
      setTotalPages(Math.max(1, data.totalPages ?? 1));
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      console.error(e);
      setLoadError("Não foi possível carregar a Gestão de Pedidos.");
      setRows([]);
      setCards(EMPTY_CARDS);
      setCardAmounts(EMPTY_CARD_AMOUNTS);
      setDashboardCards([]);
      setManagementSummary(null);
      setFulfillmentKpis(null);
      setFulfillmentCharts(null);
      setMarginEconomics(null);
      setOfficialMetrics(null);
      setSourceAudit(null);
      setTotal(0);
      setTotalPages(1);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const handleExportInternal = useCallback(async () => {
    setExportingInternal(true);
    try {
      await downloadInternalMarginExport(
        getSalesOrderManagementInternalMarginExportUrl(queryString),
        "pedidos-venda-margem-interno-management.xlsx"
      );
    } catch {
      setLoadError("Não foi possível exportar o relatório interno de margem.");
    } finally {
      setExportingInternal(false);
    }
  }, [queryString]);

  const openDrawer = useCallback(async (row: SalesOrderManagementRow) => {
    setSelectedRow(row);
    setDrawerOpen(true);
    setIntelLoading(true);
    setIntelError(null);
    setIntelPayload(null);
    try {
      const payload = await fetchJsonOk<SalesOrderIntelligencePayload>(
        getSalesOrderIntelligenceApiPath(row.id)
      );
      setIntelPayload(payload);
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : "Erro ao carregar inteligência.");
    } finally {
      setIntelLoading(false);
    }
  }, []);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) years.push(y);
    return years;
  }, [currentYear]);

  const kpiFilterHandlers = useMemo((): SalesOrderManagementKpiFilterHandlers => {
    return {
      onToggleLogisticStatus: (status) => {
        setSelectedManagementStatus((current) => (current === status ? "" : status));
        setPage(1);
      },
      onClearLogisticStatus: () => {
        setSelectedManagementStatus("");
        setPage(1);
      },
      onToggleInvoiceFilter: (value) => {
        setInvoiceFilter(value);
        setPage(1);
      },
      onToggleReviewDataFilter: (value) => {
        setReviewDataFilter(value);
        setPage(1);
      },
      onToggleCutFilter: (value) => {
        setCutFilter(value);
        setPage(1);
      },
      onToggleOverdueOnly: (value) => {
        setOverdueOnly(value);
        setPage(1);
      },
      onTogglePartialOrCut: (value) => {
        setPartialOrCut(value);
        setPage(1);
      },
      onToggleMarginStatusFilter: (status) => {
        setMarginStatusFilter(status);
        setPage(1);
      },
    };
  }, []);

  const kpiFilterState = useMemo(
    () => ({
      selectedLogisticStatus: selectedManagementStatus,
      invoiceFilter,
      reviewDataFilter,
      cutFilter,
      overdueOnly,
      partialOrCut,
      marginStatusFilter,
    }),
    [
      selectedManagementStatus,
      invoiceFilter,
      reviewDataFilter,
      cutFilter,
      overdueOnly,
      partialOrCut,
      marginStatusFilter,
    ]
  );

  const displayDashboardCards = useMemo((): ManagementDashboardCard[] => {
    if (dashboardCards.length > 0) return dashboardCards;
    if (loading || loadError) return [];
    return buildManagementDashboardCardsFromAggregates(cards, cardAmounts, {
      totalOrders: managementSummary?.totalOrdersCount,
      totalNetValue: managementSummary?.totalNetValue,
    });
  }, [cardAmounts, cards, dashboardCards, loadError, loading, managementSummary]);

  const validPortfolioCount = managementSummary?.validPortfolioCount ?? null;
  const validPortfolioValue = managementSummary?.validPortfolioValue ?? null;

  const toggleSort = useCallback(
    (key: SalesOrderManagementSortKey) => {
      setSortBy((current) => {
        if (current === key) {
          setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
          return current;
        }
        setSortDir("desc");
        return key;
      });
      setPage(1);
    },
    []
  );

  const sortIndicator = (key: SalesOrderManagementSortKey) =>
    sortBy === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const advancedFilterState = useMemo(
    () => ({
      customerId,
      customerLabel: customerSelection?.label ?? null,
      responsible,
      companyIssuer,
      operationalStatus,
      deadlineStatus,
      completionStatus,
      billingStatus,
      invoiceFilter,
      productionFilter,
      deliveryYear,
      deliveryMonth,
      nfeYear,
      nfeMonth,
      prazoFilter,
      fulfillmentFilter,
      invoiceCoverage,
      reviewDataFilter,
      cutFilter,
      invoiceNumber,
    }),
    [
      customerId,
      customerSelection?.label,
      responsible,
      companyIssuer,
      operationalStatus,
      deadlineStatus,
      completionStatus,
      billingStatus,
      invoiceFilter,
      productionFilter,
      deliveryYear,
      deliveryMonth,
      nfeYear,
      nfeMonth,
      prazoFilter,
      fulfillmentFilter,
      invoiceCoverage,
      reviewDataFilter,
      cutFilter,
      invoiceNumber,
    ]
  );

  const advancedActiveCount = useMemo(
    () => countActiveAdvancedFilters(advancedFilterState),
    [advancedFilterState]
  );

  const advancedFilterChips = useMemo(
    () => buildAdvancedFilterChips(advancedFilterState),
    [advancedFilterState]
  );

  const resetPage = useCallback(() => setPage(1), []);

  const clearAllFilters = useCallback(() => {
    setYear(String(currentYear));
    setMonth("");
    setCustomerId("");
    setCustomerSelection(null);
    setResponsible("");
    setCompanyIssuer("");
    setOperationalStatus("");
    setDeadlineStatus("");
    setCompletionStatus("");
    setBillingStatus("");
    setInvoiceFilter("");
    setProductionFilter("");
    setWithRisk(false);
    setOverdueOnly(false);
    setInvoiceAfterDeadline(false);
    setPartialOrCut(false);
    setNoProductionOrder(false);
    setProductionLate(false);
    setSelectedManagementStatus("");
    setDeliveryYear("");
    setDeliveryMonth("");
    setNfeYear("");
    setNfeMonth("");
    setPrazoFilter("");
    setFulfillmentFilter("");
    setInvoiceCoverage("");
    setReviewDataFilter("");
    setCutFilter("");
    setInvoiceNumber("");
    setSearchDraft("");
    setSearch("");
    setSortBy("issueDate");
    setSortDir("desc");
    setPage(1);
  }, [currentYear]);

  const clearAdvancedFilterChip = useCallback(
    (id: SalesOrderManagementAdvancedFilterChip["id"]) => {
      switch (id) {
        case "customerId":
          setCustomerId("");
          setCustomerSelection(null);
          break;
        case "responsible":
          setResponsible("");
          break;
        case "companyIssuer":
          setCompanyIssuer("");
          break;
        case "operationalStatus":
          setOperationalStatus("");
          break;
        case "deadlineStatus":
          setDeadlineStatus("");
          break;
        case "completionStatus":
          setCompletionStatus("");
          break;
        case "billingStatus":
          setBillingStatus("");
          break;
        case "invoiceFilter":
          setInvoiceFilter("");
          break;
        case "productionFilter":
          setProductionFilter("");
          break;
        case "deliveryYear":
          setDeliveryYear("");
          break;
        case "deliveryMonth":
          setDeliveryMonth("");
          break;
        case "nfeYear":
          setNfeYear("");
          break;
        case "nfeMonth":
          setNfeMonth("");
          break;
        case "prazoFilter":
          setPrazoFilter("");
          break;
        case "fulfillmentFilter":
          setFulfillmentFilter("");
          break;
        case "invoiceCoverage":
          setInvoiceCoverage("");
          break;
        case "reviewDataFilter":
          setReviewDataFilter("");
          break;
        case "cutFilter":
          setCutFilter("");
          break;
        case "invoiceNumber":
          setInvoiceNumber("");
          break;
        default:
          break;
      }
      setPage(1);
    },
    []
  );

  return (
    <div className="space-y-6" data-testid="sales-order-management-page">
      <div
        className="rounded-lg border border-amber-300/80 bg-amber-50/80 px-4 py-2 text-xs text-amber-950 print:block"
        data-testid="sales-order-internal-margin-disclaimer"
      >
        {SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER}
      </div>
      {sourceAudit ? (
        <div
          className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1"
          data-testid="sales-order-management-source-audit"
        >
          <p className="font-semibold text-foreground">Fontes dos indicadores (auditoria)</p>
          <p>
            Pedido/valor vendido: <span className="font-mono">{sourceAudit.orderValueSource}</span> ·
            Margem: <span className="font-mono">{sourceAudit.marginSource}</span> · Faturamento
            fiscal: <span className="font-mono">{sourceAudit.invoicedFiscalSource}</span>
          </p>
          <p>
            Vendedor: {sourceAudit.sellerSource} · Pedidos no filtro:{" "}
            {sourceAudit.filteredOrdersCount}
            {sourceAudit.lastNomusSyncAt
              ? ` · Última atualização Nomus: ${new Date(sourceAudit.lastNomusSyncAt).toLocaleString("pt-BR")}`
              : null}
          </p>
          {(sourceAudit.itemsWithoutCost > 0 ||
            sourceAudit.itemsWithoutProduct > 0 ||
            sourceAudit.itemsWithNegativeMargin > 0) && (
            <p>
              Itens sem custo: {sourceAudit.itemsWithoutCost} · sem produto:{" "}
              {sourceAudit.itemsWithoutProduct} · margem negativa:{" "}
              {sourceAudit.itemsWithNegativeMargin}
            </p>
          )}
          {sourceAudit.partialCoverageWarning ? (
            <p className="text-amber-800 dark:text-amber-200">{sourceAudit.partialCoverageWarning}</p>
          ) : null}
        </div>
      ) : null}
      <SalesOrderManagementFiltersBar
        year={year}
        month={month}
        yearOptions={yearOptions}
        searchDraft={searchDraft}
        advancedOpen={advancedFiltersOpen}
        advancedActiveCount={advancedActiveCount}
        activeChips={advancedFilterChips}
        exportingInternal={exportingInternal}
        loading={loading}
        customerSelection={customerSelection}
        responsible={responsible}
        companyIssuer={companyIssuer}
        operationalStatus={operationalStatus}
        deadlineStatus={deadlineStatus}
        completionStatus={completionStatus}
        billingStatus={billingStatus}
        invoiceFilter={invoiceFilter}
        productionFilter={productionFilter}
        deliveryYear={deliveryYear}
        deliveryMonth={deliveryMonth}
        nfeYear={nfeYear}
        nfeMonth={nfeMonth}
        prazoFilter={prazoFilter}
        fulfillmentFilter={fulfillmentFilter}
        invoiceCoverage={invoiceCoverage}
        reviewDataFilter={reviewDataFilter}
        cutFilter={cutFilter}
        invoiceNumber={invoiceNumber}
        onYearChange={(value) => {
          setYear(value);
          resetPage();
        }}
        onMonthChange={(value) => {
          setMonth(value);
          resetPage();
        }}
        onSearchDraftChange={setSearchDraft}
        onToggleAdvanced={() => setAdvancedFiltersOpen((open) => !open)}
        onExportInternal={() => void handleExportInternal()}
        onClearAll={clearAllFilters}
        onClearAdvancedChip={clearAdvancedFilterChip}
        onCustomerChange={(sel) => {
          setCustomerSelection(sel);
          setCustomerId(sel?.id ?? "");
          resetPage();
        }}
        onCustomerClear={() => {
          setCustomerSelection(null);
          setCustomerId("");
          resetPage();
        }}
        onResponsibleChange={(value) => {
          setResponsible(value);
          resetPage();
        }}
        onCompanyIssuerChange={(value) => {
          setCompanyIssuer(value);
          resetPage();
        }}
        onOperationalStatusChange={(value) => {
          setOperationalStatus(value);
          resetPage();
        }}
        onDeadlineStatusChange={(value) => {
          setDeadlineStatus(value);
          resetPage();
        }}
        onCompletionStatusChange={(value) => {
          setCompletionStatus(value);
          resetPage();
        }}
        onBillingStatusChange={(value) => {
          setBillingStatus(value);
          resetPage();
        }}
        onInvoiceFilterChange={(value) => {
          setInvoiceFilter(value);
          resetPage();
        }}
        onProductionFilterChange={(value) => {
          setProductionFilter(value);
          resetPage();
        }}
        onDeliveryYearChange={(value) => {
          setDeliveryYear(value);
          resetPage();
        }}
        onDeliveryMonthChange={(value) => {
          setDeliveryMonth(value);
          resetPage();
        }}
        onNfeYearChange={(value) => {
          setNfeYear(value);
          resetPage();
        }}
        onNfeMonthChange={(value) => {
          setNfeMonth(value);
          resetPage();
        }}
        onPrazoFilterChange={(value) => {
          setPrazoFilter(value);
          resetPage();
        }}
        onFulfillmentFilterChange={(value) => {
          setFulfillmentFilter(value);
          resetPage();
        }}
        onInvoiceCoverageChange={(value) => {
          setInvoiceCoverage(value);
          resetPage();
        }}
        onReviewDataFilterChange={(value) => {
          setReviewDataFilter(value);
          resetPage();
        }}
        onCutFilterChange={(value) => {
          setCutFilter(value);
          resetPage();
        }}
        onInvoiceNumberChange={(value) => {
          setInvoiceNumber(value);
          resetPage();
        }}
      />

      <SalesOrderManagementKpiDashboard
        loading={loading}
        loadError={loadError}
        fulfillmentKpis={fulfillmentKpis}
        officialMetrics={officialMetrics}
        marginEconomics={marginEconomics}
        managementSummary={managementSummary}
        displayDashboardCards={displayDashboardCards}
        logisticCards={cards}
        filterState={kpiFilterState}
        filterHandlers={kpiFilterHandlers}
        validPortfolioCount={validPortfolioCount}
        validPortfolioValue={validPortfolioValue}
      />

      {!loading && fulfillmentCharts ? (
        <Suspense fallback={<FulfillmentChartsSkeleton />}>
          <SalesOrderManagementFulfillmentChartsLazy charts={fulfillmentCharts} />
        </Suspense>
      ) : loading ? (
        <FulfillmentChartsSkeleton />
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Alertas operacionais
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={withRisk}
            onChange={(e) => {
              setWithRisk(e.target.checked);
              setPage(1);
            }}
          />
          Com risco
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => {
              setOverdueOnly(e.target.checked);
              setPage(1);
            }}
          />
          Atrasados
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={noProductionOrder}
            onChange={(e) => {
              setNoProductionOrder(e.target.checked);
              setPage(1);
            }}
          />
          Sem OP
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={invoiceAfterDeadline}
            onChange={(e) => {
              setInvoiceAfterDeadline(e.target.checked);
              setPage(1);
            }}
          />
          NF após prazo
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={partialOrCut}
            onChange={(e) => {
              setPartialOrCut(e.target.checked);
              setPage(1);
            }}
          />
          Parcial / com corte
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={productionLate}
            onChange={(e) => {
              setProductionLate(e.target.checked);
              setPage(1);
            }}
          />
          OP atrasada
        </label>
        </div>
      </div>

      {selectedManagementStatus ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          <span>
            Exibindo <span className="font-semibold">{total}</span> pedido(s) com status:{" "}
            <span className="font-semibold">
              {getManagementStatusFilterLabel(selectedManagementStatus)}
            </span>
          </span>
          <button
            type="button"
            data-testid="clear-management-status-filter"
            onClick={() => {
              setSelectedManagementStatus("");
              setPage(1);
            }}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Limpar filtro do card
          </button>
        </div>
      ) : null}

      {marginStatusFilter ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-violet-300/50 bg-violet-50/80 px-4 py-2 text-sm"
          data-testid="sales-order-management-margin-status-filter-chip"
        >
          <span>
            Exibindo pedidos com status de margem:{" "}
            <span className="font-semibold">
              {SALES_ORDER_MARGIN_STATUS_FILTER_OPTIONS.find((o) => o.value === marginStatusFilter)
                ?.label ?? marginStatusFilter}
            </span>
          </span>
          <button
            type="button"
            data-testid="clear-management-margin-status-filter"
            onClick={() => {
              setMarginStatusFilter("");
              setPage(1);
            }}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Limpar filtro de margem
          </button>
        </div>
      ) : null}

      {loadError ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="sales-order-management-error"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {loading ? (
          "Carregando gestão de pedidos…"
        ) : loadError ? (
          "Falha ao carregar pedidos."
        ) : total === 0 ? (
          year === "all"
            ? "Nenhum pedido encontrado para os filtros aplicados."
            : "Nenhum pedido encontrado para o ano selecionado."
        ) : (
          <>
            Exibindo página <span className="font-semibold text-foreground">{page}</span> de{" "}
            <span className="font-semibold text-foreground">{totalPages}</span> ·{" "}
            <span className="font-semibold text-foreground">{total}</span> pedido(s) no filtro
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="sales-order-management-row-hint">
        Clique no pedido para ver dados completos da integração.
      </p>

      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table
            className="w-full text-left text-sm"
            data-testid="sales-order-management-table"
          >
            <thead className="bg-accent/50 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("number")}>
                    Pedido{sortIndicator("number")}
                  </button>
                </th>
                <th className="p-3 font-semibold">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("customerName")}>
                    Cliente{sortIndicator("customerName")}
                  </button>
                </th>
                <th className="p-3 font-semibold">Responsável CRM</th>
                <th className="p-3 font-semibold">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("sellerName")}>
                    Vendedor Nomus{sortIndicator("sellerName")}
                  </button>
                </th>
                <th className="p-3 font-semibold">Status vendedor</th>
                <th className="p-3 font-semibold">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("issueDate")}>
                    Emissão{sortIndicator("issueDate")}
                  </button>
                </th>
                <th className="p-3 font-semibold">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => toggleSort("expectedDeliveryDate")}
                  >
                    Entrega planejada{sortIndicator("expectedDeliveryDate")}
                  </button>
                </th>
                <th className="p-3 font-semibold">NF</th>
                <th className="p-3 font-semibold">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("lastInvoiceDate")}>
                    Data NF{sortIndicator("lastInvoiceDate")}
                  </button>
                </th>
                <th className="p-3 font-semibold text-right">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("totalNetValue")}>
                    Valor pedido{sortIndicator("totalNetValue")}
                  </button>
                </th>
                <th className="p-3 font-semibold text-right">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("invoicedValue")}>
                    Valor faturado{sortIndicator("invoicedValue")}
                  </button>
                </th>
                <th className="p-3 font-semibold text-right">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => toggleSort("invoiceCoveragePercent")}
                  >
                    % faturado{sortIndicator("invoiceCoveragePercent")}
                  </button>
                </th>
                <th className="p-3 font-semibold">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => toggleSort("logisticStatusLabel")}
                  >
                    Status logístico{sortIndicator("logisticStatusLabel")}
                  </button>
                </th>
                <th className="p-3 font-semibold text-right">Margem comercial %</th>
                <th className="p-3 font-semibold text-right hidden lg:table-cell">
                  Margem comercial R$
                </th>
                <th className="p-3 font-semibold">Status margem</th>
                <th className="p-3 font-semibold">Prazo</th>
                <th className="p-3 font-semibold text-right">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("daysOverdue")}>
                    Dias atraso{sortIndicator("daysOverdue")}
                  </button>
                </th>
                <th className="p-3 font-semibold text-right">
                  <button type="button" className="hover:underline" onClick={() => toggleSort("slaDays")}>
                    SLA{sortIndicator("slaDays")}
                  </button>
                </th>
                <th className="p-3 font-semibold">Corte</th>
                <th className="p-3 font-semibold">Revisar</th>
                <th className="p-3 font-semibold">OP</th>
                <th className="p-3 font-semibold w-28"> </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={TABLE_COLSPAN} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
                    Carregando…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={TABLE_COLSPAN} className="p-8 text-center text-destructive">
                    {loadError}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLSPAN} className="p-8 text-center text-muted-foreground">
                    {year === "all"
                      ? "Nenhum pedido encontrado para os filtros aplicados."
                      : "Nenhum pedido encontrado para o ano selecionado."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/60 hover:bg-accent/30 cursor-pointer"
                    onClick={() => void openDrawer(row)}
                    data-testid="sales-order-management-row"
                  >
                    <td className="p-3">
                      <div className="font-semibold text-primary">{row.number}</div>
                      <div className="text-[10px] text-muted-foreground">Ver detalhes</div>
                    </td>
                    <td className="p-3">{row.customerName}</td>
                    <td className="p-3">{row.crmCommercialResponsible ?? "—"}</td>
                    <td className="p-3">
                      <div className="font-medium">{row.nomusSellerDisplayName}</div>
                      {row.nomusSellerHistoricalRule ? (
                        <span className="mt-1 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-900">
                          Regra histórica anterior a 02/2026
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          row.nomusSellerStatus === "RESOLVED"
                            ? "bg-emerald-100 text-emerald-900"
                            : row.nomusSellerStatus === "HISTORICAL"
                              ? "bg-violet-100 text-violet-900"
                              : row.nomusSellerStatus === "UNRESOLVED"
                                ? "bg-red-100 text-red-900"
                                : "bg-amber-100 text-amber-900"
                        }`}
                        data-testid="sales-order-nomus-seller-status"
                      >
                        {row.nomusSellerStatusLabel}
                      </span>
                    </td>
                    <td className="p-3">{formatSalesOrderDate(row.issueDate)}</td>
                    <td className="p-3">{formatSalesOrderDate(row.expectedDeliveryDate)}</td>
                    <td className="p-3">
                      {row.invoiceNumbers.length === 0 ? (
                        <span className={badgeClass("invoice")}>Sem NF</span>
                      ) : (
                        <div
                          className="flex flex-wrap gap-1"
                          title={row.invoiceNumbers.join(", ")}
                          data-testid="sales-order-nfe-chips"
                        >
                          {row.invoiceNumbers.slice(0, 3).map((num) => (
                            <span
                              key={num}
                              className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900"
                            >
                              {num}
                            </span>
                          ))}
                          {row.invoiceNumbers.length > 3 ? (
                            <span className="text-[10px] text-muted-foreground">
                              +{row.invoiceNumbers.length - 3}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="p-3">{row.nfeProcessingDisplay}</td>
                    <td className="p-3 text-right tabular-nums">{formatCurrency(row.totalNetValue)}</td>
                    <td className="p-3 text-right tabular-nums">{formatCurrency(row.invoicedValue)}</td>
                    <td className="p-3 text-right tabular-nums">
                      {formatSalesOrderPercent(row.invoiceCoveragePercent ?? row.invoicedPercent)}
                    </td>
                    <td className="p-3">
                      <span
                        className={badgeClass("status")}
                        title={row.executiveStatusLabel}
                        data-testid="sales-order-logistic-status"
                      >
                        {row.logisticStatusLabel}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "p-3 text-right tabular-nums font-mono text-xs",
                        row.marginSummary?.hasNegativeMargin && "text-red-700 font-semibold"
                      )}
                      data-testid="sales-order-management-margin-percent"
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {pickSalesOrderListMarginPercent(row.marginSummary)}
                        <SalesOrderMarginInfoTooltip
                          summary={row.marginSummary}
                          itemMargins={row.marginItems}
                          orderIssueDate={row.issueDate}
                          testId="sales-order-management-row-margin-tooltip"
                        />
                      </span>
                    </td>
                    <td
                      className={cn(
                        "p-3 text-right tabular-nums font-mono text-xs hidden lg:table-cell",
                        row.marginSummary?.hasNegativeMargin && "text-red-700 font-semibold"
                      )}
                      data-testid="sales-order-management-margin-value"
                    >
                      {pickSalesOrderListMarginValue(row.marginSummary)}
                    </td>
                    <td className="p-3" data-testid="sales-order-management-margin-status">
                      {row.marginSummary ? (
                        <SalesOrderMarginStatusBadge
                          label={row.marginSummary.statusLabel}
                          status={row.marginSummary.status}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={badgeClass(
                          row.deadlineStatus === "overdue" || row.deadlineStatus === "invoiced_late"
                            ? "deadline"
                            : "status"
                        )}
                        title={formatDeadlineBadge(
                          row.deadlineStatus,
                          row.daysOverdue,
                          row.operationalStatus
                        )}
                      >
                        {formatDeadlineBadge(
                          row.deadlineStatus,
                          row.daysOverdue,
                          row.operationalStatus
                        )}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {row.daysOverdue != null && row.daysOverdue > 0 ? row.daysOverdue : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {row.slaDays != null ? row.slaDays : "—"}
                    </td>
                    <td className="p-3">
                      <span className={row.hasCut ? badgeClass("deadline") : badgeClass("status")}>
                        {row.hasCut ? "Com corte" : "Sem corte"}
                      </span>
                    </td>
                    <td className="p-3">
                      {row.needsDataReview ? (
                        <span
                          className={badgeClass("risk")}
                          title={row.reviewReasons.join(" · ")}
                        >
                          Revisar
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={badgeClass("op")}
                        title={formatProductionBadge(
                          row.hasLinkedProductionOrder,
                          row.productionOrderLate,
                          {
                            label: row.productionOrderLabel,
                            status: row.productionOrderStatus,
                            operationalStatus: row.operationalStatus,
                          }
                        )}
                      >
                        {formatProductionBadge(
                          row.hasLinkedProductionOrder,
                          row.productionOrderLate,
                          {
                            label: row.productionOrderLabel,
                            status: row.productionOrderStatus,
                            operationalStatus: row.operationalStatus,
                          }
                        )}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDrawer(row);
                        }}
                        data-testid="sales-order-view-intelligence"
                      >
                        Ver inteligência
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">
            Página {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      ) : null}

      <SalesOrderIntelligenceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        loading={intelLoading}
        error={intelError}
        payload={intelPayload}
        marginSummary={selectedRow?.marginSummary}
        marginDetail={selectedRow?.marginDetail}
        orderLabel={
          selectedRow
            ? `${selectedRow.number} · ${selectedRow.customerName}`
            : "Pedido de venda"
        }
      />
    </div>
  );
}
