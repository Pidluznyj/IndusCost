import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
import { SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS } from "@/src/lib/salesOrderFlowDetailUi";
import {
  EMIL_DURATION,
  EMIL_EASE_OUT,
  emilCardListStagger,
  emilCardVariants,
  emilColumnVariants,
  emilStaggerContainer,
} from "@/src/lib/motion/emilUiMotion";
import { cn, formatCurrency } from "@/src/lib/utils";

const PRESSABLE =
  "transition-transform duration-150 [transition-timing-function:var(--ease-out-strong)] active:scale-[0.97]";

function formatKanbanResponsibleAreaLabel(
  area: string | null | undefined
): string {
  const raw = area?.trim();
  if (!raw) return "Não definida";
  const match = SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS.find(
    (opt) => opt.value === raw
  );
  return match?.label ?? raw;
}

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
  const reduceMotion = useReducedMotion();
  const columnTransition = {
    duration: reduceMotion ? 0 : EMIL_DURATION.board,
    ease: EMIL_EASE_OUT,
  };

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
      <motion.div
        className={cn(
          "flex min-w-max items-stretch gap-3",
          fullscreen && "h-full min-h-[calc(100dvh-4.5rem)]"
        )}
        variants={reduceMotion ? undefined : emilStaggerContainer}
        initial={reduceMotion ? false : "hidden"}
        animate="show"
      >
        {columns.map((column) => (
          <motion.section
            key={column.stage}
            variants={reduceMotion ? undefined : emilColumnVariants}
            transition={columnTransition}
            className={cn(
              "flex w-[300px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/80",
              fullscreen
                ? "h-full max-h-none"
                : "max-h-[min(70vh,640px)]"
            )}
            data-testid={`sales-order-flow-kanban-column-${column.stage}`}
          >
            <header
              className={cn(
                "relative z-0 shrink-0 border-b border-border/60 px-3 pb-2.5 pt-3",
                salesOrderFlowKanbanHeaderClass(column.stage)
              )}
            >
              <div
                className={cn(
                  "absolute inset-x-0 top-0 h-1",
                  salesOrderFlowKanbanAccentClass(column.stage)
                )}
                aria-hidden="true"
              />
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-semibold leading-snug tracking-tight text-foreground">
                  {column.label}
                </h3>
                <span className="tabular-nums rounded-md bg-foreground/[0.06] px-2 py-0.5 text-xs font-bold text-foreground">
                  {column.total}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                  Valor{" "}
                  <strong className="font-semibold text-foreground">
                    {formatColumnMoney(column.orderValue, valuesVisible)}
                  </strong>
                </span>
                <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                  Saldo{" "}
                  <strong className="font-semibold text-foreground">
                    {formatColumnMoney(column.activeResidualValue, valuesVisible)}
                  </strong>
                </span>
                {(column.totals.overdueCount > 0 ||
                  column.totals.blockedCount > 0) && (
                  <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 font-medium text-rose-800">
                    {column.totals.overdueCount} atras. ·{" "}
                    {column.totals.blockedCount} bloq.
                  </span>
                )}
              </div>
            </header>

            <div
              className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-y-contain bg-[linear-gradient(180deg,rgba(15,23,42,0.02),transparent_48px)] p-2"
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
                    className={cn(
                      "inline-flex rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-900 hover:bg-rose-50",
                      PRESSABLE
                    )}
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

              <motion.div
                className="space-y-1.5"
                variants={reduceMotion ? undefined : emilCardListStagger}
                initial={reduceMotion ? false : "hidden"}
                animate="show"
              >
                <AnimatePresence initial={false}>
                  {column.cards.map((card) => (
                    <motion.div
                      key={card.orderId}
                      variants={reduceMotion ? undefined : emilCardVariants}
                      initial={reduceMotion ? false : "hidden"}
                      animate="show"
                      exit={reduceMotion ? undefined : "exit"}
                      transition={{
                        duration: reduceMotion ? 0 : EMIL_DURATION.popover,
                        ease: EMIL_EASE_OUT,
                      }}
                    >
                      <SalesOrderFlowKanbanCard
                        card={card}
                        valuesVisible={valuesVisible}
                        inconsistenciesVisible={inconsistenciesVisible}
                        defaultMinimized={cardsMinimized}
                        onOpen={() => onOpenOrder(card.orderId, card.orderCode)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>

              {column.errorMessage && column.cards.length > 0 ? (
                <div
                  className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-center text-[11px] text-amber-900"
                  role="alert"
                >
                  <p>{column.errorMessage}</p>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-50",
                      PRESSABLE
                    )}
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
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50",
                    PRESSABLE
                  )}
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
          </motion.section>
        ))}
      </motion.div>
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
  const reduceMotion = useReducedMotion();
  const [minimized, setMinimized] = useState(defaultMinimized);
  useEffect(() => {
    setMinimized(defaultMinimized);
  }, [defaultMinimized, card.orderId]);

  const badges = resolveCardBadges(card).slice(0, 3);
  const stageLabel =
    SALES_ORDER_FLOW_STAGE_LABELS[card.stage] ?? String(card.stage);
  const nextAction =
    card.missingToLeave?.trim() ||
    card.nextAction?.trim() ||
    "Sem ação definida";
  const accentClass = card.isBlocked
    ? "bg-rose-500"
    : card.isOverdue
      ? "bg-amber-500"
      : "bg-sky-500/70";
  const morphTransition = {
    duration: reduceMotion ? 0 : EMIL_DURATION.popover,
    ease: EMIL_EASE_OUT,
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {minimized ? (
        <motion.div
          key="mini"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
          transition={morphTransition}
          className="flex w-full items-stretch overflow-hidden rounded-xl border border-border/70 bg-card"
          data-testid={`sales-order-flow-card-${card.orderId}`}
          data-minimized="true"
        >
          <div className={cn("w-1 shrink-0", accentClass)} aria-hidden="true" />
          <button
            type="button"
            className={cn(
              "min-w-0 flex-1 px-2.5 py-2 text-left hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              PRESSABLE
            )}
            onClick={onOpen}
            aria-label={`Abrir detalhe do pedido ${card.orderCode}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13px] font-bold tracking-tight text-foreground">
                {card.orderCode}
              </p>
              {card.isBlocked ? (
                <Ban className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
              {stageLabel}
            </p>
            <p
              className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground"
              title={card.stayReason}
              data-testid={`sales-order-flow-card-stay-reason-mini-${card.orderId}`}
            >
              {card.stayReason}
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "shrink-0 border-l border-border/70 px-2 text-muted-foreground hover:bg-accent hover:text-foreground",
              PRESSABLE
            )}
            data-testid={`sales-order-flow-card-expand-${card.orderId}`}
            aria-label={`Expandir pedido ${card.orderCode}`}
            onClick={(event) => {
              event.stopPropagation();
              setMinimized(false);
            }}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="full"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
          transition={morphTransition}
          className="overflow-hidden rounded-xl border border-border/70 bg-card"
          data-testid={`sales-order-flow-card-${card.orderId}`}
          data-minimized="false"
        >
          <div className="flex">
            <div className={cn("w-1 shrink-0 self-stretch", accentClass)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1 px-2 pt-1.5">
                <PriorityBadge priority={card.priority} />
                <button
                  type="button"
                  className={cn(
                    "rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground",
                    PRESSABLE
                  )}
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
                className={cn(
                  "w-full px-3 pb-3 pt-0.5 text-left hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  PRESSABLE
                )}
                onClick={onOpen}
                aria-label={`Abrir detalhe do pedido ${card.orderCode}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold tracking-tight text-foreground">
                    {card.orderCode}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {card.customerName?.trim() || "Cliente não informado"}
                    <span className="text-border"> · </span>
                    {stageLabel}
                  </p>
                </div>

                <div
                  className="mt-2 space-y-1"
                  data-testid={`sales-order-flow-card-stay-reason-${card.orderId}`}
                >
                  <p className="text-[11px] leading-snug text-foreground">
                    <span className="font-medium text-muted-foreground">
                      Aqui porque{" "}
                    </span>
                    {card.stayReason}
                  </p>
                  <p className="text-[11px] leading-snug text-foreground">
                    <span className="font-medium text-sky-800">Para sair · </span>
                    {nextAction}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatKanbanResponsibleAreaLabel(card.responsibleArea)}
                    <span className="text-border"> · </span>
                    {formatDaysInStage(card.daysInStage)} na etapa
                  </p>
                </div>

                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>
                    Entrega{" "}
                    <strong
                      className={cn(
                        "font-semibold",
                        card.isOverdue ? "text-rose-700" : "text-foreground"
                      )}
                    >
                      {formatFlowDate(card.promisedDeliveryAt)}
                    </strong>
                  </span>
                  {valuesVisible ? (
                    <>
                      <span>
                        Valor{" "}
                        <strong className="font-semibold text-foreground">
                          {formatNullableMoney(card.orderValue)}
                        </strong>
                      </span>
                      <span>
                        Saldo{" "}
                        <strong className="font-semibold text-foreground">
                          {formatNullableMoney(card.activeResidualValue)}
                        </strong>
                      </span>
                    </>
                  ) : (
                    <span>Valores ocultos por permissão</span>
                  )}
                </div>

                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {card.sellerName?.trim() || "Sem vendedor"}
                  {card.companyIssuer?.trim()
                    ? ` · ${card.companyIssuer.trim()}`
                    : null}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Itens{" "}
                  <strong className="font-semibold text-foreground">
                    {card.completedItems} concluídos · {card.pendingItems}{" "}
                    pendentes
                  </strong>
                </p>

                <FlowProgressStrip card={card} />

                {card.isBlocked ? (
                  <p className="mt-2 inline-flex items-start gap-1 text-[11px] font-medium text-rose-800">
                    <Ban className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>
                      Bloqueado
                      {card.blockReason?.trim()
                        ? ` · ${card.blockReason.trim()}`
                        : null}
                    </span>
                  </p>
                ) : null}

                {inconsistenciesVisible && card.inconsistencies.length > 0 ? (
                  <p className="mt-1.5 inline-flex items-start gap-1 text-[11px] text-amber-900">
                    <AlertTriangle
                      className="mt-0.5 h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="line-clamp-2">
                      {card.inconsistencies.length} inconsistência(s):{" "}
                      {card.inconsistencies
                        .slice(0, 2)
                        .map((item) => formatInconsistencyLabel(item.code))
                        .join(" · ")}
                    </span>
                  </p>
                ) : null}

                {badges.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {badges.map((badge) => (
                      <span
                        key={badge.key}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FlowProgressStrip({ card }: { card: SalesOrderFlowListCard }) {
  const steps = [
    card.progressProductionOrder != null
      ? {
          key: "op",
          label: "OP planejada",
          value: card.progressProductionOrder,
          Icon: Factory,
        }
      : null,
    card.progressProduced != null
      ? {
          key: "prod",
          label: "Produção",
          value: card.progressProduced,
          Icon: Factory,
        }
      : null,
    {
      key: "doc",
      label: "Documento",
      value: card.progressDocumented,
      Icon: PackageCheck,
    },
    {
      key: "nfe",
      label: "Faturado",
      value: card.progressInvoiced,
      Icon: CalendarClock,
    },
    {
      key: "ship",
      label: "Enviado",
      value: card.progressShipped,
      Icon: Truck,
    },
  ].filter((step): step is NonNullable<typeof step> => step != null);

  return (
    <div className="mt-2 space-y-1">
      {steps.map((step) => {
        const percent = clampProgress(step.value);
        const Icon = step.Icon;
        return (
          <div
            key={step.key}
            className="min-w-0"
            title={`${step.label}: ${formatProgressPercent(percent)}`}
          >
            <div className="mb-0.5 flex items-center justify-between gap-1 text-[10px]">
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{step.label}</span>
              </span>
              <strong className="shrink-0 tabular-nums text-foreground">
                {formatProgressPercent(percent)}
              </strong>
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label={`${step.label}: ${formatProgressPercent(percent)}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200 [transition-timing-function:var(--ease-out-strong)]",
                  percent >= 100
                    ? "bg-emerald-500"
                    : percent > 0
                      ? "bg-sky-500"
                      : "bg-transparent"
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
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
  if (normalized === "NORMAL" || normalized === "LOW" || !normalized) {
    return <span className="h-5" aria-hidden="true" />;
  }
  const label = normalized === "URGENT" ? "Urgente" : "Alta";
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        normalized === "URGENT"
          ? "bg-rose-500/10 text-rose-800"
          : "bg-amber-500/10 text-amber-900"
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
      className: "bg-rose-500/10 text-rose-800",
    },
    {
      key: "PARTIAL",
      label: "Parcial — saldo pendente",
      className: "bg-amber-500/10 text-amber-900",
    },
    {
      key: "STOCK_FULFILLED",
      label: "Atendido sem OP",
      className: "bg-sky-500/10 text-sky-800",
    },
    {
      key: "OP_LINKED",
      label: "OP vinculada",
      className: "bg-indigo-500/10 text-indigo-800",
    },
    {
      key: "OP_PARTIAL",
      label: "OP parcial",
      className: "bg-amber-500/10 text-amber-900",
    },
    {
      key: "DS_LINKED",
      label: "DS vinculado",
      className: "bg-teal-500/10 text-teal-800",
    },
    {
      key: "DS_PARTIAL",
      label: "DS parcial",
      className: "bg-amber-500/10 text-amber-900",
    },
    {
      key: "NFE_AUTHORIZED",
      label: "NF autorizada",
      className: "bg-emerald-500/10 text-emerald-800",
    },
    {
      key: "NFE_CANCELLED",
      label: "NF cancelada",
      className: "bg-rose-500/10 text-rose-800",
    },
    {
      key: "SHIPMENT_COMPLETE",
      label: "Envio completo",
      className: "bg-emerald-500/10 text-emerald-900",
    },
    {
      key: "AMBIGUOUS_LINK",
      label: "Vínculo ambíguo",
      className: "bg-orange-500/10 text-orange-900",
    },
    {
      key: "ITEM_UNRESOLVED",
      label: "Item não resolvido",
      className: "bg-orange-500/10 text-orange-800",
    },
    {
      key: "EXCESS_COVERAGE",
      label: "Cobertura excedente",
      className: "bg-violet-500/10 text-violet-800",
    },
    {
      key: "PARTIAL_COVERAGE",
      label: "Cobertura parcial",
      className: "bg-amber-500/10 text-amber-900",
    },
    {
      key: "DS_UNRECOGNIZED",
      label: "DS não reconhecido",
      className: "bg-orange-500/10 text-orange-900",
    },
    {
      key: "NFE_UNLINKED",
      label: "NF sem vínculo",
      className: "bg-orange-500/10 text-orange-800",
    },
    {
      key: "OP_UNLINKED",
      label: "OP sem vínculo",
      className: "bg-amber-500/10 text-amber-900",
    },
    {
      key: "SNAPSHOT_DIVERGENT",
      label: "Snapshot divergente",
      className: "bg-rose-500/10 text-rose-900",
    },
    {
      key: "OVERDUE",
      label: "Atraso",
      className: "bg-rose-500/10 text-rose-800",
    },
  ] as const;
  return definitions.filter((definition) => badges.has(definition.key));
}

function salesOrderFlowKanbanAccentClass(stage: SalesOrderFlowStage): string {
  switch (stage) {
    case "WAITING_RELEASE":
      return "bg-amber-400";
    case "WAITING_PRODUCTION_ORDER":
      return "bg-sky-400";
    case "IN_PRODUCTION":
      return "bg-indigo-400";
    case "WAITING_OUTPUT_DOCUMENT":
      return "bg-orange-400";
    case "WAITING_NFE":
      return "bg-rose-400";
    case "SHIPPED_COMPLETED":
      return "bg-emerald-400";
    default:
      return "bg-slate-300";
  }
}

function salesOrderFlowKanbanHeaderClass(stage: SalesOrderFlowStage): string {
  switch (stage) {
    case "SHIPPED_COMPLETED":
      return "bg-emerald-50/50";
    case "WAITING_RELEASE":
      return "bg-amber-50/45";
    case "WAITING_PRODUCTION_ORDER":
      return "bg-sky-50/45";
    case "IN_PRODUCTION":
      return "bg-indigo-50/40";
    case "WAITING_OUTPUT_DOCUMENT":
      return "bg-orange-50/40";
    case "WAITING_NFE":
      return "bg-rose-50/40";
    default:
      return "bg-muted/20";
  }
}
