/**
 * Persistência idempotente de Ordens de Produção Nomus + vínculos oficiais Pedido/Item.
 * Resolve FKs locais por externalSalesOrderId / nomusItemExternalId — sem inferência.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { MappedNomusProductionOrder } from "@/src/lib/nomusProductionOrdersMapper.js";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type UpsertNomusProductionOrderResult = {
  action: "create" | "update";
  productionOrderId: string;
  linksCreated: number;
  linksUpdated: number;
  linksMarkedAbsent: number;
  salesOrderResolved: number;
  salesOrderItemResolved: number;
};

async function resolveLocalSalesOrderId(
  db: DbClient,
  externalSalesOrderId: number
): Promise<string | null> {
  const row = await db.salesOrder.findFirst({
    where: { externalSalesOrderId },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  return row?.id ?? null;
}

async function resolveLocalSalesOrderItemId(
  db: DbClient,
  externalSalesOrderItemId: number,
  salesOrderId: string | null
): Promise<string | null> {
  if (salesOrderId) {
    const inOrder = await db.salesOrderItem.findFirst({
      where: { salesOrderId, nomusItemExternalId: externalSalesOrderItemId },
      select: { id: true },
    });
    if (inOrder) return inOrder.id;
  }
  const any = await db.salesOrderItem.findFirst({
    where: { nomusItemExternalId: externalSalesOrderItemId },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  return any?.id ?? null;
}

export async function upsertNomusProductionOrder(
  db: DbClient,
  row: MappedNomusProductionOrder,
  syncedAt: Date
): Promise<UpsertNomusProductionOrderResult> {
  const existing = await db.nomusProductionOrder.findUnique({
    where: { externalId: row.externalId },
    select: { id: true },
  });

  const headerData = {
    name: row.name,
    status: row.status,
    tipo: row.tipo,
    productCode: row.productCode,
    externalProductId: row.externalProductId,
    quantity: row.quantity,
    unit: row.unit,
    companyName: row.companyName,
    rawJson: row.rawJson as Prisma.InputJsonValue,
    syncedAt,
    lastSeenAt: syncedAt,
  };

  const productionOrder =
    existing == null
      ? await db.nomusProductionOrder.create({
          data: {
            externalId: row.externalId,
            ...headerData,
          },
          select: { id: true },
        })
      : await db.nomusProductionOrder.update({
          where: { externalId: row.externalId },
          data: headerData,
          select: { id: true },
        });

  let linksCreated = 0;
  let linksUpdated = 0;
  let salesOrderResolved = 0;
  let salesOrderItemResolved = 0;
  const payloadItemIds = row.salesLinks.map((l) => l.externalSalesOrderItemId);

  for (const link of row.salesLinks) {
    const salesOrderId = await resolveLocalSalesOrderId(db, link.externalSalesOrderId);
    const salesOrderItemId = await resolveLocalSalesOrderItemId(
      db,
      link.externalSalesOrderItemId,
      salesOrderId
    );
    if (salesOrderId) salesOrderResolved += 1;
    if (salesOrderItemId) salesOrderItemResolved += 1;

    const linkData = {
      productionOrderId: productionOrder.id,
      productionOrderExternalId: row.externalId,
      externalSalesOrderId: link.externalSalesOrderId,
      externalSalesOrderItemId: link.externalSalesOrderItemId,
      itemSequence: link.itemSequence,
      customerName: link.customerName,
      linkQuantity: link.linkQuantity,
      rawJson: link.rawJson as Prisma.InputJsonValue,
      salesOrderId,
      salesOrderItemId,
      presentInLastPayload: true,
      lastSeenAt: syncedAt,
    };

    const existingLink = await db.nomusProductionOrderSalesLink.findUnique({
      where: {
        productionOrderExternalId_externalSalesOrderItemId: {
          productionOrderExternalId: row.externalId,
          externalSalesOrderItemId: link.externalSalesOrderItemId,
        },
      },
      select: { id: true },
    });

    if (existingLink) {
      await db.nomusProductionOrderSalesLink.update({
        where: { id: existingLink.id },
        data: linkData,
      });
      linksUpdated += 1;
    } else {
      await db.nomusProductionOrderSalesLink.create({ data: linkData });
      linksCreated += 1;
    }
  }

  let linksMarkedAbsent = 0;
  if (payloadItemIds.length === 0) {
    const allMarked = await db.nomusProductionOrderSalesLink.updateMany({
      where: {
        productionOrderId: productionOrder.id,
        presentInLastPayload: true,
      },
      data: {
        presentInLastPayload: false,
        lastSeenAt: syncedAt,
      },
    });
    linksMarkedAbsent = allMarked.count;
  } else {
    const marked = await db.nomusProductionOrderSalesLink.updateMany({
      where: {
        productionOrderId: productionOrder.id,
        presentInLastPayload: true,
        externalSalesOrderItemId: { notIn: payloadItemIds },
      },
      data: {
        presentInLastPayload: false,
        lastSeenAt: syncedAt,
      },
    });
    linksMarkedAbsent = marked.count;
  }

  return {
    action: existing == null ? "create" : "update",
    productionOrderId: productionOrder.id,
    linksCreated,
    linksUpdated,
    linksMarkedAbsent,
    salesOrderResolved,
    salesOrderItemResolved,
  };
}
