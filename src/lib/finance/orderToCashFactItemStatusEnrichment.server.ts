/**
 * Enriquece facts O2C com orderItemStatus a partir de SalesOrderItem (persistido)
 * e fallback em SalesOrder.nomusRawResponse.
 * Read-only Prisma. Usado por Status Pedidos e Auditoria Pedido → Caixa.
 */

import { prisma } from "@/src/lib/prisma.js";
import { extractNomusRawItems } from "@/src/lib/salesOrderNomusRaw.js";
import {
  isCanceledOrderItemStatus,
  normalizeOrderItemFulfillmentStatus,
} from "./orderItemFulfillmentStatus.js";
import {
  isFulfilledWithCutSalesOrderItem,
  isInactiveSalesOrderItemNomusFlags,
  parseNomusSalesOrderItemStatus,
  resolveNomusRawItemMatchesForOrder,
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
  nomusIsCut?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  nomusMatchConfidence?: string | null;
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
          quantity: true,
          negotiatedPrice: true,
          notes: true,
          nomusItemExternalId: true,
          nomusItemSequence: true,
          nomusItemStatusRaw: true,
          nomusItemStatusNormalized: true,
          nomusIsCanceled: true,
          nomusIsStale: true,
          nomusIsCut: true,
          nomusMatchConfidence: true,
          nomusRawItem: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });

  const byOrderId = new Map(
    orders.map((o) => {
      const rawItems = extractNomusRawItems(o.nomusRawResponse);
      const localForMatch = o.items.map((it) => ({
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
      return [
        o.id,
        {
          raw: o.nomusRawResponse,
          items: o.items,
          itemById: new Map(o.items.map((it) => [it.id, it])),
          matches,
        },
      ] as const;
    })
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
      const cut = isFulfilledWithCutSalesOrderItem(dbItem);
      const fromCol = fromNormalizedColumn(dbItem.nomusItemStatusNormalized);
      if (inactive || cut || fromCol) {
        return {
          ...fact,
          orderItemStatus: inactive
            ? "CANCELADO"
            : cut
              ? "ATENDIDO_COM_CORTE"
              : fromCol ?? fact.orderItemStatus ?? null,
          nomusIsCanceled: dbItem.nomusIsCanceled === true || inactive,
          nomusIsStale: dbItem.nomusIsStale === true,
          nomusIsCut: dbItem.nomusIsCut === true || cut,
          nomusItemStatusNormalized: dbItem.nomusItemStatusNormalized,
          nomusMatchConfidence: dbItem.nomusMatchConfidence ?? null,
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

    if (!order?.raw || !dbItem) return { ...fact };

    // Fallback: usa o resolver POR LINHA — nunca aplica status via primeiro rawItem
    // com mesmo idProduto/SKU.
    const match = order.matches.get(dbItem.id);
    if (!match || !match.rawItem) {
      // AMBIGUOUS/NONE → não marcar cancelado por SKU.
      return {
        ...fact,
        nomusMatchConfidence: match?.matchConfidence ?? "NONE",
      };
    }
    const parsed = parseNomusSalesOrderItemStatus(match.rawItem.raw);
    if (parsed.isCanceled) {
      return {
        ...fact,
        orderItemStatus: "CANCELADO",
        nomusIsCanceled: true,
        nomusItemStatusNormalized: "CANCELED",
        nomusMatchConfidence: match.matchConfidence,
      };
    }
    if (parsed.isCut) {
      return {
        ...fact,
        orderItemStatus: "ATENDIDO_COM_CORTE",
        nomusIsCut: true,
        nomusItemStatusNormalized: "FULFILLED_WITH_CUT",
        nomusMatchConfidence: match.matchConfidence,
      };
    }
    const stored = toOrderItemFulfillmentStorageStatus(parsed.statusNormalized);
    if (stored && stored !== "DESCONHECIDO") {
      return {
        ...fact,
        orderItemStatus: stored,
        nomusItemStatusNormalized: parsed.statusNormalized,
        nomusMatchConfidence: match.matchConfidence,
      };
    }

    return {
      ...fact,
      nomusMatchConfidence: match.matchConfidence,
    };
  });
}

/** Uso legado — remove referência ao `nomusStatusToStored` para evitar drift. */
void nomusStatusToStored;
