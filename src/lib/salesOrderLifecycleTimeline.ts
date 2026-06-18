import type { SalesOrderLifecycleSummary } from "./salesOrderLifecycleTypes.js";
import type { EnrichedLifecycleItem } from "./salesOrderLifecycleStatus.js";
import type { SalesOrderTimelineEvent } from "./salesOrderLifecycleTypes.js";
import {
  extractNomusProductionOrders,
  parseNomusBrOrIsoDate,
} from "./salesOrderNomusRaw.js";

export type SalesOrderTimelineInput = {
  lifecycle: SalesOrderLifecycleSummary;
  items: EnrichedLifecycleItem[];
  nomusRawResponse?: unknown;
  referenceDate?: Date;
};

function eventStatus(
  done: boolean,
  late: boolean,
  current: boolean,
  warning = false
): SalesOrderTimelineEvent["status"] {
  if (late) return "late";
  if (warning) return "warning";
  if (current) return "current";
  if (done) return "done";
  return "pending";
}

export function buildSalesOrderTimeline(input: SalesOrderTimelineInput): SalesOrderTimelineEvent[] {
  const { lifecycle, items, nomusRawResponse } = input;
  const referenceDate = input.referenceDate ?? new Date();
  const productionOrders = extractNomusProductionOrders(nomusRawResponse);
  const hasCancelled = lifecycle.operationalStatus === "cancelled";
  const hasReturned =
    lifecycle.operationalStatus === "partially_returned" ||
    lifecycle.operationalStatus === "fully_returned";
  const hasShipped = items.some((i) => i.normalizedStatus === "shipped");
  const hasDelivered = items.some((i) => i.normalizedStatus === "delivered");
  const released =
    lifecycle.itemsReleased > 0 ||
    items.some((i) => i.normalizedStatus !== "awaiting_release");

  const firstOp = productionOrders[0];
  const opOpened = firstOp ? parseNomusBrOrIsoDate(firstOp.openedAt) : null;
  const opStarted = firstOp ? parseNomusBrOrIsoDate(firstOp.startedAt) : null;
  const opFinished = firstOp ? parseNomusBrOrIsoDate(firstOp.finishedAt) : null;

  const invoiceLate = lifecycle.deadlineStatus === "invoiced_late";
  const dueLate =
    lifecycle.deadlineStatus === "overdue" &&
    !lifecycle.hasInvoice &&
    !hasCancelled;

  const events: SalesOrderTimelineEvent[] = [
    {
      key: "created",
      label: "Pedido emitido",
      date: lifecycle.issueDate,
      status: lifecycle.issueDate ? "done" : "warning",
      description: lifecycle.issueDate ? undefined : "Data de emissão indisponível.",
    },
    {
      key: "released",
      label: "Pedido liberado",
      date: released ? lifecycle.issueDate : null,
      status: eventStatus(
        released,
        false,
        !released && !hasCancelled && lifecycle.itemsAwaitingRelease > 0
      ),
      description: released ? undefined : "Aguardando liberação dos itens.",
    },
    {
      key: "production_order",
      label: "OP vinculada",
      date: opOpened ? opOpened.toISOString().slice(0, 10) : null,
      status: eventStatus(
        productionOrders.length > 0,
        lifecycle.productionOrderLate,
        productionOrders.length === 0 && !hasCancelled,
        lifecycle.dataQuality.missingProductionOrderLink
      ),
      description:
        productionOrders.length > 0
          ? `OP ${firstOp?.number ?? firstOp?.id ?? ""}`.trim()
          : "Nenhuma OP vinculada encontrada.",
    },
    {
      key: "production_started",
      label: "Produção iniciada",
      date: opStarted ? opStarted.toISOString().slice(0, 10) : null,
      status: eventStatus(!!opStarted, false, productionOrders.length > 0 && !opStarted),
    },
    {
      key: "production_finished",
      label: "Produção finalizada",
      date: opFinished ? opFinished.toISOString().slice(0, 10) : null,
      status: eventStatus(
        !!opFinished,
        lifecycle.productionOrderLate && !opFinished,
        !!opStarted && !opFinished
      ),
    },
    {
      key: "due_date",
      label: "Prazo de entrega",
      date: lifecycle.expectedDeliveryDate,
      status: eventStatus(
        !!lifecycle.expectedDeliveryDate,
        dueLate,
        lifecycle.deadlineStatus === "due_today",
        lifecycle.deadlineStatus === "no_due_date"
      ),
      description:
        lifecycle.deadlineStatus === "no_due_date"
          ? "Sem previsão de entrega cadastrada."
          : lifecycle.daysOverdue
            ? `Atrasado ${lifecycle.daysOverdue} dia(s).`
            : undefined,
    },
    {
      key: "invoiced",
      label: "NF emitida",
      date: lifecycle.firstInvoiceDate,
      status: eventStatus(
        lifecycle.hasInvoice,
        invoiceLate,
        !lifecycle.hasInvoice && !hasCancelled && lifecycle.deadlineStatus === "overdue"
      ),
      description: lifecycle.invoiceNumbers.length
        ? `NF ${lifecycle.invoiceNumbers.join(", ")}`
        : lifecycle.hasInvoice
          ? undefined
          : "Sem nota fiscal processada.",
    },
    {
      key: "shipped",
      label: "Enviado",
      date: hasShipped ? lifecycle.lastInvoiceDate ?? lifecycle.issueDate : null,
      status: eventStatus(hasShipped, false, lifecycle.hasInvoice && !hasShipped && !hasDelivered),
    },
    {
      key: "delivered",
      label: "Entregue",
      date: hasDelivered ? lifecycle.deliveryDate ?? lifecycle.lastInvoiceDate : null,
      status: eventStatus(hasDelivered, false, hasShipped && !hasDelivered),
    },
  ];

  if (hasReturned) {
    events.push({
      key: "returned",
      label: "Devolvido",
      date: lifecycle.lastInvoiceDate,
      status: "warning",
      description: "Pedido com itens devolvidos.",
    });
  }
  if (hasCancelled) {
    events.push({
      key: "cancelled",
      label: "Cancelado",
      date: lifecycle.issueDate,
      status: "done",
    });
  }

  const currentKeys = new Set<SalesOrderTimelineEvent["key"]>();
  if (!hasCancelled) {
    const pending = events.filter((e) => e.status === "pending" || e.status === "current");
    if (pending[0]) currentKeys.add(pending[0].key);
  }

  return events.map((event) =>
    currentKeys.has(event.key) && event.status === "pending"
      ? { ...event, status: "current" as const }
      : event
  );
}
