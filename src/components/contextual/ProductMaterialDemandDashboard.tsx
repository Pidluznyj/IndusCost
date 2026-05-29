import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Loader2, RefreshCw, Search } from "lucide-react";
import { formatYmdLocal } from "@/src/components/crmSellerDashboardUi";
import {
  defaultMaterialDemandTab,
  MATERIAL_DEMAND_TABS,
  MATERIAL_DEMAND_TAB_HINTS,
  materialDemandTabButtonClass,
  materialDemandTabNeedsRows,
  type MaterialDemandDashboardTab,
} from "@/src/components/contextual/materialDemandDashboardUi";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatNumberAdaptive } from "@/src/lib/utils";
import {
  MaterialDemandEvolutionTable,
  MaterialDemandKpiGrid,
  MaterialDemandMaterialsTable,
  MaterialDemandMixedUnitsBlock,
  MaterialDemandNeedByPeriodSection,
  MaterialDemandOrdersWithoutDeliveryWarning,
  MaterialDemandParetoSection,
  MaterialDemandTablePagination,
  MaterialDemandUsageEstimateHeader,
  type MaterialOriginRow,
} from "@/src/components/contextual/MaterialDemandDashboardPanels";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";

const PAGE_SIZE = 25;

type DateBasis = "issueDate" | "expectedDeliveryDate";

type FiltersState = {
  startDate: string;
  endDate: string;
  dateBasis: DateBasis;
  status: string;
  customerId: string;
  productId: string;
  materialId: string;
  companyIssuer: string;
  unitKey: string;
  mode: "quantity" | "value" | "orders" | "products";
  search: string;
};

type MaterialRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  unitKey?: string;
  unitLabel?: string;
  quantityTotal: number;
  unitCostReference: number | null;
  estimatedValueTotal: number;
  orderCount: number;
  productCount: number;
  customerCount?: number;
  latestUsageAt: string | null;
  pctOfTotalQuantity: number | null;
  pctOfTotalValue: number | null;
  leadingProduct?: {
    productId: string;
    sku: string | null;
    name: string;
    value: number;
  } | null;
  leadingCustomer?: {
    customerId: string;
    customerName: string;
    value: number;
  } | null;
  topProducts?: Array<{ productId: string; sku: string | null; name: string; quantity: number; value: number }>;
  topCustomers?: Array<{ customerId: string; customerName: string; quantity: number; value: number }>;
  orders?: Array<{
    salesOrderId: string;
    orderCode: string;
    orderDate: string;
    issueDate?: string;
    expectedDeliveryDate?: string | null;
    orderStatus: string;
    quantity: number;
    value: number;
  }>;
};

type NeedByDeliveryRow = {
  period: string;
  periodLabel: string;
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  unitKey: string;
  unitLabel: string;
  quantity: number;
  estimatedValue: number;
  orderCount: number;
};

type QuantityByUnitRow = {
  unitKey: string;
  unitLabel: string;
  totalQuantity: number;
  materialCount: number;
};

type SummaryBlock = {
  totalEstimatedQuantity: number | null;
  totalEstimatedValue: number;
  uniqueMaterials: number;
  orderCount: number;
  productCount: number;
  customerCount: number;
  hasMixedUnits: boolean;
  quantityTotalsComparable: boolean;
  quantityByUnit: QuantityByUnitRow[];
  leaderMaterial: null | {
    code: string | null;
    description: string;
    unit?: string | null;
    unitLabel?: string;
  };
  leaderSharePct: number | null;
  ordersWithoutDeliveryDate: number;
};

