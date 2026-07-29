/**
 * Margem geral ponderada da listagem — mesma população filtrada do GET /api/sales-orders,
 * mas fora do caminho crítico da página (evita travar a tela).
 *
 * Card: filtros completos (inclui mês).
 * Série mensal do gráfico: mesmos filtros sem `month` (ano YTD).
 */
import type { PrismaClient } from "@prisma/client";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { buildOfficialSalesOrderListMarginSummary } from "./salesMarginRulesAdapter.js";
import { SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT } from "./salesOrderMarginService.server.js";
import type { SalesOrderListMarginSummary } from "./salesOrderListMarginSummary.js";

export async function loadSalesOrderListMarginSummary(
  db: PrismaClient,
  query: Record<string, unknown>
): Promise<SalesOrderListMarginSummary> {
  const listQuery = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const where = await resolveSalesOrderListWhere(db, listQuery, sellerWhere);
  // População completa filtrada — select SUMMARY (sem JSON Nomus em massa).
  const marginOrders = await db.salesOrder.findMany({
    where,
    select: SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT,
  });

  const year = listQuery.year ?? new Date().getFullYear();

  let ordersForMonthlySeries = marginOrders;
  if (listQuery.month != null) {
    const yearWideQuery = { ...listQuery, month: null };
    const yearWideWhere = await resolveSalesOrderListWhere(
      db,
      yearWideQuery,
      sellerWhere
    );
    ordersForMonthlySeries = await db.salesOrder.findMany({
      where: yearWideWhere,
      select: SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT,
    });
  }

  return buildOfficialSalesOrderListMarginSummary(db, marginOrders, {
    year,
    ordersForMonthlySeries,
  });
}
