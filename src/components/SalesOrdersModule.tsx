import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Download, Loader2, Package, Printer, Receipt, ShoppingBag, Ticket } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { SalesOrderListSummaryCards } from "@/src/components/sales/SalesOrderListSummaryCards";
import { SalesOrderListTable } from "@/src/components/sales/SalesOrderListTable";
import {
  SalesOrderQuickSummaryDrawer,
  type SalesOrderListRowSnapshot,
} from "@/src/components/sales/SalesOrderQuickSummaryDrawer";
import { SalesOrderMarginAnalysisSection } from "@/src/components/sales/SalesOrderMarginAnalysis";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary.js";
import type { SalesOrderItemMarginPayload } from "@/src/lib/salesOrderMarginTypes";
import { canViewSalesOrderMarginEconomics } from "@/src/lib/salesOrderListUi";
import {
  SALES_ORDER_MONTH_OPTIONS,
  buildSalesOrderYearOptions,
} from "@/src/lib/salesOrderPeriodFilter";
import {
  downloadInternalMarginExport,
  getSalesOrderListInternalMarginExportUrl,
} from "@/src/lib/salesOrderInternalMarginExportUi";
import { SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER } from "@/src/lib/salesOrderInternalMarginExport";

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
  const navigate = useNavigate();
  const auth = useAuth();
  const showMarginEconomics = useMemo(
    () => canViewSalesOrderMarginEconomics(auth),
    [auth]
  );
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<SalesOrderListSummary>(EMPTY_SALES_ORDER_LIST_SUMMARY);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const yearOptions = useMemo(() => buildSalesOrderYearOptions(currentYear, 5), [currentYear]);
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(null);
  const [responsible, setResponsible] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [year, setYear] = useState<string>(() => String(currentYear));
  const [month, setMonth] = useState<string>("");
  // Busca inteligente: searchDraft é o input imediato; search é o valor com debounce.
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [exportingInternal, setExportingInternal] = useState(false);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [summaryRow, setSummaryRow] = useState<SalesOrderRow | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchDraft]);

  const listFiltersKey = useMemo(
    () =>
      JSON.stringify({ status, customerId, responsible, startDate, endDate, year, month, search }),
    [status, customerId, responsible, startDate, endDate, year, month, search]
  );
  const prevListFiltersKeyRef = useRef<string | null>(null);

  const internalExportQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (customerId) params.set("customerId", customerId);
    if (responsible.trim()) params.set("responsible", responsible.trim());
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    if (search) params.set("q", search);
    return params.toString();
  }, [status, customerId, responsible, startDate, endDate, year, month, search]);

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

  const load = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(SALES_ORDERS_PAGE_SIZE));
        if (status) params.set("status", status);
        if (customerId) params.set("customerId", customerId);
        if (responsible.trim()) params.set("responsible", responsible.trim());
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
        if (year) params.set("year", year);
        if (month) params.set("month", month);
        if (search) params.set("q", search);
        const q = params.toString();
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
          let totalNetAmount = 0;
          let totalItems = 0;
          for (const row of data) {
            totalNetAmount += Number(row.totalNetValue) || 0;
            totalItems += row.totalItems ?? 0;
          }
          setSummary({
            totalOrders: data.length,
            totalNetAmount,
            totalItems,
            averageTicket: data.length > 0 ? totalNetAmount / data.length : 0,
          });
        } else if (isPaginatedSalesOrderList(data)) {
          setRows(data.data);
          setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
          setTotalPages(Number.isFinite(Number(data.totalPages)) ? Math.max(1, Number(data.totalPages)) : 1);
          setCurrentPage(Number.isFinite(Number(data.page)) ? Number(data.page) : page);
          setSummary(data.summary ?? EMPTY_SALES_ORDER_LIST_SUMMARY);
        } else {
          setRows([]);
          setTotal(0);
          setTotalPages(1);
          setSummary(EMPTY_SALES_ORDER_LIST_SUMMARY);
        }
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        console.error(e);
        alert(e instanceof Error ? e.message : "Não foi possível carregar pedidos.");
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        setSummary(EMPTY_SALES_ORDER_LIST_SUMMARY);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [status, customerId, responsible, startDate, endDate, year, month, search]
  );

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
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1">
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Ano</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
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
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Mês</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
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
          <div className="sm:col-span-2">
            <label className="text-[10px] font-bold uppercase text-muted-foreground">
              Busca inteligente
            </label>
            <input
              type="search"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              placeholder="Buscar por pedido, NF, cliente, vendedor ou documento..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="Busca inteligente de pedidos"
              data-testid="sales-orders-smart-search"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Status</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
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
          <div>
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
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Responsável</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              placeholder="Nome do responsável"
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Emissão de</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-2 text-sm outline-none"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-muted-foreground">até</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-2 text-sm outline-none"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="sales-orders-export-internal-margin"
          disabled={exportingInternal}
          onClick={() => void handleExportInternal()}
          className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium hover:bg-primary/10 disabled:opacity-50"
        >
          {exportingInternal ? (
            <>
              <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
              Exportando…
            </>
          ) : (
            <>
              <Download className="inline h-4 w-4 mr-1" />
              Excel interno (margem)
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setStatus("");
            setCustomerId("");
            setCustomerSelection(null);
            setResponsible("");
            setStartDate("");
            setEndDate("");
            setYear("");
            setMonth("");
            setSearchDraft("");
            setSearch("");
            setCurrentPage(1);
          }}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Limpar filtros
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {total === 0 ? (
          <>Nenhum pedido encontrado para os filtros informados.</>
        ) : (
          <>
            {search ? (
              <>
                Busca: <span className="font-semibold text-foreground">"{search}"</span> ·{" "}
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

      <SalesOrderListSummaryCards summary={summary} loading={loading} />

      <SalesOrderListTable
        rows={rows}
        loading={loading}
        selectedOrderId={summaryDrawerOpen ? summaryRow?.id ?? null : null}
        showMarginEconomics={showMarginEconomics}
        onRowOpenSummary={(row) => {
          setSummaryRow(row);
          setSummaryDrawerOpen(true);
        }}
        onOpenDetail={(orderId) => navigate(`/sales-orders/${orderId}`)}
      />

      <SalesOrderQuickSummaryDrawer
        open={summaryDrawerOpen}
        row={summaryRow}
        showMarginEconomics={showMarginEconomics}
        onClose={() => {
          setSummaryDrawerOpen(false);
          setSummaryRow(null);
        }}
        onOpenDetail={(orderId) => {
          setSummaryDrawerOpen(false);
          navigate(`/sales-orders/${orderId}`);
        }}
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
    </div>
  );
}

function SalesOrderDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [row, setRow] = useState<SalesOrderDetail | null>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchJsonOk<SalesOrderDetail>(`/api/sales-orders/${id}`);
        if (!cancelled) setRow(data);
      } catch (e) {
        console.error(e);
        if (!cancelled) setRow(null);
        alert(e instanceof Error ? e.message : "Pedido não encontrado.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-sm">Carregando pedido...</p>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-muted-foreground">Pedido não encontrado.</p>
        <Link to="/sales-orders" className="mt-4 inline-block text-primary font-medium text-sm">
          Voltar à lista
        </Link>
      </div>
    );
  }

  const nomusLabel = row.sentToNomusAt
    ? `Enviado em ${new Date(row.sentToNomusAt).toLocaleString("pt-BR")}`
    : "Não enviado ao Nomus";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/sales-orders")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Lista
        </button>
        <button
          type="button"
          onClick={() => window.open(`/sales-orders/${row.id}/print`, "_blank", "noopener,noreferrer")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Package className="h-5 w-5" />
          <span className="font-mono font-bold text-foreground">{row.orderCode}</span>
          <span className="text-xs">({STATUS_LABELS[row.status] ?? row.status})</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Cabeçalho comercial</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Cliente</p>
            <p className="font-medium">{row.Customer?.companyName ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Responsável</p>
            <p>{row.responsible || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Proposta de origem</p>
            <p>
              #{row.Proposal?.number ?? "—"}{" "}
              {row.Proposal?.title ? <span className="text-muted-foreground">— {row.Proposal.title}</span> : null}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Emissão / entrega prevista</p>
            <p>
              {new Date(row.issueDate).toLocaleDateString("pt-BR")}
              {row.expectedDeliveryDate ? (
                <span className="text-muted-foreground"> → {new Date(row.expectedDeliveryDate).toLocaleDateString("pt-BR")}</span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Pagamento</p>
            <p>{row.paymentTerms || "—"}</p>
            <p className="text-xs text-muted-foreground">{row.paymentMethod || ""}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Frete / entrega</p>
            <p>{row.freightCondition || "—"}</p>
            <p className="text-xs text-muted-foreground">{row.deliveryLocation || ""}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Observações</p>
            <p className="whitespace-pre-wrap">{row.notes || "—"}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-sm">
        <p className="font-semibold text-foreground">Envio ao Nomus</p>
        <p className="text-muted-foreground mt-1">{nomusLabel}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">Totais comerciais</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-[10px] text-muted-foreground">Bruto</p>
            <p className="font-mono font-semibold">{money(row.totalGrossValue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Desconto</p>
            <p className="font-mono font-semibold">{money(row.totalDiscount)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Líquido</p>
            <p className="font-mono font-semibold text-primary">{money(row.totalNetValue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Impostos</p>
            <p className="font-mono font-semibold">{money(row.totalTaxes)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Frete</p>
            <p className="font-mono font-semibold">{money(row.totalFreight)}</p>
          </div>
        </div>
      </div>

      <SalesOrderMarginAnalysisSection summary={row.marginSummary} items={row.items ?? []} />

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border bg-accent/30">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Itens comerciais</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[720px]">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 font-semibold">SKU</th>
                <th className="p-3 font-semibold">Produto</th>
                <th className="p-3 font-semibold text-right">Qtd</th>
                <th className="p-3 font-semibold">Un.</th>
                <th className="p-3 font-semibold text-right">Preço unit.</th>
                <th className="p-3 font-semibold text-right">Total líquido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(row.items ?? []).map((it) => (
                <tr key={it.id}>
                  <td className="p-3 font-mono text-xs">{it.skuSnapshot}</td>
                  <td className="p-3 max-w-[220px]">{it.productNameSnapshot}</td>
                  <td className="p-3 text-right font-mono">{formatNumber(it.quantity, 4)}</td>
                  <td className="p-3 text-muted-foreground">{it.unit || "—"}</td>
                  <td className="p-3 text-right font-mono">{money(it.negotiatedPrice)}</td>
                  <td className="p-3 text-right font-mono font-medium">{money(it.totalNetValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function SalesOrdersModule() {
  const { id } = useParams();
  if (id) return <SalesOrderDetailView id={id} />;
  return <SalesOrderList />;
}
