/**
 * Helpers puros para publicação de custo de matéria-prima versionado.
 */
import crypto from "crypto";
import { toCivilDateKey } from "./financeCivilDate.js";
import type { MaterialCostTableDraftItemInput } from "./materialCostVersioning.js";

export const MATERIAL_COST_PUBLICATION_SOURCE = "MATERIAL_COST_TABLE_MODULE" as const;

export const MATERIAL_COST_SNAPSHOT_KIND_FROZEN = "FROZEN_AT_GENERATION" as const;

export type MaterialRowForCostSnapshot = {
  id: string;
  code: string;
  description: string;
  unit: string;
  currentCost: unknown;
  averageCost?: unknown;
  standardCost?: unknown;
  freight?: unknown;
  standardLoss?: unknown;
  status?: string | null;
};

export function computeMaterialLandedCost(input: {
  currentCost: number;
  freight?: number;
}): number {
  const current = Number.isFinite(input.currentCost) ? input.currentCost : 0;
  const freight = Number.isFinite(input.freight ?? 0) ? Number(input.freight ?? 0) : 0;
  return Math.round((current + freight) * 1_000_000) / 1_000_000;
}

export function isValidMaterialLandedCostForDraft(landedCost: number): boolean {
  return Number.isFinite(landedCost) && landedCost > 0;
}

export function buildMaterialCostItemWarnings(material: MaterialRowForCostSnapshot): string[] {
  const warnings: string[] = [];
  const current = Number(material.currentCost);
  const freight = Number(material.freight ?? 0);
  if (!Number.isFinite(current) || current <= 0) {
    warnings.push("currentCost ausente ou inválido no cadastro.");
  }
  if (Number.isFinite(freight) && freight < 0) {
    warnings.push("freight negativo no cadastro.");
  }
  const standardLoss = Number(material.standardLoss ?? 0);
  if (Number.isFinite(standardLoss) && standardLoss >= 100) {
    warnings.push("standardLoss >= 100% — perda padrão inválida.");
  }
  return warnings;
}

export type MaterialCostCalculationSnapshot = {
  snapshotKind: typeof MATERIAL_COST_SNAPSHOT_KIND_FROZEN;
  calculatedAt: string;
  publicationSource: typeof MATERIAL_COST_PUBLICATION_SOURCE;
  materialId: string;
  materialCode: string;
  materialDescription: string;
  unit: string;
  currentCost: number;
  freight: number;
  landedCost: number;
  averageCost: number | null;
  standardCost: number | null;
  standardLoss: number | null;
  costSource: string;
  warnings: string[];
};

function decimalOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildMaterialCostCalculationSnapshot(
  material: MaterialRowForCostSnapshot,
  calculatedAt: Date = new Date(),
  costSource = "CURRENT_MATERIAL"
): MaterialCostCalculationSnapshot {
  const currentCost = decimalOrNull(material.currentCost) ?? 0;
  const freight = decimalOrNull(material.freight) ?? 0;
  const landedCost = computeMaterialLandedCost({ currentCost, freight });
  const warnings = buildMaterialCostItemWarnings(material);

  return {
    snapshotKind: MATERIAL_COST_SNAPSHOT_KIND_FROZEN,
    calculatedAt: calculatedAt.toISOString(),
    publicationSource: MATERIAL_COST_PUBLICATION_SOURCE,
    materialId: material.id,
    materialCode: material.code,
    materialDescription: material.description,
    unit: material.unit,
    currentCost,
    freight,
    landedCost,
    averageCost: decimalOrNull(material.averageCost),
    standardCost: decimalOrNull(material.standardCost),
    standardLoss: decimalOrNull(material.standardLoss),
    costSource,
    warnings,
  };
}

export function buildMaterialCostCalculationHash(snapshot: MaterialCostCalculationSnapshot): string {
  const stable = JSON.stringify({
    materialId: snapshot.materialId,
    materialCode: snapshot.materialCode,
    currentCost: snapshot.currentCost,
    freight: snapshot.freight,
    landedCost: snapshot.landedCost,
    averageCost: snapshot.averageCost,
    standardCost: snapshot.standardCost,
    standardLoss: snapshot.standardLoss,
    costSource: snapshot.costSource,
    unit: snapshot.unit,
  });
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

export function buildMaterialCostDraftItemFromMaterial(
  material: MaterialRowForCostSnapshot,
  calculatedAt?: Date,
  costSource = "CURRENT_MATERIAL"
): MaterialCostTableDraftItemInput {
  const snapshot = buildMaterialCostCalculationSnapshot(material, calculatedAt, costSource);
  return {
    materialId: material.id,
    materialCodeSnapshot: material.code,
    materialDescriptionSnapshot: material.description,
    unitSnapshot: material.unit,
    currentCostSnapshot: snapshot.currentCost,
    freightSnapshot: snapshot.freight,
    landedCostSnapshot: snapshot.landedCost,
    averageCostSnapshot: snapshot.averageCost,
    standardCostSnapshot: snapshot.standardCost,
    standardLossSnapshot: snapshot.standardLoss,
    costSource,
    warningsJson: snapshot.warnings.length > 0 ? snapshot.warnings : null,
    calculationHash: buildMaterialCostCalculationHash(snapshot),
    calculationSnapshot: snapshot,
  };
}

export function materialCostTableCodeFromEffectiveDateKey(effectiveDate: Date): string {
  const key = toCivilDateKey(effectiveDate);
  if (!key) throw new Error("effectiveDate inválida.");
  return key.slice(0, 7);
}
