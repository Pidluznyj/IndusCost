import { useEffect, useState, type RefObject } from "react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Factory,
  Loader2,
  PackageCheck,
  Truck,
} from "lucide-react";
import type { SalesOrderFlowListCard } from "@/src/lib/sales/salesOrderFlowList";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_LABELS,
  SALES_ORDER_FLOW_STAGE_LABELS,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog";
import type { SalesOrderFlowColumnPageState } from "@/src/lib/salesOrderFlowKanbanPagination";
import type { SalesOrderFlowColumnIndicator } from "@/src/lib/salesOrderFlowUi";
import { cn, formatCurrency } from "@/src/lib/utils";

export const SALES_ORDER_FLOW_OPERATIONAL_STAGES: readonly SalesOrderFlowStage[] =
  [
    "WAITING_RELEASE",
    "WAITING_PRODUCTION_ORDER",
    "IN_PRODUCTION",
    "WAITING_OUTPUT_DOCUMENT",
    "WAITING_NFE",
    "SHIPPED_COMPLETED",
  ];

export type SalesOrderFlowKanbanColumnView = SalesOrderFlowColumnPageState & {
  label: string;
  orderValue: number | null;
  activeResidualValue: number | null;
};

type Props = {
  columns: readonly SalesOrderFlowKanbanColumnView[];
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  /** Quando true, cards exibem só número + status (expansível por card). */
  cardsMinimized?: boolean;
  /** Layout de altura plena para modal fullscreen. */
  fullscreen?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onOpenOrder: (orderId: string, orderCode: string) => void;
  onLoadMore: (stage: SalesOrderFlowStage) => void;
  onRetryColumn: (stage: SalesOrderFlowStage) => void;
};

