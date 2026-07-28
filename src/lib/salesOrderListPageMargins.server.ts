/**
 * Margens da página atual da listagem — fora do GET /api/sales-orders.
 * A grade carrega sem motor de margem; este endpoint preenche a coluna depois.
 */
import type { PrismaClient } from "@prisma/client";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import {
  attachMarginsToSalesOrders,
  SALES_ORDER_LIST_MARGIN_PRISMA_SELECT,
} from "./salesOrderMarginService.server.js";
import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";

export type SalesOrderListPageMarginRow = {
  orderId: string;
  marginSummary?: SalesOrderMarginSummaryPayload;
  marginItems?: SalesOrderItemMarginPayload[];
};

export async function loadSalesOrderListPageMargins(
  db: PrismaClient,
  query: Record<string, unknown>
): Promise<SalesOrderListPageMarginRow[]> {
  const listQuery = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const where = await resolveSalesOrderListWhere(db, listQuery, sellerWhere);
  const skip = (listQuery.page - 1) * listQuery.pageSize;
  const rows = await db.salesOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { issueDate: "desc" }],
    skip,
    take: listQuery.pageSize,
    select: SALES_ORDER_LIST_MARGIN_PRISMA_SELECT,
  });
  const withMargins = await attachMarginsToSalesOrders(db, rows);
  return withMargins.map((order) => ({
    orderId: order.id,
    marginSummary: order.marginSummary,
    marginItems: order.marginItems,
  }));
}
