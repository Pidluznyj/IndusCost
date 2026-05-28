import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Info, Loader2, RefreshCw, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";

const PAGE_SIZE = 25;

type FiltersState = {
  startDate: string;
  endDate: string;
  status: string;
  customerId: string;
  productId: string;
  materialId: string;
  companyIssuer: string;
  mode: "quantity" | "value" | "orders" | "products";
  search: string;
};

type MaterialRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  quantityTotal: number;
  unitCostReference: number | null;
  estimatedValueTotal: number;
  orderCount: number;
  productCount: number;
  customerCount?: number;
  latestUsageAt: string | null;
  pctOfTotalQuantity: number | null;
  pctOfTotalValue: number | null;
  topProducts?: Array<{ productId: string; sku: string | null; name: string; quantity: number; value: number }>;
  topCustomers?: Array<{ customerId: string; customerName: string; quantity: number; value: number }>;
  orders?: Array<{
    salesOrderId: string;
    orderCode: string;
    orderDate: string;
    orderStatus: string;
    quantity: number;
    value: number;
  }>;
};

type SummaryBlock = {
  totalEstimatedQuantity: number;
  totalEstimatedValue: number;
  uniqueMaterials: number;
  orderCount: number;
  productCount: number;
  customerCount: number;
  leaderMaterial: null | { code: string | null; description: string };
  leaderSharePct: number | null;
};

type SummaryResponse = {
  semantics: { label: string };
  summary: SummaryBlock;
  charts: {
    paretoByQuantity: MaterialRow[];
    paretoByValue: MaterialRow[];
    evolution: Array<{ period: string; quantity: number; value: number; orderCount: number }>;
  };
  facets: {
    statuses: string[];
    customers: Array<{ id: string; companyName: string }>;
    products: Array<{ id: string; sku: string | null; name: string }>;
    materials: Array<{ materialId: string; code: string | null; description: string; unit: string | null }>;
    companyIssuers: string[];
  };
};

