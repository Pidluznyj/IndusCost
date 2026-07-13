/**
 * Backfill pontual de status Nomus em SalesOrderItem a partir de nomusRawResponse.
 * Não chama Nomus; só materializa campos locais. Usado por diagnóstico / pós-migration.
 */

import type { PrismaClient } from "@prisma/client";
import { extractNomusLineExternalId } from "@/src/lib/salesOrderNomusSync.server.js";
import { extractNomusRawItems, matchRawItemToDbItem } from "@/src/lib/salesOrderNomusRaw.js";
import { parseNomusSalesOrderItemStatus } from "@/src/lib/sales/nomusSalesOrderItemStatus.js";

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
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order?.nomusRawResponse) return { updated: 0 };

  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  const seenAt = options?.seenAt ?? new Date();
  const seenIds = new Set<string>();
  let updated = 0;

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i]!;
    const matched = matchRawItemToDbItem(
      rawItems,
      {
        externalProductId: item.externalProductId,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
      },
      { itemIndex: i, totalDbItems: order.items.length }
    );
    if (!matched) continue;
    const parsed = parseNomusSalesOrderItemStatus(matched.raw);
    const externalId = extractNomusLineExternalId(matched.raw);
    await prisma.salesOrderItem.update({
      where: { id: item.id },
      data: {
        nomusItemExternalId: externalId,
        nomusItemSequence:
          matched.item != null ? String(matched.item) : String(i + 1),
        nomusItemStatusRaw: parsed.statusRaw,
        nomusItemStatusNormalized: parsed.statusNormalized,
        nomusQuantityFulfilled: parsed.quantityFulfilled,
        nomusQuantityPending: parsed.quantityPending,
        nomusIsCanceled: parsed.isCanceled,
        nomusIsStale: false,
        nomusLastSeenAt: seenAt,
        nomusRawItem: matched.raw as object,
      },
    });
    seenIds.add(item.id);
    updated += 1;
  }

  for (const item of order.items) {
    if (seenIds.has(item.id)) continue;
    await prisma.salesOrderItem.update({
      where: { id: item.id },
      data: { nomusIsStale: true },
    });
    updated += 1;
  }

  return { updated };
}
