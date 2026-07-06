import type { Prisma } from "@prisma/client";
import type { ProjectStructureLineType } from "@/src/types/projects.js";
import {
  buildStructureLineTotal,
  previewProjectStructureLineTotal,
  ProjectStructureLineValidationError,
  resolveMaterialDefaultLossPercent,
  resolveProjectStructureLineCostSource,
  validateProjectStructureLineCreate,
  type ProjectStructureLineCreateContext as SharedCreateContext,
  type ProjectStructureLineMaterialRef as SharedMaterialRef,
} from "./projectsStructureLineBuilderShared.js";
import { resolveStructureLineSnapshots } from "./projectsService.js";
import { sanitizeFinite, toFiniteNumber } from "./projectsCalculations.js";

export {
  previewProjectStructureLineTotal,
  ProjectStructureLineValidationError,
  resolveMaterialDefaultLossPercent,
  resolveProjectStructureLineCostSource,
  validateProjectStructureLineCreate,
};

export type ProjectStructureLineMaterialRef = Omit<
  SharedMaterialRef,
  "currentCost" | "averageCost" | "standardCost" | "standardLoss"
> & {
  currentCost: Prisma.Decimal | number | null;
  averageCost?: Prisma.Decimal | number | null;
  standardCost?: Prisma.Decimal | number | null;
  standardLoss?: Prisma.Decimal | number | null;
};

export type ProjectStructureLineCreateContext = Omit<
  SharedCreateContext,
  "existingMaterial" | "simulatedItem"
> & {
  existingMaterial?: ProjectStructureLineMaterialRef | null;
  simulatedItem?: {
    description: string;
    unit: string;
    quotedUnitCost: Prisma.Decimal | number | null;
    estimatedUnitCost: Prisma.Decimal | number | null;
    supplierName?: string | null;
  } | null;
};

export type ProjectStructureLineBuilt = {
  lineType: ProjectStructureLineType;
  descriptionSnapshot: string;
  unitSnapshot: string;
  unitCostSnapshot: number;
  totalCost: number;
  costSource: string;
  isMissingCost: boolean;
  supplierNameSnapshot: string | null;
  countsInSimulatedProductCost: boolean;
};

function dec(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "object" && "toNumber" in value) return value.toNumber();
  return Number(value);
}

export function buildProjectStructureLineFromContext(
  ctx: ProjectStructureLineCreateContext
): ProjectStructureLineBuilt {
  validateProjectStructureLineCreate({
    sourceType: ctx.sourceType,
    quantity: ctx.quantity,
    existingProduct: ctx.existingProduct,
    existingMaterial: ctx.existingMaterial
      ? {
          id: ctx.existingMaterial.id,
          code: ctx.existingMaterial.code,
          description: ctx.existingMaterial.description,
          unit: ctx.existingMaterial.unit,
        }
      : null,
    simulatedItem: ctx.simulatedItem
      ? {
          description: ctx.simulatedItem.description,
          unit: ctx.simulatedItem.unit,
        }
      : null,
    manualDescription: ctx.manualDescription,
  });

  const snapshots = resolveStructureLineSnapshots({
    sourceType: ctx.sourceType,
    existingProduct: ctx.existingProduct,
    existingMaterial: ctx.existingMaterial
      ? {
          code: ctx.existingMaterial.code,
          description: ctx.existingMaterial.description,
          unit: ctx.existingMaterial.unit,
          currentCost: ctx.existingMaterial.currentCost as Prisma.Decimal,
        }
      : null,
    simulatedItem: ctx.simulatedItem as never,
    manualDescription: ctx.manualDescription,
    manualUnit: ctx.manualUnit,
    manualUnitCost: ctx.manualUnitCost,
  });

  const unitCostSnapshot =
    ctx.unitCostOverride != null && Number.isFinite(ctx.unitCostOverride)
      ? toFiniteNumber(ctx.unitCostOverride)
      : snapshots.unitCost;

  const lossPercent = toFiniteNumber(ctx.lossPercent) ?? 0;
  const quantity = toFiniteNumber(ctx.quantity) ?? 0;
  const totalCost = buildStructureLineTotal(quantity, unitCostSnapshot, lossPercent);
  const isMissingCost = !Number.isFinite(unitCostSnapshot) || unitCostSnapshot <= 0;

  const supplierNameSnapshot =
    ctx.supplierName?.trim() ||
    ctx.existingMaterial?.supplier?.trim() ||
    ctx.simulatedItem?.supplierName?.trim() ||
    null;

  const lineType =
    ctx.lineType ??
    (ctx.sourceType === "EXISTING_MATERIAL"
      ? "RAW_MATERIAL"
      : ctx.sourceType === "EXISTING_PRODUCT"
        ? "COMPONENT"
        : ctx.sourceType === "SIMULATED_ITEM"
          ? "COMPONENT"
          : "OTHER");

  return {
    lineType,
    descriptionSnapshot: snapshots.description,
    unitSnapshot: snapshots.unit,
    unitCostSnapshot: sanitizeFinite(unitCostSnapshot) ?? 0,
    totalCost,
    costSource: isMissingCost ? "MISSING" : resolveProjectStructureLineCostSource(ctx.sourceType),
    isMissingCost,
    supplierNameSnapshot,
    countsInSimulatedProductCost: true,
  };
}
