import "@/src/components/print/print-document.css";
import "@/src/components/sales/sales-order-report-print.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Download, FileText, Loader2, Package, Printer, Receipt, Search, ShoppingBag, Ticket } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { moneyAmountToFilterParam } from "@/src/lib/moneyRangeFilter";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import { formatCurrency, formatNumber, cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { SalesOrderListSummaryCards } from "@/src/components/sales/SalesOrderListSummaryCards";
import { SalesOrderListMonthlyCharts } from "@/src/components/sales/SalesOrderListMonthlyCharts";
import { SalesOrderListTable } from "@/src/components/sales/SalesOrderListTable";
import {
  SalesOrderQuickSummaryDrawer,
  type SalesOrderListRowSnapshot,
} from "@/src/components/sales/SalesOrderQuickSummaryDrawer";
import { SalesOrderMarginAnalysisSection } from "@/src/components/sales/SalesOrderMarginAnalysis";
import { SalesOrderReportPrintDocument } from "@/src/components/sales/SalesOrderReportPrintDocument";
import { SalesOrderIndustrialResultReportPrintDocument } from "@/src/components/sales/SalesOrderIndustrialResultReportPrintDocument";
import { SalesOrderDetailDialog } from "@/src/components/sales/SalesOrderDetailDialog";
import { SalesOrderReceivableStatusMultiSelect } from "@/src/components/sales/SalesOrderReceivableStatusMultiSelect";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary.js";
import type { SalesOrderListMarginSummary } from "@/src/lib/salesOrderListMarginSummary";
import type { SalesOrderItemMarginPayload } from "@/src/lib/salesOrderMarginTypes";
import { canViewSalesOrderMarginEconomics } from "@/src/lib/salesOrderListUi";
import { canExportSalesOrders } from "@/src/lib/commercialEngineeringPermissions";
import { usePermissions } from "@/src/hooks/usePermissions";
import { noteDevPerfRender } from "@/src/lib/devPerfBaselineClient";
import { ACTION_GATE_RESOURCES } from "@/src/lib/actionPermissionAccess";
import { resolveSalesOrderListSellerLabel } from "@/src/lib/salesOrderListSellerUi";
import {
  SALES_ORDER_MONTH_OPTIONS,
  buildSalesOrderYearOptions,
} from "@/src/lib/salesOrderPeriodFilter";
import { INVOICE_FILTER_OPTIONS } from "@/src/lib/salesOrderManagementUi";
import {
  downloadInternalMarginExport,
  getSalesOrderListInternalMarginExportUrl,
} from "@/src/lib/salesOrderInternalMarginExportUi";
import {
  getSalesOrderSellerFilterOptionsUrl,
} from "@/src/lib/salesOrderListReportExportUi";
import {
  getSalesOrderListMarginSummaryUrl,
  getSalesOrderListPageMarginsUrl,
} from "@/src/lib/salesOrderListMarginSummaryApi";
import {
  downloadSalesOrderReportXlsx,
  getSalesOrderReportPayloadUrl,
  getSalesOrderReportXlsxUrl,
} from "@/src/lib/sales/salesOrderReportExportUi";
import type { SalesOrderReportPayload } from "@/src/lib/sales/salesOrderReport";
import { getSalesOrderIndustrialResultReportPayloadUrl } from "@/src/lib/sales/salesOrderIndustrialResultReportExportUi";
import type { SalesOrderIndustrialResultReportPayload } from "@/src/lib/sales/salesOrderIndustrialResultReport";
import type { SalesOrderSellerFilterOption } from "@/src/lib/salesOrderNomusSellerDisplay";
import { SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER } from "@/src/lib/salesOrderInternalMarginExport";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";

/**
 * Classes canônicas da barra de filtros de Pedidos de Venda (2026-07).
 * Mantidas juntas para facilitar consistência visual — todos os controles
 * têm a mesma altura, padding e comportamento de foco.
 */
const SALES_FILTER_CONTROL_CLASS =
  "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";

/**
 * Botão de ação discreto (ghost) da barra de filtros. Sem borda no idle;
 * hover revela borda e superfície. Ícone pequeno (`h-3.5 w-3.5`). Preservado
 * o `data-testid` de cada botão para os testes existentes.
 */
const SALES_FILTER_ACTION_BUTTON_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

/** Atalhos de faixa de valor líquido — preenchem os campos livres (customizáveis). */
const SALES_ORDER_NET_VALUE_PRESETS = [
  { id: "upto-1k", label: "Até 1 mil", min: "", max: "1000" },
  { id: "1k-5k", label: "1–5 mil", min: "1000", max: "5000" },
  { id: "5k-20k", label: "5–20 mil", min: "5000", max: "20000" },
  { id: "above-20k", label: "Acima 20 mil", min: "20000", max: "" },
] as const;

