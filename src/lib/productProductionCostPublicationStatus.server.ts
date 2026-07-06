/**
 * Status de publicação de custo oficial por produto — reutiliza resolver e DRAFT existentes.
 */
import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "./financeCivilDate.js";
import { getEffectiveProductProductionCost } from "./productionCostTables.server.js";
import {
  computeProductionCostPublicationDifference,
  type ProductProductionCostPublicationStatus,
  type ProductionCostPublicationCostSlice,
} from "./productProductionCostPublicationStatus.js";
import {
  resolveProductEngineeringCostWarning,
  type ProductEngineeringCostWarningResult,
} from "./productEngineeringCostWarning.js";

function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

function mapItemToSlice(
  version: {
    id: string;
    code: string;
    status: string;
    revision: number;
    effectiveDate: Date;
  },
  item: {
    unitProductionCost: unknown;
    materialCost: unknown;
    laborCost: unknown;
    machineCost: unknown;
    overheadCost: unknown;
    otherCost: unknown;
    calculationHash: string | null;
  }
): ProductionCostPublicationCostSlice {
  return {
    versionId: version.id,
    versionCode: version.code,
    revision: version.revision,
    status: version.status,
    effectiveDate: toCivilDateKey(version.effectiveDate),
    unitProductionCost: decimalToNumber(item.unitProductionCost),
    materialCost: decimalToNumber(item.materialCost),
    laborCost: decimalToNumber(item.laborCost),
    machineCost: decimalToNumber(item.machineCost),
    overheadCost: decimalToNumber(item.overheadCost),
    otherCost: decimalToNumber(item.otherCost),
    calculationHash: item.calculationHash ?? null,
  };
}

export async function getProductProductionCostPublicationStatus(
  db: PrismaClient,
  productId: string,
  referenceDate: Date = new Date()
): Promise<ProductProductionCostPublicationStatus | null> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true },
  });
  if (!product) return null;

  const draftItem = await db.productionCostTableItem.findFirst({
    where: { productId, costTableVersion: { status: "DRAFT" } },
    orderBy: [{ createdAt: "desc" }],
    include: {
      costTableVersion: {
        select: {
          id: true,
          code: true,
          status: true,
          revision: true,
          effectiveDate: true,
        },
      },
    },
  });

  const effective = await getEffectiveProductProductionCost(db, productId, referenceDate);

  let officialCost: ProductionCostPublicationCostSlice | null = null;
  if (effective.status === "OK") {
    const pubItem = await db.productionCostTableItem.findUnique({
      where: { id: effective.costTableItemId },
      select: {
        unitProductionCost: true,
        materialCost: true,
        laborCost: true,
        machineCost: true,
        overheadCost: true,
        otherCost: true,
        calculationHash: true,
        costTableVersion: {
          select: {
            id: true,
            code: true,
            status: true,
            revision: true,
            effectiveDate: true,
          },
        },
      },
    });
    if (pubItem) {
      officialCost = mapItemToSlice(pubItem.costTableVersion, pubItem);
    }
  }

  const pendingDraft =
    draftItem?.costTableVersion.status === "DRAFT"
      ? mapItemToSlice(draftItem.costTableVersion, draftItem)
      : null;

  const difference = pendingDraft
    ? computeProductionCostPublicationDifference(
        officialCost?.unitProductionCost ?? null,
        pendingDraft.unitProductionCost
      )
    : null;

  const warning: ProductEngineeringCostWarningResult = resolveProductEngineeringCostWarning({
    officialCost: officialCost?.unitProductionCost ?? null,
    calculatedCost: pendingDraft?.unitProductionCost ?? null,
    officialHash: officialCost?.calculationHash ?? null,
    calculatedHash: pendingDraft?.calculationHash ?? null,
    hasDraft: pendingDraft != null,
    hasOfficialPublished: officialCost != null,
  });

  return {
    productId: product.id,
    sku: product.sku,
    officialCost,
    pendingDraft,
    difference,
    warning,
  };
}
