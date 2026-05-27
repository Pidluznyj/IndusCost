import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Printer,
  Loader2,
  BarChart3,
  Users,
  Package,
  Scale,
  Briefcase,
  AlertTriangle,
  Info,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { REPORTS_TOUR_STEPS } from "@/src/tours/reportsTourSteps";
import type { Customer } from "@/src/types/commercial";

type ReportsData = {
  generatedAt: string;
  filters: {
    dateFrom: string | null;
    dateTo: string | null;
    customerId: string | null;
    responsible: string | null;
    status: string | null;
    minNet: number | null;
    maxNet: number | null;
    productId: string | null;
  };
  disclaimers: string[];
  commercial: {
    orderCount: number;
    totalNet: number;
    sentToNomusNet: number;
    openOrdersNet: number;
    cancelledCount: number;
    sentToNomusCount: number;
    openOrdersCount: number;
    ticketAvg: number;
    byStatus: Record<string, { count: number; netSum: number }>;
    byResponsible: Array<{ responsible: string; count: number; netSum: number }>;
    byMonth: Array<{ month: string; count: number; netSum: number; sentToNomusNet: number }>;
    staleOrders: Array<{
      orderCode: string;
      status: string;
      customerName: string;
      responsible: string;
      totalNetValue: number;
      daysSinceUpdate: number;
    }>;
    topCustomersByNet: Array<{
      customerId: string;
      companyName: string;
      netSum: number;
      orderCount: number;
    }>;
    topCustomersByCount: Array<{
      customerId: string;
      companyName: string;
      orderCount: number;
      netSum: number;
    }>;
  };
  customers: {
    abc: Array<{
      customerId: string;
      companyName: string;
      revenue: number;
      rank: number;
      abcClass: string;
      shareOfPortfolioPct: number;
      cumulativeRevenuePct: number;
    }>;
    repurchaseLate: Array<{
      companyName: string;
      medianDays: number | null;
      daysSinceLast: number | null;
      lateVsMedian: boolean | null;
    }>;
    inactiveInPeriod: Array<{
      companyName: string;
      orderCount: number;
      lastOrderAt: string;
    }>;
  };
  products: {
    mixByProduct: Array<{
      sku: string;
      name: string;
      type: string;
      qty: number;
      revenue: number;
      marginSum: number;
      lines: number;
      orders: number;
    }>;
  };
  costing: {
    productsAnalyzed: Array<{
      sku: string;
      name: string;
      totalIndustrialCost: number | null;
      suggestedPricePremissa: number | null;
      avgNegotiatedInPeriod: number | null;
      linesInPeriod: number;
      error?: string;
    }>;
    costProductLimit: number;
    totalDistinctProductsInFilter: number;
  };
  executive: {
    previousPeriod: {
      orderCount: number;
      totalNet: number;
      sentToNomusNet: number;
    } | null;
  };
};

const SALES_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

const STATUS_FILTER: { value: string; label: string }[] = [
  { value: "ALL", label: "Todos os status" },
  { value: "DRAFT", label: SALES_ORDER_STATUS_LABELS.DRAFT },
  { value: "READY_TO_SEND", label: SALES_ORDER_STATUS_LABELS.READY_TO_SEND },
  { value: "SENT_TO_NOMUS", label: SALES_ORDER_STATUS_LABELS.SENT_TO_NOMUS },
  { value: "CANCELLED", label: SALES_ORDER_STATUS_LABELS.CANCELLED },
  { value: "ERROR", label: SALES_ORDER_STATUS_LABELS.ERROR },
];

const TAB_OPTS = [
  { id: "executive" as const, label: "Executivo", icon: Briefcase },
  { id: "commercial" as const, label: "Comercial", icon: BarChart3 },
  { id: "customers" as const, label: "Clientes & ABC", icon: Users },
  { id: "products" as const, label: "Produtos / mix", icon: Package },
  { id: "costing" as const, label: "Custos & preço", icon: Scale },
];

const CHART_COLORS = ["#0d9488", "#6366f1", "#d97706", "#dc2626", "#64748b", "#16a34a", "#7c3aed"];

