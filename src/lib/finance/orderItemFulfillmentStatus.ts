/**
 * Normalizador de status operacional do item do pedido (Status Pedidos / O2C).
 * Fonte: orderItemStatus materializado, status Nomus ou sinais de linha.
 */

export type OrderItemFulfillmentStatus =
  | "CANCELADO"
  | "ATENDIDO"
  | "PARCIAL"
  | "PENDENTE"
  | "DESCONHECIDO";

const CANCEL_RE =
  /\b(cancelad[oa]s?|cancelled?|canceled|cancelamento)\b/i;
const FULFILLED_RE =
  /\b(atendid[oa]\s*totalmente|fully[_\s-]?fulfilled|atendido|fulfilled|entregue|faturad[oa])\b/i;
const PARTIAL_RE =
  /\b(parcialmente\s*atendid[oa]|partially[_\s-]?fulfilled|parcial|com\s*corte|fulfilled_with_cut)\b/i;
const PENDING_RE =
  /\b(pendente|em\s*aberto|liberad[oa]|aguardando|awaiting|released|not[_\s-]?fulfilled)\b/i;

export function normalizeOrderItemFulfillmentStatus(
  raw: unknown
): OrderItemFulfillmentStatus {
  if (raw == null) return "DESCONHECIDO";

  if (typeof raw === "string" || typeof raw === "number") {
    const text = String(raw).trim();
    if (!text) return "DESCONHECIDO";
    const upper = text.toUpperCase();
    if (
      upper === "CANCELADO" ||
      upper === "CANCELLED" ||
      upper === "CANCELED" ||
      upper === "CANCEL"
    ) {
      return "CANCELADO";
    }
    if (
      upper === "ATENDIDO" ||
      upper === "FULLY_FULFILLED" ||
      upper === "FULFILLED"
    ) {
      return "ATENDIDO";
    }
    if (upper === "PARCIAL" || upper === "PARTIALLY_FULFILLED") {
      return "PARCIAL";
    }
    if (
      upper === "PENDENTE" ||
      upper === "PENDING" ||
      upper === "NOT_FULFILLED" ||
      upper === "OPEN"
    ) {
      return "PENDENTE";
    }

    const lower = text.toLowerCase().replace(/-/g, "_");
    if (lower === "cancelled" || lower === "canceled") return "CANCELADO";
    if (lower === "fully_fulfilled" || lower === "delivered" || lower === "shipped") {
      return "ATENDIDO";
    }
    if (
      lower === "partially_fulfilled" ||
      lower === "fulfilled_with_cut" ||
      lower === "partially_returned"
    ) {
      return "PARCIAL";
    }
    if (
      lower === "awaiting_release" ||
      lower === "released" ||
      lower === "unknown"
    ) {
      return lower === "unknown" ? "DESCONHECIDO" : "PENDENTE";
    }

    if (CANCEL_RE.test(text)) return "CANCELADO";
    if (PARTIAL_RE.test(text)) return "PARCIAL";
    if (FULFILLED_RE.test(text)) return "ATENDIDO";
    if (PENDING_RE.test(text)) return "PENDENTE";
  }

  return "DESCONHECIDO";
}

export function isCanceledOrderItemStatus(raw: unknown): boolean {
  return normalizeOrderItemFulfillmentStatus(raw) === "CANCELADO";
}

/** Fact/linha com status de item cancelado (não conta como pendência ativa). */
export function isCanceledOrderItemFact(fact: {
  orderItemStatus?: string | null;
  itemFulfillmentStatus?: OrderItemFulfillmentStatus | string | null;
}): boolean {
  if (fact.itemFulfillmentStatus != null) {
    return (
      normalizeOrderItemFulfillmentStatus(fact.itemFulfillmentStatus) ===
      "CANCELADO"
    );
  }
  return isCanceledOrderItemStatus(fact.orderItemStatus);
}

export function orderItemFulfillmentStatusLabel(
  status: OrderItemFulfillmentStatus
): string {
  switch (status) {
    case "CANCELADO":
      return "Cancelado";
    case "ATENDIDO":
      return "Atendido";
    case "PARCIAL":
      return "Parcial";
    case "PENDENTE":
      return "Pendente";
    default:
      return "Desconhecido";
  }
}
