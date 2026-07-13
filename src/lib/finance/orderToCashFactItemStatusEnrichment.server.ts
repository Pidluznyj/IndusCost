/**
 * Enriquece facts O2C com orderItemStatus a partir do Nomus raw do pedido.
 * Read-only Prisma. Usado por Status Pedidos e Auditoria Pedido → Caixa
 * para runs antigos onde orderItemStatus ainda está null.
 */

import { prisma } from "@/src/lib/prisma.js";
import {
  extractNomusRawItems,
  isSalesOrderItemCancelledByRawQuantity,
  matchRawItemToDbItem,
  resolveSalesOrderItemNomusStatus,
} from "@/src/lib/salesOrderNomusRaw.js";
import { isCanceledOrderItemStatus } from "./orderItemFulfillmentStatus.js";

export type OrderItemStatusEnrichableFact = {
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  productCode?: string | null;
  sku?: string | null;
  productName?: string | null;
  orderItemStatus?: string | null;
  lineType?: string | null;
};

function nomusStatusToStored(status: string): string {
  if (status === "cancelled") return "CANCELADO";
  if (status === "fully_fulfilled") return "ATENDIDO";
  if (
    status === "partially_fulfilled" ||
    status === "fulfilled_with_cut"
  ) {
    return "PARCIAL";
  }
  if (status === "awaiting_release" || status === "released") return "PENDENTE";
  return status.toUpperCase();
}

/**
 * Resolve status cancelado/ativo do item via nomusRawResponse + itens do pedido.
 */
export async function enrichFactsWithOrderItemStatus<
  T extends OrderItemStatusEnrichableFact,
>(facts: readonly T[]): Promise<T[]> {
  if (facts.length === 0) return [];

  const orderIds = [
    ...new Set(
      facts
        .map((f) => f.salesOrderId?.trim())
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (orderIds.length === 0) return facts.map((f) => ({ ...f }));

  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
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

  const byOrderId = new Map(
    orders.map((o) => [
      o.id,
      {
        raw: o.nomusRawResponse,
        items: o.items,
        itemById: new Map(o.items.map((it) => [it.id, it])),
      },
    ])
  );

  return facts.map((fact) => {
    if (isCanceledOrderItemStatus(fact.orderItemStatus)) {
      return { ...fact, orderItemStatus: "CANCELADO" };
    }
    if (fact.orderItemStatus?.trim()) {
      return { ...fact };
    }

    const orderId = fact.salesOrderId?.trim();
    if (!orderId) return { ...fact };
    const order = byOrderId.get(orderId);
    if (!order?.raw) return { ...fact };

    const dbItem =
      (fact.salesOrderItemId
        ? order.itemById.get(fact.salesOrderItemId)
        : null) ??
      order.items.find((it) => {
        const sku = (it.skuSnapshot ?? "").trim().toUpperCase();
        const code = (fact.productCode ?? fact.sku ?? "").trim().toUpperCase();
        if (sku && code && sku === code) return true;
        const name = (it.productNameSnapshot ?? "").trim().toLowerCase();
        const pname = (fact.productName ?? "").trim().toLowerCase();
        return Boolean(name && pname && name === pname);
      });

    if (!dbItem) {
      // Fallback: raw items by product code
      const rawItems = extractNomusRawItems(order.raw);
      const matched = matchRawItemToDbItem(rawItems, {
        skuSnapshot: fact.sku ?? fact.productCode,
        productNameSnapshot: fact.productName,
      });
      if (matched && isSalesOrderItemCancelledByRawQuantity(matched.raw)) {
        return { ...fact, orderItemStatus: "CANCELADO" };
      }
      if (matched?.status) {
        const nomus = resolveSalesOrderItemNomusStatus(order.raw, {
          skuSnapshot: fact.sku ?? fact.productCode,
          productNameSnapshot: fact.productName,
        });
        if (nomus === "cancelled") {
          return { ...fact, orderItemStatus: "CANCELADO" };
        }
      }
      return { ...fact };
    }

    const itemIndex = order.items.findIndex((it) => it.id === dbItem.id);
    const nomus = resolveSalesOrderItemNomusStatus(
      order.raw,
      {
        externalProductId: dbItem.externalProductId,
        skuSnapshot: dbItem.skuSnapshot,
        productNameSnapshot: dbItem.productNameSnapshot,
      },
      {
        itemIndex: itemIndex >= 0 ? itemIndex : undefined,
        totalDbItems: order.items.length,
      }
    );

    if (nomus === "cancelled") {
      return { ...fact, orderItemStatus: "CANCELADO" };
    }

    const rawItems = extractNomusRawItems(order.raw);
    const matched = matchRawItemToDbItem(
      rawItems,
      {
        externalProductId: dbItem.externalProductId,
        skuSnapshot: dbItem.skuSnapshot,
        productNameSnapshot: dbItem.productNameSnapshot,
      },
      {
        itemIndex: itemIndex >= 0 ? itemIndex : undefined,
        totalDbItems: order.items.length,
      }
    );
    if (matched && isSalesOrderItemCancelledByRawQuantity(matched.raw)) {
      return { ...fact, orderItemStatus: "CANCELADO" };
    }

    if (nomus !== "unknown") {
      return { ...fact, orderItemStatus: nomusStatusToStored(nomus) };
    }

    return { ...fact };
  });
}
