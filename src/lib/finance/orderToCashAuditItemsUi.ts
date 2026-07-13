/**
 * Helpers UI — chips / classificação de linhas da Auditoria Pedido → Caixa
 * (reuso Status Pedidos drilldown + aba Auditoria).
 * Não recalcula valores; só classifica rows já mapeadas pela API.
 */

import type { OrderToCashAuditListRow } from "@/src/lib/finance/orderToCashAuditApi";

export type OrderToCashAuditItemChipId =
  | ""
  | "attended"
  | "pending"
  | "canceled"
  | "excess"
  | "outside"
  | "cr_open"
  | "received";

export const ORDER_TO_CASH_AUDIT_ITEM_CHIPS: ReadonlyArray<{
  id: Exclude<OrderToCashAuditItemChipId, "">;
  label: string;
  tone: string;
}> = [
  {
    id: "attended",
    label: "Itens atendidos",
    tone: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
  },
  {
    id: "pending",
    label: "Itens pendentes",
    tone: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  },
  {
    id: "canceled",
    label: "Itens cancelados",
    tone: "border-[#D0D5DD] bg-[#F2F4F7] text-[#475467]",
  },
  {
    id: "excess",
    label: "Itens com excedente",
    tone: "border-[#FDBA74] bg-[#FFF6ED] text-[#C2410C]",
  },
  {
    id: "outside",
    label: "Produtos fora do pedido",
    tone: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
  },
  {
    id: "cr_open",
    label: "Itens com CR aberto",
    tone: "border-[#B2DDFF] bg-[#EFF8FF] text-[#175CD3]",
  },
  {
    id: "received",
    label: "Itens recebidos",
    tone: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
  },
];

const MONEY_EPS = 0.009;

export function orderToCashAuditLineType(row: OrderToCashAuditListRow): string {
  return (row.lineType ?? "").trim().toUpperCase();
}

export function isOrderToCashAuditCanceledLine(row: OrderToCashAuditListRow): boolean {
  if (row.itemFulfillmentStatus === "CANCELADO") return true;
  const status = (row.orderItemStatus ?? "").trim().toUpperCase();
  return (
    status === "CANCELADO" ||
    status === "CANCELLED" ||
    status === "CANCELED" ||
    status === "CANCELLED"
  );
}

export function isOrderToCashAuditPendingLine(row: OrderToCashAuditListRow): boolean {
  if (isOrderToCashAuditCanceledLine(row)) return false;
  return orderToCashAuditLineType(row) === "ORDER_ITEM_PENDING";
}

export function isOrderToCashAuditAttendedLine(row: OrderToCashAuditListRow): boolean {
  if (isOrderToCashAuditCanceledLine(row)) return false;
  const lt = orderToCashAuditLineType(row);
  if (lt === "ORDER_ITEM_PENDING") return false;
  if (lt === "ORDER_ITEM_ALLOCATED") return true;
  return (row.quantityUsedForOrder ?? 0) > MONEY_EPS || (row.allocatedValueByOrderPrice ?? 0) > MONEY_EPS;
}

export function isOrderToCashAuditExcessLine(row: OrderToCashAuditListRow): boolean {
  const lt = orderToCashAuditLineType(row);
  return lt === "QUANTITY_SURPLUS" || row.hasExcessQuantity || (row.excessQuantity ?? 0) > MONEY_EPS;
}

export function isOrderToCashAuditOutsideLine(row: OrderToCashAuditListRow): boolean {
  const lt = orderToCashAuditLineType(row);
  return (
    lt === "DOCUMENT_EXTRA_ITEM" ||
    row.hasProductOutsideOrder ||
    (row.outsideOrderQuantity ?? 0) > MONEY_EPS
  );
}

export function isOrderToCashAuditCrOpenLine(row: OrderToCashAuditListRow): boolean {
  if (isOrderToCashAuditPendingLine(row)) return false;
  return (row.receivableOpenValue ?? 0) > MONEY_EPS;
}

export function isOrderToCashAuditReceivedLine(row: OrderToCashAuditListRow): boolean {
  if (isOrderToCashAuditPendingLine(row)) return false;
  if ((row.receivableReceivedValue ?? 0) > MONEY_EPS) return true;
  const pay = (row.paymentStatus ?? "").toUpperCase();
  return pay.includes("RECEIV") || pay.includes("RECEB");
}

export function matchesOrderToCashAuditItemChip(
  row: OrderToCashAuditListRow,
  chip: OrderToCashAuditItemChipId
): boolean {
  if (!chip) return true;
  switch (chip) {
    case "attended":
      return isOrderToCashAuditAttendedLine(row);
    case "pending":
      return isOrderToCashAuditPendingLine(row);
    case "canceled":
      return isOrderToCashAuditCanceledLine(row);
    case "excess":
      return isOrderToCashAuditExcessLine(row);
    case "outside":
      return isOrderToCashAuditOutsideLine(row);
    case "cr_open":
      return isOrderToCashAuditCrOpenLine(row);
    case "received":
      return isOrderToCashAuditReceivedLine(row);
    default:
      return true;
  }
}

export function countOrderToCashAuditItemChips(
  rows: readonly OrderToCashAuditListRow[]
): Record<Exclude<OrderToCashAuditItemChipId, "">, number> {
  const counts = {
    attended: 0,
    pending: 0,
    canceled: 0,
    excess: 0,
    outside: 0,
    cr_open: 0,
    received: 0,
  };
  for (const row of rows) {
    if (isOrderToCashAuditAttendedLine(row)) counts.attended += 1;
    if (isOrderToCashAuditPendingLine(row)) counts.pending += 1;
    if (isOrderToCashAuditCanceledLine(row)) counts.canceled += 1;
    if (isOrderToCashAuditExcessLine(row)) counts.excess += 1;
    if (isOrderToCashAuditOutsideLine(row)) counts.outside += 1;
    if (isOrderToCashAuditCrOpenLine(row)) counts.cr_open += 1;
    if (isOrderToCashAuditReceivedLine(row)) counts.received += 1;
  }
  return counts;
}

export function filterOrderToCashAuditRowsByChip(
  rows: readonly OrderToCashAuditListRow[],
  chip: OrderToCashAuditItemChipId
): OrderToCashAuditListRow[] {
  if (!chip) return [...rows];
  return rows.filter((r) => matchesOrderToCashAuditItemChip(r, chip));
}

/** Colunas ocultas no drilldown por pedido (já filtrado). */
export const ORDER_TO_CASH_AUDIT_COMPACT_HIDDEN_COLUMNS = [
  "orderCode",
  "orderIssueDate",
  "orderExpectedDeliveryDate",
  "customerName",
  "sellerName",
  "temperature",
  "confidenceLabel",
  "responsibleArea",
] as const;

export function pendingQuantityOfAuditRow(row: OrderToCashAuditListRow): number | null {
  if (isOrderToCashAuditCanceledLine(row)) return 0;
  const ordered = row.orderedQuantity;
  if (ordered == null) {
    if (isOrderToCashAuditPendingLine(row)) return null;
    return null;
  }
  if (isOrderToCashAuditPendingLine(row)) return ordered;
  const used = row.quantityUsedForOrder ?? 0;
  return Math.max(0, ordered - used);
}
