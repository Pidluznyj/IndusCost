import React, {
  createElement,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Download,
  FileText,
  FileWarning,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";
import {
  fetchOutputDocumentsList,
  fetchOutputDocumentsSummary,
} from "@/src/lib/outputDocumentsClient";
import {
  applyOutputDocumentsKpiPreset,
  areOutputDocumentsSearchParamsEqual,
  canViewOutputDocuments,
  classifyOutputDocumentsListError,
  downloadOutputDocumentsPageCsv,
  hasActiveOutputDocumentsFilters,
  isOutputDocumentsDateRangeInvalid,
  nextOutputDocumentsSortDir,
  OUTPUT_DOCUMENT_FINANCIAL_STATUS_OPTIONS,
  OUTPUT_DOCUMENTS_BREADCRUMB,
  OUTPUT_DOCUMENTS_PAGE_SIZE,
  OUTPUT_DOCUMENTS_TRI_STATE_OPTIONS,
  parseOutputDocumentsFinancialStatusParam,
  parseOutputDocumentsSortByParam,
  parseOutputDocumentsSortDirParam,
  parseOutputDocumentsTriStateParam,
  type OutputDocumentsKpiFilterPreset,
} from "@/src/lib/outputDocumentsUi";
import type { OutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver";
import type {
  OutputDocumentsListItem,
  OutputDocumentsListSummary,
  OutputDocumentsSortBy,
  OutputDocumentsSortDir,
  OutputDocumentsTriState,
} from "@/src/lib/output-documents/outputDocumentsListTypes";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { OutputDocumentGridTableRow } from "@/src/components/commercial/OutputDocumentGridTableRow";
import { OutputDocumentDetailOverlay } from "@/src/components/commercial/OutputDocumentDetailOverlay";
import { cn } from "@/src/lib/utils";

const SalesOrderDetailDialog = React.lazy(() =>
  import("@/src/components/sales/SalesOrderDetailDialog").then((mod) => ({
    default: mod.SalesOrderDetailDialog,
  }))
);

const SEARCH_DEBOUNCE_MS = 300;
const FILTER_CONTROL_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

const EMPTY_SUMMARY: OutputDocumentsListSummary = {
  documentCount: 0,
  validTotalValue: 0,
  withNfe: 0,
  withReceivable: 0,
  awaitingReceivable: 0,
  cancelled: 0,
};

type GridColumn = {
  label: string;
  sortKey?: OutputDocumentsSortBy;
  align?: "left" | "right";
};

const GRID_COLUMNS: ReadonlyArray<GridColumn> = [
  { label: "Documento", sortKey: "documentNumber" },
  { label: "Emissão", sortKey: "dataDocumento" },
  { label: "Cliente", sortKey: "personName" },
  { label: "Empresa", sortKey: "companyName" },
  { label: "Status", sortKey: "statusRaw" },
  { label: "Valor", sortKey: "totalValue", align: "right" },
  { label: "Pedido" },
  { label: "NF-e" },
  { label: "Financeiro" },
  { label: "Valor aberto", align: "right" },
  { label: "Última sincronização", sortKey: "syncedAt" },
];

function initialParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}

function initialPage(params: URLSearchParams): number {
  const parsed = Number.parseInt(params.get("page") ?? "1", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function OutputDocumentsModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canView = canViewOutputDocuments({
    canPerformAction: permissions.canPerformAction,
    hasPermission: auth.hasPermission,
  });

  const [searchDraft, setSearchDraft] = useState(() =>
    initialParam(searchParams, "search")
  );
  const [companyDraft, setCompanyDraft] = useState(() =>
    initialParam(searchParams, "company")
  );
  const [customerDraft, setCustomerDraft] = useState(() =>
    initialParam(searchParams, "customer")
  );
  const [statusDraft, setStatusDraft] = useState(() =>
    initialParam(searchParams, "status")
  );
  const [orderDraft, setOrderDraft] = useState(() =>
    initialParam(searchParams, "order")
  );
  const [nfeDraft, setNfeDraft] = useState(() => initialParam(searchParams, "nfe"));
  const [search, setSearch] = useState(searchDraft);
  const [company, setCompany] = useState(companyDraft);
  const [customer, setCustomer] = useState(customerDraft);
  const [status, setStatus] = useState(statusDraft);
  const [order, setOrder] = useState(orderDraft);
  const [nfe, setNfe] = useState(nfeDraft);
  const [from, setFrom] = useState(() => initialParam(searchParams, "from"));
  const [to, setTo] = useState(() => initialParam(searchParams, "to"));
  const [financialStatus, setFinancialStatus] =
    useState<OutputDocumentFinancialStatus | null>(() =>
      parseOutputDocumentsFinancialStatusParam(
        searchParams.get("financialStatus")
      )
    );
  const [cancelled, setCancelled] = useState<OutputDocumentsTriState>(() =>
    parseOutputDocumentsTriStateParam(searchParams.get("cancelled"))
  );
  const [hasReceivable, setHasReceivable] = useState<OutputDocumentsTriState>(
    () => parseOutputDocumentsTriStateParam(searchParams.get("hasReceivable"))
  );
  const [sortBy, setSortBy] = useState<OutputDocumentsSortBy>(() =>
    parseOutputDocumentsSortByParam(searchParams.get("sortBy"))
  );
  const [sortDir, setSortDir] = useState<OutputDocumentsSortDir>(() =>
    parseOutputDocumentsSortDirParam(searchParams.get("sortDir"))
  );
  const [page, setPage] = useState(() => initialPage(searchParams));
  const [items, setItems] = useState<OutputDocumentsListItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] =
    useState<OutputDocumentsListSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    () => {
      const id = initialParam(searchParams, "documentId");
      return id || null;
    }
  );
  const [salesOrderDetailId, setSalesOrderDetailId] = useState<string | null>(
    null
  );
  const [salesOrderDetailCode, setSalesOrderDetailCode] = useState<string | null>(
    null
  );
  const openSalesOrderDetail = useCallback(
    (salesOrderId: string, orderCode?: string | null) => {
      setSalesOrderDetailId(salesOrderId);
      setSalesOrderDetailCode(orderCode?.trim() || null);
    },
    []
  );
  const closeSalesOrderDetail = useCallback(() => {
    setSalesOrderDetailId(null);
    setSalesOrderDetailCode(null);
  }, []);
  const [errorKind, setErrorKind] = useState<
    "access_denied" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openNfeInList = useCallback(
    (nfe: { numero: string | null; externalId: number }) => {
      const label = nfe.numero?.trim() || String(nfe.externalId);
      setNfeDraft(label);
      setNfe(label);
      setPage(1);
      setSelectedDocumentId(null);
    },
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchDraft.trim();
      const nextCompany = companyDraft.trim();
      const nextCustomer = customerDraft.trim();
      const nextStatus = statusDraft.trim();
      const nextOrder = orderDraft.trim();
      const nextNfe = nfeDraft.trim();
      if (
        nextSearch === search &&
        nextCompany === company &&
        nextCustomer === customer &&
        nextStatus === status &&
        nextOrder === order &&
        nextNfe === nfe
      ) {
        return;
      }
      setPage(1);
      setSearch(nextSearch);
      setCompany(nextCompany);
      setCustomer(nextCustomer);
      setStatus(nextStatus);
      setOrder(nextOrder);
      setNfe(nextNfe);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    searchDraft,
    companyDraft,
    customerDraft,
    statusDraft,
    orderDraft,
    nfeDraft,
    search,
    company,
    customer,
    status,
    order,
    nfe,
  ]);

  useEffect(() => {
    const fromUrl = searchParams.get("documentId")?.trim() || null;
    setSelectedDocumentId((current) => (current === fromUrl ? current : fromUrl));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (page > 1) next.set("page", String(page));
    if (search) next.set("search", search);
    if (company) next.set("company", company);
    if (customer) next.set("customer", customer);
    if (status) next.set("status", status);
    if (order) next.set("order", order);
    if (nfe) next.set("nfe", nfe);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (financialStatus) next.set("financialStatus", financialStatus);
    if (cancelled !== "all") next.set("cancelled", cancelled);
    if (hasReceivable !== "all") next.set("hasReceivable", hasReceivable);
    if (sortBy !== "dataDocumento") next.set("sortBy", sortBy);
    if (sortDir !== "desc") next.set("sortDir", sortDir);
    if (selectedDocumentId) next.set("documentId", selectedDocumentId);
    if (!areOutputDocumentsSearchParamsEqual(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    page,
    search,
    company,
    customer,
    status,
    order,
    nfe,
    from,
    to,
    financialStatus,
    cancelled,
    hasReceivable,
    sortBy,
    sortDir,
    selectedDocumentId,
    searchParams,
    setSearchParams,
  ]);

  const dateRangeInvalid = isOutputDocumentsDateRangeInvalid(from, to);

  useEffect(() => {
    if (!canView) return;
    if (dateRangeInvalid) {
      setLoading(false);
      setErrorKind(null);
      setErrorMessage(null);
      return;
    }
    const controller = new AbortController();
    const query = {
      page,
      pageSize: OUTPUT_DOCUMENTS_PAGE_SIZE,
      search,
      company,
      customer,
      status,
      order,
      nfe,
      from,
      to,
      financialStatus: financialStatus ?? undefined,
      cancelled,
      hasReceivable,
      sortBy,
      sortDir,
    };
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);

    void Promise.all([
      fetchOutputDocumentsSummary(query, controller.signal),
      fetchOutputDocumentsList(query, controller.signal),
    ])
      .then(([summaryPayload, listPayload]) => {
        if (controller.signal.aborted) return;
        if (
          listPayload.pagination.totalItems > 0 &&
          listPayload.pagination.page > listPayload.pagination.totalPages
        ) {
          setPage(listPayload.pagination.totalPages);
          return;
        }
        setSummary(summaryPayload.summary);
        setItems(listPayload.items);
        setTotalItems(listPayload.pagination.totalItems);
        setTotalPages(listPayload.pagination.totalPages);
        setHasLoadedOnce(true);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const classified = classifyOutputDocumentsListError(error);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
        setSummary(EMPTY_SUMMARY);
        setItems([]);
        setTotalItems(0);
        setTotalPages(1);
        setHasLoadedOnce(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    canView,
    dateRangeInvalid,
    page,
    search,
    company,
    customer,
    status,
    order,
    nfe,
    from,
    to,
    financialStatus,
    cancelled,
    hasReceivable,
    sortBy,
    sortDir,
    retryToken,
  ]);

  if (!canView) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  const filtersActive = hasActiveOutputDocumentsFilters({
    search,
    company,
    customer,
    from,
    to,
    status,
    order,
    nfe,
    financialStatus,
    cancelled,
    hasReceivable,
  });
  const draftsActive = Boolean(
    searchDraft.trim() ||
      companyDraft.trim() ||
      customerDraft.trim() ||
      statusDraft.trim() ||
      orderDraft.trim() ||
      nfeDraft.trim() ||
      from ||
      to ||
      financialStatus ||
      cancelled !== "all" ||
      hasReceivable !== "all"
  );
  const initialLoading = loading && (!hasLoadedOnce || items.length === 0);
  const showEmptyCatalog =
    hasLoadedOnce && !loading && !errorMessage && totalItems === 0 && !filtersActive;
  const showEmptyFilters =
    hasLoadedOnce && !loading && !errorMessage && totalItems === 0 && filtersActive;

  const clearFilters = () => {
    setSearchDraft("");
    setCompanyDraft("");
    setCustomerDraft("");
    setStatusDraft("");
    setOrderDraft("");
    setNfeDraft("");
    setSearch("");
    setCompany("");
    setCustomer("");
    setStatus("");
    setOrder("");
    setNfe("");
    setFrom("");
    setTo("");
    setFinancialStatus(null);
    setCancelled("all");
    setHasReceivable("all");
    setSortBy("dataDocumento");
    setSortDir("desc");
    setPage(1);
  };

  const applyKpiPreset = (preset: OutputDocumentsKpiFilterPreset) => {
    const next = applyOutputDocumentsKpiPreset(preset);
    setCancelled(next.cancelled);
    setHasReceivable(next.hasReceivable);
    setFinancialStatus(next.financialStatus);
    setPage(1);
  };

  const toggleSort = (column: OutputDocumentsSortBy) => {
    const nextDir = nextOutputDocumentsSortDir(sortBy, sortDir, column);
    setSortBy(column);
    setSortDir(nextDir);
    setPage(1);
  };

  return (
    <div className="space-y-4" data-testid="output-documents-module">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        data-testid="output-documents-breadcrumb"
      >
        {OUTPUT_DOCUMENTS_BREADCRUMB}
      </p>

      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="output-documents-toolbar"
      >
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          data-testid="output-documents-refresh"
          disabled={loading}
          onClick={() => setRetryToken((token) => token + 1)}
          title="Atualizar lista"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            aria-hidden="true"
          />
          Atualizar
        </button>
      </div>

      <section
        className="rounded-xl border border-border bg-card p-3"
        data-testid="output-documents-filters"
        aria-label="Filtros de Documentos de Saída"
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Busca geral">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                data-testid="output-documents-search"
                placeholder="Documento, pedido, NF-e, SKU ou status…"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </div>
          </FilterField>
          <FilterField label="Emissão de">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-from"
              aria-invalid={dateRangeInvalid}
              value={from}
              onChange={(event) => {
                setPage(1);
                setFrom(event.target.value);
              }}
            />
          </FilterField>
          <FilterField label="Emissão até">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-to"
              aria-invalid={dateRangeInvalid}
              value={to}
              onChange={(event) => {
                setPage(1);
                setTo(event.target.value);
              }}
            />
          </FilterField>
          <FilterField label="Empresa">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-company"
              placeholder="Ex.: KOPPETEL"
              value={companyDraft}
              onChange={(event) => setCompanyDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="Cliente">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-customer"
              placeholder="Nome do cliente"
              value={customerDraft}
              onChange={(event) => setCustomerDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="Status">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-status"
              placeholder="Ex.: Emitido"
              value={statusDraft}
              onChange={(event) => setStatusDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="Pedido">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-order"
              placeholder="Código ou ID do pedido"
              value={orderDraft}
              onChange={(event) => setOrderDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="NF-e">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-nfe"
              placeholder="Número ou ID da NF-e"
              value={nfeDraft}
              onChange={(event) => setNfeDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="Situação financeira">
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-financial-status"
              value={financialStatus ?? ""}
              onChange={(event) => {
                setPage(1);
                setFinancialStatus(
                  parseOutputDocumentsFinancialStatusParam(event.target.value)
                );
              }}
            >
              <option value="">Todas</option>
              {OUTPUT_DOCUMENT_FINANCIAL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Cancelado">
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-cancelled"
              value={cancelled}
              onChange={(event) => {
                setPage(1);
                setCancelled(
                  parseOutputDocumentsTriStateParam(event.target.value)
                );
              }}
            >
              {OUTPUT_DOCUMENTS_TRI_STATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Com CR">
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-has-receivable"
              value={hasReceivable}
              onChange={(event) => {
                setPage(1);
                setHasReceivable(
                  parseOutputDocumentsTriStateParam(event.target.value)
                );
              }}
            >
              {OUTPUT_DOCUMENTS_TRI_STATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <div className="flex items-end sm:col-span-2 xl:col-span-1">
            <button
              type="button"
              className="w-full rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="output-documents-clear-filters"
              disabled={!draftsActive}
              onClick={clearFilters}
            >
              Limpar filtros
            </button>
          </div>
        </div>
        {dateRangeInvalid ? (
          <p className="mt-2 text-xs font-medium text-rose-700" role="alert">
            A data inicial não pode ser posterior à data final.
          </p>
        ) : null}
      </section>

      <SummaryKpiGrid
        minColumnWidth={168}
        className={SYSTEM_TOTALIZER_GRID_CLASS}
        testId="output-documents-cards"
      >
        <KpiPresetButton
          preset="all"
          active={
            cancelled === "all" &&
            hasReceivable === "all" &&
            financialStatus == null
          }
          onSelect={applyKpiPreset}
          testId="output-documents-card-documents"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Documentos"
            amount={summary.documentCount}
            amountFormat="number"
            tone="neutral"
            icon={FileText}
            loading={loading && !hasLoadedOnce}
          />
        </KpiPresetButton>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="output-documents-card-total-value"
          label="Valor total"
          amount={summary.validTotalValue}
          amountFormat="currency"
          tone="money"
          icon={Wallet}
          helperText="Exclui cancelados"
          loading={loading && !hasLoadedOnce}
        />
        <KpiPresetButton
          preset="with_nfe"
          active={cancelled === "no" && hasReceivable === "all" && financialStatus == null}
          onSelect={applyKpiPreset}
          testId="output-documents-card-with-nfe"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Com NF-e"
            amount={summary.withNfe}
            amountFormat="number"
            tone="info"
            icon={Receipt}
            helperText="Filtro aproximado: exclui cancelados"
            loading={loading && !hasLoadedOnce}
          />
        </KpiPresetButton>
        <KpiPresetButton
          preset="with_receivable"
          active={hasReceivable === "yes"}
          onSelect={applyKpiPreset}
          testId="output-documents-card-with-receivable"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Com CR"
            amount={summary.withReceivable}
            amountFormat="number"
            tone="success"
            icon={Wallet}
            loading={loading && !hasLoadedOnce}
          />
        </KpiPresetButton>
        <KpiPresetButton
          preset="awaiting_receivable"
          active={financialStatus === "aguardando_cr"}
          onSelect={applyKpiPreset}
          testId="output-documents-card-awaiting-receivable"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Aguardando CR"
            amount={summary.awaitingReceivable}
            amountFormat="number"
            tone="warning"
            icon={FileWarning}
            loading={loading && !hasLoadedOnce}
          />
        </KpiPresetButton>
        <KpiPresetButton
          preset="cancelled"
          active={cancelled === "yes"}
          onSelect={applyKpiPreset}
          testId="output-documents-card-cancelled"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Cancelados"
            amount={summary.cancelled}
            amountFormat="number"
            tone="danger"
            icon={Ban}
            loading={loading && !hasLoadedOnce}
          />
        </KpiPresetButton>
      </SummaryKpiGrid>

      <div
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
        data-testid="output-documents-meta"
      >
        <span>
          Total filtrado:{" "}
          <strong className="text-foreground">{totalItems}</strong>
          {sortBy !== "dataDocumento" || sortDir !== "desc" ? (
            <>
              {" "}
              · Ordenado por{" "}
              <strong className="text-foreground">
                {GRID_COLUMNS.find((column) => column.sortKey === sortBy)?.label ??
                  sortBy}
              </strong>{" "}
              ({sortDir === "asc" ? "crescente" : "decrescente"})
            </>
          ) : null}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="output-documents-export-csv"
          disabled={items.length === 0 || loading}
          onClick={() => downloadOutputDocumentsPageCsv(items)}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Exportar página (CSV)
        </button>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className={cn(
            "rounded-xl border p-4 text-sm",
            errorKind === "api_unavailable"
              ? "border-amber-300/60 bg-amber-50 text-amber-950"
              : errorKind === "access_denied"
                ? "border-rose-300/60 bg-rose-50 text-rose-950"
                : "border-destructive/40 bg-destructive/5 text-destructive"
          )}
          data-testid={
            errorKind === "api_unavailable"
              ? "output-documents-api-unavailable"
              : errorKind === "access_denied"
                ? "output-documents-error-denied"
                : "output-documents-error"
          }
        >
          {errorMessage}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setRetryToken((current) => current + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!errorMessage ? (
        <section
          className="relative overflow-hidden rounded-xl border border-border bg-card"
          data-testid="output-documents-grid"
          aria-busy={loading}
        >
          {loading && hasLoadedOnce ? (
            <div
              className="absolute right-3 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs text-muted-foreground shadow-sm"
              role="status"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Atualizando…
            </div>
          ) : null}
          {initialLoading ? (
            <div
              className="space-y-3 p-4"
              data-testid="output-documents-loading"
              role="status"
              aria-live="polite"
              aria-label="Carregando Documentos de Saída"
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Carregando Documentos de Saída…
              </div>
              <div
                className="space-y-2"
                data-testid="output-documents-skeleton"
                aria-hidden="true"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-10 animate-pulse rounded-md bg-muted/70"
                  />
                ))}
              </div>
            </div>
          ) : showEmptyCatalog ? (
            <div
              className="p-10 text-center text-sm text-muted-foreground"
              data-testid="output-documents-empty"
            >
              Nenhum Documento de Saída sincronizado ainda.
            </div>
          ) : showEmptyFilters ? (
            <div
              className="p-10 text-center text-sm text-muted-foreground"
              data-testid="output-documents-empty-filters"
            >
              Nenhum resultado para os filtros aplicados.
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto" data-testid="output-documents-grid-scroll">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <caption className="sr-only">
                  Documentos de Saída sincronizados do Nomus. Ative uma linha para
                  abrir o detalhe.
                </caption>
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {GRID_COLUMNS.map((column) => (
                      <th
                        key={column.label}
                        className={cn(
                          "whitespace-nowrap px-3 py-2 font-medium",
                          column.align === "right" ? "text-right" : undefined
                        )}
                        aria-sort={
                          column.sortKey && sortBy === column.sortKey
                            ? sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                      >
                        {column.sortKey ? (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-0.5 py-0.5 hover:text-foreground",
                              column.align === "right" && "ml-auto",
                              sortBy === column.sortKey && "text-foreground"
                            )}
                            data-testid={`output-documents-sort-${column.sortKey}`}
                            onClick={() => toggleSort(column.sortKey!)}
                          >
                            {column.label}
                            {sortBy === column.sortKey ? (
                              sortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3 w-3" aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) =>
                    createElement(OutputDocumentGridTableRow, {
                      key: item.id,
                      item,
                      selected: selectedDocumentId === item.id,
                      onOpen: () => setSelectedDocumentId(item.id),
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {totalPages > 1 ? (
        <div
          className="flex items-center justify-between gap-3 text-sm"
          data-testid="output-documents-pagination"
          role="navigation"
          aria-label="Paginação dos Documentos de Saída"
        >
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              data-testid="output-documents-page-prev"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              data-testid="output-documents-page-next"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}

      <OutputDocumentDetailOverlay
        outputDocumentId={selectedDocumentId}
        onClose={() => setSelectedDocumentId(null)}
        onOpenSalesOrder={openSalesOrderDetail}
        onOpenNfe={openNfeInList}
        dismissOnEsc={salesOrderDetailId == null}
      />

      {salesOrderDetailId != null ? (
        <React.Suspense fallback={null}>
          <SalesOrderDetailDialog
            open
            salesOrderId={salesOrderDetailId}
            orderCode={salesOrderDetailCode}
            onClose={closeSalesOrderDetail}
            onOpenFullAudit={(id) => {
              closeSalesOrderDetail();
              navigate(
                `/finance/portfolio-reconciliation?auditOrderId=${encodeURIComponent(id)}`
              );
            }}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}

function KpiPresetButton({
  children,
  preset,
  active,
  onSelect,
  testId,
}: {
  children: ReactNode;
  preset: OutputDocumentsKpiFilterPreset;
  active: boolean;
  onSelect: (preset: OutputDocumentsKpiFilterPreset) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-kpi-preset={preset}
      data-kpi-active={active ? "true" : "false"}
      className={cn(
        "rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        active ? "ring-2 ring-primary/25" : "hover:opacity-95"
      )}
      onClick={() => onSelect(preset)}
    >
      {children}
    </button>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