type SummaryResponse = {
  semantics: {
    label: string;
    deliveryDateNote?: string | null;
  };
  filtersApplied?: { dateBasis?: DateBasis };
  summary: SummaryBlock;
  charts: {
    needByDeliveryPeriod: NeedByDeliveryRow[];
    paretoByQuantityByUnit: Array<{ unitKey: string; unitLabel: string; rows: MaterialRow[] }>;
    paretoByValue: MaterialRow[];
    evolution: Array<{
      period: string;
      periodLabel?: string;
      quantity: number | null;
      value: number;
      orderCount: number;
    }>;
  };
  facets: {
    statuses: string[];
    customers: Array<{ id: string; companyName: string }>;
    products: Array<{ id: string; sku: string | null; name: string }>;
    materials: Array<{ materialId: string; code: string | null; description: string; unit: string | null }>;
    companyIssuers: string[];
    units: QuantityByUnitRow[];
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
  origins?: MaterialOriginRow[];
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
      "Estimativa de quanto matéria-prima será necessária para atender os pedidos de venda filtrados, com base na composição atual dos produtos.",
  },
} as const;

type PeriodPreset =
  | "ytd"
  | "last90"
  | "thisMonth"
  | "next30"
  | "next60"
  | "next90"
  | "nextMonth";

const ISSUE_PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "ytd", label: "Ano atual (YTD)" },
  { id: "last90", label: "Últimos 90 dias" },
  { id: "thisMonth", label: "Este mês" },
];

const DELIVERY_PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "next30", label: "Próximos 30 dias" },
  { id: "next60", label: "Próximos 60 dias" },
  { id: "next90", label: "Próximos 90 dias" },
  { id: "thisMonth", label: "Este mês" },
  { id: "nextMonth", label: "Próximo mês" },
];

const FILTER_CONTROL_CLASS =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20";

function resolvePeriodPreset(
  preset: PeriodPreset,
  dateBasis: DateBasis
): Pick<FiltersState, "startDate" | "endDate"> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = formatYmdLocal(today);

  if (dateBasis === "expectedDeliveryDate") {
    if (preset === "next30") {
      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      return { startDate: todayYmd, endDate: formatYmdLocal(end) };
    }
    if (preset === "next60") {
      const end = new Date(today);
      end.setDate(end.getDate() + 60);
      return { startDate: todayYmd, endDate: formatYmdLocal(end) };
    }
    if (preset === "next90") {
      const end = new Date(today);
      end.setDate(end.getDate() + 90);
      return { startDate: todayYmd, endDate: formatYmdLocal(end) };
    }
    if (preset === "thisMonth") {
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return {
        startDate: formatYmdLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
        endDate: formatYmdLocal(end),
      };
    }
    if (preset === "nextMonth") {
      const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      return { startDate: formatYmdLocal(start), endDate: formatYmdLocal(end) };
    }
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    return { startDate: todayYmd, endDate: formatYmdLocal(end) };
  }

  if (preset === "ytd") {
    return { startDate: formatYmdLocal(new Date(today.getFullYear(), 0, 1)), endDate: todayYmd };
  }
  if (preset === "thisMonth") {
    return {
      startDate: formatYmdLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
      endDate: todayYmd,
    };
  }
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  return { startDate: formatYmdLocal(start), endDate: todayYmd };
}

function buildDefaultMaterialDemandFilters(): FiltersState {
  const dateBasis: DateBasis = "expectedDeliveryDate";
  const { startDate, endDate } = resolvePeriodPreset("next30", dateBasis);
  return {
    startDate,
    endDate,
    dateBasis,
    status: "",
    customerId: "",
    productId: "",
    materialId: "",
    companyIssuer: "",
    unitKey: "",
    mode: "value",
    search: "",
  };
}

function periodPresetOptions(dateBasis: DateBasis) {
  return dateBasis === "expectedDeliveryDate" ? DELIVERY_PERIOD_PRESETS : ISSUE_PERIOD_PRESETS;
}

function detectPeriodPreset(
  startDate: string,
  endDate: string,
  dateBasis: DateBasis
): PeriodPreset | "custom" {
  for (const opt of periodPresetOptions(dateBasis)) {
    const range = resolvePeriodPreset(opt.id, dateBasis);
    if (range.startDate === startDate && range.endDate === endDate) return opt.id;
  }
  return "custom";
}

function dateBasisLabel(dateBasis: DateBasis): string {
  return dateBasis === "expectedDeliveryDate" ? "Entrega prevista" : "Emissão do pedido";
}

function MaterialDemandFilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground leading-none"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

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

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function MaterialDemandInfoBanner({ context }: { context: "products" | "sales-orders" }) {
  const operational = context === "sales-orders";
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
          <p className="text-sm font-semibold text-foreground">
            {operational
              ? "Estimativa de uso — não é estoque, compra em aberto nem consumo real de fábrica"
              : "Esta visão não representa consumo real de produção"}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {operational
              ? "Os volumes são calculados a partir dos pedidos de venda filtrados e da composição atual dos produtos. Não considera estoque disponível, compras em aberto, consumo real de fábrica nem MRP completo. Quantidades em KG, UN e outras unidades não podem ser somadas — filtre por unidade ou compare por valor estimado (R$)."
              : "Os volumes apresentados são estimativas calculadas a partir dos produtos, estruturas e quantidades presentes nos pedidos de venda filtrados. A necessidade vem da composição estimada dos produtos — não é consumo real de fábrica, não considera estoque disponível nem compras em aberto. Quantidades em KG, UN e outras unidades não podem ser somadas nem ranqueadas juntas — use o filtro de unidade ou compare por valor estimado (R$)."}
          </p>
        </div>
      </div>
    </div>
  );
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
      <p className="text-base font-semibold text-foreground">
        Nenhuma demanda estimada encontrada para os filtros selecionados
      </p>
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
  const [activeTab, setActiveTab] = useState<MaterialDemandDashboardTab>(() => defaultMaterialDemandTab(context));
  const [usageTableSort, setUsageTableSort] = useState<"value" | "quantity">("value");
  const [filters, setFilters] = useState<FiltersState>(() => buildDefaultMaterialDemandFilters());
  const [searchInput, setSearchInput] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(() => buildDefaultMaterialDemandFilters());
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
      setAppliedFilters((f) => {
        if (f.search === next) return f;
        setRowsPage(1);
        return { ...f, search: next };
      });
    }, 320);
    return () => {
      if (debouncedSearchCommit.current) clearTimeout(debouncedSearchCommit.current);
    };
  }, [searchInput]);

  useEffect(() => {
    setSearchInput(appliedFilters.search);
  }, [appliedFilters]);

  const filterKey = useMemo(() => JSON.stringify(appliedFilters), [appliedFilters]);

  const rowsSort = useMemo(() => {
    if (activeTab === "usage-estimate") {
      return {
        sortBy: usageTableSort === "quantity" ? "quantityTotal" : "estimatedValueTotal",
        sortDir: "desc" as const,
      };
    }
    return sortParamsForMode(appliedFilters.mode);
  }, [activeTab, usageTableSort, appliedFilters.mode]);

  const rowsSortKey = useMemo(() => JSON.stringify(rowsSort), [rowsSort]);
  const tabNeedsRows = materialDemandTabNeedsRows(activeTab);

  useEffect(() => {
    detailsCacheRef.current = detailsCache;
  }, [detailsCache]);

  useEffect(() => {
    const ac = new AbortController();
    const qs = filtersQueryString(appliedFilters);
    const sort = rowsSort;
    const sameFilterKey = lastCompletedFilterKeyRef.current === filterKey;

    let cancelled = false;

    async function run() {
      setRowsError(null);
      if (!sameFilterKey) {
        setFatalError(null);
        setLoadingSummary(true);
        if (tabNeedsRows) setLoadingRows(true);
        setSummaryData(null);
        if (!tabNeedsRows) setRowsData(null);
        setDetailsCache(new Map());
        detailsCacheRef.current = new Map();
        setDetailsErrorById(new Map());
        setExpandedMaterialId(null);
      } else if (tabNeedsRows) {
        setLoadingRows(true);
      }

      const rowsUrl = `/api/products/material-demand/rows?${qs}&page=${rowsPage}&pageSize=${PAGE_SIZE}&sortBy=${sort.sortBy}&sortDir=${sort.sortDir}`;

      try {
        if (!sameFilterKey) {
          const requests: Promise<unknown>[] = [
            fetchJsonOk<SummaryResponse>(`/api/products/material-demand/summary?${qs}`, { signal: ac.signal }),
          ];
          if (tabNeedsRows) {
            requests.push(fetchJsonOk<RowsResponse>(rowsUrl, { signal: ac.signal }));
          }

          const settled = await Promise.allSettled(requests);
          if (cancelled || ac.signal.aborted) return;

          if (settled[0].status === "rejected") {
            const err = settled[0].reason;
            console.error("[MaterialDemand] summary", err);
            setFatalError(err instanceof Error ? err.message : "Não foi possível carregar o resumo da análise.");
            setSummaryData(null);
          } else {
            setSummaryData(settled[0].value as SummaryResponse);
            lastCompletedFilterKeyRef.current = filterKey;
          }

          if (tabNeedsRows) {
            const rowsResult = settled[1];
            if (!rowsResult || rowsResult.status === "rejected") {
              console.error("[MaterialDemand] rows", rowsResult?.status === "rejected" ? rowsResult.reason : "missing");
              setRowsError("Não foi possível carregar a tabela de matérias-primas.");
              setRowsData(null);
            } else {
              setRowsData(rowsResult.value as RowsResponse);
            }
          }
        } else if (tabNeedsRows) {
          const rowPayload = await fetchJsonOk<RowsResponse>(rowsUrl, { signal: ac.signal });
          if (cancelled || ac.signal.aborted) return;
          setRowsData(rowPayload);
        }
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        console.error("[MaterialDemand] load", e);
        if (!sameFilterKey) {
          setFatalError(e instanceof Error ? e.message : "Erro inesperado ao carregar a análise.");
        } else if (tabNeedsRows) {
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
  }, [filterKey, rowsPage, appliedFilters, retryNonce, rowsSortKey, tabNeedsRows]);

  const showEvolutionQuantity =
    summaryData?.summary.quantityTotalsComparable === true ||
    Boolean(appliedFilters.unitKey);

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
    const defaults = buildDefaultMaterialDemandFilters();
    setFilters(defaults);
    setSearchInput("");
    setRowsPage(1);
    setAppliedFilters(defaults);
  }, []);

  const activePeriodPreset = useMemo(
    () => detectPeriodPreset(appliedFilters.startDate, appliedFilters.endDate, appliedFilters.dateBasis),
    [appliedFilters.startDate, appliedFilters.endDate, appliedFilters.dateBasis]
  );

  const applyPeriodPreset = useCallback(
    (preset: PeriodPreset) => {
      setFilters((p) => {
        const range = resolvePeriodPreset(preset, p.dateBasis);
        const merged: FiltersState = {
          ...p,
          ...range,
          search: searchInput.trim().toLowerCase(),
        };
        setRowsPage(1);
        lastCompletedFilterKeyRef.current = null;
        setDetailsCache(new Map());
        detailsCacheRef.current = new Map();
        setDetailsErrorById(new Map());
        setExpandedMaterialId(null);
        setAppliedFilters(merged);
        return merged;
      });
    },
    [searchInput]
  );

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

  const handleSelectUnit = useCallback(
    (unitKey: string) => {
      const next = { ...filters, unitKey };
      setFilters(next);
      setAppliedFilters(next);
      setRowsPage(1);
    },
    [filters]
  );

  const handleTabChange = useCallback((tab: MaterialDemandDashboardTab) => {
    setActiveTab(tab);
    setExpandedMaterialId(null);
    setRowsPage(1);
  }, []);

  const getDetailOrigins = useCallback(
    (materialId: string): MaterialOriginRow[] => detailsCache.get(materialId)?.origins ?? [],
    [detailsCache]
  );

  const getDetailTopProducts = useCallback(
    (materialId: string) => detailsCache.get(materialId)?.topProducts ?? [],
    [detailsCache]
  );

  const getDetailTopCustomers = useCallback(
    (materialId: string) => detailsCache.get(materialId)?.topCustomers ?? [],
    [detailsCache]
  );

  const getDetailOrders = useCallback(
    (materialId: string) => detailsCache.get(materialId)?.orders ?? [],
    [detailsCache]
  );

  const renderMaterialsTableCard = (variant: "usage" | "detail", title: string, description: string) => (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm relative">
      <div className="px-5 py-4 border-b border-border bg-muted/20 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
        {variant === "usage" ? (
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex flex-wrap gap-1.5 justify-end">
              <button
                type="button"
                onClick={() => {
                  setUsageTableSort("value");
                  setRowsPage(1);
                }}
                className={cn(
                  "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold transition-colors",
                  materialDemandTabButtonClass(usageTableSort === "value")
                )}
              >
                Ordenar por valor
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsageTableSort("quantity");
                  setRowsPage(1);
                }}
                className={cn(
                  "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold transition-colors",
                  materialDemandTabButtonClass(usageTableSort === "quantity")
                )}
              >
                Ordenar por quantidade
              </button>
            </div>
            {summaryData?.summary.hasMixedUnits && !appliedFilters.unitKey ? (
              <p className="text-[10px] text-muted-foreground text-right max-w-xs">
                Ordenação por quantidade compara MPs de unidades diferentes — prefira filtrar por unidade ou ordenar
                por valor.
              </p>
            ) : null}
          </div>
        ) : null}
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
          <MaterialDemandMaterialsTable
            variant={variant}
            rows={tableRows}
            expandedMaterialId={expandedMaterialId}
            detailsLoadingId={detailsLoadingId}
            detailsErrorById={detailsErrorById}
            getOrigins={getDetailOrigins}
            getTopProducts={getDetailTopProducts}
            getTopCustomers={getDetailTopCustomers}
            getOrders={getDetailOrders}
            onToggleRow={toggleRow}
          />
          {pagination ? (
            <MaterialDemandTablePagination
              pagination={pagination}
              loadingRows={loadingRows}
              onPrev={() => setRowsPage((p) => Math.max(1, p - 1))}
              onNext={() => setRowsPage((p) => p + 1)}
            />
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
  );

  const showFullPageLoading = loadingSummary && !summaryData && !fatalError;
  const showSummaryLoadingOverlay = loadingSummary && summaryData != null;
  const showTableSkeleton =
    tabNeedsRows && loadingRows && summaryData != null && rowsData == null && !rowsError;

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
                {context === "sales-orders" ? "Estimativa de uso" : "Demanda estimada"}
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-muted/20 px-2.5 py-0.5 text-xs text-muted-foreground">
                {ctx.baseBadge}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{ctx.title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground max-w-3xl">{ctx.subtitle}</p>
          </div>
        </div>
        <MaterialDemandInfoBanner context={context} />
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-5">
        <div>
          <h2 className="text-sm font-bold text-foreground">Filtros da análise</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Por padrão usa entrega prevista nos próximos 30 dias. Ajuste a base do período, presets ou filtros
            adicionais. Não inclui estoque nem compras em aberto.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end max-w-3xl">
          <MaterialDemandFilterField label="Base do período" htmlFor="mdf-date-basis">
            <select
              id="mdf-date-basis"
              value={filters.dateBasis}
              onChange={(e) => {
                const dateBasis = e.target.value as DateBasis;
                const defaultPreset = dateBasis === "expectedDeliveryDate" ? "next30" : "ytd";
                const range = resolvePeriodPreset(defaultPreset, dateBasis);
                setFilters((p) => ({ ...p, dateBasis, ...range }));
              }}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="expectedDeliveryDate">Entrega prevista</option>
              <option value="issueDate">Emissão do pedido</option>
            </select>
          </MaterialDemandFilterField>
        </div>

        <div className="rounded-lg border border-border/80 bg-muted/15 p-4 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground shrink-0">
              Período · {dateBasisLabel(filters.dateBasis).toLowerCase()}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {periodPresetOptions(filters.dateBasis).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => applyPeriodPreset(opt.id)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition-colors",
                    activePeriodPreset === opt.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-accent"
                  )}
                >
                  {opt.label}
                </button>
              ))}
              {activePeriodPreset === "custom" ? (
                <span className="inline-flex h-9 items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground">
                  Período personalizado
                </span>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end max-w-xl">
            <MaterialDemandFilterField label="Data inicial" htmlFor="mdf-start">
              <input
                id="mdf-start"
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
                className={FILTER_CONTROL_CLASS}
              />
            </MaterialDemandFilterField>
            <MaterialDemandFilterField label="Data final" htmlFor="mdf-end">
              <input
                id="mdf-end"
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
                className={FILTER_CONTROL_CLASS}
              />
            </MaterialDemandFilterField>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <MaterialDemandFilterField label="Status" htmlFor="mdf-status">
            <select
              id="mdf-status"
              value={filters.status}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">Todos os status</option>
              {(summaryData?.facets.statuses ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </MaterialDemandFilterField>
          <MaterialDemandFilterField label="Cliente" htmlFor="mdf-customer">
            <select
              id="mdf-customer"
              value={filters.customerId}
              onChange={(e) => setFilters((p) => ({ ...p, customerId: e.target.value }))}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">Todos os clientes</option>
              {(summaryData?.facets.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </MaterialDemandFilterField>
          <MaterialDemandFilterField label="Produto" htmlFor="mdf-product">
            <select
              id="mdf-product"
              value={filters.productId}
              onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">Todos os produtos</option>
              {(summaryData?.facets.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.sku ? `[${p.sku}] ` : "") + p.name}
                </option>
              ))}
            </select>
          </MaterialDemandFilterField>
          <MaterialDemandFilterField label="Empresa emissora" htmlFor="mdf-company">
            <select
              id="mdf-company"
              value={filters.companyIssuer}
              onChange={(e) => setFilters((p) => ({ ...p, companyIssuer: e.target.value }))}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">Todas</option>
              {(summaryData?.facets.companyIssuers ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </MaterialDemandFilterField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
          <MaterialDemandFilterField label="Unidade de medida" htmlFor="mdf-unit">
            <select
              id="mdf-unit"
              value={filters.unitKey}
              onChange={(e) => setFilters((p) => ({ ...p, unitKey: e.target.value }))}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">Todas (ranking por unidade)</option>
              {(summaryData?.facets.units ?? []).map((u) => (
                <option key={u.unitKey} value={u.unitKey}>
                  {u.unitLabel} ({u.materialCount} MP · {num(u.totalQuantity)})
                </option>
              ))}
            </select>
          </MaterialDemandFilterField>
          <MaterialDemandFilterField label="Matéria-prima" htmlFor="mdf-material">
            <select
              id="mdf-material"
              value={filters.materialId}
              onChange={(e) => setFilters((p) => ({ ...p, materialId: e.target.value }))}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">Todas as matérias-primas</option>
              {(summaryData?.facets.materials ?? []).map((m) => (
                <option key={m.materialId} value={m.materialId}>
                  {(m.code ? `[${m.code}] ` : "") + m.description}
                </option>
              ))}
            </select>
          </MaterialDemandFilterField>
          <MaterialDemandFilterField label="Modo de análise" htmlFor="mdf-mode">
            <select
              id="mdf-mode"
              value={filters.mode}
              onChange={(e) => {
                const mode = e.target.value as FiltersState["mode"];
                setFilters((p) => ({ ...p, mode }));
                if (activeTab === "by-material") {
                  setAppliedFilters((p) => ({ ...p, mode }));
                  setRowsPage(1);
                }
              }}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="quantity">{modeOptionLabel("quantity")}</option>
              <option value="value">{modeOptionLabel("value")}</option>
              <option value="orders">{modeOptionLabel("orders")}</option>
              <option value="products">{modeOptionLabel("products")}</option>
            </select>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Afeta a ordenação da aba «Por matéria-prima». Na aba «Estimativa de uso», use os botões de ordenação da
              tabela.
            </p>
          </MaterialDemandFilterField>
        </div>

        <MaterialDemandFilterField label="Buscar matéria-prima" htmlFor="mdf-search">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              id="mdf-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Código ou descrição"
              className={cn(FILTER_CONTROL_CLASS, "pl-10")}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">A busca é aplicada automaticamente ao digitar.</p>
        </MaterialDemandFilterField>

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
              <nav
                className="space-y-2 border-b border-border pb-3"
                aria-label="Abas da análise de matéria-prima"
              >
                <div className="flex flex-wrap gap-2">
                  {MATERIAL_DEMAND_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={cn(
                        "inline-flex h-10 items-center rounded-lg border px-4 text-sm font-semibold transition-colors",
                        materialDemandTabButtonClass(activeTab === tab.id)
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{MATERIAL_DEMAND_TAB_HINTS[activeTab]}</p>
              </nav>

              {activeTab === "usage-estimate" ? (
                <div className="space-y-6">
                  <MaterialDemandUsageEstimateHeader
                    appliedFilters={appliedFilters}
                    facets={summaryData.facets}
                  />
                  <MaterialDemandKpiGrid summaryData={summaryData} appliedFilters={appliedFilters} />
                  <MaterialDemandMixedUnitsBlock
                    summaryData={summaryData}
                    appliedFilters={appliedFilters}
                    onSelectUnit={handleSelectUnit}
                  />
                  <MaterialDemandOrdersWithoutDeliveryWarning
                    count={summaryData.summary.ordersWithoutDeliveryDate}
                    dateBasis={appliedFilters.dateBasis}
                  />
                  {renderMaterialsTableCard(
                    "usage",
                    "Estimativa de uso por matéria-prima",
                    "Quanto de cada matéria-prima será necessário para atender os pedidos filtrados. Clique em uma linha para ver a origem por pedido e produto."
                  )}
                  <MaterialDemandNeedByPeriodSection
                    rows={summaryData.charts.needByDeliveryPeriod}
                    dateBasis={appliedFilters.dateBasis}
                  />
                </div>
              ) : null}

              {activeTab === "summary" ? (
                <div className="space-y-6">
                  <MaterialDemandKpiGrid summaryData={summaryData} appliedFilters={appliedFilters} />
                  <MaterialDemandMixedUnitsBlock
                    summaryData={summaryData}
                    appliedFilters={appliedFilters}
                    onSelectUnit={handleSelectUnit}
                  />
                  <MaterialDemandOrdersWithoutDeliveryWarning
                    count={summaryData.summary.ordersWithoutDeliveryDate}
                    dateBasis={appliedFilters.dateBasis}
                  />
                  <MaterialDemandParetoSection
                    paretoByQuantityByUnit={summaryData.charts.paretoByQuantityByUnit}
                    paretoByValue={summaryData.charts.paretoByValue}
                    maxParetoVal={maxParetoVal}
                  />
                  <MaterialDemandEvolutionTable
                    evolution={summaryData.charts.evolution}
                    showQuantity={showEvolutionQuantity}
                    unitLabel={
                      appliedFilters.unitKey
                        ? summaryData.facets.units.find((u) => u.unitKey === appliedFilters.unitKey)?.unitLabel
                        : undefined
                    }
                    dateBasis={appliedFilters.dateBasis}
                  />
                </div>
              ) : null}

              {activeTab === "by-material" ? (
                <div className="space-y-6">
                  {renderMaterialsTableCard(
                    "detail",
                    "Matérias-primas (detalhe)",
                    "Lista paginada com percentuais e último uso. Clique em uma linha para ver produtos, clientes e pedidos relacionados."
                  )}
                </div>
              ) : null}

              {activeTab === "by-period" ? (
                <div className="space-y-6">
                  <MaterialDemandNeedByPeriodSection
                    rows={summaryData.charts.needByDeliveryPeriod}
                    dateBasis={appliedFilters.dateBasis}
                  />
                  <MaterialDemandEvolutionTable
                    evolution={summaryData.charts.evolution}
                    showQuantity={showEvolutionQuantity}
                    unitLabel={
                      appliedFilters.unitKey
                        ? summaryData.facets.units.find((u) => u.unitKey === appliedFilters.unitKey)?.unitLabel
                        : undefined
                    }
                    dateBasis={appliedFilters.dateBasis}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </ContextualDashboardLayout>
  );
}
