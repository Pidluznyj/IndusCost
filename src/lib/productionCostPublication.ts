/**
 * Helpers puros para publicação de custo de produção versionado (sem Prisma).
 */
import crypto from "crypto";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
  type OfficialProductFinalCostSuccess,
} from "./productOfficialFinalCost.js";
import type { ProductionCostTableDraftItemInput } from "./productionCostVersioning.js";
import {
  buildProductionCostBomStructureHashInput,
  extractProductionCostBomAuditStructureFromAnalysis,
  extractProductionCostWarningsFromAnalysis,
  PRODUCTION_COST_SNAPSHOT_KIND,
  PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE,
  type ProductionCostBomAuditStructure,
  type ProductionCostAuditWarning,
} from "./productionCostCalculationSnapshotAudit.js";

export const PRODUCTION_COST_PUBLICATION_SOURCE = "PRICING_MODULE_PRODUCTION_COST" as const;

export function productionCostTableCodeFromEffectiveDate(effectiveDate: Date): string {
  const key = toCivilDateKey(effectiveDate);
  if (!key) throw new Error("effectiveDate inválida.");
  return key.slice(0, 7);
}

export function productionCostTableNameFromCode(code: string, revision: number): string {
  return `Custo de produção ${code} (rev. ${revision})`;
}

export type ProductionCostCalculationSnapshot = {
  snapshotKind: typeof PRODUCTION_COST_SNAPSHOT_KIND;
  liveBomNotice: typeof PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE;
  calculatedAt: string;
  source: typeof OFFICIAL_PRODUCT_FINAL_COST_SOURCE;
  publicationSource: typeof PRODUCTION_COST_PUBLICATION_SOURCE;
  productId: string;
  sku: string | null;
  productName: string | null;
  productType: string | null;
  finalUnitCost: number;
  costAnalysisPartial: boolean;
  breakdown: {
    materialCost: number;
    processCost: number;
    laborCost: number;
    machineCost: number;
    overheadCost: number;
    otherCost: number;
  };
  analysisSummary: Record<string, unknown>;
  bomStructure: ProductionCostBomAuditStructure;
  warnings: ProductionCostAuditWarning[];
  calculationHashInputVersion: 2;
};

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function mapOfficialCostToItemBreakdown(resolved: OfficialProductFinalCostSuccess): {
  materialCost: number;
  processCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  otherCost: number;
} {
  const materialCost = resolved.breakdown.totalMaterialCost ?? 0;
  const laborCost = resolved.breakdown.totalHH_Unit ?? 0;
  const machineCost = resolved.breakdown.totalHM_Unit ?? 0;
  const overheadCost =
    (resolved.breakdown.totalCIF_Unit ?? 0) + (resolved.breakdown.totalOPEX_Unit ?? 0);
  const processCost = 0;
  const sumParts = materialCost + laborCost + machineCost + overheadCost + processCost;
  const otherCost = Math.max(0, round6(resolved.finalUnitCost - sumParts));
  return { materialCost, processCost, laborCost, machineCost, overheadCost, otherCost };
}

export function buildProductionCostCalculationSnapshot(
  resolved: OfficialProductFinalCostSuccess,
  analysis: unknown,
  productMeta?: { name?: string | null; type?: string | null },
  calculatedAt: Date = new Date()
): ProductionCostCalculationSnapshot {
  const breakdown = mapOfficialCostToItemBreakdown(resolved);
  const raw = analysis && typeof analysis === "object" ? (analysis as Record<string, unknown>) : {};
  const summary =
    raw.summary && typeof raw.summary === "object"
      ? (raw.summary as Record<string, unknown>)
      : raw;
  const bomStructure = extractProductionCostBomAuditStructureFromAnalysis(analysis);
  const warnings = extractProductionCostWarningsFromAnalysis(analysis);

  return {
    snapshotKind: PRODUCTION_COST_SNAPSHOT_KIND,
    liveBomNotice: PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE,
    calculatedAt: calculatedAt.toISOString(),
    source: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
    publicationSource: PRODUCTION_COST_PUBLICATION_SOURCE,
    productId: resolved.productId ?? "",
    sku: resolved.sku,
    productName: productMeta?.name?.trim() || readString(raw.name) || null,
    productType: productMeta?.type?.trim() || readString(raw.productType) || null,
    finalUnitCost: resolved.finalUnitCost,
    costAnalysisPartial: resolved.costAnalysisPartial,
    breakdown,
    analysisSummary: {
      totalIndustrialCost: summary.totalIndustrialCost ?? raw.totalIndustrialCost,
      totalMaterialCost: summary.totalMaterialCost ?? raw.totalMaterialCost,
      totalHH_Unit: summary.totalHH_Unit ?? raw.totalHH_Unit,
      totalHM_Unit: summary.totalHM_Unit ?? raw.totalHM_Unit,
      totalCIF_Unit: summary.totalCIF_Unit ?? raw.totalCIF_Unit,
      totalOPEX_Unit: summary.totalOPEX_Unit ?? raw.totalOPEX_Unit,
      costAnalysisPartial: summary.costAnalysisPartial ?? raw.costAnalysisPartial,
      costingMode: raw.costingMode ?? null,
      ownProcessSkipped: raw.ownProcessSkipped ?? null,
    },
    bomStructure,
    warnings,
    calculationHashInputVersion: 2,
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildProductionCostCalculationHash(
  snapshot: ProductionCostCalculationSnapshot
): string {
  const stable = JSON.stringify({
    version: snapshot.calculationHashInputVersion ?? 1,
    source: snapshot.source,
    productId: snapshot.productId,
    sku: snapshot.sku,
    finalUnitCost: snapshot.finalUnitCost,
    breakdown: snapshot.breakdown,
    analysisSummary: snapshot.analysisSummary,
    bomStructure: buildProductionCostBomStructureHashInput(snapshot.bomStructure),
    warnings: snapshot.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    costAnalysisPartial: snapshot.costAnalysisPartial,
  });
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

export function buildProductionCostDraftItemFromAnalysis(
  product: { id: string; sku: string; name: string; type?: string | null },
  resolved: OfficialProductFinalCostSuccess,
  analysis: unknown,
  calculatedAt?: Date
): ProductionCostTableDraftItemInput {
  const snapshot = buildProductionCostCalculationSnapshot(
    resolved,
    analysis,
    { name: product.name, type: product.type ?? null },
    calculatedAt
  );
  return {
    productId: product.id,
    productCodeSnapshot: product.sku,
    productNameSnapshot: product.name,
    unitProductionCost: resolved.finalUnitCost,
    ...snapshot.breakdown,
    currency: "BRL",
    calculationHash: buildProductionCostCalculationHash(snapshot),
    calculationSnapshot: snapshot,
  };
}
