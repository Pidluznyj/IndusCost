/**
 * Enriquece facts O2C com orderItemStatus a partir de SalesOrderItem (persistido)
 * e fallback em SalesOrder.nomusRawResponse.
 * Read-only Prisma. Usado por Status Pedidos e Auditoria Pedido → Caixa.
 */

import { prisma } from "@/src/lib/prisma.js";
import {
  extractNomusRawItems,
  isSalesOrderItemCancelledByRawQuantity,
  matchRawItemToDbItem,
  resolveSalesOrderItemNomusStatus,
} from "@/src/lib/salesOrderNomusRaw.js";
import {
  isCanceledOrderItemStatus,
  normalizeOrderItemFulfillmentStatus,
} from "./orderItemFulfillmentStatus.js";
import {
  isInactiveSalesOrderItemNomusFlags,
  toOrderItemFulfillmentStorageStatus,
  type NomusSalesOrderItemStatusNormalized,
} from "@/src/lib/sales/nomusSalesOrderItemStatus.js";

export type OrderItemStatusEnrichableFact = {
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  productCode?: string | null;
  sku?: string | null;
  productName?: string | null;
  orderItemStatus?: string | null;
  lineType?: string | null;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusItemStatusNormalized?: string | null;
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

function fromNormalizedColumn(
  normalized: string | null | undefined
): string | null {
  if (!normalized?.trim()) return null;
  const upper = normalized.trim().toUpperCase();
  if (
    upper === "FULFILLED" ||
    upper === "CANCELED" ||
    upper === "PARTIAL" ||
    upper === "PENDING" ||
    upper === "UNKNOWN"
  ) {
    return toOrderItemFulfillmentStorageStatus(
      upper as NomusSalesOrderItemStatusNormalized
    );
  }
  return normalizeOrderItemFulfillmentStatus(normalized) === "DESCONHECIDO"
    ? null
    : normalizeOrderItemFulfillmentStatus(normalized);
}

/**
 * Resolve status cancelado/ativo do item via SalesOrderItem + nomusRawResponse.
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
          nomusItemStatusRaw: true,
          nomusItemStatusNormalized: true,
          nomusIsCanceled: true,
          nomusIsStale: true,
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
    const orderId = fact.salesOrderId?.trim();
    const order = orderId ? byOrderId.get(orderId) : undefined;

    const dbItem =
      (fact.salesOrderItemId && order
        ? order.itemById.get(fact.salesOrderItemId)
        : null) ??
      order?.items.find((it) => {
        const sku = (it.skuSnapshot ?? "").trim().toUpperCase();
        const code = (fact.productCode ?? fact.sku ?? "").trim().toUpperCase();
        if (sku && code && sku === code) return true;
        const name = (it.productNameSnapshot ?? "").trim().toLowerCase();
        const pname = (fact.productName ?? "").trim().toLowerCase();
        return Boolean(name && pname && name === pname);
      });

    if (dbItem) {
      const inactive = isInactiveSalesOrderItemNomusFlags(dbItem);
      const fromCol = fromNormalizedColumn(dbItem.nomusItemStatusNormalized);
      if (inactive || fromCol) {
        return {
          ...fact,
          orderItemStatus: inactive
            ? "CANCELADO"
            : fromCol ?? fact.orderItemStatus ?? null,
          nomusIsCanceled: dbItem.nomusIsCanceled === true || inactive,
          nomusIsStale: dbItem.nomusIsStale === true,
          nomusItemStatusNormalized: dbItem.nomusItemStatusNormalized,
        };
      }
    }

    if (isCanceledOrderItemStatus(fact.orderItemStatus)) {
      return {
        ...fact,
        orderItemStatus: "CANCELADO",
        nomusIsCanceled: true,
      };
    }
    if (fact.orderItemStatus?.trim()) {
      return { ...fact };
    }

    if (!order?.raw) return { ...fact };

    const matchDb = dbItem ?? {
      externalProductId: null as number | null,
      skuSnapshot: fact.sku ?? fact.productCode,
      productNameSnapshot: fact.productName,
    };
    const itemIndex = dbItem
      ? order.items.findIndex((it) => it.id === dbItem.id)
      : undefined;
    const nomus = resolveSalesOrderItemNomusStatus(
      order.raw,
      {
        externalProductId: matchDb.externalProductId,
        skuSnapshot: matchDb.skuSnapshot,
        productNameSnapshot: matchDb.productNameSnapshot,
      },
      {
        itemIndex: itemIndex != null && itemIndex >= 0 ? itemIndex : undefined,
        totalDbItems: order.items.length,
      }
    );

    if (nomus === "cancelled") {
      return {
        ...fact,
        orderItemStatus: "CANCELADO",
        nomusIsCanceled: true,
        nomusItemStatusNormalized: "CANCELED",
      };
    }

    const rawItems = extractNomusRawItems(order.raw);
    const matched = matchRawItemToDbItem(
      rawItems,
      {
        externalProductId: matchDb.externalProductId,
        skuSnapshot: matchDb.skuSnapshot,
        productNameSnapshot: matchDb.productNameSnapshot,
      },
      {
        itemIndex: itemIndex != null && itemIndex >= 0 ? itemIndex : undefined,
        totalDbItems: order.items.length,
      }
    );
    if (matched && isSalesOrderItemCancelledByRawQuantity(matched.raw)) {
      return {
        ...fact,
        orderItemStatus: "CANCELADO",
        nomusIsCanceled: true,
        nomusItemStatusNormalized: "CANCELED",
      };
    }

    if (nomus !== "unknown") {
      return {
        ...fact,
        orderItemStatus: nomusStatusToStored(nomus),
      };
    }

    return { ...fact };
  });
}
