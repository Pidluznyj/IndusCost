import "./raw-material-planning-print.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Download,
  Info,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { cn } from "@/src/lib/utils";
import {
  ContextualDashboardKpiCard,
} from "@/src/components/contextual/ContextualDashboardKpiCard";
import { ContextualDashboardKpiGrid } from "@/src/components/contextual/ContextualDashboardKpiGrid";
import {
  MaterialDemandFilterChips,
  type MaterialDemandFilterChip,
  MaterialDemandTablePagination,
} from "@/src/components/contextual/MaterialDemandDashboardPanels";
import { RawMaterialPlanningPrintDocument } from "@/src/components/materials/RawMaterialPlanningPrintDocument";
import {
  RawMaterialPlanningTable,
  type RawMaterialPurchasePlanPatch,
} from "@/src/components/materials/RawMaterialPlanningTable";
import {
  RAW_MATERIAL_PLANNING_HORIZON_LABELS,
  RAW_MATERIAL_PLANNING_STATUS_LABELS,
  STATUS_TONE_CLASSES,
  type RawMaterialPlanningResponse,
  type RawMaterialPlanningRow,
} from "@/src/components/materials/rawMaterialPlanningUi";
import {
  RAW_MATERIAL_PLANNING_HORIZON_VALUES,
  type RawMaterialPlanningHorizon,
  type RawMaterialPlanningStatus,
} from "@/src/lib/rawMaterialPlanning.shared";

const PLANNING_API = "/api/materials/planning";
const PAGE_SIZE = 25;

/** Ordenação do grid — vale para a tela E para Imprimir/PDF. */
type GridSortField =
  | "technicalNeed"
  | "suggestedQuantity"
  | "countedBalance"
  | "estimatedPurchaseValue"
  | "description";

const GRID_SORT_OPTIONS: Array<{ value: GridSortField; label: string }> = [
  { value: "technicalNeed", label: "Necessidade técnica" },
  { value: "suggestedQuantity", label: "Qtde sugerida" },
  { value: "countedBalance", label: "Saldo atual" },
  { value: "estimatedPurchaseValue", label: "Valor estimado" },
  { value: "description", label: "Matéria-prima (A–Z)" },
];

function gridSortValue(row: RawMaterialPlanningRow, field: GridSortField): number | string {
  switch (field) {
    case "technicalNeed":
      return row.technicalNeed ?? Number.NEGATIVE_INFINITY;
    case "suggestedQuantity":
      return row.suggestedQuantity ?? Number.NEGATIVE_INFINITY;
    case "countedBalance":
      return row.countedBalance ?? Number.NEGATIVE_INFINITY;
    case "estimatedPurchaseValue":
      return row.estimatedPurchaseValue ?? Number.NEGATIVE_INFINITY;
    case "description":
      return `${row.code ?? ""} ${row.description}`.trim().toLowerCase();
  }
}

type FiltersState = {
  asOfDate: string;
  horizon: RawMaterialPlanningHorizon;
  horizonEndDate: string;
  situations: RawMaterialPlanningStatus[];
  search: string;
  supplier: string;
  companyIssuer: string;
  onlyWithPurchaseNeed: boolean;
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultFilters(): FiltersState {
  return {
    asOfDate: todayYmd(),
    horizon: "60",
    horizonEndDate: "",
    situations: [],
    search: "",
    supplier: "",
    companyIssuer: "",
    onlyWithPurchaseNeed: false,
  };
}

/**
 * O backend não pagina (retorna todas as MPs do filtro) — a paginação é só
 * de exibição, feita no cliente sobre `data.materials`.
 */
function filtersToQueryString(f: FiltersState): string {
  const params = new URLSearchParams();
  if (f.asOfDate) params.set("asOfDate", f.asOfDate);
  params.set("horizon", f.horizon);
  if (f.horizon === "custom" && f.horizonEndDate) params.set("horizonEndDate", f.horizonEndDate);
  for (const s of f.situations) params.append("situation", s);
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.supplier.trim()) params.set("supplier", f.supplier.trim());
  if (f.companyIssuer.trim()) params.set("companyIssuer", f.companyIssuer.trim());
  if (f.onlyWithPurchaseNeed) params.set("onlyWithPurchaseNeed", "true");
  return params.toString();
}

