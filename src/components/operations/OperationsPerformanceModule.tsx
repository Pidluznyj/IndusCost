import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gauge,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
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
  EMPTY_COMPONENT_PERFORMANCE_COLUMN_FILTERS,
  formatPerformanceDateTime,
  formatPerformanceNumber,
  hasActivePerformanceColumnFilters,
  itemMatchesPerformanceColumnFilters,
  type ComponentPerformanceColumnFilters,
  type ComponentPerformanceFilterId,
} from "@/src/lib/componentPerformanceUi";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { cn } from "@/src/lib/utils";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { ComponentPerformanceEditDrawer } from "@/src/components/operations/ComponentPerformanceEditDrawer";
import { ComponentPerformanceHistoryDrawer } from "@/src/components/operations/ComponentPerformanceHistoryDrawer";

const PAGE_SIZE = 50;

const COLUMN_FILTER_INPUT_CLASS =
  "w-full min-w-[4.5rem] rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/80 focus:ring-2 focus:ring-primary/25";

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
  const permissions = usePermissions();
  const canView =
    canViewComponentPerformance(auth) ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.performance, OPERATIONS_ACTIONS.view);
  const canEdit =
    canEditComponentPerformance(auth) ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.performance, OPERATIONS_ACTIONS.update);

  const [columnFilters, setColumnFilters] = useState<ComponentPerformanceColumnFilters>(
    EMPTY_COMPONENT_PERFORMANCE_COLUMN_FILTERS
  );
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
    () => filterToQuery(filter, columnFilters.sku, columnFilters.name, offset),
    [filter, columnFilters.sku, columnFilters.name, offset]
  );

  const filteredItems = useMemo(
    () => items.filter((item) => itemMatchesPerformanceColumnFilters(item, columnFilters)),
    [items, columnFilters]
  );

  const columnFiltersActive = hasActivePerformanceColumnFilters(columnFilters);

  const updateColumnFilter = useCallback(
    (key: keyof ComponentPerformanceColumnFilters, value: string) => {
      setOffset(0);
      setColumnFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const clearColumnFilters = useCallback(() => {
    setOffset(0);
    setColumnFilters(EMPTY_COMPONENT_PERFORMANCE_COLUMN_FILTERS);
  }, []);

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
    setupTimeMin: number;
    efficiencyExpected: number;
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

      <SummaryKpiGrid
        minColumnWidth={200}
        className={SYSTEM_TOTALIZER_GRID_CLASS}
        testId="performance-coverage-cards"
      >
        <FinanceExecutiveTotalizerCard
          label="Componentes ativos"
          value={coverageLoading ? undefined : String(coverage?.totals.activeComponents ?? "—")}
          loading={coverageLoading}
          subtitle={coverage?.periodLabel ?? "—"}
        />
        <FinanceExecutiveTotalizerCard
          label="Sem ciclo ou cavidades"
          value={coverageLoading ? undefined : String(coverage?.totals.withoutCycleOrCavities ?? "—")}
          loading={coverageLoading}
          subtitle="Pendências operacionais"
        />
        <FinanceExecutiveTotalizerCard
          label="Vendidos sem performance"
          value={
            coverageLoading
              ? undefined
              : String(coverage?.totals.soldWithoutCompletePerformance ?? "—")
          }
          loading={coverageLoading}
          tone={
            !coverageLoading && (coverage?.totals.soldWithoutCompletePerformance ?? 0) > 0
              ? "warning"
              : undefined
          }
          subtitle="Crítico comercial"
        />
        <FinanceExecutiveTotalizerCard
          label="Nunca revisados"
          value={coverageLoading ? undefined : String(coverage?.totals.neverReviewed ?? "—")}
          loading={coverageLoading}
          subtitle="Sem histórico de alteração"
        />
      </SummaryKpiGrid>

      {coverageError ? (
        <div className="rounded-xl border border-amber-300/50 bg-amber-50/50 p-3 text-sm text-amber-900">
          {coverageError}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex flex-wrap gap-2" data-testid="performance-status-chips">
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

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span data-testid="performance-list-count">
            {columnFiltersActive
              ? `${filteredItems.length} exibido(s) de ${items.length} na página · ${total} no recorte`
              : `${total} componente(s) encontrado(s)`}
            {loading ? " — carregando…" : ""}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {columnFiltersActive ? (
              <button
                type="button"
                onClick={clearColumnFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 hover:bg-accent text-xs"
                data-testid="performance-clear-column-filters"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros de coluna
              </button>
            ) : null}
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
            <table className="w-full text-sm" data-testid="performance-components-table">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">SKU</th>
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold text-right">Ciclo (s)</th>
                  <th className="px-4 py-3 font-semibold text-right">Cavidades</th>
                  <th className="px-4 py-3 font-semibold text-right">Setup (min)</th>
                  <th className="px-4 py-3 font-semibold text-right">Peças/h</th>
                  <th className="px-4 py-3 font-semibold">Última alteração</th>
                  <th className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
                <tr className="border-t border-border/70 bg-muted/30" data-testid="performance-column-filters">
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.sku}
                      onChange={(e) => updateColumnFilter("sku", e.target.value)}
                      placeholder="Filtrar SKU"
                      className={COLUMN_FILTER_INPUT_CLASS}
                      data-testid="performance-filter-sku"
                      aria-label="Filtrar por SKU"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.name}
                      onChange={(e) => updateColumnFilter("name", e.target.value)}
                      placeholder="Filtrar nome"
                      className={COLUMN_FILTER_INPUT_CLASS}
                      data-testid="performance-filter-name"
                      aria-label="Filtrar por nome"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.type}
                      onChange={(e) => updateColumnFilter("type", e.target.value)}
                      placeholder="Filtrar tipo"
                      className={COLUMN_FILTER_INPUT_CLASS}
                      data-testid="performance-filter-type"
                      aria-label="Filtrar por tipo"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.cycle}
                      onChange={(e) => updateColumnFilter("cycle", e.target.value)}
                      placeholder="Filtrar ciclo"
                      className={cn(COLUMN_FILTER_INPUT_CLASS, "text-right")}
                      data-testid="performance-filter-cycle"
                      aria-label="Filtrar por ciclo"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.cavities}
                      onChange={(e) => updateColumnFilter("cavities", e.target.value)}
                      placeholder="Filtrar cav."
                      className={cn(COLUMN_FILTER_INPUT_CLASS, "text-right")}
                      data-testid="performance-filter-cavities"
                      aria-label="Filtrar por cavidades"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.setup}
                      onChange={(e) => updateColumnFilter("setup", e.target.value)}
                      placeholder="Filtrar setup"
                      className={cn(COLUMN_FILTER_INPUT_CLASS, "text-right")}
                      data-testid="performance-filter-setup"
                      aria-label="Filtrar por setup"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.piecesPerHour}
                      onChange={(e) => updateColumnFilter("piecesPerHour", e.target.value)}
                      placeholder="Filtrar p/h"
                      className={cn(COLUMN_FILTER_INPUT_CLASS, "text-right")}
                      data-testid="performance-filter-pieces"
                      aria-label="Filtrar por peças por hora"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal">
                    <input
                      type="search"
                      value={columnFilters.lastChange}
                      onChange={(e) => updateColumnFilter("lastChange", e.target.value)}
                      placeholder="Filtrar data"
                      className={COLUMN_FILTER_INPUT_CLASS}
                      data-testid="performance-filter-last-change"
                      aria-label="Filtrar por última alteração"
                    />
                  </th>
                  <th className="px-3 py-2 font-normal" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                      data-testid="performance-column-filter-empty"
                    >
                      Nenhum componente nesta página corresponde aos filtros de coluna.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
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
                        {formatPerformanceNumber(item.process.setupTimeMin)}
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
                  ))
                )}
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