/** Filtros efetivos da listagem/export — só mudam ao clicar em Pesquisar. */
type SalesOrderListAppliedFilters = {
  status: string;
  hasInvoice: string;
  receivableStatus: string;
  customerId: string;
  sellerKey: string;
  startDate: string;
  endDate: string;
  minNetValue: string;
  maxNetValue: string;
  year: string;
  month: string;
  search: string;
};

function buildInitialSalesOrderListAppliedFilters(
  year: string,
  month: string
): SalesOrderListAppliedFilters {
  return {
    status: "",
    hasInvoice: "",
    receivableStatus: "",
    customerId: "",
    sellerKey: "",
    startDate: "",
    endDate: "",
    minNetValue: "",
    maxNetValue: "",
    year,
    month,
    search: "",
  };
}

function FilterLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
    >
      {children}
    </label>
  );
}

type SalesOrderRow = SalesOrderListRowSnapshot;

type SalesOrderDetail = SalesOrderRow & {
  expectedDeliveryDate: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  internalNotes: string | null;
  totalGrossValue: unknown;
  totalDiscount: unknown;
  totalCost: unknown;
  totalTaxes: unknown;
  totalFreight: unknown;
  sentToNomusAt: string | null;
  nomusRawResponse: unknown;
  items: Array<{
    id: string;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: unknown;
    unit: string | null;
    negotiatedPrice: unknown;
    totalNetValue: unknown;
    unitCost: unknown;
    totalCost: unknown;
    marginValue: unknown;
    marginPerc: unknown;
    margin?: SalesOrderItemMarginPayload;
  }>;
};

const SALES_ORDERS_PAGE_SIZE = 20;

type SalesOrderListResponse = {
  data: SalesOrderRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary?: SalesOrderListSummary;
  marginSummary?: SalesOrderListMarginSummary;
};

const EMPTY_SALES_ORDER_LIST_SUMMARY: SalesOrderListSummary = {
  totalOrders: 0,
  totalNetAmount: 0,
  totalItems: 0,
  averageTicket: 0,
};

function isPaginatedSalesOrderList(value: unknown): value is SalesOrderListResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.data);
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

function money(v: unknown, decimals = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return formatCurrency(n, decimals);
}

