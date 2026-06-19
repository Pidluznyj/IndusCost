import type {
  SalesOrderCompletionStatus,
  SalesOrderDeadlineStatus,
  SalesOrderItemNomusStatus,
  SalesOrderOperationalStatus,
  SalesOrderTimelineEventStatus,
} from "./salesOrderLifecycleTypes.js";

export const SALES_ORDER_MANAGEMENT_PAGE_TITLE = "Gestão de Pedidos de Venda";

export const BILLING_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "not_invoiced", label: "Sem NF" },
  { value: "partially_invoiced", label: "NF parcial" },
  { value: "fully_invoiced", label: "NF total" },
  { value: "invoiced_with_cut", label: "NF com corte" },
];

export const INVOICE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "true", label: "Com NF" },
  { value: "false", label: "Sem NF" },
];

export const PRODUCTION_ORDER_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "true", label: "Com OP" },
  { value: "false", label: "Sem OP" },
  { value: "late", label: "OP atrasada" },
];

export const OPERATIONAL_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "awaiting_release", label: "Aguardando liberação" },
  { value: "released", label: "Liberado" },
  { value: "partially_fulfilled", label: "Atendido parcial" },
  { value: "fulfilled_with_cut", label: "Atendido com corte" },
  { value: "fully_fulfilled", label: "Atendido total" },
  { value: "partially_invoiced", label: "Faturado parcial" },
  { value: "fully_invoiced", label: "Faturado total" },
  { value: "shipped", label: "Enviado" },
  { value: "delivered", label: "Entregue" },
  { value: "cancelled", label: "Cancelado" },
  { value: "divergent", label: "Divergente" },
];

export const DEADLINE_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "on_time", label: "No prazo" },
  { value: "due_today", label: "Vence hoje" },
  { value: "overdue", label: "Atrasado" },
  { value: "invoiced_on_time", label: "NF no prazo" },
  { value: "invoiced_late", label: "NF após prazo" },
  { value: "no_due_date", label: "Sem prazo" },
];

export const COMPLETION_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "complete", label: "Completo" },
  { value: "partial", label: "Parcial" },
  { value: "with_cut", label: "Com corte" },
  { value: "cancelled", label: "Cancelado" },
  { value: "returned", label: "Devolvido" },
  { value: "mixed", label: "Misto" },
];

export const ITEM_NOMUS_STATUS_LABELS: Record<SalesOrderItemNomusStatus, string> = {
  awaiting_release: "Aguardando liberação",
  released: "Liberado",
  fulfilled_with_cut: "Atendido com corte",
  partially_fulfilled: "Atendido parcialmente",
  fully_fulfilled: "Atendido totalmente",
  cancelled: "Cancelado",
  partially_returned: "Devolvido parcialmente",
  fully_returned: "Devolvido totalmente",
  shipped: "Enviado",
  delivered: "Entregue",
  unknown: "Desconhecido",
};

export const COMPLETION_STATUS_LABELS: Record<SalesOrderCompletionStatus, string> = {
  complete: "Completo",
  partial: "Parcial",
  with_cut: "Com corte",
  cancelled: "Cancelado",
  returned: "Devolvido",
  mixed: "Misto",
  unknown: "Desconhecido",
};

export const TIMELINE_STATUS_LABELS: Record<SalesOrderTimelineEventStatus, string> = {
  done: "Feito",
  current: "Atual",
  pending: "Pendente",
  late: "Atrasado",
  warning: "Atenção",
};

export function formatSalesOrderPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100) / 100}%`;
}

export function formatSalesOrderDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatDeadlineBadge(
  status: SalesOrderDeadlineStatus,
  daysOverdue: number | null,
  operationalStatus?: SalesOrderOperationalStatus
): string {
  if (operationalStatus === "cancelled" || operationalStatus === "fully_returned") {
    return "—";
  }
  if (status === "on_time") return "No prazo";
  if (status === "due_today") return "Vence hoje";
  if (status === "overdue") {
    return daysOverdue != null && daysOverdue > 0
      ? `Atrasado ${daysOverdue} dia(s)`
      : "Atrasado";
  }
  if (status === "invoiced_on_time") return "NF no prazo";
  if (status === "invoiced_late") return "NF após prazo";
  if (status === "invoiced_early") return "NF antecipada";
  if (status === "no_due_date") return "Sem prazo";
  return "—";
}

export function formatInvoiceBadge(
  hasInvoice: boolean,
  invoicedPercent: number | null,
  operationalStatus?: SalesOrderOperationalStatus
): string {
  if (operationalStatus === "cancelled" || operationalStatus === "fully_returned") {
    return "Não aplicável";
  }
  if (!hasInvoice) return "Sem NF";
  if (invoicedPercent != null && invoicedPercent >= 99.5) return "NF total";
  if (invoicedPercent != null && invoicedPercent > 0) return "NF parcial";
  return "Com NF";
}

export function formatProductionBadge(
  hasOp: boolean,
  isLate: boolean,
  options?: {
    finished?: boolean;
    label?: string | null;
    status?: string | null;
    operationalStatus?: SalesOrderOperationalStatus;
  }
): string {
  if (
    options?.operationalStatus === "cancelled" ||
    options?.operationalStatus === "fully_returned"
  ) {
    return "Não aplicável";
  }
  if (!hasOp) return "Sem OP";
  if (options?.label) return options.label;
  if (isLate) return "OP atrasada";
  if (options?.finished) return "OP finalizada";
  const statusLower = (options?.status ?? "").toLowerCase();
  if (statusLower.includes("produ") || statusLower.includes("andamento")) return "OP em produção";
  if (options?.status === "not_available") return "OP não disponível";
  return "Com OP";
}

export function formatBillingBadge(
  billingStatus: string,
  operationalStatus?: SalesOrderOperationalStatus
): string {
  if (operationalStatus === "cancelled" || operationalStatus === "fully_returned") {
    return "Não aplicável";
  }
  if (billingStatus === "not_invoiced") return "Sem NF";
  if (billingStatus === "partially_invoiced") return "NF parcial";
  if (billingStatus === "fully_invoiced") return "NF total";
  if (billingStatus === "invoiced_with_cut") return "NF com corte";
  return "—";
}

export function formatItemSituation(item: {
  normalizedStatus: SalesOrderItemNomusStatus;
  hasCut: boolean;
  isCancelled: boolean;
  isReturned: boolean;
}): string {
  if (item.isCancelled) return "Cancelado";
  if (item.isReturned) return "Devolvido";
  if (item.hasCut) return "Com corte";
  if (item.normalizedStatus === "partially_fulfilled") return "Parcial";
  if (item.normalizedStatus === "fully_fulfilled" || item.normalizedStatus === "delivered") {
    return "Completo";
  }
  return ITEM_NOMUS_STATUS_LABELS[item.normalizedStatus] ?? "—";
}

export const MANAGEMENT_KPI_CARDS = [] as const;

/** @deprecated Use MANAGEMENT_STATUS_CARDS from salesOrderManagementStatus */
export const MANAGEMENT_KPI_CARD_HINTS: Record<string, string> = {};

export const INTELLIGENCE_DRAWER_TABS = [
  { id: "summary", label: "Resumo" },
  { id: "items", label: "Itens" },
  { id: "invoicing", label: "NF / Faturamento" },
  { id: "production", label: "Produção / OP" },
  { id: "timeline", label: "Timeline" },
  { id: "nomus-data", label: "Dados Nomus" },
  { id: "rule-audit", label: "Auditoria de regras" },
] as const;

export type SalesOrderIntelligenceDrawerTabId =
  (typeof INTELLIGENCE_DRAWER_TABS)[number]["id"];
