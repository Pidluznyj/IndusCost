/**
 * Carga em lote do preço Varejo 1 publicado e do custo industrial vigente.
 * Reutiliza a resolução de vigência da Tabela comercial e da tabela de custo de produção.
 * Não recalcula preço, margem, BOM nem custo.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { resolvePublishedPriceTableVersionForDate } from "@/src/lib/priceTablePublication.server.js";
import { resolvePublishedProductionCostTableVersionForDate } from "@/src/lib/priceTableProductionCostResolver.js";
import {
  INVENTORY_INDUSTRIAL_COST_UNAVAILABLE,
  INVENTORY_RETAIL_VALUATION_UNAVAILABLE,
  INVENTORY_VAREJO_1_TABLE_CODE,
  indexUnitAmountByProductId,
} from "./inventoryManagerialValuation.js";

export type InventoryValuationUnitPrices = {
  retailPriceByProductId: Map<string, Prisma.Decimal | null> | null;
  industrialCostByProductId: Map<string, Prisma.Decimal | null> | null;
  retailUnavailableReason: string | null;
  industrialUnavailableReason: string | null;
};

type ValuationDb = Pick<
  PrismaClient,
  "priceTable" | "priceTableVersion" | "priceTableItem" | "productionCostTableVersion"
>;

export async function loadInventoryValuationUnitPrices(
  db: ValuationDb,
  productIds: readonly string[],
  referenceDate: Date
): Promise<InventoryValuationUnitPrices> {
  const uniqueProductIds = [...new Set(productIds.filter((id) => id.trim().length > 0))];

  const table = await db.priceTable.findUnique({
    where: { code: INVENTORY_VAREJO_1_TABLE_CODE },
    select: { id: true, status: true },
  });

  let retailPriceByProductId: Map<string, Prisma.Decimal | null> | null = null;
  let retailUnavailableReason: string | null = null;

  if (!table || table.status !== "ACTIVE") {
    retailUnavailableReason = INVENTORY_RETAIL_VALUATION_UNAVAILABLE;
  } else {
    const version = await resolvePublishedPriceTableVersionForDate(db as PrismaClient, table.id, referenceDate);
    if (!version) {
      retailUnavailableReason = INVENTORY_RETAIL_VALUATION_UNAVAILABLE;
    } else {
      const rows =
        uniqueProductIds.length === 0
          ? []
          : await db.priceTableItem.findMany({
              where: {
                priceTableVersionId: version.id,
                productId: { in: uniqueProductIds },
              },
              select: { productId: true, salePrice: true },
            });
      retailPriceByProductId = indexUnitAmountByProductId(
        rows.map((row) => ({ productId: row.productId, amount: row.salePrice }))
      );
    }
  }

  const costVersion = await resolvePublishedProductionCostTableVersionForDate(
    db as PrismaClient,
    referenceDate
  );

  let industrialCostByProductId: Map<string, Prisma.Decimal | null> | null = null;
  let industrialUnavailableReason: string | null = null;
  if (!costVersion) {
    industrialUnavailableReason = INVENTORY_INDUSTRIAL_COST_UNAVAILABLE;
  } else {
    const wanted = new Set(uniqueProductIds);
    industrialCostByProductId = indexUnitAmountByProductId(
      costVersion.items
        .filter((item) => wanted.has(item.productId))
        .map((item) => ({ productId: item.productId, amount: item.unitProductionCost }))
    );
  }

  return {
    retailPriceByProductId,
    industrialCostByProductId,
    retailUnavailableReason,
    industrialUnavailableReason,
  };
}
