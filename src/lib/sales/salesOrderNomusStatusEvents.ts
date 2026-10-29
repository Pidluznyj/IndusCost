import type { NomusSyncExistingItem, NomusSyncItemWriteRow } from "../salesOrderNomusSync.server.js";
import { summarizeSalesOrderNomusLifecycle } from "./salesOrderNomusLifecycle.js";

/**
 * Transições de status Nomus observadas numa sincronização (antes = itens gravados; depois = plano de escrita).
 * Alimenta SalesOrderNomusStatusEvent: o cancelamento anterior continua no histórico mesmo depois de uma
 * reativação (o item em si reflete sempre o estado atual do Nomus).
 */

export type SalesOrderNomusStatusEventKind =
  | "ITEM_CANCELED"
  | "ITEM_REACTIVATED"
  | "ITEM_CUT"
  | "ITEM_CUT_REVERTED"
  | "ITEM_STALE"
  | "ITEM_RETURNED"
  | "ITEM_STATUS_CHANGED"
  | "ITEM_STATUS_UNKNOWN_PRESERVED"
  | "ORDER_FULLY_CANCELED"
  | "ORDER_REACTIVATED";

export type SalesOrderNomusItemState = {
  statusNormalized: string | null;
  statusRaw: string | null;
  canceled: boolean;
  cut: boolean;
  stale: boolean;
  quantity: number | null;
  quantityFulfilled: number | null;
  quantityPending: number | null;
};

export type SalesOrderNomusStatusEventDraft = {
  salesOrderId: string;
  salesOrderItemId: string | null;
  kind: SalesOrderNomusStatusEventKind;
  previousStatusNormalized: string | null;
  newStatusNormalized: string | null;
  newStatusRaw: string | null;
  previousState: SalesOrderNomusItemState | { orderState: string } | null;
  newState: SalesOrderNomusItemState | { orderState: string } | null;
};

const num = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(typeof value === "object" ? String(value) : value);
  return Number.isFinite(n) ? n : null;
};

export function nomusItemStateFromExisting(item: NomusSyncExistingItem): SalesOrderNomusItemState {
  return {
    statusNormalized: item.nomusItemStatusNormalized ?? null,
    statusRaw: item.nomusItemStatusRaw ?? null,
    canceled: item.nomusIsCanceled === true,
    cut: item.nomusIsCut === true,
    stale: item.nomusIsStale === true,
    quantity: num(item.quantity),
    quantityFulfilled: num(item.nomusQuantityFulfilled),
    quantityPending: num(item.nomusQuantityPending),
  };
}

export function nomusItemStateFromWriteRow(row: NomusSyncItemWriteRow): SalesOrderNomusItemState {
  return {
    statusNormalized: row.nomusItemStatusNormalized ?? null,
    statusRaw: row.nomusItemStatusRaw ?? null,
    canceled: row.nomusIsCanceled === true,
    cut: row.nomusIsCut === true,
    stale: row.nomusIsStale === true || row.stale === true,
    quantity: num(row.quantity),
    quantityFulfilled: num(row.nomusQuantityFulfilled),
    quantityPending: num(row.nomusQuantityPending),
  };
}

function orderState(states: Array<SalesOrderNomusItemState & { totalNetValue?: number }>): string {
  return summarizeSalesOrderNomusLifecycle(
    0,
    states.map((s) => ({
      quantity: s.quantity ?? 0,
      totalNetValue: 0,
      nomusIsCanceled: s.canceled,
      nomusIsStale: s.stale,
      nomusIsCut: s.cut,
      nomusQuantityFulfilled: s.quantityFulfilled,
    }))
  ).state;
}

export function buildSalesOrderNomusStatusEvents(input: {
  salesOrderId: string;
  existingItems: NomusSyncExistingItem[];
  plan: { upserts: NomusSyncItemWriteRow[]; creates: NomusSyncItemWriteRow[]; staleUpdates: NomusSyncItemWriteRow[] };
}): SalesOrderNomusStatusEventDraft[] {
  const events: SalesOrderNomusStatusEventDraft[] = [];
  const beforeById = new Map(input.existingItems.map((item) => [item.id, nomusItemStateFromExisting(item)]));
  const afterById = new Map<string, SalesOrderNomusItemState>();

  const push = (
    itemId: string,
    kind: SalesOrderNomusStatusEventKind,
    before: SalesOrderNomusItemState,
    after: SalesOrderNomusItemState
  ) =>
    events.push({
      salesOrderId: input.salesOrderId,
      salesOrderItemId: itemId,
      kind,
      previousStatusNormalized: before.statusNormalized,
      newStatusNormalized: after.statusNormalized,
      newStatusRaw: after.statusRaw,
      previousState: before,
      newState: after,
    });

  for (const row of [...input.plan.upserts, ...input.plan.staleUpdates]) {
    if (!row.id) continue;
    const before = beforeById.get(row.id);
    const after = nomusItemStateFromWriteRow(row);
    afterById.set(row.id, after);
    if (!before) continue;
    if (!before.stale && after.stale) {
      push(row.id, "ITEM_STALE", before, after);
      continue;
    }
    if (before.stale && !after.stale) push(row.id, "ITEM_RETURNED", before, after);
    if (!before.canceled && after.canceled) push(row.id, "ITEM_CANCELED", before, after);
    else if (before.canceled && !after.canceled) push(row.id, "ITEM_REACTIVATED", before, after);
    if (!before.cut && after.cut) push(row.id, "ITEM_CUT", before, after);
    else if (before.cut && !after.cut) push(row.id, "ITEM_CUT_REVERTED", before, after);
    const flagEvent = before.stale !== after.stale || before.canceled !== after.canceled || before.cut !== after.cut;
    if (row.nomusStatusPreservedFromPrevious === true) {
      // Só registra quando o código recebido muda (evita um evento por sincronização com o mesmo código).
      if (before.statusRaw !== after.statusRaw) push(row.id, "ITEM_STATUS_UNKNOWN_PRESERVED", before, after);
    } else if (!flagEvent && (before.statusNormalized ?? null) !== (after.statusNormalized ?? null)) {
      push(row.id, "ITEM_STATUS_CHANGED", before, after);
    }
  }

  // Pedido inteiro: só quando já havia itens (pedido novo não tem "antes").
  if (input.existingItems.length > 0) {
    const beforeStates = [...beforeById.values()];
    const afterStates = [
      ...input.existingItems.map((item) => afterById.get(item.id) ?? beforeById.get(item.id)!),
      ...input.plan.creates.map(nomusItemStateFromWriteRow),
    ];
    const before = orderState(beforeStates);
    const after = orderState(afterStates);
    const order = (kind: SalesOrderNomusStatusEventKind) =>
      events.push({
        salesOrderId: input.salesOrderId,
        salesOrderItemId: null,
        kind,
        previousStatusNormalized: before,
        newStatusNormalized: after,
        newStatusRaw: null,
        previousState: { orderState: before },
        newState: { orderState: after },
      });
    if (before !== "FULLY_CANCELED" && after === "FULLY_CANCELED") order("ORDER_FULLY_CANCELED");
    else if (before === "FULLY_CANCELED" && (after === "OPEN" || after === "PARTIALLY_CANCELED")) order("ORDER_REACTIVATED");
  }
  return events;
}
