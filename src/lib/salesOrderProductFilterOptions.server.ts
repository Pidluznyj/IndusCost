/**
 * Opções do filtro de produto (tela Resultado de Pedidos de Venda): produtos que
 * já aparecem em itens de pedido de venda, buscando por SKU ou nome.
 * 1 query (EXISTS em SalesOrderItem pelo índice de productId), somente leitura.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildSalesOrderProductFilterSearchWhere,
  parseSalesOrderProductFilterSearch,
  type SalesOrderProductFilterOption,
} from "./salesOrderProductFilter.js";

export async function searchSalesOrderProductFilterOptions(
  db: Pick<PrismaClient, "product">,
  query: Record<string, unknown>
): Promise<SalesOrderProductFilterOption[]> {
  const search = parseSalesOrderProductFilterSearch(query);
  if (!search) return [];
  const products = await db.product.findMany({
    where: buildSalesOrderProductFilterSearchWhere(search.term),
    select: { id: true, sku: true, name: true },
    orderBy: [{ sku: "asc" }],
    take: search.limit,
  });
  return products.map((product) => ({
    productId: product.id,
    sku: product.sku,
    name: product.name,
  }));
}
