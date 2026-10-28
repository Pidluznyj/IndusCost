import { Prisma } from "@prisma/client";
import {
  buildNomusSyncItemWritePlan,
  type NomusSyncExistingItem,
  type NomusSyncItemWriteRow,
  type NomusSyncPlannedLine,
} from "../salesOrderNomusSync.server.js";
import { buildSalesOrderNomusStatusEvents, type SalesOrderNomusStatusEventDraft } from "./salesOrderNomusStatusEvents.js";

/**
 * Gravação dos itens de UM pedido Nomus dentro da transação do sync (scripts/nomusSalesOrdersSyncV1.ts):
 * plano idempotente (buildNomusSyncItemWritePlan — itens nunca são apagados; linha que sai do Nomus vira stale),
 * escrita e histórico de transições de status (SalesOrderNomusStatusEvent).
 */

/** Namespace do lock consultivo por pedido do Nomus (serializa sincronizações concorrentes do mesmo pedido). */
export const NOMUS_SALES_ORDER_SYNC_LOCK_NAMESPACE = 0x4e534f53; // "NSOS"

export async function lockNomusSalesOrderSyncInTx(tx: Prisma.TransactionClient, externalSalesOrderId: number): Promise<void> {
  // pg_advisory_xact_lock retorna void; ::text evita coluna void no $queryRaw.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${NOMUS_SALES_ORDER_SYNC_LOCK_NAMESPACE}::int, hashtext(${`nomus-so:${externalSalesOrderId}`}))::text AS locked`;
}

/** Campos lidos dos itens existentes para o plano e para o histórico de status. */
export const NOMUS_SYNC_EXISTING_ITEM_SELECT = {
  id: true,
  productId: true,
  externalProductId: true,
  proposalItemId: true,
  skuSnapshot: true,
  productNameSnapshot: true,
  unit: true,
  unitCost: true,
  totalCost: true,
  marginValue: true,
  marginPerc: true,
  quantity: true,
  negotiatedPrice: true,
  totalNetValue: true,
  notes: true,
  nomusItemExternalId: true,
  nomusItemStatusRaw: true,
  nomusItemStatusNormalized: true,
  nomusQuantityFulfilled: true,
  nomusQuantityPending: true,
  nomusIsCanceled: true,
  nomusIsStale: true,
  nomusIsCut: true,
  nomusMatchConfidence: true,
} satisfies Prisma.SalesOrderItemSelect;

export function mapNomusItemWriteRowToData(row: NomusSyncItemWriteRow): Prisma.SalesOrderItemCreateManyInput {
  return {
    salesOrderId: row.salesOrderId,
    proposalItemId: row.proposalItemId,
    productId: row.productId,
    externalProductId: row.externalProductId,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    quantity: row.quantity,
    unit: row.unit,
    unitCost: row.unitCost,
    negotiatedPrice: row.negotiatedPrice,
    totalNetValue: row.totalNetValue,
    totalCost: row.totalCost,
    marginValue: row.marginValue,
    marginPerc: row.marginPerc,
    notes: row.notes,
    nomusItemExternalId: row.nomusItemExternalId ?? null,
    nomusItemSequence: row.nomusItemSequence ?? null,
    nomusItemStatusRaw: row.nomusItemStatusRaw ?? null,
    nomusItemStatusNormalized: row.nomusItemStatusNormalized ?? null,
    nomusQuantityFulfilled: row.nomusQuantityFulfilled ?? null,
    nomusQuantityPending: row.nomusQuantityPending ?? null,
    nomusIsCanceled: row.nomusIsCanceled ?? false,
    nomusIsCut: row.nomusIsCut ?? false,
    nomusIsStale: row.nomusIsStale ?? false,
    nomusMatchConfidence: row.nomusMatchConfidence ?? null,
    nomusMatchReason: row.nomusMatchReason ?? null,
    nomusLastSeenAt: row.nomusLastSeenAt ?? null,
    nomusRawItem: row.nomusRawItem != null ? (row.nomusRawItem as Prisma.InputJsonValue) : Prisma.JsonNull,
  };
}

export async function recordSalesOrderNomusStatusEventsInTx(
  tx: Prisma.TransactionClient,
  events: SalesOrderNomusStatusEventDraft[],
  runId: string | null
): Promise<number> {
  if (events.length === 0) return 0;
  const createdAt = new Date();
  await tx.salesOrderNomusStatusEvent.createMany({
    data: events.map((event) => ({
      salesOrderId: event.salesOrderId,
      salesOrderItemId: event.salesOrderItemId,
      kind: event.kind,
      previousStatusNormalized: event.previousStatusNormalized,
      newStatusNormalized: event.newStatusNormalized,
      newStatusRaw: event.newStatusRaw,
      previousState: (event.previousState ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      newState: (event.newState ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      runId,
      createdAt,
    })),
  });
  return events.length;
}

export type NomusSalesOrderItemSyncResult = {
  plan: ReturnType<typeof buildNomusSyncItemWritePlan>;
  statusEvents: SalesOrderNomusStatusEventDraft[];
};

export async function applyNomusSalesOrderItemSyncInTx(
  tx: Prisma.TransactionClient,
  input: {
    salesOrderId: string;
    plannedLines: NomusSyncPlannedLine[];
    /** Itens já gravados (vazio para pedido novo); lidos com NOMUS_SYNC_EXISTING_ITEM_SELECT. */
    existingItems: NomusSyncExistingItem[];
    runId: string | null;
    seenAt?: Date;
  }
): Promise<NomusSalesOrderItemSyncResult> {
  const plan = buildNomusSyncItemWritePlan({
    salesOrderId: input.salesOrderId,
    plannedLines: input.plannedLines,
    existingItems: input.existingItems,
    seenAt: input.seenAt,
  });
  for (const row of [...plan.upserts, ...plan.staleUpdates]) {
    if (!row.id) continue;
    await tx.salesOrderItem.update({ where: { id: row.id }, data: mapNomusItemWriteRowToData(row) });
  }
  if (plan.creates.length > 0) {
    await tx.salesOrderItem.createMany({ data: plan.creates.map(mapNomusItemWriteRowToData) });
  }
  const statusEvents = buildSalesOrderNomusStatusEvents({
    salesOrderId: input.salesOrderId,
    existingItems: input.existingItems,
    plan,
  });
  await recordSalesOrderNomusStatusEventsInTx(tx, statusEvents, input.runId);
  return { plan, statusEvents };
}
