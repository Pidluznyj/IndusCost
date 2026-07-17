import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Factory,
  PackageCheck,
  Truck,
} from "lucide-react";
import type {
  SalesOrderFlowListCard,
  SalesOrderFlowListPayload,
} from "@/src/lib/sales/salesOrderFlowList";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_LABELS,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog";
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

type Props = {
  payload: SalesOrderFlowListPayload;
  columnIndicators: readonly SalesOrderFlowColumnIndicator[];
  onOpenOrder: (orderId: string, orderCode: string) => void;
};

export function SalesOrderFlowKanbanBoard({
  payload,
  columnIndicators,
  onOpenOrder,
}: Props) {
  const indicatorByStage = new Map(
    columnIndicators.map((column) => [column.stage, column] as const)
  );
  const columns = payload.columns.filter((column) =>
    SALES_ORDER_FLOW_OPERATIONAL_STAGES.includes(column.stage)
  );

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
      className="overflow-x-auto overscroll-x-contain pb-3"
      aria-label="Kanban operacional de pedidos"
      data-testid="sales-order-flow-kanban"
    >
      <div className="flex min-w-max items-start gap-3">
        {columns.map((column) => {
          const totals = indicatorByStage.get(column.stage);
          return (
            <section
              key={column.stage}
              className="w-[300px] shrink-0 rounded-xl border border-border bg-muted/20 shadow-sm"
              data-testid={`sales-order-flow-kanban-column-${column.stage}`}
            >
              <header
                className={cn(
                  "sticky top-0 z-10 rounded-t-xl border-b px-3 py-2.5 backdrop-blur-sm",
                  salesOrderFlowKanbanHeaderClass(column.stage)
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-tight">
                    {totals?.label ?? column.stage}
                  </h3>
                  <span className="rounded-full border border-current/15 bg-white/75 px-2 py-0.5 text-xs font-semibold">
                    {column.total}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>Valor</span>
                  <strong className="text-right text-foreground">
                    {formatColumnMoney(
                      totals?.orderValue ?? null,
                      payload.valuesVisible
                    )}
                  </strong>
                  <span>Saldo ativo</span>
                  <strong className="text-right text-foreground">
                    {formatColumnMoney(
                      totals?.activeResidualValue ?? null,
                      payload.valuesVisible
                    )}
                  </strong>
                  <span>Atrasados / bloqueados</span>
                  <strong className="text-right text-foreground">
                    {column.totals.overdueCount} / {column.totals.blockedCount}
                  </strong>
                </div>
              </header>

              <div className="space-y-2 p-2">
                {column.cards.length === 0 ? (
                  <div
                    className="rounded-lg border border-dashed border-border bg-background/70 p-5 text-center text-xs text-muted-foreground"
                    data-testid={`sales-order-flow-kanban-column-empty-${column.stage}`}
                  >
                    Nenhum pedido nesta etapa.
                  </div>
                ) : (
                  column.cards.map((card) => (
                    <div key={card.orderId}>
                      <SalesOrderFlowKanbanCard
                        card={card}
                        valuesVisible={payload.valuesVisible}
                        inconsistenciesVisible={payload.inconsistenciesVisible}
                        onOpen={() => onOpenOrder(card.orderId, card.orderCode)}
                      />
                    </div>
                  ))
                )}
                {column.hasMore ? (
                  <p className="px-2 py-1 text-center text-[11px] text-muted-foreground">
                    Há mais pedidos disponíveis nesta coluna.
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function SalesOrderFlowKanbanCard({
  card,
  valuesVisible,
  inconsistenciesVisible,
  onOpen,
}: {
  card: SalesOrderFlowListCard;
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  onOpen: () => void;
}) {
  const badges = resolveCardBadges(card);

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm transition hover:border-primary/35 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      onClick={onOpen}
      data-testid={`sales-order-flow-card-${card.orderId}`}
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
        </div>
        <PriorityBadge priority={card.priority} />
      </div>

      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Vendedor</span>
        <strong className="truncate text-right font-medium text-foreground">
          {card.sellerName?.trim() || "—"}
        </strong>
        <span className="text-muted-foreground">Empresa</span>
        <strong className="truncate text-right font-medium text-foreground">
          {card.companyIssuer?.trim() || "—"}
        </strong>
        <span className="text-muted-foreground">Entrega</span>
        <strong
          className={cn(
            "text-right font-medium",
            card.isOverdue ? "text-rose-700" : "text-foreground"
          )}
        >
          {formatFlowDate(card.promisedDeliveryAt)}
        </strong>
        <span className="text-muted-foreground">Na etapa</span>
        <strong className="text-right font-medium text-foreground">
          {formatDaysInStage(card.daysInStage)}
        </strong>
      </div>

      <div className="mt-2 rounded-md border border-border/70 bg-muted/25 px-2 py-1.5 text-[11px]">
        {valuesVisible ? (
          <div className="grid grid-cols-2 gap-x-2">
            <span className="text-muted-foreground">Valor</span>
            <strong className="text-right text-foreground">
              {formatNullableMoney(card.orderValue)}
            </strong>
            <span className="text-muted-foreground">Saldo ativo</span>
            <strong className="text-right text-foreground">
              {formatNullableMoney(card.activeResidualValue)}
            </strong>
          </div>
        ) : (
          <p className="text-center text-muted-foreground">
            Valores ocultos por permissão
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Itens</span>
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

      <div className="mt-2 border-t border-border/70 pt-2 text-[11px]">
        <p className="text-muted-foreground">Próxima ação</p>
        <p className="font-medium text-foreground">
          {card.nextAction?.trim() || "Sem ação definida"}
        </p>
        <p className="mt-1 text-muted-foreground">
          Área:{" "}
          <span className="font-medium text-foreground">
            {card.responsibleArea?.trim() || "Não definida"}
          </span>
        </p>
      </div>

      {card.isBlocked ? (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50/70 px-2 py-1.5 text-[11px] text-rose-800">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Ban className="h-3 w-3" /> Bloqueado
          </span>
          {card.blockReason?.trim() ? ` · ${card.blockReason.trim()}` : null}
        </div>
      ) : null}

      {inconsistenciesVisible && card.inconsistencies.length > 0 ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-[11px] text-amber-900">
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
                "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                badge.className
              )}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
    </button>
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
      label: "Corte",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    },
    {
      key: "PARTIAL",
      label: "Parcial",
      className: "border-amber-200 bg-amber-50 text-amber-800",
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