const QUICK_GROUPS: Array<{ id: string; label: string; situations: RawMaterialPlanningStatus[] }> = [
  { id: "buyNow", label: "Comprar agora", situations: ["BUY_NOW"] },
  { id: "buyWithin7", label: "Comprar em 7 dias", situations: ["BUY_WITHIN_7_DAYS"] },
  {
    id: "atRisk",
    label: "Em risco",
    situations: ["BUY_NOW", "BUY_WITHIN_7_DAYS", "PLAN_PURCHASE", "PARTIALLY_COVERED", "INBOUND_LATE"],
  },
  { id: "staleCount", label: "Contagem desatualizada", situations: ["STOCK_COUNT_STALE"] },
  { id: "noLeadTime", label: "Sem lead time", situations: ["DATA_INCOMPLETE"] },
  { id: "unitError", label: "Erro de unidade", situations: ["UNIT_CONVERSION_ERROR"] },
];

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function InfoBanner() {
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
            Cruza saldo de estoque com demanda dos pedidos e entradas de compra confirmadas
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            O saldo contado vem da última conferência de estoque registrada — não é atualizado em tempo real por
            movimentações de fábrica. A necessidade vem dos pedidos de venda ainda em aberto (líquida de
            atendimento/corte) explodidos pela mesma composição (BOM) usada na Inteligência de Matéria-Prima.
            Quando faltar um dado confiável (lead time, contagem recente, data de entrega), a situação aparece como
            "Dados incompletos" em vez de um número inventado.
          </p>
        </div>
      </div>
    </div>
  );
}

