/**
 * Margem geral ponderada da listagem — mesma população filtrada do GET /api/sales-orders,
 * mas fora do caminho crítico da página (evita travar a tela).
 *
 * Card: filtros completos da tela (inclui mês/cliente/vendedor/…).
 * Série mensal do gráfico: população anual canônica OP-02 do ano corrente,
 * sem nenhum filtro da tela (apenas exclusões oficiais: CANCELLED, presença Nomus, etc.).
 */
import type { PrismaClient } from "@prisma/client";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { resolveSalesOrderOperationalPopulationWhere } from "./salesOrderOperationalPopulation.server.js";
import { buildOfficialSalesOrderListMarginSummary } from "./salesMarginRulesAdapter.js";
import { SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT } from "./salesOrderMarginService.server.js";
import type { SalesOrderListMarginSummary } from "./salesOrderListMarginSummary.js";
import type { SalesOrderForMargin } from "./salesOrderMarginService.server.js";

/** Ano civil dinâmico para os gráficos mensais (independente dos filtros da tela). */
export function resolveSalesOrderListChartsCalendarYear(
  referenceDate: Date = new Date()
): number {
  return referenceDate.getFullYear();
}

/**
 * População elegível do gráfico de margem mensal: ano civil, sem filtros de UI.
 */
export async function loadSalesOrderListChartYearOrders(
  db: PrismaClient,
  year: number
): Promise<SalesOrderForMargin[]> {
  const where = await resolveSalesOrderOperationalPopulationWhere(db, {
    listFilters: { year, month: null },
    context: "OPERATIONAL",
  });
  return db.salesOrder.findMany({
    where,
    select: SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT,
  });
}

export async function loadSalesOrderListMarginSummary(
  db: PrismaClient,
  query: Record<string, unknown>,
  options?: { referenceDate?: Date }
): Promise<SalesOrderListMarginSummary> {
  const listQuery = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const where = await resolveSalesOrderListWhere(db, listQuery, sellerWhere);
  const chartYear = resolveSalesOrderListChartsCalendarYear(
    options?.referenceDate ?? new Date()
  );
  // Card (população filtrada) e série mensal (população anual) são leituras
  // independentes — em paralelo, sem alterar nenhuma das duas populações.
  const [marginOrders, ordersForMonthlySeries] = await Promise.all([
    // População filtrada do card — select SUMMARY (sem JSON Nomus em massa).
    db.salesOrder.findMany({
      where,
      select: SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT,
    }),
    loadSalesOrderListChartYearOrders(db, chartYear),
  ]);

  return buildOfficialSalesOrderListMarginSummary(db, marginOrders, {
    year: chartYear,
    ordersForMonthlySeries,
  });
}
