/**
 * Carga da posição de estoque. Somente leitura.
 * Reusa a vigência do Varejo 1 e da tabela oficial de matéria-prima.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  loadInventoryMaterialFrozenCosts,
  loadInventoryValuationUnitPrices,
} from "./inventoryManagerialValuation.server.js";
import {
  buildInventoryPositionReport,
  type InventoryPositionReport,
  type InventoryPositionReportSourceLine,
} from "./inventoryPositionReport.js";

function toDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value == null || value === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(String(value));
}

export async function loadInventoryPositionReport(
  db: PrismaClient,
  referenceDate = new Date()
): Promise<InventoryPositionReport> {
  const balances = await db.inventoryBalance.findMany({
    select: {
      physicalQuantity: true,
      item: {
        select: {
          id: true,
          code: true,
          description: true,
          unit: true,
          itemType: true,
          productId: true,
          materialId: true,
        },
      },
    },
  });

  const lines: InventoryPositionReportSourceLine[] = balances.map((row) => ({
    itemId: row.item.id,
    itemType: row.item.itemType,
    code: row.item.code,
    description: row.item.description,
    unit: row.item.unit,
    productId: row.item.productId,
    materialId: row.item.materialId,
    physicalQuantity: toDecimal(row.physicalQuantity),
  }));

  const productIds = lines
    .filter(
      (line) =>
        line.physicalQuantity.gt(0) &&
        (line.itemType === "FINISHED_PRODUCT" || line.itemType === "COMPONENT") &&
        Boolean(line.productId)
    )
    .map((line) => line.productId as string);
  const materialIds = lines
    .filter(
      (line) => line.physicalQuantity.gt(0) && line.itemType === "RAW_MATERIAL" && Boolean(line.materialId)
    )
    .map((line) => line.materialId as string);

  const [prices, materialCosts] = await Promise.all([
    loadInventoryValuationUnitPrices(db, productIds, referenceDate),
    loadInventoryMaterialFrozenCosts(db, materialIds, referenceDate),
  ]);

  return buildInventoryPositionReport({
    lines,
    generatedAt: referenceDate,
    retailPriceByProductId: prices.retailPriceByProductId,
    factoryCostByProductId: prices.industrialCostByProductId,
    materialCostByMaterialId: materialCosts.supplyCostByMaterialId,
    retailUnavailableReason: prices.retailUnavailableReason,
    factoryCostUnavailableReason: prices.industrialUnavailableReason,
    materialCostUnavailableReason: materialCosts.supplyCostUnavailableReason,
  });
}
