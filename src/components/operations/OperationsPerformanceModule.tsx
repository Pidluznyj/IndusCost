import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gauge,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  fetchComponentPerformanceCoverage,
  fetchComponentPerformanceHistory,
  fetchComponentPerformanceList,
  patchComponentPerformanceProduct,
  type ComponentPerformanceChangeLogItem,
  type ComponentPerformanceCoverageResponse,
  type ComponentPerformanceListItem,
  type ComponentPerformanceListQuery,
} from "@/src/lib/componentPerformanceClient";
import {
  canEditComponentPerformance,
  canViewComponentPerformance,
  COMPONENT_PERFORMANCE_FILTER_OPTIONS,
  formatPerformanceDateTime,
  formatPerformanceNumber,
  type ComponentPerformanceFilterId,
} from "@/src/lib/componentPerformanceUi";
import { cn } from "@/src/lib/utils";
import { ComponentPerformanceEditDrawer } from "@/src/components/operations/ComponentPerformanceEditDrawer";
import { ComponentPerformanceHistoryDrawer } from "@/src/components/operations/ComponentPerformanceHistoryDrawer";

const PAGE_SIZE = 50;

function filterToQuery(
  filter: ComponentPerformanceFilterId,
  sku: string,
  name: string,
  offset: number
): ComponentPerformanceListQuery {
  const base: ComponentPerformanceListQuery = {
    sku: sku.trim() || undefined,
    name: name.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  };
  switch (filter) {
    case "sold":
      return { ...base, soldOnly: true };
    case "pending":
      return { ...base, pendingOnly: true };
    case "sold_missing":
      return { ...base, soldMissingOnly: true };
    case "missing_cycle":
      return { ...base, missingCycleOnly: true };
    case "missing_cavities":
      return { ...base, missingCavitiesOnly: true };
    case "missing_process":
      return { ...base, missingProcessOnly: true };
    case "recent":
      return { ...base, recentlyChangedOnly: true, recentDays: 30 };
    default:
      return base;
  }
}

