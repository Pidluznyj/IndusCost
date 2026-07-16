/**
 * Service — detalhe read-only de Ordem de Produção (OP-17).
 * Uma consulta Prisma com includes — sem Nomus, sem mutação.
 */
import type { PrismaClient } from "@prisma/client";
import {
  serializeProductionOrderDetail,
  type ProductionOrderDetailResponse,
} from "@/src/lib/productionOrdersDetail.js";

const PRODUCTION_ORDER_DETAIL_LINK_SELECT = {
  id: true,
  isCurrent: true,
  externalSalesOrderId: true,
  externalSalesOrderItemId: true,
  itemNumber: true,
  customerName: true,
  linkedQuantity: true,
  salesOrderId: true,
  salesOrderItemId: true,
  firstSeenAt: true,
  lastSeenAt: true,
  removedAt: true,
  rawJson: true,
  SalesOrder: { select: { orderCode: true } },
  SalesOrderItem: {
    select: {
      id: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      unit: true,
      nomusItemExternalId: true,
      nomusItemSequence: true,
    },
  },
} as const;

export async function getProductionOrderDetailById(
  db: PrismaClient,
  id: string
): Promise<ProductionOrderDetailResponse | null> {
  const row = await db.nomusProductionOrder.findUnique({
    where: { id },
    include: {
      salesLinks: {
        orderBy: [{ isCurrent: "desc" }, { lastSeenAt: "desc" }],
        select: PRODUCTION_ORDER_DETAIL_LINK_SELECT,
      },
    },
  });

  if (row == null) return null;
  return serializeProductionOrderDetail(row);
}
