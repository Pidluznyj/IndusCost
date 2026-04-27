import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Loader2, Package } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { SearchableSelect, type SelectOption } from "@/src/components/shared/SearchableSelect";
import type { Customer } from "@/src/types/commercial";

type SalesOrderRow = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: string;
  responsible: string | null;
  totalItems: number;
  totalNetValue: unknown;
  totalMarginPerc: unknown;
  Customer?: { companyName?: string; tradeName?: string };
  Proposal?: { number: number; externalProposalCode?: string | null; title?: string | null };
};

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
  totalMarginValue: unknown;
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
  }>;
};

const SALES_ORDERS_PAGE_SIZE = 20;

type SalesOrderListResponse = {
  data: SalesOrderRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);

  const loadCustomers = useCallback(async () => {
    try {
      const c = await fetchJsonOk<Customer[]>("/api/customers");
      setCustomers(Array.isArray(c) ? c : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  const listFiltersKey = useMemo(
    () => JSON.stringify({ status, customerId, responsible, startDate, endDate }),
    [status, customerId, responsible, startDate, endDate]
  );
  const prevListFiltersKeyRef = useRef<string | null>(null);

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
        } else if (isPaginatedSalesOrderList(data)) {
          setRows(data.data);
          setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
          setTotalPages(Number.isFinite(Number(data.totalPages)) ? Math.max(1, Number(data.totalPages)) : 1);
          setCurrentPage(Number.isFinite(Number(data.page)) ? Number(data.page) : page);
        } else {
          setRows([]);
          setTotal(0);
          setTotalPages(1);
        }
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        console.error(e);
        alert(e instanceof Error ? e.message : "Não foi possível carregar pedidos.");
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [status, customerId, responsible, startDate, endDate]
  );

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

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

  const customerOptions = useMemo((): SelectOption[] => {
    const sorted = customers.slice().sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
    return [
      { value: "", label: "Todos os clientes", searchTerms: "todos" },
      ...sorted.map((c) => ({
        value: c.id,
        label: (c.companyName || c.tradeName || "Cliente").trim(),
        searchTerms: [c.companyName, c.tradeName, c.taxId].filter(Boolean).join(" "),
      })),
    ];
  }, [customers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1">
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
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Cliente</label>
            <div className="mt-1">
              <SearchableSelect
                options={customerOptions}
                value={customerId}
                onChange={setCustomerId}
                placeholder="Todos os clientes"
                searchInputPlaceholder="Buscar cliente..."
                pinOptionValues={[""]}
                listMaxHeight={280}
              />
            </div>
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
          onClick={() => {
            setStatus("");
            setCustomerId("");
            setResponsible("");
            setStartDate("");
            setEndDate("");
            setCurrentPage(1);
          }}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Limpar filtros
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {total === 0 ? (
          <>Nenhum pedido no filtro atual.</>
        ) : (
          <>
            Exibindo{" "}
            <span className="font-semibold text-foreground">
              {listShownRange.from}–{listShownRange.to}
            </span>{" "}
            de <span className="font-semibold text-foreground">{total}</span> pedido(s) · {SALES_ORDERS_PAGE_SIZE} por
            página · mais recentes primeiro
          </>
        )}
      </p>

      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-accent/50 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Pedido</th>
                <th className="p-3 font-semibold">Proposta</th>
                <th className="p-3 font-semibold">Cliente</th>
                <th className="p-3 font-semibold">Responsável</th>
                <th className="p-3 font-semibold">Emissão</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right">Valor líquido</th>
                <th className="p-3 font-semibold text-right">Margem %</th>
                <th className="p-3 font-semibold text-right">Itens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin inline text-primary" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    Nenhum pedido de venda encontrado.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-accent/30 cursor-pointer"
                    onClick={() => navigate(`/sales-orders/${r.id}`)}
                  >
                    <td className="p-3 font-mono font-semibold">{r.orderCode}</td>
                    <td className="p-3">
                      #{r.Proposal?.number ?? "—"}
                      {r.Proposal?.externalProposalCode ? (
                        <span className="block text-[10px] text-muted-foreground">Nomus: {r.Proposal.externalProposalCode}</span>
                      ) : null}
                    </td>
                    <td className="p-3">{r.Customer?.companyName ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{r.responsible || "—"}</td>
                    <td className="p-3 text-xs">{new Date(r.issueDate).toLocaleDateString("pt-BR")}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase">
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">{money(r.totalNetValue, 2)}</td>
                    <td className="p-3 text-right font-mono">{Number.isFinite(Number(r.totalMarginPerc)) ? `${formatNumber(r.totalMarginPerc, 2)}%` : "—"}</td>
                    <td className="p-3 text-right">{r.totalItems}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">Totais</h3>
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
            <p className="text-[10px] text-muted-foreground">Custo total</p>
            <p className="font-mono font-semibold">{money(row.totalCost)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Margem R$</p>
            <p className="font-mono font-semibold">{money(row.totalMarginValue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Margem %</p>
            <p className="font-mono font-semibold">{Number.isFinite(Number(row.totalMarginPerc)) ? `${formatNumber(row.totalMarginPerc, 2)}%` : "—"}</p>
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

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border bg-accent/30">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Itens</h3>
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
                <th className="p-3 font-semibold text-right">Custo</th>
                <th className="p-3 font-semibold text-right">Margem</th>
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
                  <td className="p-3 text-right font-mono">{money(it.totalCost)}</td>
                  <td className="p-3 text-right text-xs">
                    <div className="font-mono">{money(it.marginValue)}</div>
                    <div className="text-muted-foreground">{Number.isFinite(Number(it.marginPerc)) ? `${formatNumber(it.marginPerc, 2)}%` : "—"}</div>
                  </td>
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
