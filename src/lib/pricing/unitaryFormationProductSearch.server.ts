/**
 * Persistência read-only da busca de produtos da Formação de Preço Unitária.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildUnitaryFormationProductSearchResponse,
  buildUnitaryFormationProductSearchWhere,
  rankUnitaryFormationProductSearchResults,
  UNITARY_FORMATION_PRODUCT_SEARCH_CANDIDATE_CAP,
  type UnitaryFormationProductSearchQuery,
  type UnitaryFormationProductSearchResponse,
} from "./unitaryFormationProductSearch.js";

export async function searchUnitaryFormationProducts(
  db: PrismaClient,
  query: UnitaryFormationProductSearchQuery
): Promise<UnitaryFormationProductSearchResponse> {
  const where = buildUnitaryFormationProductSearchWhere(query.q);
  const rows = await db.product.findMany({
    where: where as never,
    select: {
      id: true,
      sku: true,
      name: true,
      type: true,
      status: true,
    },
    orderBy: { sku: "asc" },
    take: UNITARY_FORMATION_PRODUCT_SEARCH_CANDIDATE_CAP,
  });

  const results = rankUnitaryFormationProductSearchResults(
    rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      type: row.type === "COMPONENT" ? "COMPONENT" : "PRODUCT",
      status: row.status ?? null,
    })),
    query.q,
    query.limit
  );

  return buildUnitaryFormationProductSearchResponse(query.q, query.limit, results);
}