export const ReportsModule = () => {
  const [tab, setTab] = useState<(typeof TAB_OPTS)[number]["id"]>("executive");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ReportsData | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; sku: string; name: string }>>([]);

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  }, []);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [minNet, setMinNet] = useState("");
  const [maxNet, setMaxNet] = useState("");
  const [productId, setProductId] = useState("");
  const [tourOpen, setTourOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (customerId) params.set("customerId", customerId);
    if (responsible.trim()) params.set("responsible", responsible.trim());
    if (status && status !== "ALL") params.set("status", status);
    if (minNet !== "") params.set("minNet", minNet);
    if (maxNet !== "") params.set("maxNet", maxNet);
    if (productId) params.set("productId", productId);
    try {
      const json = await fetchJsonOk<ReportsData>(`/api/reports/data?${params.toString()}`);
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar relatórios.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, customerId, responsible, status, minNet, maxNet, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchJsonOk<Customer[]>("/api/customers")
      .then((r) => setCustomers(Array.isArray(r) ? r : []))
      .catch(() => setCustomers([]));
    fetchJsonOk<Array<{ id: string; sku: string; name: string }>>("/api/products")
      .then((r) => setProducts(Array.isArray(r) ? r.map((p) => ({ id: p.id, sku: p.sku, name: p.name })) : []))
      .catch(() => setProducts([]));
  }, []);

  const customerOpts = useMemo(
    () => [
      { value: "", label: "Todos os clientes", searchTerms: "todos" },
      ...customers.map((c) => ({
        value: c.id,
        label: `${c.companyName} (${c.taxId})`,
        searchTerms: `${c.companyName} ${c.taxId}`,
      })),
    ],
    [customers]
  );

  const productOpts = useMemo(
    () => [
      { value: "", label: "Todos os produtos (mix)", searchTerms: "todos" },
      ...products.map((p) => ({
        value: p.id,
        label: `${p.sku} — ${p.name}`,
        searchTerms: `${p.sku} ${p.name}`,
      })),
    ],
    [products]
  );

  const statusChartData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.commercial.byStatus).map(([name, v]) => {
      const row = v as { count: number; netSum: number };
      return {
        name: SALES_ORDER_STATUS_LABELS[name] ?? name,
        count: row.count,
        netSum: row.netSum,
      };
    });
  }, [data]);

  const monthChartData = useMemo(() => {
    if (!data) return [];
    return data.commercial.byMonth.map((m) => ({
      ...m,
      label: m.month,
    }));
  }, [data]);

  const handlePrint = () => window.print();

  const resetFilters = () => {
    setDateFrom(defaultFrom);
    setDateTo(new Date().toISOString().slice(0, 10));
    setCustomerId("");
    setResponsible("");
    setStatus("ALL");
    setMinNet("");
    setMaxNet("");
    setProductId("");
  };

  return (
    <div id="reports-print-root" className="space-y-6 text-foreground" data-tour="reports-root">
      <header className="reports-print-break border-b border-border pb-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Central de relatórios gerenciais</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Indicadores de pedidos de venda, carteira, mix e custo industrial alinhados aos dados reais do IndusCost.
              Imprima ou salve em PDF pelo navegador (Ctrl+P).
            </p>
            {data && (
              <p className="text-xs text-muted-foreground mt-2 font-mono">
                Emissão: {new Date(data.generatedAt).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 reports-no-print items-center" data-tour="reports-header-actions">
            <TourHelpButton onClick={() => setTourOpen(true)} />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-accent"
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90"
            >
              <Printer className="h-4 w-4" />
              Imprimir / PDF
            </button>
          </div>
        </div>
      </header>

      <section
        className="reports-no-print rounded-xl border border-border bg-card p-4 space-y-4"
        data-tour="reports-filters"
      >
        <p className="text-xs font-bold uppercase text-muted-foreground">Filtros globais</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <div>
            <label className="text-[10px] font-bold text-muted-foreground">De (emissão pedido)</label>
            <input
              type="date"
              className="mt-1 w-full p-2 rounded-lg border border-border text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground">Até (emissão pedido)</label>
            <input
              type="date"
              className="mt-1 w-full p-2 rounded-lg border border-border text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="min-w-[200px]">
            <label className="text-[10px] font-bold text-muted-foreground">Cliente</label>
            <div className="mt-1">
              <SearchableSelect options={customerOpts} value={customerId} onChange={setCustomerId} placeholder="—" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground">Responsável (exato)</label>
            <input
              className="mt-1 w-full p-2 rounded-lg border border-border text-sm"
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              placeholder="Nome como no pedido"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="text-[10px] font-bold text-muted-foreground">Status</label>
            <div className="mt-1">
              <SearchableSelect
                options={STATUS_FILTER.map((s) => ({
                  value: s.value,
                  label: s.label,
                  searchTerms: s.label,
                }))}
                value={status}
                onChange={setStatus}
                placeholder="Status"
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="text-[10px] font-bold text-muted-foreground">Produto (filtra pedidos com item)</label>
            <div className="mt-1">
              <SearchableSelect options={productOpts} value={productId} onChange={setProductId} placeholder="—" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground">Valor pedido min</label>
            <input
              type="number"
              className="mt-1 w-full p-2 rounded-lg border border-border text-sm"
              value={minNet}
              onChange={(e) => setMinNet(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground">Valor pedido max</label>
            <input
              type="number"
              className="mt-1 w-full p-2 rounded-lg border border-border text-sm"
              value={maxNet}
              onChange={(e) => setMaxNet(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-border/60">
          <button
            type="button"
            onClick={resetFilters}
            disabled={loading}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Limpar filtros
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed min-w-[9.5rem]"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Pesquisando...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" aria-hidden />
                Pesquisar
              </>
            )}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Os relatórios também atualizam ao alterar um filtro. Use <strong className="font-semibold">Pesquisar</strong>{" "}
          para recarregar com os valores atuais.
        </p>
      </section>

      {data?.disclaimers && data.disclaimers.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex gap-2 text-sm text-amber-950">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <ul className="list-disc pl-4 space-y-1">
            {data.disclaimers.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="reports-no-print flex flex-wrap gap-2 p-1 bg-accent/40 rounded-xl border border-border"
        data-tour="reports-tabs"
      >
        {TAB_OPTS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
              tab === t.id ? "bg-card shadow border border-border" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-24 gap-2">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Carregando agregados…</p>
        </div>
      )}
      {err && <p className="text-center text-red-600 py-8">{err}</p>}

      {!loading && data && (
        <div data-tour="reports-main-content" className="space-y-6">
          {/* Resumo impressão: filtros */}
          <div className="hidden print:block text-xs border border-border rounded p-2 mb-4">
            <strong>Filtros:</strong> {dateFrom || "—"} a {dateTo || "—"} · Cliente:{" "}
            {customerId ? customerOpts.find((c) => c.value === customerId)?.label : "todos"} · Resp.:{" "}
            {responsible || "—"} · Status: {status === "ALL" ? "todos" : status}
          </div>

          {tab === "executive" && (
            <div className="space-y-6">
              <ReportsContextNote>
                Indicadores por <strong className="font-semibold text-foreground">data de emissão do pedido</strong>{" "}
                (issueDate) e filtros globais. Pedidos de venda registrados no IndusCost não representam necessariamente
                NF ou faturamento fiscal.
              </ReportsContextNote>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Pedidos (período)" value={String(data.commercial.orderCount)} />
                <KpiCard label="Valor líq. total" value={formatCurrency(data.commercial.totalNet)} />
                <KpiCard
                  label="Enviados ao Nomus (líq.)"
                  value={formatCurrency(data.commercial.sentToNomusNet)}
                  hint="Status Enviado ao Nomus"
                />
                <KpiCard label="Pedidos em aberto (líq.)" value={formatCurrency(data.commercial.openOrdersNet)} />
                <KpiCard label="Ticket médio" value={formatCurrency(data.commercial.ticketAvg)} />
                <KpiCard
                  label="Pedidos enviados ao Nomus"
                  value={String(data.commercial.sentToNomusCount)}
                />
                <KpiCard label="Pedidos em aberto" value={String(data.commercial.openOrdersCount)} />
                <KpiCard label="Pedidos cancelados" value={String(data.commercial.cancelledCount)} />
                <KpiCard label="Pedidos parados (alerta)" value={String(data.commercial.staleOrders.length)} />
              </div>

              {data.executive.previousPeriod && (
                <div className="rounded-xl border border-border p-4 reports-print-break">
                  <h3 className="text-sm font-bold mb-2">Comparação com período anterior (mesma duração)</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Mesmos filtros do período atual (cliente, responsável, status, faixa de valor e produto, quando
                    informados).
                  </p>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Pedidos</p>
                      <p className="font-mono font-bold">{data.executive.previousPeriod.orderCount}</p>
                      <Delta cur={data.commercial.orderCount} prev={data.executive.previousPeriod.orderCount} />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Valor líq.</p>
                      <p className="font-mono font-bold">{formatCurrency(data.executive.previousPeriod.totalNet)}</p>
                      <Delta cur={data.commercial.totalNet} prev={data.executive.previousPeriod.totalNet} />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Enviados ao Nomus</p>
                      <p className="font-mono font-bold">
                        {formatCurrency(data.executive.previousPeriod.sentToNomusNet)}
                      </p>
                      <Delta
                        cur={data.commercial.sentToNomusNet}
                        prev={data.executive.previousPeriod.sentToNomusNet}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border p-4 reports-print-break">
                  <h3 className="text-sm font-bold mb-4">Top clientes — valor vendido (período)</h3>
                  <Table
                    cols={["Cliente", "Pedidos", "Valor líq."]}
                    rows={data.commercial.topCustomersByNet.slice(0, 10).map((r) => [
                      r.companyName,
                      String(r.orderCount),
                      formatCurrency(r.netSum),
                    ])}
                  />
                </div>
                <div className="rounded-xl border border-border p-4 reports-print-break">
                  <h3 className="text-sm font-bold mb-4">Top produtos — valor vendido (período)</h3>
                  <Table
                    cols={["SKU", "Valor vendido", "Margem R$"]}
                    rows={data.products.mixByProduct.slice(0, 10).map((r) => [
                      r.sku,
                      formatCurrency(r.revenue),
                      formatCurrency(r.marginSum),
                    ])}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 h-80 reports-print-break">
                <h3 className="text-sm font-bold mb-2">Valor líquido por mês (emissão do pedido)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatNumber(Number(v) / 1000, 0) + "k"} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend />
                    <Bar dataKey="netSum" name="Valor líq." fill="#0d9488" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="sentToNomusNet" name="Enviado Nomus" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {tab === "commercial" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border p-4 h-72">
                  <h3 className="text-sm font-bold mb-2">Pedidos por status (quantidade)</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusChartData}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {statusChartData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-bold mb-4">Por responsável / vendedor</h3>
                  <Table
                    cols={["Responsável", "Qtd", "Valor líq."]}
                    rows={data.commercial.byResponsible.map((r) => [
                      r.responsible,
                      String(r.count),
                      formatCurrency(r.netSum),
                    ])}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 reports-print-break">
                <h3 className="text-sm font-bold flex items-center gap-2 text-red-900 mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  Pedidos em aberto sem atualização há ≥14 dias
                </h3>
                <Table
                  cols={["Código", "Cliente", "Resp.", "Status", "Dias s/ atual.", "Líq."]}
                  rows={data.commercial.staleOrders.map((p) => [
                    p.orderCode,
                    p.customerName,
                    p.responsible,
                    SALES_ORDER_STATUS_LABELS[p.status] ?? p.status,
                    String(p.daysSinceUpdate),
                    formatCurrency(p.totalNetValue),
                  ])}
                />
                {data.commercial.staleOrders.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma ocorrência no filtro atual.</p>
                )}
              </div>
            </div>
          )}

          {tab === "customers" && (
            <div className="space-y-6">
              <ReportsContextNote>
                Curva ABC usa pedidos do período/filtro (exceto cancelados). Recompra usa histórico global de pedidos não
                cancelados. &quot;Menos ativos&quot; segue os filtros globais da tela.
              </ReportsContextNote>
              <div className="rounded-xl border border-border p-4 reports-print-break overflow-x-auto">
                <h3 className="text-sm font-bold mb-2">Curva ABC — valor vendido em pedidos (período filtrado)</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Classe A/B/C pela regra Pareto 80/15 sobre o valor líquido dos pedidos do filtro (exceto cancelados).
                </p>
                <Table
                  cols={["#", "Cliente", "Classe", "Valor vendido", "% carteira", "Acum. %"]}
                  rows={data.customers.abc.slice(0, 40).map((r) => [
                    String(r.rank),
                    r.companyName,
                    r.abcClass,
                    formatCurrency(r.revenue),
                    `${formatNumber(r.shareOfPortfolioPct, 1)}%`,
                    `${formatNumber(r.cumulativeRevenuePct, 1)}%`,
                  ])}
                />
              </div>
              <div className="rounded-xl border border-border p-4 reports-print-break">
                <h3 className="text-sm font-bold mb-2">Clientes — atraso vs. mediana entre pedidos</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Baseado no histórico de pedidos do cliente (exceto cancelados), não no período filtrado.
                </p>
                <Table
                  cols={["Cliente", "Mediana (d)", "Dias último pedido"]}
                  rows={data.customers.repurchaseLate.map((r) => [
                    r.companyName,
                    r.medianDays != null ? String(Math.round(r.medianDays)) : "—",
                    r.daysSinceLast != null ? String(r.daysSinceLast) : "—",
                  ])}
                />
                {data.customers.repurchaseLate.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum cliente com padrão de atraso detectado ou dados insuficientes.</p>
                )}
              </div>
              <div className="rounded-xl border border-border p-4 reports-print-break">
                <h3 className="text-sm font-bold mb-2">Menos ativos no período (último pedido no filtro)</h3>
                <Table
                  cols={["Cliente", "Pedidos (filtro)", "Último pedido"]}
                  rows={data.customers.inactiveInPeriod.map((r) => [
                    r.companyName,
                    String(r.orderCount),
                    new Date(r.lastOrderAt).toLocaleDateString("pt-BR"),
                  ])}
                />
              </div>
            </div>
          )}

          {tab === "products" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-border p-4 overflow-x-auto reports-print-break">
                <h3 className="text-sm font-bold mb-2">Mix por produto (itens dos pedidos filtrados)</h3>
                <Table
                  cols={["SKU", "Nome", "Tipo", "Qtd", "Valor vendido", "Margem R$", "Pedidos", "Linhas"]}
                  rows={data.products.mixByProduct.map((r) => [
                    r.sku,
                    r.name,
                    r.type,
                    formatNumber(r.qty, 2),
                    formatCurrency(r.revenue),
                    formatCurrency(r.marginSum),
                    String(r.orders),
                    String(r.lines),
                  ])}
                />
              </div>
            </div>
          )}

          {tab === "costing" && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Custo industrial via motor CIU (mesma base do pricing). Preço sugerido = formação de preço da primeira regra
                encontrada para o produto. Preço vendido = média ponderada por quantidade nos itens dos pedidos do filtro.
              </p>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-950">
                <strong className="font-semibold">Amostra limitada:</strong> análise de custo industrial restrita aos
                primeiros {data.costing.costProductLimit} SKUs distintos encontrados no filtro (
                {data.costing.totalDistinctProductsInFilter} no total), por custo de processamento. Produtos fora da
                amostra não aparecem nesta tabela.
              </div>
              <div className="rounded-xl border border-border p-4 overflow-x-auto reports-print-break">
                <Table
                  cols={["SKU", "Custo ind.", "Preço sugerido", "Média vendida", "Δ", "Linhas"]}
                  rows={data.costing.productsAnalyzed.map((r) => {
                    const sug = r.suggestedPricePremissa;
                    const neg = r.avgNegotiatedInPeriod;
                    const delta =
                      sug != null && neg != null ? formatCurrency(neg - sug) : r.error ? r.error : "—";
                    return [
                      r.sku,
                      r.totalIndustrialCost != null ? formatCurrency(r.totalIndustrialCost) : "—",
                      sug != null ? formatCurrency(sug) : "—",
                      neg != null ? formatCurrency(neg) : "—",
                      delta,
                      String(r.linesInPeriod),
                    ];
                  })}
                />
              </div>
              {data.costing.totalDistinctProductsInFilter > data.costing.costProductLimit && (
                <p className="text-xs text-amber-800">
                  Limite de análise de custo: {data.costing.costProductLimit} produtos nesta resposta.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={REPORTS_TOUR_STEPS}
        tourName="Tour de Relatórios"
      />
    </div>
  );
};

function ReportsContextNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex gap-2 reports-print-break">
      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 reports-print-break">
      <p className="text-[10px] font-bold uppercase text-muted-foreground leading-tight">{label}</p>
      <p className="text-lg font-black mt-1">{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{hint}</p> : null}
    </div>
  );
}

function Table({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <div className="reports-table-wrap overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse min-w-[480px]">
        <thead>
          <tr className="border-b border-border bg-accent/40">
            {cols.map((c) => (
              <th key={c} className="p-2 font-bold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="p-4 text-muted-foreground">
                Sem dados.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 hover:bg-accent/20">
                {row.map((cell, j) => (
                  <td key={j} className="p-2 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  return (
    <span className={cn("text-xs font-bold", up ? "text-emerald-600" : "text-red-600")}>
      {up ? "▲" : "▼"} {formatNumber(Math.abs(pct), 1)}%
    </span>
  );
}
