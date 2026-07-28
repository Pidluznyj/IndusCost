/**
 * Backfill pontual de status Nomus em SalesOrderItem a partir de nomusRawResponse.
 * Não chama Nomus; só materializa campos locais. Usado por diagnóstico / pós-migration.
 *
 * IMPORTANTE: status do item é aplicado POR LINHA, não por SKU/produto. Múltiplas
 * linhas do mesmo produto no pedido são resolvidas via
 * `resolveNomusRawItemMatchesForOrder` (id → sequência → qty+preço → posicional).
 */

import type { PrismaClient } from "@prisma/client";
import { extractNomusLineExternalId } from "@/src/lib/salesOrderNomusSync.server.js";
import { extractNomusRawItems } from "@/src/lib/salesOrderNomusRaw.js";
import {
  parseNomusSalesOrderItemStatus,
  resolveNomusRawItemMatchesForOrder,
} from "@/src/lib/sales/nomusSalesOrderItemStatus.js";

export async function backfillSalesOrderItemNomusStatusForOrder(
  prisma: PrismaClient,
  orderId: string,
  options?: { seenAt?: Date }
): Promise<{ updated: number }> {
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      nomusRawResponse: true,
      items: {
        select: {
          id: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
          negotiatedPrice: true,
          notes: true,
          nomusItemExternalId: true,
          nomusItemSequence: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order?.nomusRawResponse) return { updated: 0 };

  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  const seenAt = options?.seenAt ?? new Date();
  let updated = 0;

  const localForMatch = order.items.map((it) => ({
    id: it.id,
    externalProductId: it.externalProductId,
    skuSnapshot: it.skuSnapshot,
    productNameSnapshot: it.productNameSnapshot,
    quantity: it.quantity != null ? Number(it.quantity) : null,
    negotiatedPrice:
      it.negotiatedPrice != null ? Number(it.negotiatedPrice) : null,
    notes: it.notes,
    nomusItemExternalId: it.nomusItemExternalId ?? null,
    nomusItemSequence: it.nomusItemSequence ?? null,
  }));

  const matches = resolveNomusRawItemMatchesForOrder(localForMatch, rawItems);

  for (const item of order.items) {
    const match = matches.get(item.id)!;
    if (!match.rawItem) {
      // AMBIGUOUS / NONE: preservar como UNKNOWN, marcar stale se rawItems existe.
      const isStale = rawItems.length > 0 && match.matchConfidence !== "NONE";
      await prisma.salesOrderItem.update({
        where: { id: item.id },
        data: {
          nomusItemStatusRaw: null,
          nomusItemStatusNormalized: "UNKNOWN",
          nomusQuantityFulfilled: null,
          nomusQuantityPending: null,
          nomusIsCanceled: false,
          nomusIsCut: false,
          nomusIsStale: isStale,
          nomusMatchConfidence: match.matchConfidence,
          nomusMatchReason: match.matchReason,
          nomusLastSeenAt: seenAt,
        },
      });
      updated += 1;
      continue;
    }
    const parsed = parseNomusSalesOrderItemStatus(match.rawItem.raw);
    const externalId = extractNomusLineExternalId(match.rawItem.raw);
    const sequence =
      match.rawItem.item != null ? String(match.rawItem.item) : null;
    const matchReason = parsed.fulfilledQuantityCoercedDueToStatusMismatch
      ? [match.matchReason, "FULFILLED_QTY_MISMATCH: atendida < pedida com status Atendido totalmente; qty promovida à pedida"]
          .filter((part) => typeof part === "string" && part.trim().length > 0)
          .join(" | ")
      : match.matchReason;
    await prisma.salesOrderItem.update({
      where: { id: item.id },
      data: {
        nomusItemExternalId: externalId ?? item.nomusItemExternalId ?? null,
        nomusItemSequence: sequence ?? item.nomusItemSequence ?? null,
        nomusItemStatusRaw: parsed.statusRaw,
        nomusItemStatusNormalized: parsed.statusNormalized,
        nomusQuantityFulfilled: parsed.quantityFulfilled,
        nomusQuantityPending: parsed.quantityPending,
        nomusIsCanceled: parsed.isCanceled,
        nomusIsCut: parsed.isCut,
        nomusIsStale: false,
        nomusMatchConfidence: match.matchConfidence,
        nomusMatchReason: matchReason,
        nomusLastSeenAt: seenAt,
        nomusRawItem: match.rawItem.raw as object,
      },
    });
    updated += 1;
  }

  return { updated };
}