export function OperationsPerformanceModule() {
  const auth = useAuth();
  const canView = canViewComponentPerformance(auth);
  const canEdit = canEditComponentPerformance(auth);

  const [skuSearch, setSkuSearch] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [filter, setFilter] = useState<ComponentPerformanceFilterId>("all");
  const [items, setItems] = useState<ComponentPerformanceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<ComponentPerformanceCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  const [editItem, setEditItem] = useState<ComponentPerformanceListItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<ComponentPerformanceListItem | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<ComponentPerformanceChangeLogItem[]>([]);

  const query = useMemo(
    () => filterToQuery(filter, skuSearch, nameSearch, offset),
    [filter, skuSearch, nameSearch, offset]
  );

  const loadCoverage = useCallback(async () => {
    if (!canView) return;
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const now = new Date();
      const data = await fetchComponentPerformanceCoverage({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        top: 5,
      });
      setCoverage(data);
    } catch (e: unknown) {
      setCoverageError(e instanceof Error ? e.message : "Erro ao carregar cobertura.");
      setCoverage(null);
    } finally {
      setCoverageLoading(false);
    }
  }, [canView]);

  const loadList = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchComponentPerformanceList(query);
      setItems(data.items);
      setTotal(data.total);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Erro ao carregar componentes.";
      setError(message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [canView, query]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openHistory = async (item: ComponentPerformanceListItem) => {
    setHistoryItem(item);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryRows([]);
    try {
      const data = await fetchComponentPerformanceHistory(item.id, { limit: 50 });
      setHistoryRows(data.items);
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : "Erro ao carregar histórico.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const openEdit = (item: ComponentPerformanceListItem) => {
    setEditItem(item);
    setEditOpen(true);
    setEditError(null);
  };

  const handleSave = async (payload: {
    cycleTimeSeconds: number;
    cavities: number;
    responsiblePersonName: string;
    note: string | null;
  }) => {
    if (!editItem) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await patchComponentPerformanceProduct(editItem.id, payload);
      setEditOpen(false);
      setEditItem(null);
      setToast(
        result.changed
          ? "Performance atualizada. Custos publicados permanecem congelados."
          : result.message ?? "Nenhuma alteração detectada."
      );
      await loadList();
      void loadCoverage();
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : "Erro ao salvar alteração.");
    } finally {
      setEditSaving(false);
    }
  };

  if (!canView) {
    return (
      <div
        className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"
        data-testid="operations-performance-denied"
      >
        Você não possui permissão para acessar Performance de Componentes.
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="operations-performance-module">
      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] max-w-md rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg">
          {toast}
        </div>
      ) : null}

      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="performance-coverage-cards"
      >
        {[
          {
            label: "Componentes ativos",
            value: coverage?.totals.activeComponents,
            hint: coverage?.periodLabel ?? "—",
          },
          {
            label: "Sem ciclo ou cavidades",
            value: coverage?.totals.withoutCycleOrCavities,
            hint: "Pendências operacionais",
          },
          {
            label: "Vendidos sem performance",
            value: coverage?.totals.soldWithoutCompletePerformance,
            hint: "Crítico comercial",
            critical: true,
          },
          {
            label: "Nunca revisados",
            value: coverage?.totals.neverReviewed,
            hint: "Sem histórico de alteração",
          },
        ].map((card) => (
          <div
            key={card.label}
            className={cn(
              "rounded-xl border bg-card p-4",
              card.critical ? "border-amber-300/60" : "border-border"
            )}
          >
            <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
            <p
              className={cn(
                "mt-1 text-2xl font-semibold tabular-nums",
                card.critical && (coverage?.totals.soldWithoutCompletePerformance ?? 0) > 0
                  ? "text-amber-700"
                  : ""
              )}
            >
              {coverageLoading ? "…" : card.value ?? "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>

      {coverageError ? (
        <div className="rounded-xl border border-amber-300/50 bg-amber-50/50 p-3 text-sm text-amber-900">
          {coverageError}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={skuSearch}
              onChange={(e) => {
                setOffset(0);
                setSkuSearch(e.target.value);
              }}
              placeholder="Buscar por SKU / código"
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm"
              data-testid="performance-search-sku"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={nameSearch}
              onChange={(e) => {
                setOffset(0);
                setNameSearch(e.target.value);
              }}
              placeholder="Buscar por nome"
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm"
              data-testid="performance-search-name"
            />
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-2">
            {COMPONENT_PERFORMANCE_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setOffset(0);
                  setFilter(option.id);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                  filter === option.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-accent"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {total} componente(s) encontrado(s)
            {loading ? " — carregando…" : ""}
          </span>
          <button
            type="button"
            onClick={() => void loadList()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 hover:bg-accent"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => {
              void loadList();
              void loadCoverage();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 hover:bg-accent text-xs"
          >
            Recarregar cobertura
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando componentes…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground" data-testid="performance-empty">
            Nenhum componente encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">SKU</th>
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold text-right">Ciclo (s)</th>
                  <th className="px-4 py-3 font-semibold text-right">Cavidades</th>
                  <th className="px-4 py-3 font-semibold text-right">Peças/h</th>
                  <th className="px-4 py-3 font-semibold">Última alteração</th>
                  <th className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-700">
                        <Gauge className="h-3 w-3" />
                        {item.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPerformanceNumber(item.process.cycleTimeSeconds)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPerformanceNumber(item.process.cavities, 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPerformanceNumber(item.estimatedPiecesPerHour, 0)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatPerformanceDateTime(item.lastPerformanceChangeAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                          data-testid={`performance-edit-${item.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void openHistory(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                          data-testid={`performance-history-${item.id}`}
                        >
                          <History className="h-3.5 w-3.5" />
                          Histórico
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={offset <= 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      ) : null}

      <ComponentPerformanceEditDrawer
        open={editOpen}
        item={editItem}
        canEdit={canEdit}
        saving={editSaving}
        error={editError}
        onClose={() => {
          if (editSaving) return;
          setEditOpen(false);
          setEditItem(null);
          setEditError(null);
        }}
        onSave={(payload) => void handleSave(payload)}
      />

      <ComponentPerformanceHistoryDrawer
        open={historyOpen}
        loading={historyLoading}
        error={historyError}
        sku={historyItem?.sku ?? ""}
        name={historyItem?.name ?? ""}
        items={historyRows}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryItem(null);
        }}
      />
    </div>
  );
}
