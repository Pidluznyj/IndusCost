/**
 * Workspace visual — Conferência de estoque (lista + detalhes).
 * Presentacional: estados injetados para testes e o page container.
 */
import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ClipboardList,
  Flame,
  HelpCircle,
  History,
  Loader2,
  Search,
  Settings2,
} from "lucide-react";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { cn } from "@/src/lib/utils";
import {
  deriveStockConferenceMetrics,
  formatStockConferenceDateTime,
  formatStockConferenceQuantity,
  MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE,
  MATERIAL_STOCK_CONFERENCE_SELECT_HINT,
  resolveMaterialStockStatusVisual,
  stockConferenceStatusLabel,
  type MaterialStockConferenceLayoutMode,
} from "@/src/lib/materialStockConferenceUi";
import {
  MATERIAL_STOCK_LIST_FILTERS,
  summarizeStockListDescription,
  type MaterialStockListFilterId,
} from "@/src/lib/materialStockTabletSearchClient";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes";

export type MaterialStockConferenceViewKind =
  | "loading"
  | "error"
  | "empty"
  | "ready";

export type MaterialStockConferenceWorkspaceProps = {
  viewKind: MaterialStockConferenceViewKind;
  layoutMode: MaterialStockConferenceLayoutMode;
  search: string;
  onSearchChange: (value: string) => void;
  filter: MaterialStockListFilterId;
  onFilterChange: (value: MaterialStockListFilterId) => void;
  rows: MaterialStockTabletListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  error: string | null;
  onRetry: () => void;
  isRefreshing?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  totalCount?: number;
  canViewHistory: boolean;
  canConference: boolean;
  canEditParameters: boolean;
  onConference: () => void;
  onHistory: () => void;
  onEditParameters: () => void;
};

function StatusIcon({
  icon,
  className,
}: {
  icon: ReturnType<typeof resolveMaterialStockStatusVisual>["icon"];
  className?: string;
}) {
  const props = { className: cn("h-4 w-4 shrink-0", className), "aria-hidden": true as const };
  switch (icon) {
    case "help-circle":
      return <HelpCircle {...props} />;
    case "ban":
      return <Ban {...props} />;
    case "flame":
      return <Flame {...props} />;
    case "alert-triangle":
      return <AlertTriangle {...props} />;
    case "alert-circle":
      return <AlertCircle {...props} />;
    case "check-circle":
      return <CheckCircle2 {...props} />;
    default:
      return <HelpCircle {...props} />;
  }
}

function StatusPill({ status }: { status: string }) {
  const visual = resolveMaterialStockStatusVisual(status);
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
        visual.tone === "success" && "bg-emerald-50 text-emerald-800",
        visual.tone === "caution" && "bg-amber-50 text-amber-900",
        visual.tone === "warning" && "bg-orange-50 text-orange-900",
        visual.tone === "danger" && "bg-red-50 text-red-800",
        visual.tone === "neutral" && "bg-slate-100 text-slate-700",
        visual.tone === "muted" && "bg-muted text-muted-foreground"
      )}
      data-testid="stock-conference-status-pill"
      data-status={visual.status}
      aria-label={`Status: ${visual.label}. ${visual.explanation}`}
      title={visual.explanation}
    >
      <StatusIcon icon={visual.icon} />
      <span>{visual.label}</span>
    </span>
  );
}

function StatusCard({ status }: { status: string }) {
  const visual = resolveMaterialStockStatusVisual(status);
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3",
        visual.tone === "success" && "border-emerald-200 bg-emerald-50/60",
        visual.tone === "caution" && "border-amber-200 bg-amber-50/60",
        visual.tone === "warning" && "border-orange-200 bg-orange-50/60",
        visual.tone === "danger" && "border-red-200 bg-red-50/60",
        visual.tone === "neutral" && "border-slate-200 bg-slate-50",
        visual.tone === "muted" && "border-border bg-muted/40"
      )}
      data-testid="stock-conference-status-card"
      data-status={visual.status}
    >
      <div className="flex items-center gap-2">
        <StatusIcon icon={visual.icon} className="h-5 w-5" />
        <p className="text-sm font-semibold text-foreground">{visual.label}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{visual.explanation}</p>
    </div>
  );
}

