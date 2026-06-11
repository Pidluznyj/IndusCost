import type { Prisma } from "@prisma/client";
import type {
  ProjectStructureLineType,
  ProjectStructureSourceType,
} from "@/src/types/projects.js";
import {
  buildStructureLineTotal,
  resolveStructureLineSnapshots,
} from "./projectsService.js";
import { sanitizeFinite, toFiniteNumber } from "./projectsCalculations.js";

export type ProjectStructureLineMaterialRef = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category?: string | null;
  supplier?: string | null;
  currentCost: Prisma.Decimal | number | null;
  averageCost?: Prisma.Decimal | number | null;
  standardCost?: Prisma.Decimal | number | null;
  standardLoss?: Prisma.Decimal | number | null;
};

export type ProjectStructureLineCreateContext = {
  sourceType: ProjectStructureSourceType;
  lineType?: ProjectStructureLineType;
  quantity: number;
  lossPercent: number;
  unitCostOverride?: number | null;
  manualDescription?: string;
  manualUnit?: string;
  manualUnitCost?: number;
  supplierName?: string | null;
  existingProduct?: { name: string; sku: string } | null;
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

export class ProjectStructureLineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStructureLineValidationError";
  }
}

function dec(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "object" && "toNumber" in value) return value.toNumber();
  return Number(value);
}

export function resolveProjectStructureLineCostSource(sourceType: string): string {
  switch (sourceType) {
    case "EXISTING_MATERIAL":
      return "MATERIAL_CURRENT_COST";
    case "EXISTING_PRODUCT":
      return "OFFICIAL_PRODUCT_REFERENCE";
    case "SIMULATED_ITEM":
      return "PROJECT_SIMULATED_ITEM";
    case "MANUAL":
      return "MANUAL_PROJECT_ENTRY";
    default:
      return "MANUAL_PROJECT_ENTRY";
  }
}

export function resolveMaterialDefaultLossPercent(
  material: Pick<ProjectStructureLineMaterialRef, "standardLoss"> | null | undefined
): number {
  if (!material?.standardLoss) return 0;
  return sanitizeFinite(toFiniteNumber(dec(material.standardLoss))) ?? 0;
}

export function validateProjectStructureLineCreate(
  ctx: Pick<
    ProjectStructureLineCreateContext,
    | "sourceType"
    | "quantity"
    | "existingProduct"
    | "existingMaterial"
    | "simulatedItem"
    | "manualDescription"
  >
): void {
  const qty = toFiniteNumber(ctx.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ProjectStructureLineValidationError("Informe quantidade ou peso maior que zero.");
  }

  switch (ctx.sourceType) {
    case "EXISTING_MATERIAL":
      if (!ctx.existingMaterial) {
        throw new ProjectStructureLineValidationError("Selecione uma matéria-prima da base.");
      }
      break;
    case "EXISTING_PRODUCT":
      if (!ctx.existingProduct) {
        throw new ProjectStructureLineValidationError("Selecione um produto existente.");
      }
      break;
    case "SIMULATED_ITEM":
      if (!ctx.simulatedItem) {
        throw new ProjectStructureLineValidationError("Selecione um componente do projeto.");
      }
      break;
    case "MANUAL":
      if (!ctx.manualDescription?.trim()) {
        throw new ProjectStructureLineValidationError("Informe a descrição da linha manual.");
      }
      break;
    default:
      throw new ProjectStructureLineValidationError("Tipo de origem inválido.");
  }
}

export function buildProjectStructureLineFromContext(
  ctx: ProjectStructureLineCreateContext
): ProjectStructureLineBuilt {
  validateProjectStructureLineCreate(ctx);

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

export function previewProjectStructureLineTotal(
  quantity: number,
  unitCost: number,
  lossPercent: number
): number {
  return buildStructureLineTotal(quantity, unitCost, lossPercent);
}
