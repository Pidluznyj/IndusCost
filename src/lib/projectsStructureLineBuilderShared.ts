import type {
  ProjectStructureLineType,
  ProjectStructureSourceType,
} from "@/src/types/projects.js";
import {
  calculateStructureLineTotalCost,
  sanitizeFinite,
  toFiniteNumber,
} from "./projectsCalculations.js";

export type ProjectStructureLineMaterialRef = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category?: string | null;
  supplier?: string | null;
  currentCost?: number | null;
  averageCost?: number | null;
  standardCost?: number | null;
  standardLoss?: number | null;
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
    quotedUnitCost?: number | null;
    estimatedUnitCost?: number | null;
    supplierName?: string | null;
  } | null;
};

export class ProjectStructureLineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStructureLineValidationError";
  }
}

export function buildStructureLineTotal(
  quantity: number,
  unitCost: number,
  lossPercent?: number | null
): number {
  const total = calculateStructureLineTotalCost(quantity, unitCost, lossPercent ?? 0);
  return sanitizeFinite(total) ?? 0;
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
  if (material?.standardLoss == null) return 0;
  return sanitizeFinite(toFiniteNumber(material.standardLoss)) ?? 0;
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

export function previewProjectStructureLineTotal(
  quantity: number,
  unitCost: number,
  lossPercent: number
): number {
  return buildStructureLineTotal(quantity, unitCost, lossPercent);
}