function SalesOrderList() {
  noteDevPerfRender("SalesOrderList");
  const navigate = useNavigate();
  const auth = useAuth();
  const permissions = usePermissions();
  const showMarginEconomics = useMemo(
    () => canViewSalesOrderMarginEconomics(auth),
    [auth]
  );
  const allowExport =
    canExportSalesOrders(auth) ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.salesOrders, "export");
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<SalesOrderListSummary>(EMPTY_SALES_ORDER_LIST_SUMMARY);
  const [marginSummary, setMarginSummary] = useState<SalesOrderListMarginSummary | null>(null);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const yearOptions = useMemo(() => buildSalesOrderYearOptions(currentYear, 5), [currentYear]);
  const [status, setStatus] = useState("");
  const [hasInvoice, setHasInvoice] = useState("");
  const [receivableStatus, setReceivableStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(null);
  const [sellerKey, setSellerKey] = useState("");
  const [sellerFilterOptions, setSellerFilterOptions] = useState<SalesOrderSellerFilterOption[]>([]);
  const [sellerOptionsLoading, setSellerOptionsLoading] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minNetValue, setMinNetValue] = useState("");
  const [maxNetValue, setMaxNetValue] = useState("");
  const [year, setYear] = useState<string>(() => String(currentYear));
  const [month, setMonth] = useState<string>("");
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<SalesOrderListAppliedFilters>(() =>
    buildInitialSalesOrderListAppliedFilters(String(currentYear), "")
  );
  const [exportingInternal, setExportingInternal] = useState(false);
  const [exportingReportXlsx, setExportingReportXlsx] = useState(false);
  const [exportingReportPdf, setExportingReportPdf] = useState(false);
  const [exportingIndustrialPdf, setExportingIndustrialPdf] = useState(false);
  const [industrialPrintPayload, setIndustrialPrintPayload] =
    useState<SalesOrderIndustrialResultReportPayload | null>(null);
  const [industrialPrintRequestId, setIndustrialPrintRequestId] = useState(0);
  const [reportPrintPayload, setReportPrintPayload] = useState<SalesOrderReportPayload | null>(
    null
  );
  const [reportPrintRequestId, setReportPrintRequestId] = useState(0);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const brandingLoadedRef = useRef(false);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [summaryRow, setSummaryRow] = useState<SalesOrderRow | null>(null);
  // Modal Detalhe do Pedido — abre in-place (preserva filtros/paginação).
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrderCode, setDetailOrderCode] = useState<string | null>(null);

  const openDetail = useCallback((orderId: string, orderCode?: string | null) => {
    setDetailOrderId(orderId);
    setDetailOrderCode(orderCode ?? null);
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailOrderId(null);
    setDetailOrderCode(null);
  }, []);

  const handleRowOpenSummary = useCallback((row: SalesOrderRow) => {
    setSummaryRow(row);
    setSummaryDrawerOpen(true);
  }, []);

  const handleOpenDetailFromList = useCallback(
    (orderId: string) => {
      const row = rows.find((r) => r.id === orderId);
      openDetail(orderId, row?.orderCode ?? null);
    },
    [rows, openDetail]
  );

  const handleCloseSummaryDrawer = useCallback(() => {
    setSummaryDrawerOpen(false);
    setSummaryRow(null);
  }, []);

  const handleOpenDetailFromSummary = useCallback(
    (orderId: string) => {
      const code = summaryRow?.orderCode ?? null;
      setSummaryDrawerOpen(false);
      openDetail(orderId, code);
    },
    [summaryRow?.orderCode, openDetail]
  );

  const handleOpenFullAudit = useCallback(
    (id: string) => {
      closeDetail();
      navigate(`/finance/portfolio-reconciliation?auditOrderId=${encodeURIComponent(id)}`);
    },
    [closeDetail, navigate]
  );

  const selectedOrderId = summaryDrawerOpen ? summaryRow?.id ?? null : null;

  const monthlyChartsFilters = useMemo(
    () => ({
      // Gráficos ignoram filtros da tela — sempre o ano civil corrente.
      year: currentYear,
    }),
    [currentYear]
  );

  // Ref dos drafts: evita stale closure no Pesquisar / atalhos de valor líquido.
  const listFilterDraftRef = useRef({
    status,
    hasInvoice,
    receivableStatus,
    customerId,
    sellerKey,
    startDate,
    endDate,
    minNetValue,
    maxNetValue,
    year,
    month,
    searchDraft,
  });
  listFilterDraftRef.current = {
    status,
    hasInvoice,
    receivableStatus,
    customerId,
    sellerKey,
    startDate,
    endDate,
    minNetValue,
    maxNetValue,
    year,
    month,
    searchDraft,
  };

  const applyListFilters = useCallback(
    (overrides?: { minNetValue?: string; maxNetValue?: string }) => {
      const draft = listFilterDraftRef.current;
      const nextMin = moneyAmountToFilterParam(
        overrides?.minNetValue ?? draft.minNetValue
      );
      const nextMax = moneyAmountToFilterParam(
        overrides?.maxNetValue ?? draft.maxNetValue
      );
      setMinNetValue(nextMin);
      setMaxNetValue(nextMax);
      setAppliedFilters({
        status: draft.status,
        hasInvoice: draft.hasInvoice,
        receivableStatus: draft.receivableStatus,
        customerId: draft.customerId,
        sellerKey: draft.sellerKey,
        startDate: draft.startDate,
        endDate: draft.endDate,
        minNetValue: nextMin,
        maxNetValue: nextMax,
        year: draft.year,
        month: draft.month,
        search: draft.searchDraft.trim(),
      });
      setCurrentPage(1);
    },
    []
  );

  const clearListFilters = useCallback(() => {
    setStatus("");
    setHasInvoice("");
    setReceivableStatus("");
    setCustomerId("");
    setCustomerSelection(null);
    setSellerKey("");
    setStartDate("");
    setEndDate("");
    setMinNetValue("");
    setMaxNetValue("");
    setYear("");
    setMonth("");
    setSearchDraft("");
    setAppliedFilters(buildInitialSalesOrderListAppliedFilters("", ""));
    setCurrentPage(1);
  }, []);

  const listFiltersKey = useMemo(
    () => JSON.stringify(appliedFilters),
    [appliedFilters]
  );
  const sellerOptionsFiltersKey = useMemo(
    () =>
      JSON.stringify({
        status: appliedFilters.status,
        hasInvoice: appliedFilters.hasInvoice,
        receivableStatus: appliedFilters.receivableStatus,
        customerId: appliedFilters.customerId,
        startDate: appliedFilters.startDate,
        endDate: appliedFilters.endDate,
        minNetValue: appliedFilters.minNetValue,
        maxNetValue: appliedFilters.maxNetValue,
        year: appliedFilters.year,
        month: appliedFilters.month,
        search: appliedFilters.search,
      }),
    [appliedFilters]
  );
  const prevListFiltersKeyRef = useRef<string | null>(null);

  const listExportQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFilters.status) params.set("status", appliedFilters.status);
    if (appliedFilters.hasInvoice) params.set("hasInvoice", appliedFilters.hasInvoice);
    if (appliedFilters.receivableStatus) {
      params.set("receivableStatus", appliedFilters.receivableStatus);
    }
    if (appliedFilters.customerId) params.set("customerId", appliedFilters.customerId);
    if (appliedFilters.sellerKey) params.set("sellerKey", appliedFilters.sellerKey);
    if (appliedFilters.startDate) params.set("startDate", appliedFilters.startDate);
    if (appliedFilters.endDate) params.set("endDate", appliedFilters.endDate);
    if (appliedFilters.minNetValue) params.set("minNetValue", appliedFilters.minNetValue);
    if (appliedFilters.maxNetValue) params.set("maxNetValue", appliedFilters.maxNetValue);
    if (appliedFilters.year) params.set("year", appliedFilters.year);
    if (appliedFilters.month) params.set("month", appliedFilters.month);
    if (appliedFilters.search) params.set("q", appliedFilters.search);
    return params.toString();
  }, [appliedFilters]);

  const internalExportQuery = listExportQuery;

  const customerLabelForFilename = customerSelection?.name ?? null;

  const handleExportReportXlsx = useCallback(async () => {
    setExportingReportXlsx(true);
    try {
      await downloadSalesOrderReportXlsx(
        getSalesOrderReportXlsxUrl(listExportQuery),
        customerLabelForFilename
      );
    } catch (err) {
      console.error(err);
      alert("Não foi possível exportar o Excel de pedidos de venda.");
    } finally {
      setExportingReportXlsx(false);
    }
  }, [customerLabelForFilename, listExportQuery]);

  const ensureBranding = useCallback(async () => {
    if (brandingLoadedRef.current) return branding;
    try {
      const next = await fetchUiSessionCachedJson<BrandingSettingsDTO>(
        "/api/branding-settings",
        { ttlMs: 300_000 }
      );
      brandingLoadedRef.current = true;
      setBranding(next);
      return next;
    } catch {
      brandingLoadedRef.current = true;
      setBranding(DEFAULT_BRANDING);
      return DEFAULT_BRANDING;
    }
  }, [branding]);

  const handleExportReportPdf = useCallback(async () => {
    if (exportingReportPdf) return;
    setExportingReportPdf(true);
    try {
      await ensureBranding();
      const payload = await fetchJsonOk<SalesOrderReportPayload>(
        getSalesOrderReportPayloadUrl(listExportQuery)
      );
      setReportPrintPayload(payload);
      setReportPrintRequestId((id) => id + 1);
    } catch (err) {
      console.error(err);
      alert("Não foi possível gerar o PDF de pedidos de venda.");
      setExportingReportPdf(false);
    }
  }, [ensureBranding, exportingReportPdf, listExportQuery]);

  const handleExportIndustrialResultPdf = useCallback(async () => {
    if (exportingIndustrialPdf) return;
    setExportingIndustrialPdf(true);
    try {
      await ensureBranding();
      const payload = await fetchJsonOk<SalesOrderIndustrialResultReportPayload>(
        getSalesOrderIndustrialResultReportPayloadUrl(listExportQuery)
      );
      setIndustrialPrintPayload(payload);
      setIndustrialPrintRequestId((id) => id + 1);
    } catch (err) {
      console.error(err);
      alert("Não foi possível gerar o PDF de Resultado Industrial.");
      setExportingIndustrialPdf(false);
    }
  }, [ensureBranding, exportingIndustrialPdf, listExportQuery]);

  useEffect(() => {
    if (reportPrintRequestId === 0 || !reportPrintPayload) return;

    document.body.classList.add("sales-orders-print-route");

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      setReportPrintPayload(null);
      setReportPrintRequestId(0);
      setExportingReportPdf(false);
    };

    window.addEventListener("afterprint", onAfterPrint, { once: true });

    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [reportPrintRequestId, reportPrintPayload]);

  useEffect(() => {
    if (industrialPrintRequestId === 0 || !industrialPrintPayload) return;

    document.body.classList.add("sales-orders-print-route");
    document.body.classList.add("sales-orders-industrial-print-route");

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      document.body.classList.remove("sales-orders-industrial-print-route");
      setIndustrialPrintPayload(null);
      setIndustrialPrintRequestId(0);
      setExportingIndustrialPdf(false);
    };

    window.addEventListener("afterprint", onAfterPrint, { once: true });

    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [industrialPrintRequestId, industrialPrintPayload]);

  const handleExportInternal = useCallback(async () => {
    setExportingInternal(true);
    try {
      await downloadInternalMarginExport(
        getSalesOrderListInternalMarginExportUrl(internalExportQuery),
        "pedidos-venda-margem-interno-list.xlsx"
      );
    } catch {
      alert("Não foi possível exportar o relatório interno de margem.");
    } finally {
      setExportingInternal(false);
    }
  }, [internalExportQuery]);

  const buildListQueryString = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(SALES_ORDERS_PAGE_SIZE));
      if (appliedFilters.status) params.set("status", appliedFilters.status);
      if (appliedFilters.hasInvoice) params.set("hasInvoice", appliedFilters.hasInvoice);
      if (appliedFilters.receivableStatus) {
        params.set("receivableStatus", appliedFilters.receivableStatus);
      }
      if (appliedFilters.customerId) params.set("customerId", appliedFilters.customerId);
      if (appliedFilters.sellerKey) params.set("sellerKey", appliedFilters.sellerKey);
      if (appliedFilters.startDate) params.set("startDate", appliedFilters.startDate);
      if (appliedFilters.endDate) params.set("endDate", appliedFilters.endDate);
      if (appliedFilters.minNetValue) {
        params.set("minNetValue", appliedFilters.minNetValue);
      }
      if (appliedFilters.maxNetValue) {
        params.set("maxNetValue", appliedFilters.maxNetValue);
      }
      if (appliedFilters.year) params.set("year", appliedFilters.year);
      if (appliedFilters.month) params.set("month", appliedFilters.month);
      if (appliedFilters.search) params.set("q", appliedFilters.search);
      return params.toString();
    },
    [appliedFilters]
  );

  const load = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const q = buildListQueryString(page);
        const data = await fetchJsonOk<SalesOrderListResponse | SalesOrderRow[]>(
          `/api/sales-orders?${q}`,
          { signal }
        );
        if (signal?.aborted) return;
        if (Array.isArray(data)) {
          setRows(data);
          setTotal(data.length);
          setTotalPages(1);
          setCurrentPage(1);
          setSummary(EMPTY_SALES_ORDER_LIST_SUMMARY);
          setMarginSummary(null);
        } else if (isPaginatedSalesOrderList(data)) {
          setRows(data.data);
          setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
          setTotalPages(Number.isFinite(Number(data.totalPages)) ? Math.max(1, Number(data.totalPages)) : 1);
          setCurrentPage(Number.isFinite(Number(data.page)) ? Number(data.page) : page);
          setSummary(data.summary ?? EMPTY_SALES_ORDER_LIST_SUMMARY);
          // Margem geral vem de endpoint dedicado (não bloqueia a grade).
          setMarginSummary(data.marginSummary ?? null);
        } else {
          setRows([]);
          setTotal(0);
          setTotalPages(1);
          setSummary(EMPTY_SALES_ORDER_LIST_SUMMARY);
          setMarginSummary(null);
        }

        // Margens só DEPOIS da grade — nunca em paralelo (summary puxava
        // milhares de nomusRawResponse e saturava o pool da lista).
        if (showMarginEconomics && !signal?.aborted) {
          void fetchJsonOk<{
            margins: Array<{
              orderId: string;
              marginSummary?: SalesOrderRow["marginSummary"];
              marginItems?: SalesOrderItemMarginPayload[];
            }>;
          }>(getSalesOrderListPageMarginsUrl(q), { signal })
            .then((marginData) => {
              if (signal?.aborted) return;
              const byId = new Map(
                (marginData.margins ?? []).map((row) => [row.orderId, row] as const)
              );
              setRows((prev) =>
                prev.map((row) => {
                  const margin = byId.get(row.id);
                  if (!margin) return row;
                  return {
                    ...row,
                    marginSummary: margin.marginSummary,
                    marginItems: margin.marginItems,
                  };
                })
              );
            })
            .catch((e) => {
              if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
              console.error(e);
            });

          void fetchJsonOk<{ marginSummary: SalesOrderListMarginSummary }>(
            getSalesOrderListMarginSummaryUrl(q),
            { signal }
          )
            .then((data) => {
              if (!signal?.aborted) setMarginSummary(data.marginSummary ?? null);
            })
            .catch((e) => {
              if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
              console.error(e);
              setMarginSummary(null);
            });
        } else if (!showMarginEconomics) {
          setMarginSummary(null);
        }
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        console.error(e);
        alert(e instanceof Error ? e.message : "Não foi possível carregar pedidos.");
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        setSummary(EMPTY_SALES_ORDER_LIST_SUMMARY);
        setMarginSummary(null);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [buildListQueryString, showMarginEconomics]
  );

  useEffect(() => {
    const ac = new AbortController();
    setSellerOptionsLoading(true);
    const params = new URLSearchParams();
    if (appliedFilters.status) params.set("status", appliedFilters.status);
    if (appliedFilters.hasInvoice) params.set("hasInvoice", appliedFilters.hasInvoice);
    if (appliedFilters.receivableStatus) {
      params.set("receivableStatus", appliedFilters.receivableStatus);
    }
    if (appliedFilters.customerId) params.set("customerId", appliedFilters.customerId);
    if (appliedFilters.startDate) params.set("startDate", appliedFilters.startDate);
    if (appliedFilters.endDate) params.set("endDate", appliedFilters.endDate);
    if (appliedFilters.minNetValue) params.set("minNetValue", appliedFilters.minNetValue);
    if (appliedFilters.maxNetValue) params.set("maxNetValue", appliedFilters.maxNetValue);
    if (appliedFilters.year) params.set("year", appliedFilters.year);
    if (appliedFilters.month) params.set("month", appliedFilters.month);
    if (appliedFilters.search) params.set("q", appliedFilters.search);
    const q = params.toString();
    // Rota consumida: GET /api/sales-orders/seller-filter-options (via helper).
    void fetchJsonOk<{ options: SalesOrderSellerFilterOption[] }>(
      getSalesOrderSellerFilterOptionsUrl(q),
      { signal: ac.signal }
    )
      .then((data) => {
        if (!ac.signal.aborted) setSellerFilterOptions(data.options ?? []);
      })
      .catch((e) => {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setSellerFilterOptions([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setSellerOptionsLoading(false);
      });
    return () => ac.abort();
  }, [sellerOptionsFiltersKey, appliedFilters]);

  useEffect(() => {
    const ac = new AbortController();
    const prevKey = prevListFiltersKeyRef.current;
    const filtersChanged = prevKey !== null && prevKey !== listFiltersKey;
    prevListFiltersKeyRef.current = listFiltersKey;

    const pageToFetch = filtersChanged ? 1 : currentPage;
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
    }

    void load(pageToFetch, ac.signal);

    return () => ac.abort();
  }, [currentPage, listFiltersKey, load]);

  const listShownRange = useMemo(() => {
    if (total === 0 || rows.length === 0) return { from: 0, to: 0 };
    const from = (currentPage - 1) * SALES_ORDERS_PAGE_SIZE + 1;
    const to = from + rows.length - 1;
    return { from, to };
  }, [total, currentPage, rows.length]);

  return (
    <div className="space-y-6">
      {/*
        Barra de filtros + ações — padrão executivo (2026-07).
        - Grid uniforme 12 colunas: todos os campos alinham em duas linhas com
          altura e proporção consistentes.
        - Ações separadas por divisor sutil; botões discretos (ghost) para não
          competir visualmente com os KPIs e a tabela.
      */}
      <form
        className="space-y-3 rounded-xl border border-border bg-card/60 p-3 shadow-sm"
        data-testid="sales-orders-filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          applyListFilters();
        }}
      >
        <div className="grid grid-cols-12 gap-2">
          {/* Linha 1: período + status + busca */}
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-year">Ano</FilterLabel>
            <select
              id="sales-orders-filter-year"
              className={SALES_FILTER_CONTROL_CLASS}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              aria-label="Filtrar por ano de emissão"
            >
              <option value="">Todos os anos</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-month">Mês</FilterLabel>
            <select
              id="sales-orders-filter-month"
              className={SALES_FILTER_CONTROL_CLASS}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Filtrar por mês de emissão"
            >
              <option value="">Todos os meses</option>
              {SALES_ORDER_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={String(m.value)}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-status">Status</FilterLabel>
            <select
              id="sales-orders-filter-status"
              className={SALES_FILTER_CONTROL_CLASS}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Todos</option>
              {Object.keys(STATUS_LABELS).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-has-invoice">Vínculo NF</FilterLabel>
            <select
              id="sales-orders-filter-has-invoice"
              className={SALES_FILTER_CONTROL_CLASS}
              value={hasInvoice}
              onChange={(e) => setHasInvoice(e.target.value)}
              aria-label="Filtrar por vínculo de NF"
              data-testid="sales-orders-filter-has-invoice"
            >
              {INVOICE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <FilterLabel htmlFor="sales-orders-smart-search">Busca inteligente</FilterLabel>
            <input
              id="sales-orders-smart-search"
              type="search"
              className={SALES_FILTER_CONTROL_CLASS}
              placeholder="Buscar por pedido, NF, cliente, vendedor ou documento..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="Busca inteligente de pedidos"
              data-testid="sales-orders-smart-search"
            />
          </div>

          {/* Linha 2: cliente + vendedor + datas + status CR */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              placeholder="Todos os clientes"
              onChange={(sel) => {
                setCustomerSelection(sel);
                setCustomerId(sel?.id ?? "");
              }}
              onClear={() => {
                setCustomerSelection(null);
                setCustomerId("");
              }}
            />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <FilterLabel htmlFor="sales-orders-seller-filter">Vendedor</FilterLabel>
            <select
              id="sales-orders-seller-filter"
              className={SALES_FILTER_CONTROL_CLASS}
              value={sellerKey}
              onChange={(e) => setSellerKey(e.target.value)}
              disabled={sellerOptionsLoading}
              aria-label="Filtrar por vendedor Nomus"
              data-testid="sales-orders-seller-filter"
            >
              <option value="">Todos os vendedores</option>
              {sellerFilterOptions.map((option) => (
                <option key={option.sellerKey} value={option.sellerKey}>
                  {option.label}
                  {option.orderCount > 0 ? ` (${option.orderCount})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-start-date">Emissão de</FilterLabel>
            <input
              id="sales-orders-filter-start-date"
              type="date"
              className={SALES_FILTER_CONTROL_CLASS}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-end-date">até</FilterLabel>
            <input
              id="sales-orders-filter-end-date"
              type="date"
              className={SALES_FILTER_CONTROL_CLASS}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="sales-orders-filter-receivable-status">Status CR</FilterLabel>
            <SalesOrderReceivableStatusMultiSelect
              value={receivableStatus}
              onChange={setReceivableStatus}
              controlClassName={SALES_FILTER_CONTROL_CLASS}
            />
          </div>

          <div className="col-span-12 lg:col-span-4" data-testid="sales-orders-filter-net-value">
            <FilterLabel htmlFor="sales-orders-filter-min-net-value">Valor líquido</FilterLabel>
            <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-border bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <span
                className="flex shrink-0 items-center border-r border-border bg-muted/40 px-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground"
                aria-hidden="true"
              >
                R$
              </span>
              <input
                id="sales-orders-filter-min-net-value"
                type="text"
                inputMode="decimal"
                className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground/70"
                placeholder="De"
                value={minNetValue}
                onChange={(e) => setMinNetValue(e.target.value)}
                aria-label="Valor líquido mínimo"
                data-testid="sales-orders-filter-min-net-value"
              />
              <span className="flex shrink-0 items-center px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                até
              </span>
              <input
                id="sales-orders-filter-max-net-value"
                type="text"
                inputMode="decimal"
                className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground/70"
                placeholder="Até"
                value={maxNetValue}
                onChange={(e) => setMaxNetValue(e.target.value)}
                aria-label="Valor líquido máximo"
                data-testid="sales-orders-filter-max-net-value"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Faixas rápidas de valor">
              {SALES_ORDER_NET_VALUE_PRESETS.map((preset) => {
                const active =
                  minNetValue.trim() === preset.min && maxNetValue.trim() === preset.max;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      applyListFilters({
                        minNetValue: preset.min,
                        maxNetValue: preset.max,
                      });
                    }}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-transparent bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                    )}
                    data-testid={`sales-orders-net-value-preset-${preset.id}`}
                    aria-pressed={active}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Barra de ações — separada por divisor, alinhada à direita, botões
            discretos (ghost). Ordem: Limpar → separador → Excel → PDF → Excel
            interno. O botão "Excel interno (margem)" perdeu o realce azul; o
            peso visual agora é o mesmo dos outros exports. */}
        <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border/70 pt-2 sales-orders-no-print">
          <button
            type="button"
            onClick={clearListFilters}
            className={SALES_FILTER_ACTION_BUTTON_CLASS}
            data-testid="sales-orders-clear-filters"
          >
            Limpar filtros
          </button>
          <button
            type="submit"
            className={cn(
              SALES_FILTER_ACTION_BUTTON_CLASS,
              "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            )}
            data-testid="sales-orders-apply-filters"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Pesquisar</span>
          </button>
          <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          {allowExport ? (
            <>
          <button
            type="button"
            data-testid="sales-orders-export-report-xlsx"
            disabled={exportingReportXlsx}
            onClick={() => void handleExportReportXlsx()}
            className={SALES_FILTER_ACTION_BUTTON_CLASS}
            title="Exportar Excel branded (padrão Contas a Receber > Títulos)"
          >
            {exportingReportXlsx ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Exportando…</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Excel</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="sales-orders-export-report-pdf"
            disabled={exportingReportPdf}
            onClick={() => void handleExportReportPdf()}
            className={SALES_FILTER_ACTION_BUTTON_CLASS}
            title="Exportar PDF branded (padrão Contas a Receber > Títulos)"
          >
            {exportingReportPdf ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Gerando…</span>
              </>
            ) : (
              <>
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                <span>PDF</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="sales-orders-export-industrial-result-pdf"
            disabled={exportingIndustrialPdf}
            onClick={() => void handleExportIndustrialResultPdf()}
            className={SALES_FILTER_ACTION_BUTTON_CLASS}
            title="PDF — Resultado Industrial (mesmos filtros da tela)"
          >
            {exportingIndustrialPdf ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Gerando…</span>
              </>
            ) : (
              <>
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                <span>PDF — Resultado Industrial</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="sales-orders-export-internal-margin"
            disabled={exportingInternal}
            onClick={() => void handleExportInternal()}
            className={SALES_FILTER_ACTION_BUTTON_CLASS}
            title="Exportar Excel interno com margem por pedido"
          >
            {exportingInternal ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Exportando…</span>
              </>
            ) : (
              <>
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Excel interno (margem)</span>
              </>
            )}
          </button>
            </>
          ) : null}
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        {total === 0 ? (
          <>Nenhum pedido encontrado para os filtros informados.</>
        ) : (
          <>
            {appliedFilters.search ? (
              <>
                Busca: <span className="font-semibold text-foreground">"{appliedFilters.search}"</span> ·{" "}
              </>
            ) : null}
            Exibindo{" "}
            <span className="font-semibold text-foreground">
              {listShownRange.from}–{listShownRange.to}
            </span>{" "}
            de <span className="font-semibold text-foreground">{total}</span> pedido(s) · {SALES_ORDERS_PAGE_SIZE} por
            página · mais recentes primeiro
          </>
        )}
      </p>

      <SalesOrderListSummaryCards
        summary={summary}
        marginSummary={marginSummary}
        showMarginCard={showMarginEconomics}
        loading={loading}
      />

      <SalesOrderListMonthlyCharts
        filters={monthlyChartsFilters}
        showMarginChart={showMarginEconomics}
        monthlyCommercialMargin={
          marginSummary ? marginSummary.monthlyCommercialMargin : null
        }
      />

      <SalesOrderListTable
        rows={rows}
        loading={loading}
        selectedOrderId={selectedOrderId}
        showMarginEconomics={showMarginEconomics}
        onRowOpenSummary={handleRowOpenSummary}
        onOpenDetail={handleOpenDetailFromList}
      />

      <SalesOrderQuickSummaryDrawer
        open={summaryDrawerOpen}
        row={summaryRow}
        showMarginEconomics={showMarginEconomics}
        onClose={handleCloseSummaryDrawer}
        onOpenDetail={handleOpenDetailFromSummary}
      />

      <SalesOrderDetailDialog
        open={detailOpen}
        salesOrderId={detailOrderId}
        orderCode={detailOrderCode}
        onClose={closeDetail}
        onOpenFullAudit={handleOpenFullAudit}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Página <span className="font-semibold text-foreground">{currentPage}</span> de{" "}
          <span className="font-semibold text-foreground">{totalPages}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1 || loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
          >
            <ArrowLeft className="h-4 w-4" />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages || loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {reportPrintPayload
        ? createPortal(
            <SalesOrderReportPrintDocument
              payload={reportPrintPayload}
              branding={branding}
            />,
            document.body
          )
        : null}
      {industrialPrintPayload
        ? createPortal(
            <SalesOrderIndustrialResultReportPrintDocument
              payload={industrialPrintPayload}
              branding={branding}
            />,
            document.body
          )
        : null}
    </div>
  );
}

function SalesOrderDetailRoute({ id }: { id: string }) {
  const navigate = useNavigate();
  return (
    <SalesOrderDetailDialog
      open
      salesOrderId={id}
      onClose={() => navigate("/sales-orders")}
      onOpenFullAudit={(salesOrderId) =>
        navigate(
          `/finance/portfolio-reconciliation?auditOrderId=${encodeURIComponent(salesOrderId)}`
        )
      }
    />
  );
}

export function SalesOrdersModule() {
  noteDevPerfRender("SalesOrdersModule");
  const { id } = useParams();
  if (id) return <SalesOrderDetailRoute id={id} />;
  return <SalesOrderList />;
}
