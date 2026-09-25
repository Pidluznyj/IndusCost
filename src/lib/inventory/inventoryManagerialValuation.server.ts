/**
 * Carga em lote do preço e do custo fabril congelados na Tabela Comercial Varejo 1,
 * e do custo posto congelado da tabela oficial de matéria-prima.
 * Não recalcula preço, margem, BOM nem custo. Não lê a tabela de custo de produção vigente.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "@/src/lib/financeCivilDate.js";
import { resolvePublishedPriceTableVersionForDate } from "@/src/lib/priceTablePublication.server.js";
import {
  INVENTORY_INDUSTRIAL_COST_UNAVAILABLE,
  INVENTORY_MATERIAL_COST_UNAVAILABLE,
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

type ValuationDb = Pick<PrismaClient, "priceTable" | "priceTableVersion" | "priceTableItem">;

type MaterialCostDb = Pick<PrismaClient, "materialCostTableVersion" | "materialCostTableItem">;

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
  let industrialCostByProductId: Map<string, Prisma.Decimal | null> | null = null;
  let retailUnavailableReason: string | null = null;
  let industrialUnavailableReason: string | null = null;

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
              select: { productId: true, salePrice: true, frozenTotalCost: true },
            });
      retailPriceByProductId = indexUnitAmountByProductId(
        rows.map((row) => ({ productId: row.productId, amount: row.salePrice }))
      );
      industrialCostByProductId = indexUnitAmountByProductId(
        rows.map((row) => ({ productId: row.productId, amount: row.frozenTotalCost }))
      );
    }
  }

  if (!industrialCostByProductId) {
    industrialUnavailableReason = retailUnavailableReason ?? INVENTORY_INDUSTRIAL_COST_UNAVAILABLE;
  }

  return {
    retailPriceByProductId,
    industrialCostByProductId,
    retailUnavailableReason,
    industrialUnavailableReason,
  };
}

export type InventoryMaterialFrozenCosts = {
  supplyCostByMaterialId: Map<string, Prisma.Decimal | null> | null;
  supplyCostUnavailableReason: string | null;
};

/**
 * Mesma vigência de resolvePublishedMaterialCostTableVersionForDate,
 * sem carregar a tabela inteira. O valor usado é o custo posto congelado.
 */
export async function loadInventoryMaterialFrozenCosts(
  db: MaterialCostDb,
  materialIds: readonly string[],
  referenceDate: Date
): Promise<InventoryMaterialFrozenCosts> {
  const uniqueIds = [...new Set(materialIds.filter((id) => id.trim().length > 0))];
  if (uniqueIds.length === 0) {
    return { supplyCostByMaterialId: new Map(), supplyCostUnavailableReason: null };
  }

  const version = await db.materialCostTableVersion.findFirst({
    where: {
      status: "PUBLISHED",
      effectiveDate: { lte: startOfCivilDate(referenceDate) },
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { publishedAt: "desc" }],
    select: { id: true },
  });
  if (!version) {
    return {
      supplyCostByMaterialId: null,
      supplyCostUnavailableReason: INVENTORY_MATERIAL_COST_UNAVAILABLE,
    };
  }

  const rows = await db.materialCostTableItem.findMany({
    where: {
      materialCostTableVersionId: version.id,
      materialId: { in: uniqueIds },
    },
    select: { materialId: true, landedCostSnapshot: true },
  });
  return {
    supplyCostByMaterialId: indexUnitAmountByProductId(
      rows.map((row) => ({ productId: row.materialId, amount: row.landedCostSnapshot }))
    ),
    supplyCostUnavailableReason: null,
  };
}
