/**
 * Vínculos oficiais OP ↔ Pedido/Item Nomus (OP-06).
 *
 * Fonte: `itensPedido[]`
 * - externalSalesOrderId     = idPedido      → SalesOrder.externalSalesOrderId
 * - externalSalesOrderItemId = id           → SalesOrderItem.nomusItemExternalId
 *
 * Sem inferência por nome/código/cliente/produto/quantidade.
 * Não altera SalesOrder nem SalesOrderItem.
 * Vínculo externo é preservado mesmo sem FK local (resolução posterior).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { MappedNomusProductionOrderSalesLink } from "@/src/lib/nomusProductionOrdersMapper.js";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type SyncNomusProductionOrderSalesLinksResult = {
  linksCreated: number;
  linksUpdated: number;
  linksReactivated: number;
  linksMarkedAbsent: number;
  salesOrderResolved: number;
  salesOrderItemResolved: number;
};

export type ReconcilePendingNomusProductionOrderSalesLinksResult = {
  scanned: number;
  salesOrderResolved: number;
  salesOrderItemResolved: number;
  updated: number;
};

/** Localiza SalesOrder.id apenas por `externalSalesOrderId` (idPedido Nomus). */
export async function resolveLocalSalesOrderIdByNomusExternalId(
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

/**
 * Localiza SalesOrderItem.id apenas por `nomusItemExternalId` (itensPedido[].id).
 * Prefere o item dentro do pedido já resolvido.
 */
export async function resolveLocalSalesOrderItemIdByNomusExternalId(
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

/**
 * Sincroniza vínculos de uma OP com o payload atual de itensPedido.
 * Ausentes → isCurrent=false + removedAt (sem delete).
 * Reaparecimento → reativa (isCurrent=true, removedAt=null).
 */
export async function syncNomusProductionOrderSalesLinks(
  db: DbClient,
  args: {
    productionOrderId: string;
    productionOrderExternalId: number;
    salesLinks: MappedNomusProductionOrderSalesLink[];
    syncedAt: Date;
  }
): Promise<SyncNomusProductionOrderSalesLinksResult> {
  const { productionOrderId, productionOrderExternalId, salesLinks, syncedAt } = args;

  let linksCreated = 0;
  let linksUpdated = 0;
  let linksReactivated = 0;
  let salesOrderResolved = 0;
  let salesOrderItemResolved = 0;

  const payloadItemIds = salesLinks.map((l) => l.externalSalesOrderItemId);

  for (const link of salesLinks) {
    const salesOrderId = await resolveLocalSalesOrderIdByNomusExternalId(
      db,
      link.externalSalesOrderId
    );
    const salesOrderItemId = await resolveLocalSalesOrderItemIdByNomusExternalId(
      db,
      link.externalSalesOrderItemId,
      salesOrderId
    );
    if (salesOrderId) salesOrderResolved += 1;
    if (salesOrderItemId) salesOrderItemResolved += 1;

    const existing = await db.nomusProductionOrderSalesLink.findUnique({
      where: {
        productionOrderExternalId_externalSalesOrderItemId: {
          productionOrderExternalId,
          externalSalesOrderItemId: link.externalSalesOrderItemId,
        },
      },
      select: { id: true, isCurrent: true },
    });

    const linkData = {
      productionOrderId,
      productionOrderExternalId,
      externalSalesOrderId: link.externalSalesOrderId,
      externalSalesOrderItemId: link.externalSalesOrderItemId,
      itemNumber: link.itemNumber,
      customerName: link.customerName,
      linkedQuantity: link.linkedQuantity,
      rawJson: link.rawJson as Prisma.InputJsonValue,
      salesOrderId,
      salesOrderItemId,
      isCurrent: true,
      removedAt: null as Date | null,
      lastSeenAt: syncedAt,
    };

    if (existing) {
      const wasAbsent = existing.isCurrent === false;
      await db.nomusProductionOrderSalesLink.update({
        where: { id: existing.id },
        data: linkData,
      });
      linksUpdated += 1;
      if (wasAbsent) linksReactivated += 1;
    } else {
      await db.nomusProductionOrderSalesLink.create({
        data: {
          ...linkData,
          firstSeenAt: syncedAt,
        },
      });
      linksCreated += 1;
    }
  }

  const absentWhere: Prisma.NomusProductionOrderSalesLinkWhereInput = {
    productionOrderId,
    isCurrent: true,
    ...(payloadItemIds.length > 0
      ? { externalSalesOrderItemId: { notIn: payloadItemIds } }
      : {}),
  };

  const marked = await db.nomusProductionOrderSalesLink.updateMany({
    where: absentWhere,
    data: {
      isCurrent: false,
      removedAt: syncedAt,
      lastSeenAt: syncedAt,
    },
  });

  return {
    linksCreated,
    linksUpdated,
    linksReactivated,
    linksMarkedAbsent: marked.count,
    salesOrderResolved,
    salesOrderItemResolved,
  };
}

/**
 * Reconciliia FKs locais em vínculos que ainda não encontraram SalesOrder / SalesOrderItem.
 * Útil após sync de pedidos: preenche salesOrderId / salesOrderItemId sem alterar pedidos.
 */
export async function reconcilePendingNomusProductionOrderSalesLinks(
  db: DbClient,
  options?: {
    limit?: number;
    productionOrderExternalIds?: number[];
    externalSalesOrderIds?: number[];
  }
): Promise<ReconcilePendingNomusProductionOrderSalesLinksResult> {
  const limit =
    options?.limit != null && Number.isFinite(options.limit) && options.limit > 0
      ? Math.trunc(options.limit)
      : 500;

  const pending = await db.nomusProductionOrderSalesLink.findMany({
    where: {
      OR: [{ salesOrderId: null }, { salesOrderItemId: null }],
      ...(options?.productionOrderExternalIds?.length
        ? { productionOrderExternalId: { in: options.productionOrderExternalIds } }
        : {}),
      ...(options?.externalSalesOrderIds?.length
        ? { externalSalesOrderId: { in: options.externalSalesOrderIds } }
        : {}),
    },
    select: {
      id: true,
      externalSalesOrderId: true,
      externalSalesOrderItemId: true,
      salesOrderId: true,
      salesOrderItemId: true,
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  let salesOrderResolved = 0;
  let salesOrderItemResolved = 0;
  let updated = 0;

  for (const link of pending) {
    let salesOrderId = link.salesOrderId;
    let salesOrderItemId = link.salesOrderItemId;
    let changed = false;

    if (!salesOrderId) {
      salesOrderId = await resolveLocalSalesOrderIdByNomusExternalId(
        db,
        link.externalSalesOrderId
      );
      if (salesOrderId) {
        salesOrderResolved += 1;
        changed = true;
      }
    }

    if (!salesOrderItemId) {
      const resolvedItem = await resolveLocalSalesOrderItemIdByNomusExternalId(
        db,
        link.externalSalesOrderItemId,
        salesOrderId
      );
      if (resolvedItem) {
        salesOrderItemId = resolvedItem;
        salesOrderItemResolved += 1;
        changed = true;
      }
    }

    if (!changed) continue;

    await db.nomusProductionOrderSalesLink.update({
      where: { id: link.id },
      data: {
        salesOrderId,
        salesOrderItemId,
      },
    });
    updated += 1;
  }

  return {
    scanned: pending.length,
    salesOrderResolved,
    salesOrderItemResolved,
    updated,
  };
}