type RowsResponse = {
  rows: MaterialRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

type MaterialDetailsResponse = {
  material: { materialId: string; code: string | null; description: string; unit: string | null };
  totals: {
    quantityTotal: number;
    estimatedValueTotal: number;
    orderCount: number;
    productCount: number;
    customerCount?: number;
    unitCostReference: number | null;
    latestUsageAt: string | null;
  };
  topProducts: NonNullable<MaterialRow["topProducts"]>;
  topCustomers: NonNullable<MaterialRow["topCustomers"]>;
  orders: NonNullable<MaterialRow["orders"]>;
};

export type ProductMaterialDemandDashboardProps = {
  context?: "products" | "sales-orders";
};

const DASHBOARD_CONTEXT = {
  products: {
    moduleLabel: "Engenharia — demanda estimada",
    backPath: "/products",
    backLabel: "Voltar para Engenharia",
    baseBadge: "Base: pedidos de venda",
    title: "Engenharia — Inteligência de Matéria-Prima",
    subtitle:
      "Visão estimada da necessidade de matéria-prima com base nos itens dos pedidos de venda selecionados.",
  },
  "sales-orders": {
    moduleLabel: "Pedidos de venda — demanda estimada",
    backPath: "/sales-orders",
    backLabel: "Voltar para Pedidos de venda",
    baseBadge: "Base: pedidos de venda",
    title: "Pedidos de venda — Inteligência de Matéria-Prima",
    subtitle:
      "Visão estimada da necessidade de matéria-prima com base nos itens dos pedidos de venda filtrados.",
  },
} as const;

const INITIAL_FILTERS: FiltersState = {
  startDate: "",
  endDate: "",
  status: "",
  customerId: "",
  productId: "",
  materialId: "",
  companyIssuer: "",
  mode: "quantity",
  search: "",
};

function filtersQueryString(f: FiltersState): string {
  const qs = new URLSearchParams();
  (Object.entries(f) as Array<[keyof FiltersState, string]>).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  return qs.toString();
}

function sortParamsForMode(mode: FiltersState["mode"]): { sortBy: string; sortDir: "desc" } {
  switch (mode) {
    case "value":
      return { sortBy: "estimatedValueTotal", sortDir: "desc" };
    case "orders":
      return { sortBy: "orderCount", sortDir: "desc" };
    case "products":
      return { sortBy: "productCount", sortDir: "desc" };
    default:
      return { sortBy: "quantityTotal", sortDir: "desc" };
  }
}

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${formatNumberAdaptive(v)}%`;
}

function periodLabel(yyyymm: string): string {
  const [yy, mm] = yyyymm.split("-");
  if (!yy || !mm) return yyyymm;
  return `${mm}/${yy}`;
}

function modeOptionLabel(mode: FiltersState["mode"]): string {
  switch (mode) {
    case "value":
      return "Valor estimado";
    case "orders":
      return "Pedidos de venda (contagem)";
    case "products":
      return "Produtos impactados (contagem)";
    default:
      return "Quantidade estimada";
  }
}

function MaterialDemandInfoBanner() {
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-sky-200/80 bg-sky-50/60 dark:border-sky-900/50 dark:bg-sky-950/25 pl-4 pr-4 py-4 shadow-sm"
      role="status"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-sky-500/80" aria-hidden />
      <div className="flex gap-3 pl-2">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200/80 bg-white/80 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          <Info className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">Esta visão não representa consumo real de produção</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Os volumes apresentados são estimativas calculadas a partir dos produtos, estruturas e quantidades presentes
            nos pedidos de venda filtrados. Use esta tela para planejamento de compra, análise de demanda e visão
            antecipada da necessidade de matéria-prima.
          </p>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted/70", className)} aria-hidden />;
}

function MaterialDemandLoadingState({ phase }: { phase: "summary" | "rows" | "both" }) {
  const showSummary = phase === "summary" || phase === "both";
  const showRows = phase === "rows" || phase === "both";
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-foreground">Calculando demanda estimada…</p>
            <p className="text-sm text-muted-foreground">
              Isso pode levar alguns segundos dependendo do volume de pedidos e da complexidade das estruturas de
              produto.
            </p>
          </div>
        </div>
      </div>
      {showSummary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <React.Fragment key={`kpi-${i}`}>
              <DashboardSkeletonBlock className="h-24" />
            </React.Fragment>
          ))}
        </div>
      ) : null}
      {showSummary ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DashboardSkeletonBlock className="h-56" />
          <DashboardSkeletonBlock className="h-56" />
        </div>
      ) : null}
      {showRows ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <DashboardSkeletonBlock className="h-5 w-48" />
          <DashboardSkeletonBlock className="h-40" />
        </div>
      ) : null}
    </div>
  );
}

function MaterialDemandEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
      <p className="text-base font-semibold text-foreground">Nenhuma demanda encontrada para os filtros selecionados</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Tente ampliar o período, remover filtros de cliente ou produto ou selecionar outro status.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-accent"
      >
        Limpar filtros
      </button>
    </div>
  );
}

function MaterialDemandErrorState({
  onRetry,
  onClear,
}: {
  onRetry: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <p className="text-base font-semibold text-foreground">Não foi possível carregar a análise de matéria-prima</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Verifique os filtros e tente novamente. Se o problema persistir, acione o suporte técnico.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Tentar novamente
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-accent"
        >
          Limpar filtros
        </button>
      </div>
    </div>
  );
}

export function ProductMaterialDemandDashboard({ context = "products" }: ProductMaterialDemandDashboardProps) {
  const ctx = DASHBOARD_CONTEXT[context];
  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(INITIAL_FILTERS);
  const [rowsPage, setRowsPage] = useState(1);

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [rowsData, setRowsData] = useState<RowsResponse | null>(null);

  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Map<string, MaterialDetailsResponse>>(new Map());
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsErrorById, setDetailsErrorById] = useState<Map<string, string>>(new Map());

  const [retryNonce, setRetryNonce] = useState(0);

  /** Último filtro com resumo carregado com sucesso — usado para distinguir mudança de filtro vs. só paginação. */
  const lastCompletedFilterKeyRef = useRef<string | null>(null);
  const detailsCacheRef = useRef<Map<string, MaterialDetailsResponse>>(new Map());

  const debouncedSearchCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debouncedSearchCommit.current) clearTimeout(debouncedSearchCommit.current);
    debouncedSearchCommit.current = setTimeout(() => {
      const next = searchInput.trim().toLowerCase();
      setFilters((f) => (f.search === next ? f : { ...f, search: next }));
    }, 320);
    return () => {
      if (debouncedSearchCommit.current) clearTimeout(debouncedSearchCommit.current);
    };
  }, [searchInput]);

  useEffect(() => {
    setSearchInput(appliedFilters.search);
  }, [appliedFilters]);

  const filterKey = useMemo(() => JSON.stringify(appliedFilters), [appliedFilters]);

  useEffect(() => {
    detailsCacheRef.current = detailsCache;
  }, [detailsCache]);

  useEffect(() => {
    const ac = new AbortController();
    const qs = filtersQueryString(appliedFilters);
    const sort = sortParamsForMode(appliedFilters.mode);
    const sameFilterKey = lastCompletedFilterKeyRef.current === filterKey;

    let cancelled = false;

    async function run() {
      setRowsError(null);
      if (!sameFilterKey) {
        setFatalError(null);
        setLoadingSummary(true);
        setLoadingRows(true);
        setSummaryData(null);
        setRowsData(null);
        setDetailsCache(new Map());
        detailsCacheRef.current = new Map();
        setDetailsErrorById(new Map());
        setExpandedMaterialId(null);
      } else {
        setLoadingRows(true);
      }

      const rowsUrl = `/api/products/material-demand/rows?${qs}&page=${rowsPage}&pageSize=${PAGE_SIZE}&sortBy=${sort.sortBy}&sortDir=${sort.sortDir}`;

      try {
        if (!sameFilterKey) {
          const settled = await Promise.allSettled([
            fetchJsonOk<SummaryResponse>(`/api/products/material-demand/summary?${qs}`, { signal: ac.signal }),
            fetchJsonOk<RowsResponse>(rowsUrl, { signal: ac.signal }),
          ]);
          if (cancelled || ac.signal.aborted) return;

          if (settled[0].status === "rejected") {
            const err = settled[0].reason;
            console.error("[MaterialDemand] summary", err);
            setFatalError(err instanceof Error ? err.message : "Não foi possível carregar o resumo da análise.");
            setSummaryData(null);
          } else {
            setSummaryData(settled[0].value);
            lastCompletedFilterKeyRef.current = filterKey;
          }

          if (settled[1].status === "rejected") {
            console.error("[MaterialDemand] rows", settled[1].reason);
            setRowsError("Não foi possível carregar a tabela de matérias-primas.");
            setRowsData(null);
          } else {
            setRowsData(settled[1].value);
          }
        } else {
          const rowPayload = await fetchJsonOk<RowsResponse>(rowsUrl, { signal: ac.signal });
          if (cancelled || ac.signal.aborted) return;
          setRowsData(rowPayload);
        }
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        console.error("[MaterialDemand] load", e);
        if (!sameFilterKey) {
          setFatalError(e instanceof Error ? e.message : "Erro inesperado ao carregar a análise.");
        } else {
          setRowsError("Não foi possível atualizar a página da tabela.");
        }
      } finally {
        if (!cancelled && !ac.signal.aborted) {
          setLoadingSummary(false);
          setLoadingRows(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [filterKey, rowsPage, appliedFilters, retryNonce]);

  const maxParetoQty = useMemo(
    () => Math.max(0, ...(summaryData?.charts.paretoByQuantity.map((r) => r.quantityTotal) ?? [0])),
    [summaryData]
  );
  const maxParetoVal = useMemo(
    () => Math.max(0, ...(summaryData?.charts.paretoByValue.map((r) => r.estimatedValueTotal) ?? [0])),
    [summaryData]
  );

  const handleApply = useCallback(() => {
    const merged: FiltersState = { ...filters, search: searchInput.trim().toLowerCase() };
    setFilters(merged);
    setRowsPage(1);
    setAppliedFilters(merged);
  }, [filters, searchInput]);

  const handleClear = useCallback(() => {
    setFilters(INITIAL_FILTERS);
    setSearchInput("");
    setRowsPage(1);
    setAppliedFilters(INITIAL_FILTERS);
  }, []);

  const handleRetry = useCallback(() => {
    lastCompletedFilterKeyRef.current = null;
    setRowsPage(1);
    setRetryNonce((n) => n + 1);
  }, []);

  const hasData =
    summaryData &&
    (summaryData.summary.uniqueMaterials > 0 ||
      summaryData.summary.totalEstimatedQuantity > 0 ||
      summaryData.summary.totalEstimatedValue > 0);

  const tableRows = rowsData?.rows ?? [];
  const pagination = rowsData?.pagination;

  const loadDetails = useCallback(async (materialId: string) => {
    if (detailsCacheRef.current.has(materialId)) return;
    setDetailsLoadingId(materialId);
    setDetailsErrorById((m) => {
      const next = new Map(m);
      next.delete(materialId);
      return next;
    });
    const qs = filtersQueryString(appliedFilters);
    try {
      const d = await fetchJsonOk<MaterialDetailsResponse>(
        `/api/products/material-demand/materials/${encodeURIComponent(materialId)}/details?${qs}`
      );
      setDetailsCache((prev) => {
        const next = new Map(prev).set(materialId, d);
        detailsCacheRef.current = next;
        return next;
      });
    } catch (e) {
      console.error("[MaterialDemand] details", e);
      const msg = e instanceof Error ? e.message : "Não foi possível carregar os detalhes.";
      setDetailsErrorById((prev) => new Map(prev).set(materialId, msg));
    } finally {
      setDetailsLoadingId(null);
    }
  }, [appliedFilters]);

  const toggleRow = useCallback(
    (materialId: string) => {
      setExpandedMaterialId((prev) => {
        if (prev === materialId) return null;
        void loadDetails(materialId);
        return materialId;
      });
    },
    [loadDetails]
  );

  const showFullPageLoading = (loadingSummary || loadingRows) && !summaryData && !fatalError;
  const showSummaryLoadingOverlay = loadingSummary && summaryData != null;
  const showTableSkeleton = loadingRows && summaryData != null && rowsData == null && !rowsError;

  return (
    <ContextualDashboardLayout
      moduleLabel={ctx.moduleLabel}
      backPath={ctx.backPath}
      backLabel={ctx.backLabel}
    >
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Demanda estimada
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-muted/20 px-2.5 py-0.5 text-xs text-muted-foreground">
                {ctx.baseBadge}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{ctx.title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground max-w-3xl">{ctx.subtitle}</p>
          </div>
        </div>
        <MaterialDemandInfoBanner />
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Filtros da análise</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Refine a visão para entender a demanda estimada por período, cliente, produto ou matéria-prima.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-start">
              Data inicial
            </label>
            <p className="text-[11px] text-muted-foreground leading-snug">Período usado para selecionar pedidos de venda (data de emissão).</p>
            <input
              id="mdf-start"
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-end">
              Data final
            </label>
            <p className="text-[11px] text-muted-foreground leading-snug">Período usado para selecionar pedidos de venda (data de emissão).</p>
            <input
              id="mdf-end"
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-status">
              Status
            </label>
            <select
              id="mdf-status"
              value={filters.status}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Todos os status</option>
              {(summaryData?.facets.statuses ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-customer">
              Cliente
            </label>
            <select
              id="mdf-customer"
              value={filters.customerId}
              onChange={(e) => setFilters((p) => ({ ...p, customerId: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Todos os clientes</option>
              {(summaryData?.facets.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-product">
              Produto
            </label>
            <select
              id="mdf-product"
              value={filters.productId}
              onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Todos os produtos</option>
              {(summaryData?.facets.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.sku ? `[${p.sku}] ` : "") + p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-material">
              Matéria-prima
            </label>
            <select
              id="mdf-material"
              value={filters.materialId}
              onChange={(e) => setFilters((p) => ({ ...p, materialId: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Todas as matérias-primas</option>
              {(summaryData?.facets.materials ?? []).map((m) => (
                <option key={m.materialId} value={m.materialId}>
                  {(m.code ? `[${m.code}] ` : "") + m.description}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-company">
              Empresa emissora
            </label>
            <select
              id="mdf-company"
              value={filters.companyIssuer}
              onChange={(e) => setFilters((p) => ({ ...p, companyIssuer: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Todas</option>
              {(summaryData?.facets.companyIssuers ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-mode">
              Modo de análise
            </label>
            <p className="text-[11px] text-muted-foreground leading-snug">Quantidade ou valor estimado (e visões por contagem).</p>
            <select
              id="mdf-mode"
              value={filters.mode}
              onChange={(e) => setFilters((p) => ({ ...p, mode: e.target.value as FiltersState["mode"] }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="quantity">{modeOptionLabel("quantity")}</option>
              <option value="value">{modeOptionLabel("value")}</option>
              <option value="orders">{modeOptionLabel("orders")}</option>
              <option value="products">{modeOptionLabel("products")}</option>
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mdf-search">
              Buscar matéria-prima
            </label>
            <p className="text-[11px] text-muted-foreground leading-snug">Pesquise por código ou descrição (atualização suavizada ao digitar).</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="mdf-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Código ou descrição"
                className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={handleApply}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-accent"
          >
            Limpar
          </button>
        </div>
      </section>

      {fatalError ? (
        <MaterialDemandErrorState onRetry={handleRetry} onClear={handleClear} />
      ) : showFullPageLoading ? (
        <MaterialDemandLoadingState phase="both" />
      ) : summaryData ? (
        <div className="relative space-y-6">
          {showSummaryLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-background/40 backdrop-blur-[1px]" aria-hidden />
          ) : null}

          {!hasData ? (
            <MaterialDemandEmptyState onClear={handleClear} />
          ) : (
            <>
              <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <ContextualDashboardKpiCard
                  label="Quantidade estimada (matéria-prima)"
                  value={num(summaryData.summary.totalEstimatedQuantity)}
                />
                <ContextualDashboardKpiCard
                  label="Valor estimado (matéria-prima)"
                  value={money(summaryData.summary.totalEstimatedValue)}
                />
                <ContextualDashboardKpiCard
                  label="Matérias-primas analisadas"
                  value={String(summaryData.summary.uniqueMaterials)}
                />
                <ContextualDashboardKpiCard
                  label="Pedidos de venda considerados"
                  value={String(summaryData.summary.orderCount)}
                />
                <ContextualDashboardKpiCard
                  label="Produtos impactados"
                  value={String(summaryData.summary.productCount)}
                />
                <ContextualDashboardKpiCard
                  label="Clientes impactados"
                  value={String(summaryData.summary.customerCount)}
                />
                {summaryData.summary.leaderMaterial ? (
                  <ContextualDashboardKpiCard
                    label="Principal matéria-prima demandada"
                    value={`${summaryData.summary.leaderMaterial.code ? `[${summaryData.summary.leaderMaterial.code}] ` : ""}${summaryData.summary.leaderMaterial.description}`}
                    hint={
                      summaryData.summary.leaderSharePct != null
                        ? `${pct(summaryData.summary.leaderSharePct)} da quantidade total`
                        : undefined
                    }
                    valueClassName="text-base font-semibold leading-snug sm:text-lg normal-nums"
                  />
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                  <h3 className="text-sm font-bold text-foreground">Pareto por quantidade (Top 10)</h3>
                  <div className="space-y-2">
                    {summaryData.charts.paretoByQuantity.slice(0, 10).map((row) => (
                      <div key={`q-${row.materialId}`} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">{(row.code ? `[${row.code}] ` : "") + row.description}</span>
                          <span className="tabular-nums font-semibold">{num(row.quantityTotal)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-blue-600/80"
                            style={{ width: `${maxParetoQty > 0 ? (row.quantityTotal / maxParetoQty) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                  <h3 className="text-sm font-bold text-foreground">Pareto por valor (Top 10)</h3>
                  <div className="space-y-2">
                    {summaryData.charts.paretoByValue.slice(0, 10).map((row) => (
                      <div key={`v-${row.materialId}`} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">{(row.code ? `[${row.code}] ` : "") + row.description}</span>
                          <span className="tabular-nums font-semibold">{money(row.estimatedValueTotal)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-emerald-600/80"
                            style={{ width: `${maxParetoVal > 0 ? (row.estimatedValueTotal / maxParetoVal) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
                <h3 className="text-sm font-bold text-foreground">Evolução mensal estimada</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-semibold">Período</th>
                        <th className="py-2 text-right font-semibold">Quantidade estimada</th>
                        <th className="py-2 text-right font-semibold">Valor estimado</th>
                        <th className="py-2 text-right font-semibold">Pedidos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {summaryData.charts.evolution.map((r) => (
                        <tr key={r.period}>
                          <td className="py-2">{periodLabel(r.period)}</td>
                          <td className="py-2 text-right tabular-nums">{num(r.quantity)}</td>
                          <td className="py-2 text-right tabular-nums">{money(r.value)}</td>
                          <td className="py-2 text-right tabular-nums">{r.orderCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm relative">
                <div className="px-5 py-4 border-b border-border bg-muted/20">
                  <h3 className="text-sm font-bold text-foreground">Matérias-primas (detalhe)</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clique em uma linha para ver produtos, clientes e pedidos relacionados. A lista é paginada para
                    manter a tela responsiva.
                  </p>
                </div>
                {rowsError ? (
                  <div className="p-6 text-center text-sm text-destructive">{rowsError}</div>
                ) : showTableSkeleton ? (
                  <div className="p-6 space-y-3">
                    <DashboardSkeletonBlock className="h-6 w-40" />
                    <DashboardSkeletonBlock className="h-48" />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/15 border-b border-border">
                          <tr>
                            <th className="p-3 text-left font-semibold">Matéria-prima</th>
                            <th className="p-3 text-left font-semibold">Unidade</th>
                            <th className="p-3 text-right font-semibold">Qtd. total</th>
                            <th className="p-3 text-right font-semibold">Custo unit. ref.</th>
                            <th className="p-3 text-right font-semibold">Valor total</th>
                            <th className="p-3 text-right font-semibold">Pedidos</th>
                            <th className="p-3 text-right font-semibold">Produtos</th>
                            <th className="p-3 text-right font-semibold">Último uso</th>
                            <th className="p-3 text-right font-semibold">% qtd.</th>
                            <th className="p-3 text-right font-semibold">% valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {tableRows.map((row) => {
                            const cached = detailsCache.get(row.materialId);
                            const detailErr = detailsErrorById.get(row.materialId);
                            const isOpen = expandedMaterialId === row.materialId;
                            const topProducts = cached?.topProducts ?? row.topProducts ?? [];
                            const topCustomers = cached?.topCustomers ?? row.topCustomers ?? [];
                            const orders = cached?.orders ?? row.orders ?? [];

                            return (
                              <React.Fragment key={row.materialId}>
                                <tr
                                  className="hover:bg-muted/30 cursor-pointer"
                                  onClick={() => toggleRow(row.materialId)}
                                >
                                  <td className="p-3">
                                    <div className="flex items-start gap-2">
                                      <ChevronDown
                                        className={cn(
                                          "h-4 w-4 mt-0.5 shrink-0 transition-transform text-muted-foreground",
                                          isOpen && "rotate-180"
                                        )}
                                        aria-hidden
                                      />
                                      <div className="min-w-0">
                                        <p className="font-semibold break-words">
                                          {(row.code ? `[${row.code}] ` : "") + row.description}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="p-3">{row.unit ?? "—"}</td>
                                  <td className="p-3 text-right tabular-nums">{num(row.quantityTotal)}</td>
                                  <td className="p-3 text-right tabular-nums">{money(row.unitCostReference)}</td>
                                  <td className="p-3 text-right tabular-nums font-semibold">
                                    {money(row.estimatedValueTotal)}
                                  </td>
                                  <td className="p-3 text-right tabular-nums">{row.orderCount}</td>
                                  <td className="p-3 text-right tabular-nums">{row.productCount}</td>
                                  <td className="p-3 text-right tabular-nums">
                                    {row.latestUsageAt ? new Date(row.latestUsageAt).toLocaleDateString("pt-BR") : "—"}
                                  </td>
                                  <td className="p-3 text-right tabular-nums">{pct(row.pctOfTotalQuantity)}</td>
                                  <td className="p-3 text-right tabular-nums">{pct(row.pctOfTotalValue)}</td>
                                </tr>
                                {isOpen ? (
                                  <tr className="bg-muted/10">
                                    <td colSpan={10} className="p-3">
                                      {detailsLoadingId === row.materialId ? (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                          Carregando detalhes…
                                        </div>
                                      ) : detailErr ? (
                                        <p className="text-sm text-destructive py-2">{detailErr}</p>
                                      ) : (
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                          <div className="rounded-lg border border-border bg-background p-3">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                                              Principais produtos
                                            </p>
                                            <ul className="space-y-1 text-xs">
                                              {topProducts.slice(0, 6).map((p) => (
                                                <li key={`${row.materialId}-${p.productId}`}>
                                                  {(p.sku ? `[${p.sku}] ` : "") + p.name} · {money(p.value)}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                          <div className="rounded-lg border border-border bg-background p-3">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                                              Principais clientes
                                            </p>
                                            <ul className="space-y-1 text-xs">
                                              {topCustomers.slice(0, 6).map((c) => (
                                                <li key={`${row.materialId}-${c.customerId}`}>
                                                  {c.customerName} · {money(c.value)}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                          <div className="rounded-lg border border-border bg-background p-3">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                                              Pedidos de venda
                                            </p>
                                            <ul className="space-y-1 text-xs">
                                              {orders.slice(0, 6).map((o) => (
                                                <li key={`${row.materialId}-${o.salesOrderId}`}>
                                                  {o.orderCode} ({o.orderStatus}) ·{" "}
                                                  {new Date(o.orderDate).toLocaleDateString("pt-BR")} ·{" "}
                                                  {money(o.value)}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ) : null}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {pagination && pagination.totalPages > 1 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
                        <p className="text-muted-foreground">
                          Página {pagination.page} de {pagination.totalPages} · {pagination.totalItems} itens
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pagination.page <= 1 || loadingRows}
                            onClick={() => setRowsPage((p) => Math.max(1, p - 1))}
                            className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
                          >
                            Anterior
                          </button>
                          <button
                            type="button"
                            disabled={pagination.page >= pagination.totalPages || loadingRows}
                            onClick={() => setRowsPage((p) => p + 1)}
                            className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
                          >
                            Próxima
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {loadingRows && rowsData != null ? (
                      <div className="absolute bottom-3 right-4 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        Atualizando tabela…
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </ContextualDashboardLayout>
  );
}