export function SalesOrderFlowKanbanBoard({
  columns,
  valuesVisible,
  inconsistenciesVisible,
  cardsMinimized = false,
  fullscreen = false,
  scrollContainerRef,
  onOpenOrder,
  onLoadMore,
  onRetryColumn,
}: Props) {
  if (columns.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground"
        data-testid="sales-order-flow-kanban-empty"
      >
        Nenhuma coluna operacional corresponde aos filtros aplicados.
      </div>
    );
  }

  return (
    <section
      ref={scrollContainerRef}
      className={cn(
        "overflow-x-auto overscroll-x-contain pb-3",
        fullscreen && "h-full pb-0"
      )}
      aria-label="Kanban operacional de pedidos"
      data-testid="sales-order-flow-kanban"
    >
      {/* min-w-max: scroll horizontal em 1366×768; colunas 300px × 6 ≈ 1848px */}
      <div
        className={cn(
          "flex min-w-max items-stretch gap-3",
          fullscreen && "h-full min-h-[calc(100dvh-4.5rem)]"
        )}
      >
        {columns.map((column) => (
          <section
            key={column.stage}
            className={cn(
              "flex w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/20 shadow-sm",
              fullscreen
                ? "h-full max-h-none"
                : "max-h-[min(70vh,640px)]"
            )}
            data-testid={`sales-order-flow-kanban-column-${column.stage}`}
          >
            <header
              className={cn(
                "z-10 shrink-0 rounded-t-xl border-b px-3 py-2.5",
                salesOrderFlowKanbanHeaderClass(column.stage)
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-tight text-foreground">
                  {column.label}
                </h3>
                <span className="rounded-full border border-slate-300/80 bg-white/90 px-2 py-0.5 text-xs font-semibold text-slate-800">
                  {column.total}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-600">
                <span>Valor</span>
                <strong className="text-right text-foreground">
                  {formatColumnMoney(column.orderValue, valuesVisible)}
                </strong>
                <span>Saldo ativo</span>
                <strong className="text-right text-foreground">
                  {formatColumnMoney(column.activeResidualValue, valuesVisible)}
                </strong>
                <span>Atrasados / bloqueados</span>
                <strong className="text-right text-foreground">
                  {column.totals.overdueCount} / {column.totals.blockedCount}
                </strong>
              </div>
            </header>

            <div
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain p-2"
              data-testid={`sales-order-flow-kanban-column-scroll-${column.stage}`}
            >
              {column.status === "loading" ? (
                <div
                  className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/70 p-6 text-xs text-muted-foreground"
                  data-testid={`sales-order-flow-kanban-column-loading-${column.stage}`}
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Carregando coluna…
                </div>
              ) : null}

              {column.status === "error" && column.cards.length === 0 ? (
                <div
                  className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 p-4 text-center text-xs text-rose-800"
                  data-testid={`sales-order-flow-kanban-column-error-${column.stage}`}
                  role="alert"
                >
                  <p>{column.errorMessage ?? "Falha ao carregar a coluna."}</p>
                  <button
                    type="button"
                    className="inline-flex rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-900 hover:bg-rose-50"
                    data-testid={`sales-order-flow-kanban-column-retry-${column.stage}`}
                    onClick={() => onRetryColumn(column.stage)}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : null}

              {column.status !== "loading" &&
              column.cards.length === 0 &&
              column.status !== "error" ? (
                <div
                  className="rounded-lg border border-dashed border-border bg-background/70 p-5 text-center text-xs text-muted-foreground"
                  data-testid={`sales-order-flow-kanban-column-empty-${column.stage}`}
                >
                  {column.stage === "IN_PRODUCTION" ? (
                    <>
                      <p>Sem apontamentos de produção integrados.</p>
                      <p className="mt-1 opacity-80">
                        A coluna será preenchida quando houver evidência real de
                        quantidade produzida.
                      </p>
                    </>
                  ) : (
                    "Nenhum pedido nesta etapa."
                  )}
                </div>
              ) : null}

              {column.cards.map((card) => (
                <div key={card.orderId}>
                  <SalesOrderFlowKanbanCard
                    card={card}
                    valuesVisible={valuesVisible}
                    inconsistenciesVisible={inconsistenciesVisible}
                    defaultMinimized={cardsMinimized}
                    onOpen={() => onOpenOrder(card.orderId, card.orderCode)}
                  />
                </div>
              ))}

              {column.errorMessage && column.cards.length > 0 ? (
                <div
                  className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-center text-[11px] text-amber-900"
                  role="alert"
                >
                  <p>{column.errorMessage}</p>
                  <button
                    type="button"
                    className="inline-flex rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-50"
                    onClick={() =>
                      column.hasMore
                        ? onLoadMore(column.stage)
                        : onRetryColumn(column.stage)
                    }
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : null}

              {column.hasMore && column.status === "ready" ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  data-testid={`sales-order-flow-kanban-load-more-${column.stage}`}
                  disabled={column.loadingMore}
                  onClick={() => onLoadMore(column.stage)}
                >
                  {column.loadingMore ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Carregando…
                    </>
                  ) : (
                    `Carregar mais (${column.cards.length}/${column.total})`
                  )}
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

export function buildSalesOrderFlowKanbanColumnViews(input: {
  stages: readonly SalesOrderFlowStage[];
  columns: Readonly<Record<string, SalesOrderFlowColumnPageState>>;
  indicators: readonly SalesOrderFlowColumnIndicator[];
}): SalesOrderFlowKanbanColumnView[] {
  const indicatorByStage = new Map(
    input.indicators.map((column) => [column.stage, column] as const)
  );
  return input.stages
    .map((stage) => {
      const state = input.columns[stage];
      if (!state) return null;
      const indicator = indicatorByStage.get(stage);
      return {
        ...state,
        label: indicator?.label ?? stage,
        orderValue: indicator?.orderValue ?? null,
        activeResidualValue: indicator?.activeResidualValue ?? null,
      };
    })
    .filter((column): column is SalesOrderFlowKanbanColumnView => column != null);
}

export function SalesOrderFlowKanbanCard({
  card,
  valuesVisible,
  inconsistenciesVisible,
  defaultMinimized = false,
  onOpen,
}: {
  card: SalesOrderFlowListCard;
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  defaultMinimized?: boolean;
  onOpen: () => void;
}) {
  const [minimized, setMinimized] = useState(defaultMinimized);
  useEffect(() => {
    setMinimized(defaultMinimized);
  }, [defaultMinimized, card.orderId]);

  const badges = resolveCardBadges(card);
  const stageLabel =
    SALES_ORDER_FLOW_STAGE_LABELS[card.stage] ?? String(card.stage);

  if (minimized) {
    return (
      <div
        className="flex w-full items-stretch gap-1 rounded-lg border border-border bg-card shadow-sm"
        data-testid={`sales-order-flow-card-${card.orderId}`}
        data-minimized="true"
      >
        <button
          type="button"
          className="min-w-0 flex-1 px-2.5 py-2 text-left transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          onClick={onOpen}
          aria-label={`Abrir detalhe do pedido ${card.orderCode}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-bold text-foreground">
              {card.orderCode}
            </p>
            {card.isBlocked ? (
              <Ban className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
            {stageLabel}
          </p>
        </button>
        <button
          type="button"
          className="shrink-0 border-l border-border px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid={`sales-order-flow-card-expand-${card.orderId}`}
          aria-label={`Expandir pedido ${card.orderCode}`}
          onClick={(event) => {
            event.stopPropagation();
            setMinimized(false);
          }}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-border bg-card shadow-sm"
      data-testid={`sales-order-flow-card-${card.orderId}`}
      data-minimized="false"
    >
      <div className="flex items-start gap-1 border-b border-border/60 px-1 pt-1">
        <button
          type="button"
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid={`sales-order-flow-card-minimize-${card.orderId}`}
          aria-label={`Minimizar pedido ${card.orderCode}`}
          onClick={(event) => {
            event.stopPropagation();
            setMinimized(true);
          }}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="w-full p-3 pt-1 text-left transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={onOpen}
        aria-label={`Abrir detalhe do pedido ${card.orderCode}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">
              {card.orderCode}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {card.customerName?.trim() || "Cliente não informado"}
            </p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
              {stageLabel}
            </p>
          </div>
          <PriorityBadge priority={card.priority} />
        </div>

        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          <span className="text-slate-600">Vendedor</span>
          <strong className="truncate text-right font-medium text-foreground">
            {card.sellerName?.trim() || "—"}
          </strong>
          <span className="text-slate-600">Empresa</span>
          <strong className="truncate text-right font-medium text-foreground">
            {card.companyIssuer?.trim() || "—"}
          </strong>
          <span className="text-slate-600">Entrega</span>
          <strong
            className={cn(
              "text-right font-medium",
              card.isOverdue ? "text-rose-700" : "text-foreground"
            )}
          >
            {formatFlowDate(card.promisedDeliveryAt)}
          </strong>
          <span className="text-slate-600">Na etapa</span>
          <strong className="text-right font-medium text-foreground">
            {formatDaysInStage(card.daysInStage)}
          </strong>
        </div>

        <div className="mt-2 rounded-md border border-border/70 bg-muted/25 px-2 py-1.5 text-xs">
          {valuesVisible ? (
            <div className="grid grid-cols-2 gap-x-2">
              <span className="text-slate-600">Valor</span>
              <strong className="text-right text-foreground">
                {formatNullableMoney(card.orderValue)}
              </strong>
              <span className="text-slate-600">Saldo ativo</span>
              <strong className="text-right text-foreground">
                {formatNullableMoney(card.activeResidualValue)}
              </strong>
            </div>
          ) : (
            <p className="text-center text-slate-600">
              Valores ocultos por permissão
            </p>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-slate-600">Itens</span>
          <strong className="text-foreground">
            {card.completedItems} concluídos · {card.pendingItems} pendentes
          </strong>
        </div>

        <div className="mt-2 space-y-1.5">
          {card.progressProductionOrder != null ? (
            <CompactProgress
              label="OP"
              value={card.progressProductionOrder}
              icon={Factory}
            />
          ) : null}
          {card.progressProduced != null ? (
            <CompactProgress
              label="Produção"
              value={card.progressProduced}
              icon={Factory}
            />
          ) : null}
          <CompactProgress
            label="Documento"
            value={card.progressDocumented}
            icon={PackageCheck}
          />
          <CompactProgress
            label="Faturado"
            value={card.progressInvoiced}
            icon={CalendarClock}
          />
          <CompactProgress
            label="Enviado"
            value={card.progressShipped}
            icon={Truck}
          />
        </div>

        <div className="mt-2 border-t border-border/70 pt-2 text-xs">
          <p className="text-slate-600">Próxima ação</p>
          <p className="font-medium text-foreground">
            {card.nextAction?.trim() || "Sem ação definida"}
          </p>
          <p className="mt-1 text-slate-600">
            Área:{" "}
            <span className="font-medium text-foreground">
              {card.responsibleArea?.trim() || "Não definida"}
            </span>
          </p>
        </div>

        {card.isBlocked ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50/70 px-2 py-1.5 text-xs text-rose-900">
            <span className="inline-flex items-center gap-1 font-semibold">
              <Ban className="h-3 w-3" /> Bloqueado
            </span>
            {card.blockReason?.trim() ? ` · ${card.blockReason.trim()}` : null}
          </div>
        ) : null}

        {inconsistenciesVisible && card.inconsistencies.length > 0 ? (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-xs text-amber-950">
            <p className="inline-flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              {card.inconsistencies.length} inconsistência(s)
            </p>
            <p className="mt-0.5 line-clamp-2">
              {card.inconsistencies
                .slice(0, 2)
                .map((item) => formatInconsistencyLabel(item.code))
                .join(" · ")}
            </p>
          </div>
        ) : null}

        {badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map((badge) => (
              <span
                key={badge.key}
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                  badge.className
                )}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </button>
    </div>
  );
}

function CompactProgress({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Factory;
}) {
  const percent = clampProgress(value);
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[10px]">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Icon className="h-3 w-3" /> {label}
        </span>
        <strong className="text-foreground">{formatProgressPercent(percent)}</strong>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={`${label}: ${formatProgressPercent(percent)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-sky-500 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatProgressPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function formatFlowDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function formatDaysInStage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value === 1 ? "1 dia" : `${value} dias`;
}

function formatNullableMoney(value: number | null): string {
  return value == null ? "—" : formatCurrency(value, 2);
}

function formatColumnMoney(value: number | null, valuesVisible: boolean): string {
  if (!valuesVisible || value == null) return "Oculto";
  return formatCurrency(value, 2);
}

function formatInconsistencyLabel(code: string): string {
  return (
    SALES_ORDER_FLOW_INCONSISTENCY_LABELS[
      code as SalesOrderFlowInconsistencyCode
    ] ?? code
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const normalized = priority.trim().toUpperCase();
  const label =
    normalized === "URGENT"
      ? "Urgente"
      : normalized === "HIGH"
        ? "Alta"
        : normalized === "LOW"
          ? "Baixa"
          : "Normal";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        normalized === "URGENT"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : normalized === "HIGH"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-slate-50 text-slate-700"
      )}
    >
      {label}
    </span>
  );
}

function resolveCardBadges(card: SalesOrderFlowListCard): Array<{
  key: string;
  label: string;
  className: string;
}> {
  const badges = new Set(card.badges.map((badge) => badge.toUpperCase()));
  if (card.isOverdue) badges.add("OVERDUE");
  const definitions = [
    {
      key: "CUT",
      label: "Atendido com corte",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    },
    {
      key: "PARTIAL",
      label: "Parcial — saldo pendente",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    },
    {
      key: "STOCK_FULFILLED",
      label: "Atendido sem OP",
      className: "border-sky-200 bg-sky-50 text-sky-800",
    },
    {
      key: "OP_LINKED",
      label: "OP vinculada",
      className: "border-indigo-200 bg-indigo-50 text-indigo-800",
    },
    {
      key: "OP_PARTIAL",
      label: "OP parcial",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    },
    {
      key: "DS_LINKED",
      label: "DS vinculado",
      className: "border-teal-200 bg-teal-50 text-teal-800",
    },
    {
      key: "DS_PARTIAL",
      label: "DS parcial",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    },
    {
      key: "NFE_AUTHORIZED",
      label: "NF autorizada",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      key: "NFE_CANCELLED",
      label: "NF cancelada",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    },
    {
      key: "SHIPMENT_COMPLETE",
      label: "Envio completo",
      className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    },
    {
      key: "AMBIGUOUS_LINK",
      label: "Vínculo ambíguo",
      className: "border-orange-200 bg-orange-50 text-orange-900",
    },
    {
      key: "ITEM_UNRESOLVED",
      label: "Item não resolvido",
      className: "border-orange-200 bg-orange-50 text-orange-800",
    },
    {
      key: "EXCESS_COVERAGE",
      label: "Cobertura excedente",
      className: "border-violet-200 bg-violet-50 text-violet-800",
    },
    {
      key: "PARTIAL_COVERAGE",
      label: "Cobertura parcial",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    },
    {
      key: "DS_UNRECOGNIZED",
      label: "DS não reconhecido",
      className: "border-orange-200 bg-orange-50 text-orange-900",
    },
    {
      key: "NFE_UNLINKED",
      label: "NF sem vínculo",
      className: "border-orange-200 bg-orange-50 text-orange-800",
    },
    {
      key: "OP_UNLINKED",
      label: "OP sem vínculo",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    },
    {
      key: "SNAPSHOT_DIVERGENT",
      label: "Snapshot divergente",
      className: "border-rose-200 bg-rose-50 text-rose-900",
    },
    {
      key: "OVERDUE",
      label: "Atraso",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    },
  ] as const;
  return definitions.filter((definition) => badges.has(definition.key));
}

function salesOrderFlowKanbanHeaderClass(stage: SalesOrderFlowStage): string {
  switch (stage) {
    case "SHIPPED_COMPLETED":
      return "border-emerald-200 bg-emerald-50/90 text-emerald-900";
    case "WAITING_RELEASE":
    case "WAITING_OUTPUT_DOCUMENT":
    case "WAITING_NFE":
      return "border-amber-200 bg-amber-50/90 text-amber-900";
    default:
      return "border-border bg-card/95 text-foreground";
  }
}
