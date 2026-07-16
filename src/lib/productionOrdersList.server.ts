/**
 * Service — listagem paginada de Ordens de Produção (OP-16).
 * Somente leitura do PostgreSQL local — sem Nomus.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildProductionOrderLinkAggregates,
  buildProductionOrdersListResponse,
  buildProductionOrdersListWhere,
  buildProductionOrdersStatusCounts,
  PRODUCTION_ORDERS_GRID_SELECT,
  productionOrdersListOrderBy,
  serializeProductionOrderGridRow,
  type ProductionOrdersListResponse,
} from "@/src/lib/productionOrdersList.js";
import type { ProductionOrdersListQuery } from "@/src/lib/productionOrdersListQuery.js";

export async function listProductionOrdersForGrid(
  db: PrismaClient,
  query: ProductionOrdersListQuery
): Promise<ProductionOrdersListResponse> {
  const where = buildProductionOrdersListWhere(query);

  const [headers, total, statusGroups] = await Promise.all([
    db.nomusProductionOrder.findMany({
      where,
      select: PRODUCTION_ORDERS_GRID_SELECT,
      orderBy: productionOrdersListOrderBy(),
      skip: query.skip,
      take: query.pageSize,
    }),
    db.nomusProductionOrder.count({ where }),
    db.nomusProductionOrder.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  const productionOrderIds = headers.map((row) => row.id);
  const links =
    productionOrderIds.length === 0
      ? []
      : await db.nomusProductionOrderSalesLink.findMany({
          where: { productionOrderId: { in: productionOrderIds } },
          select: {
            productionOrderId: true,
            isCurrent: true,
            externalSalesOrderId: true,
            customerName: true,
            salesOrderId: true,
            salesOrderItemId: true,
            SalesOrder: { select: { orderCode: true } },
          },
          orderBy: [{ isCurrent: "desc" }, { lastSeenAt: "desc" }],
        });

  const linkAggregates = buildProductionOrderLinkAggregates(
    links.map((link) => ({
      productionOrderId: link.productionOrderId,
      isCurrent: link.isCurrent,
      externalSalesOrderId: link.externalSalesOrderId,
      customerName: link.customerName,
      salesOrderId: link.salesOrderId,
      salesOrderItemId: link.salesOrderItemId,
      orderCode: link.SalesOrder?.orderCode ?? null,
    }))
  );

  const rows = headers.map((header) =>
    serializeProductionOrderGridRow(header, linkAggregates.get(header.id))
  );

  return buildProductionOrdersListResponse({
    rows,
    query,
    total,
    statusCounts: buildProductionOrdersStatusCounts(statusGroups),
  });
}