export function RawMaterialPlanningPage() {
  const [filters, setFilters] = useState<FiltersState>(defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(filters);
  const [page, setPage] = useState(1);
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RawMaterialPlanningResponse | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [savingPlanMaterialId, setSavingPlanMaterialId] = useState<string | null>(null);
  const [planSaveError, setPlanSaveError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<GridSortField>("technicalNeed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [retryNonce, setRetryNonce] = useState(0);

  const [branding, setBranding] = useState<BrandingSettingsDTO | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const filterKey = useMemo(() => JSON.stringify(appliedFilters), [appliedFilters]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setExpandedMaterialId(null);
    const qs = filtersToQueryString(appliedFilters);
    fetchJsonOk<RawMaterialPlanningResponse>(`${PLANNING_API}?${qs}`, { signal: ac.signal })
      .then((payload) => {
        if (ac.signal.aborted) return;
        setData(payload);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        console.error("[RawMaterialPlanning] load", e);
        setError(e instanceof Error ? e.message : "Não foi possível carregar o planejamento de matéria-prima.");
        setData(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [filterKey, retryNonce]);

  const commitFilters = useCallback((next: FiltersState) => {
    setFilters(next);
    setAppliedFilters(next);
    setPage(1);
  }, []);

  const handleApplyGroup = useCallback(
    (situations: RawMaterialPlanningStatus[]) => {
      commitFilters({ ...filters, situations });
    },
    [filters, commitFilters]
  );

  const handleClearGroup = useCallback(() => {
    commitFilters({ ...filters, situations: [] });
  }, [filters, commitFilters]);

  const handleApplyText = useCallback(() => {
    commitFilters(filters);
  }, [filters, commitFilters]);

  const handleClearAll = useCallback(() => {
    commitFilters(defaultFilters());
  }, [commitFilters]);

  const filterChips = useMemo((): MaterialDemandFilterChip[] => {
    const chips: MaterialDemandFilterChip[] = [];
    if (appliedFilters.situations.length > 0) {
      chips.push({
        id: "situations",
        label: `Situação: ${appliedFilters.situations.map((s) => RAW_MATERIAL_PLANNING_STATUS_LABELS[s]).join(", ")}`,
      });
    }
    if (appliedFilters.search) chips.push({ id: "search", label: `Busca: ${appliedFilters.search}` });
    if (appliedFilters.supplier) chips.push({ id: "supplier", label: `Fornecedor: ${appliedFilters.supplier}` });
    if (appliedFilters.companyIssuer) chips.push({ id: "companyIssuer", label: `Empresa: ${appliedFilters.companyIssuer}` });
    if (appliedFilters.onlyWithPurchaseNeed) chips.push({ id: "onlyWithPurchaseNeed", label: "Só com necessidade de compra" });
    return chips;
  }, [appliedFilters]);

  const handleRemoveChip = useCallback(
    (id: string) => {
      const next = { ...appliedFilters };
      if (id === "situations") next.situations = [];
      else if (id === "search") next.search = "";
      else if (id === "supplier") next.supplier = "";
      else if (id === "companyIssuer") next.companyIssuer = "";
      else if (id === "onlyWithPurchaseNeed") next.onlyWithPurchaseNeed = false;
      commitFilters(next);
    },
    [appliedFilters, commitFilters]
  );

  const handleRetry = useCallback(() => setRetryNonce((n) => n + 1), []);

  // Pré-carrega o branding assim que há dados: o documento de impressão fica
  // montado (oculto) e o primeiro "Imprimir / PDF" não depende de nenhuma
  // corrida de fetch/render.
  useEffect(() => {
    if (!data || branding) return;
    let cancelled = false;
    void fetchUiSessionCachedJson<BrandingSettingsDTO>("/api/branding-settings", {
      ttlMs: 300_000,
    })
      .then((next) => {
        if (!cancelled) setBranding(next);
      })
      .catch((e) => {
        console.error("[RawMaterialPlanning] prefetch branding", e);
      });
    return () => {
      cancelled = true;
    };
  }, [data, branding]);

  /**
   * Salva as anotações de compra (data/previsão/nº do pedido) e reflete o
   * retorno do servidor na linha local — sem recarregar o planejamento
   * inteiro (o cálculo pesado não muda por causa dessas anotações).
   */
  const handleSavePurchasePlan = useCallback(
    async (materialId: string, patch: RawMaterialPurchasePlanPatch) => {
      setSavingPlanMaterialId(materialId);
      setPlanSaveError(null);
      try {
        const res = await fetch(
          `${PLANNING_API}/purchase-plan/${materialId}`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Não foi possível salvar as anotações de compra.");
        }
        const payload = (await res.json()) as {
          plan: RawMaterialPlanningRow["purchasePlan"];
        };
        setData((prev) =>
          prev
            ? {
                ...prev,
                materials: prev.materials.map((m) =>
                  m.materialId === materialId ? { ...m, purchasePlan: payload.plan } : m
                ),
              }
            : prev
        );
      } catch (e) {
        console.error("[RawMaterialPlanning] save purchase plan", e);
        setPlanSaveError(
          e instanceof Error ? e.message : "Não foi possível salvar as anotações de compra."
        );
      } finally {
        setSavingPlanMaterialId(null);
      }
    },
    []
  );

  const handleExportCsv = useCallback(async () => {
    setExportingCsv(true);
    setExportError(null);
    try {
      const qs = filtersToQueryString(appliedFilters);
      const res = await fetch(`${PLANNING_API}/export.csv?${qs}`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível exportar.");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `planejamento-materia-prima-${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.error("[RawMaterialPlanning] export csv", e);
      setExportError(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setExportingCsv(false);
    }
  }, [appliedFilters]);

  const handlePrint = useCallback(async () => {
    setIsPrinting(true);
    try {
      if (!branding) {
        const next = await fetchUiSessionCachedJson<BrandingSettingsDTO>(
          "/api/branding-settings",
          { ttlMs: 300_000 }
        );
        setBranding(next);
      }
      document.body.classList.add("raw-material-planning-print-route");
      setTimeout(() => {
        window.print();
        document.body.classList.remove("raw-material-planning-print-route");
        setIsPrinting(false);
      }, 300);
    } catch (e) {
      console.error("[RawMaterialPlanning] load branding", e);
      setIsPrinting(false);
    }
  }, [branding]);

  const rows: RawMaterialPlanningRow[] = data?.materials ?? [];

  /**
   * Ordena a lista INTEIRA antes de paginar (antes a tabela ordenava só a
   * página atual). A mesma lista ordenada alimenta o Imprimir/PDF — tela e
   * relatório sempre na mesma ordem, sobre os mesmos filtros.
   */
  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...(data?.materials ?? [])].sort((a, b) => {
      const va = gridSortValue(a, sortField);
      const vb = gridSortValue(b, sortField);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "pt-BR") * dir;
      }
      return (va - vb) * dir;
    });
  }, [data, sortField, sortDir]);

  const totalItems = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = sortedRows.slice(pageStart, pageStart + PAGE_SIZE);
  const pagination = { page, pageSize: PAGE_SIZE, totalItems, totalPages };

  /** Payload do relatório impresso — mesma ordem/filtros da tela. */
  const printData = useMemo(
    () => (data ? { ...data, materials: sortedRows } : null),
    [data, sortedRows]
  );

  return (
    <div className="space-y-6" data-testid="raw-material-planning-page">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Planejamento de compra
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-muted/20 px-2.5 py-0.5 text-xs text-muted-foreground">
                Base: estoque contado + pedidos de venda + compras confirmadas
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Planejamento de Matéria-Prima</h1>
            <p className="text-sm leading-relaxed text-muted-foreground max-w-3xl">
              O que comprar, quanto, até quando e com que confiança — cruzando saldo de estoque, proteção
              mínima/contingência, demanda dos pedidos de venda em aberto e entradas de compra já confirmadas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              disabled={exportingCsv || rows.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
            >
              {exportingCsv ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={isPrinting || loading || rows.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
            >
              {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Imprimir / PDF
            </button>
            <button
              type="button"
              onClick={handleRetry}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </button>
          </div>
        </div>
        {exportError ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm",
              STATUS_TONE_CLASSES.danger
            )}
            role="alert"
          >
            <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-bold">Erro:</span> {exportError}
            </span>
          </div>
        ) : null}
        <InfoBanner />
        {data?.warnings && data.warnings.length > 0 ? (
          <div
            className={cn(
              "rounded-xl border p-4 shadow-sm",
              STATUS_TONE_CLASSES.warning
            )}
          >
            <p className="mb-2 flex items-center gap-2 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              Avisos de qualidade de dados
            </p>
            <ul className="space-y-1 text-xs font-medium">
              {data.warnings.map((w, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-5">
        <div>
          <h2 className="text-sm font-bold text-foreground">Filtros</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Data-base padrão: hoje. Horizonte padrão: próximos 60 dias.
          </p>
        </div>

        <MaterialDemandFilterChips chips={filterChips} onRemove={handleRemoveChip} onClearAll={handleClearAll} />

        <div className="flex flex-wrap gap-1.5">
          {QUICK_GROUPS.map((group) => {
            const active =
              group.situations.length === appliedFilters.situations.length &&
              group.situations.every((s) => appliedFilters.situations.includes(s));
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => handleApplyGroup(group.situations)}
                className={cn(
                  "inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition-colors",
                  active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-accent"
                )}
              >
                {group.label}
              </button>
            );
          })}
          {appliedFilters.situations.length > 0 ? (
            <button
              type="button"
              onClick={handleClearGroup}
              className="inline-flex h-9 items-center rounded-lg border border-dashed border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent"
            >
              Limpar situação
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rmp-as-of-date" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Data-base
            </label>
            <input
              id="rmp-as-of-date"
              type="date"
              value={filters.asOfDate}
              onChange={(e) => setFilters((p) => ({ ...p, asOfDate: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rmp-horizon" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Horizonte
            </label>
            <select
              id="rmp-horizon"
              value={filters.horizon}
              onChange={(e) => setFilters((p) => ({ ...p, horizon: e.target.value as RawMaterialPlanningHorizon }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              {RAW_MATERIAL_PLANNING_HORIZON_VALUES.map((h) => (
                <option key={h} value={h}>
                  {RAW_MATERIAL_PLANNING_HORIZON_LABELS[h]}
                </option>
              ))}
            </select>
          </div>
          {filters.horizon === "custom" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rmp-horizon-end" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Data final do horizonte
              </label>
              <input
                id="rmp-horizon-end"
                type="date"
                value={filters.horizonEndDate}
                onChange={(e) => setFilters((p) => ({ ...p, horizonEndDate: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rmp-search" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Buscar matéria-prima
            </label>
            <input
              id="rmp-search"
              type="text"
              placeholder="Código ou descrição"
              value={filters.search}
              onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleApplyText()}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rmp-supplier" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Fornecedor
            </label>
            <input
              id="rmp-supplier"
              type="text"
              placeholder="Nome do fornecedor"
              value={filters.supplier}
              onChange={(e) => setFilters((p) => ({ ...p, supplier: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleApplyText()}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rmp-company" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Empresa
            </label>
            <input
              id="rmp-company"
              type="text"
              placeholder="Empresa emissora"
              value={filters.companyIssuer}
              onChange={(e) => setFilters((p) => ({ ...p, companyIssuer: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleApplyText()}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-col gap-1.5 justify-end">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filters.onlyWithPurchaseNeed}
                onChange={(e) => setFilters((p) => ({ ...p, onlyWithPurchaseNeed: e.target.checked }))}
                className="rounded border-border"
              />
              Só com necessidade de compra
            </label>
          </div>
          <div className="flex flex-col gap-1.5 justify-end">
            <button
              type="button"
              onClick={handleApplyText}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Search className="h-4 w-4" />
              Pesquisar
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div
          className={cn(
            "rounded-xl border px-6 py-10 text-center shadow-sm",
            STATUS_TONE_CLASSES.danger
          )}
          role="alert"
        >
          <p className="flex items-center justify-center gap-2 text-base font-bold">
            <Ban className="h-5 w-5 shrink-0" aria-hidden />
            Não foi possível carregar o planejamento de matéria-prima
          </p>
          <p className="mt-2 text-sm font-medium">{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Tentar novamente
          </button>
        </div>
      ) : loading && !data ? (
        <div className="space-y-6" aria-busy="true" aria-live="polite">
          <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Calculando planejamento de matéria-prima…</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/70" />
            ))}
          </div>
        </div>
      ) : data ? (
        <>
          <ContextualDashboardKpiGrid minColumnWidth={160}>
            <ContextualDashboardKpiCard label="Comprar agora" value={String(data.summary.buyNowCount)} tone={data.summary.buyNowCount > 0 ? "danger" : "neutral"} />
            <ContextualDashboardKpiCard label="Comprar em 7 dias" value={String(data.summary.buyWithin7DaysCount)} tone={data.summary.buyWithin7DaysCount > 0 ? "warning" : "neutral"} />
            <ContextualDashboardKpiCard label="Materiais em risco" value={String(data.summary.materialsAtRiskCount)} />
            <ContextualDashboardKpiCard label="Pedidos em risco" value={String(data.summary.ordersAtRiskCount)} />
            <ContextualDashboardKpiCard
              label="Valor estimado de compra"
              value={money(data.summary.estimatedPurchaseValue)}
              hint={data.summary.estimatedPurchaseValueIsPartial ? "Parcial — alguns materiais sem custo cadastrado" : undefined}
            />
            <ContextualDashboardKpiCard label="Contagem desatualizada" value={String(data.summary.staleStockCountMaterials)} />
            <ContextualDashboardKpiCard label="Sem lead time" value={String(data.summary.missingLeadTimeMaterials)} />
            <ContextualDashboardKpiCard label="Erro de unidade" value={String(data.summary.unitConversionErrorMaterials)} />
          </ContextualDashboardKpiGrid>

          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4 border-b border-border bg-muted/20">
              <div>
                <h3 className="text-sm font-bold text-foreground">Matérias-primas ({data.summary.totalMaterials})</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Data-base {data.asOfDate.split("-").reverse().join("/")} · horizonte até{" "}
                  {data.horizonEndDate.split("-").reverse().join("/")} · gerado em{" "}
                  {new Date(data.generatedAt).toLocaleString("pt-BR")}
                </p>
              </div>
              {/* Ordenação do grid — vale também para Imprimir/PDF. */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="rmp-sort-field"
                  className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Ordenar por
                </label>
                <select
                  id="rmp-sort-field"
                  value={sortField}
                  onChange={(e) => {
                    setSortField(e.target.value as GridSortField);
                    setPage(1);
                  }}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                  data-testid="rmp-sort-field"
                >
                  {GRID_SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    setPage(1);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold hover:bg-accent"
                  title={sortDir === "asc" ? "Crescente — clique para decrescente" : "Decrescente — clique para crescente"}
                  data-testid="rmp-sort-dir"
                >
                  {sortDir === "asc" ? (
                    <>
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      Crescente
                    </>
                  ) : (
                    <>
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      Decrescente
                    </>
                  )}
                </button>
              </div>
            </div>
            {planSaveError ? (
              <div
                className={cn(
                  "mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm",
                  STATUS_TONE_CLASSES.danger
                )}
                role="alert"
              >
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-bold">Erro:</span> {planSaveError}
                </span>
              </div>
            ) : null}
            <RawMaterialPlanningTable
              rows={pageRows}
              expandedMaterialId={expandedMaterialId}
              onToggleRow={(id) => setExpandedMaterialId((prev) => (prev === id ? null : id))}
              onSavePurchasePlan={handleSavePurchasePlan}
              savingPlanMaterialId={savingPlanMaterialId}
            />
            <MaterialDemandTablePagination
              pagination={pagination}
              loadingRows={loading}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => p + 1)}
            />
          </div>
        </>
      ) : null}

      {/* Documento de impressão — SEMPRE montado (oculto em tela pelo CSS
          base de #rmp-print-root) e PORTALIZADO direto no <body>: o CSS de
          impressão esconde o #root inteiro, então dentro da árvore normal o
          relatório sairia em branco (era exatamente o defeito — o documento
          nunca era renderizado). */}
      {printData && branding
        ? createPortal(
            <RawMaterialPlanningPrintDocument
              data={printData}
              branding={branding}
              filterChips={filterChips}
            />,
            document.body
          )
        : null}
    </div>
  );
}
