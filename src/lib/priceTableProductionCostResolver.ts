/**
 * Resolução de custo de produção publicado para geração de tabela de preço comercial.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";

export const PRICE_TABLE_PRODUCTION_COST_SOURCE = "VERSIONED_PRODUCTION_COST_TABLE" as const;

export const NO_PUBLISHED_PRODUCTION_COST_TABLE_MESSAGE =
  "Não existe tabela oficial de custo de produção publicada vigente para esta data.";

export type PublishedProductionCostItemSnapshot = {
  productionCostTableItemId: string;
  productId: string;
  productCode: string;
  productName: string;
  unitProductionCost: number;
  materialCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  processCost: number;
  otherCost: number;
  calculationHash: string | null;
  calculationSnapshot: unknown;
};

export type ProductionCostTableSourcePreview = {
  available: boolean;
  message: string | null;
  productionCostTableVersionId: string | null;
  productionCostTableVersionCode: string | null;
  revision: number | null;
  effectiveDate: string | null;
  itemsCount: number;
  name: string | null;
};

function decimalToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapProductionCostTableItemToPriceSnapshot(row: {
  id: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitProductionCost: unknown;
  materialCost: unknown;
  processCost: unknown;
  laborCost: unknown;
  machineCost: unknown;
  overheadCost: unknown;
  otherCost: unknown;
  calculationHash: string | null;
  calculationSnapshot: unknown;
}): PublishedProductionCostItemSnapshot {
  return {
    productionCostTableItemId: row.id,
    productId: row.productId,
    productCode: row.productCodeSnapshot,
    productName: row.productNameSnapshot,
    unitProductionCost: decimalToNumber(row.unitProductionCost),
    materialCost: decimalToNumber(row.materialCost),
    laborCost: decimalToNumber(row.laborCost),
    machineCost: decimalToNumber(row.machineCost),
    overheadCost: decimalToNumber(row.overheadCost),
    processCost: decimalToNumber(row.processCost),
    otherCost: decimalToNumber(row.otherCost),
    calculationHash: row.calculationHash,
    calculationSnapshot: row.calculationSnapshot,
  };
}

export async function resolvePublishedProductionCostTableVersionForDate(
  db: PrismaClient,
  referenceDate: Date
) {
  const ref = startOfCivilDate(referenceDate);
  return db.productionCostTableVersion.findFirst({
    where: {
      status: "PUBLISHED",
      effectiveDate: { lte: ref },
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { publishedAt: "desc" }],
    include: {
      items: true,
    },
  });
}

export async function previewProductionCostTableSourceForPriceDraft(
  db: PrismaClient,
  referenceDate: Date
): Promise<ProductionCostTableSourcePreview> {
  const version = await resolvePublishedProductionCostTableVersionForDate(db, referenceDate);
  if (!version) {
    return {
      available: false,
      message: NO_PUBLISHED_PRODUCTION_COST_TABLE_MESSAGE,
      productionCostTableVersionId: null,
      productionCostTableVersionCode: null,
      revision: null,
      effectiveDate: null,
      itemsCount: 0,
      name: null,
    };
  }
  return {
    available: version.items.length > 0,
    message:
      version.items.length > 0
        ? null
        : "Tabela de custo de produção publicada existe, mas não possui itens.",
    productionCostTableVersionId: version.id,
    productionCostTableVersionCode: version.code,
    revision: version.revision,
    effectiveDate: toCivilDateKey(version.effectiveDate),
    itemsCount: version.items.length,
    name: version.name,
  };
}

export function buildProductionCostItemsByProductId(
  items: Array<{
    id: string;
    productId: string;
    productCodeSnapshot: string;
    productNameSnapshot: string;
    unitProductionCost: unknown;
    materialCost: unknown;
    processCost: unknown;
    laborCost: unknown;
    machineCost: unknown;
    overheadCost: unknown;
    otherCost: unknown;
    calculationHash: string | null;
    calculationSnapshot: unknown;
  }>
): Map<string, PublishedProductionCostItemSnapshot> {
  const map = new Map<string, PublishedProductionCostItemSnapshot>();
  for (const row of items) {
    map.set(row.productId, mapProductionCostTableItemToPriceSnapshot(row));
  }
  return map;
}

export function buildPriceTableCostSnapshotJson(input: {
  productionCostTableVersionId: string;
  productionCostTableVersionCode: string;
  revision: number;
  effectiveDate: string;
  item: PublishedProductionCostItemSnapshot;
}) {
  return {
    costSource: PRICE_TABLE_PRODUCTION_COST_SOURCE,
    productionCostTableVersionId: input.productionCostTableVersionId,
    productionCostTableVersionCode: input.productionCostTableVersionCode,
    revision: input.revision,
    effectiveDate: input.effectiveDate,
    productionCostTableItemId: input.item.productionCostTableItemId,
    productId: input.item.productId,
    unitProductionCost: input.item.unitProductionCost,
    breakdown: {
      materialCost: input.item.materialCost,
      laborCost: input.item.laborCost,
      machineCost: input.item.machineCost,
      overheadCost: input.item.overheadCost,
      processCost: input.item.processCost,
      otherCost: input.item.otherCost,
    },
    calculationHash: input.item.calculationHash,
    calculationSnapshot: input.item.calculationSnapshot,
  };
}
