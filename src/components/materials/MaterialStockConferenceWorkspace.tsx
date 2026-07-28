/**
 * Workspace visual — Conferência de estoque (lista + detalhes).
 * Presentacional: estados injetados para testes e o page container.
 */
import React from "react";
import { ArrowLeft, ClipboardList, History, Loader2, Search } from "lucide-react";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { cn } from "@/src/lib/utils";
import {
  deriveStockConferenceMetrics,
  formatStockConferenceDateTime,
  formatStockConferenceQuantity,
  MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE,
  MATERIAL_STOCK_CONFERENCE_SELECT_HINT,
  stockConferenceStatusLabel,
  type MaterialStockConferenceLayoutMode,
} from "@/src/lib/materialStockConferenceUi";
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
  rows: MaterialStockTabletListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  error: string | null;
  onRetry: () => void;
  canViewHistory: boolean;
  canConference: boolean;
  onConference: () => void;
  onHistory: () => void;
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs font-semibold",
        status === "SAUDAVEL" && "bg-emerald-50 text-emerald-800",
        status === "ATENCAO" && "bg-amber-50 text-amber-900",
        status === "CRITICO" && "bg-orange-50 text-orange-900",
        status === "EMERGENCIA" && "bg-red-50 text-red-800",
        status === "SEM_ESTOQUE" && "bg-slate-100 text-slate-700",
        status === "NAO_CONFIGURADO" && "bg-muted text-muted-foreground"
      )}
      data-testid="stock-conference-status-pill"
    >
      {stockConferenceStatusLabel(status)}
    </span>
  );
}

function MetricRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
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
  onConference,
  onHistory,
  showBack,
  onBack,
}: {
  item: MaterialStockTabletListItem;
  canViewHistory: boolean;
  canConference: boolean;
  onConference: () => void;
  onHistory: () => void;
  showBack: boolean;
  onBack: () => void;
}) {
  const metrics = deriveStockConferenceMetrics(item);
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
        <p className="text-sm text-muted-foreground">Unidade: {item.unit}</p>
      </div>

      <MetricRow
        label="Estoque atual"
        value={`${formatStockConferenceQuantity(item.currentQuantity)} ${item.unit}`}
        emphasize
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <MetricRow
          label="Contingência"
          value={formatStockConferenceQuantity(item.contingencyQuantity)}
        />
        <MetricRow
          label="Mínimo"
          value={formatStockConferenceQuantity(item.minimumQuantity)}
        />
        <MetricRow
          label="Recomendado"
          value={formatStockConferenceQuantity(item.recommendedQuantity)}
        />
        <MetricRow
          label="Disponível acima da contingência"
          value={formatStockConferenceQuantity(metrics.availableAboveContingency)}
        />
        <MetricRow
          label="Sugestão de reposição"
          value={formatStockConferenceQuantity(metrics.replenishmentSuggestion)}
        />
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
          <span className="text-sm text-muted-foreground">Status</span>
          <StatusPill status={item.stockStatus} />
        </div>
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
      <div className="sticky top-0 z-10 bg-background pb-1">
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
      </div>

      {props.viewKind === "empty" || props.rows.length === 0 ? (
        <div data-testid="stock-conference-empty">
          <ContextualDashboardEmpty message={MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE} />
        </div>
      ) : (
        <ul
          className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
          data-testid="stock-conference-list"
        >
          {props.rows.map((row) => {
            const selectedRow = row.id === props.selectedId;
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
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {row.code}
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        {row.description}
                      </p>
                    </div>
                    <StatusPill status={row.stockStatus} />
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{row.unit}</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatStockConferenceQuantity(row.currentQuantity)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
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
          onConference={props.onConference}
          onHistory={props.onHistory}
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