function MetricRow({
  label,
  value,
  emphasize,
  testId,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-baseline justify-between gap-3 rounded-lg border border-border px-3 py-3",
        emphasize && "border-primary/30 bg-primary/5"
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right font-semibold tabular-nums text-foreground",
          emphasize ? "text-2xl" : "text-base"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DetailPanel({
  item,
  canViewHistory,
  canConference,
  canEditParameters,
  onConference,
  onHistory,
  onEditParameters,
  showBack,
  onBack,
}: {
  item: MaterialStockTabletListItem;
  canViewHistory: boolean;
  canConference: boolean;
  canEditParameters: boolean;
  onConference: () => void;
  onHistory: () => void;
  onEditParameters: () => void;
  showBack: boolean;
  onBack: () => void;
}) {
  const metrics = deriveStockConferenceMetrics(item);
  const unit = item.unit;
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4"
      data-testid="stock-conference-detail"
    >
      {showBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold"
          data-testid="stock-conference-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
      ) : null}

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {item.code}
        </p>
        <h2 className="text-xl font-semibold text-foreground">{item.description}</h2>
        <p className="text-sm text-muted-foreground">Unidade: {unit}</p>
      </div>

      <MetricRow
        label="Saldo atual"
        value={`${formatStockConferenceQuantity(item.currentQuantity)} ${unit}`}
        emphasize
        testId="stock-conference-detail-current-balance"
      />

      <StatusCard status={item.stockStatus} />

      <div className="space-y-2" data-testid="stock-conference-parameters-readonly">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Parâmetros de nível</p>
          {canEditParameters ? (
            <button
              type="button"
              onClick={onEditParameters}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold"
              data-testid="stock-conference-edit-parameters"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Editar
            </button>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              data-testid="stock-conference-parameters-readonly-badge"
            >
              Somente leitura
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Contingência, mínimo e recomendado não somam ao saldo atual.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <MetricRow
            label={`Contingência (${unit})`}
            value={formatStockConferenceQuantity(item.contingencyQuantity)}
          />
          <MetricRow
            label={`Mínimo (${unit})`}
            value={formatStockConferenceQuantity(item.minimumQuantity)}
          />
          <MetricRow
            label={`Recomendado (${unit})`}
            value={formatStockConferenceQuantity(item.recommendedQuantity)}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" data-testid="stock-conference-indicators">
        <MetricRow
          label={`Disponível acima da contingência (${unit})`}
          value={formatStockConferenceQuantity(metrics.availableAboveContingency)}
        />
        <MetricRow
          label={`Sugestão de reposição (${unit})`}
          value={formatStockConferenceQuantity(metrics.replenishmentSuggestion)}
        />
      </div>

      <div className="rounded-lg border border-border px-3 py-3 text-sm">
        <p className="text-muted-foreground">Última conferência</p>
        <p className="mt-1 font-medium text-foreground">
          {formatStockConferenceDateTime(item.lastStockConferenceAt)}
        </p>
        <p className="mt-2 text-muted-foreground">Responsável</p>
        <p className="mt-1 font-medium text-foreground">
          {item.lastStockConferenceUser?.name ?? "—"}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-2 sm:flex-row">
        {canConference ? (
          <button
            type="button"
            onClick={onConference}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
            data-testid="stock-conference-action"
          >
            <ClipboardList className="h-4 w-4" />
            Conferir e atualizar estoque
          </button>
        ) : null}
        {canViewHistory ? (
          <button
            type="button"
            onClick={onHistory}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold"
            data-testid="stock-conference-history"
          >
            <History className="h-4 w-4" />
            Histórico
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MaterialStockConferenceWorkspace(
  props: MaterialStockConferenceWorkspaceProps
) {
  const selected = props.rows.find((r) => r.id === props.selectedId) ?? null;
  const stackedDetailOpen =
    props.layoutMode === "stacked" && selected != null;

  if (props.viewKind === "loading") {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16"
        data-testid="stock-conference-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-sm text-muted-foreground">
          Carregando matérias-primas para conferência…
        </p>
      </div>
    );
  }

  if (props.viewKind === "error") {
    return (
      <div className="space-y-3" data-testid="stock-conference-error">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {props.error ?? "Não foi possível carregar a conferência de estoque."}
        </div>
        <button
          type="button"
          onClick={props.onRetry}
          className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-primary"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const listPanel = (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid="stock-conference-list-panel"
      hidden={stackedDetailOpen ? true : undefined}
    >
      <div className="sticky top-0 z-10 space-y-2 bg-background pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            inputMode="search"
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder="Buscar por código ou descrição…"
            className="min-h-12 w-full rounded-lg border border-border bg-card py-3 pl-10 pr-4 text-base outline-none focus:ring-2 focus:ring-primary/20"
            data-testid="stock-conference-search"
          />
        </div>
        <div
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          data-testid="stock-conference-filters"
          role="toolbar"
          aria-label="Filtros de status"
        >
          {MATERIAL_STOCK_LIST_FILTERS.map((chip) => {
            const active = props.filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => props.onFilterChange(chip.id)}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground"
                )}
                data-testid={`stock-conference-filter-${chip.id}`}
                aria-pressed={active}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        {props.isRefreshing ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="stock-conference-refreshing"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Atualizando resultados…
          </p>
        ) : null}
      </div>

      {props.viewKind === "empty" || props.rows.length === 0 ? (
        <div data-testid="stock-conference-empty">
          <ContextualDashboardEmpty message={MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE} />
        </div>
      ) : (
        <>
          <ul
            className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
            data-testid="stock-conference-list"
          >
            {props.rows.map((row) => {
              const selectedRow = row.id === props.selectedId;
              const qtyLabel = `${formatStockConferenceQuantity(row.currentQuantity)} ${row.unit}`;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(row.id)}
                    className={cn(
                      "flex w-full min-h-14 flex-col gap-1 rounded-xl border px-3 py-3 text-left transition-colors",
                      selectedRow
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border bg-card"
                    )}
                    data-testid={`stock-conference-row-${row.id}`}
                    aria-pressed={selectedRow}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          {row.code}
                        </p>
                        <p className="truncate text-sm font-semibold text-foreground">
                          {summarizeStockListDescription(row.description)}
                        </p>
                      </div>
                      <StatusPill status={row.stockStatus} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">Saldo atual</span>
                      <span
                        className="font-semibold tabular-nums text-foreground"
                        data-testid={`stock-conference-row-balance-${row.id}`}
                      >
                        {qtyLabel}
                      </span>
                      <span className="sr-only">
                        Status textual: {stockConferenceStatusLabel(row.stockStatus)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {props.hasMore ? (
            <div className="space-y-2" data-testid="stock-conference-more">
              <p className="text-xs text-muted-foreground">
                Mostrando {props.rows.length}
                {props.totalCount != null ? ` de ${props.totalCount}` : ""} — há mais
                resultados.
              </p>
              <button
                type="button"
                onClick={props.onLoadMore}
                disabled={props.loadingMore}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold disabled:opacity-60"
                data-testid="stock-conference-load-more"
              >
                {props.loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando…
                  </>
                ) : (
                  "Carregar mais"
                )}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const detailPanel = (
    <div
      className="min-h-0 rounded-xl border border-border bg-card p-4"
      data-testid="stock-conference-detail-panel"
      hidden={props.layoutMode === "stacked" && !stackedDetailOpen ? true : undefined}
    >
      {selected ? (
        <DetailPanel
          item={selected}
          canViewHistory={props.canViewHistory}
          canConference={props.canConference}
          canEditParameters={props.canEditParameters}
          onConference={props.onConference}
          onHistory={props.onHistory}
          onEditParameters={props.onEditParameters}
          showBack={props.layoutMode === "stacked"}
          onBack={props.onClearSelection}
        />
      ) : (
        <div
          className="flex h-full min-h-[240px] items-center justify-center p-6 text-center text-sm text-muted-foreground"
          data-testid="stock-conference-detail-empty"
        >
          {MATERIAL_STOCK_CONFERENCE_SELECT_HINT}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "gap-4",
        props.layoutMode === "split"
          ? "grid min-h-[70vh] grid-cols-1 lg:grid-cols-[minmax(280px,38%)_1fr]"
          : "flex min-h-[70vh] flex-col"
      )}
      data-testid="stock-conference-workspace"
      data-layout={props.layoutMode}
    >
      {listPanel}
      {detailPanel}
    </div>
  );
}
