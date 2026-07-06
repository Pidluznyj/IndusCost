import type { CurrentCostSnapshot } from "@/src/lib/nomusEffectiveBomCostImpact.js";
import { resolveOfficialProductFinalCostFromAnalysis } from "./productOfficialFinalCost.js";

/** Mesmo predicado usado em server.ts para falhas do motor getProductCostAnalysis. */
export function isCostAnalysisFailure(x: unknown): x is { error: string; message?: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as { error: unknown }).error === "string"
  );
}

/**
 * Converte resultado de getProductCostAnalysis em CurrentCostSnapshot.
 * Paridade com GET /api/nomus/effective-pricing-bom/cost-impact (server.ts).
 */
export function buildCurrentCostSnapshotFromAnalysis(
  analysis: unknown
): CurrentCostSnapshot | null {
  if (!analysis || isCostAnalysisFailure(analysis)) return null;

  const a = analysis as {
    productId?: string;
    sku?: string;
    totalMaterialCost?: unknown;
    totalHH_Unit?: unknown;
    totalHM_Unit?: unknown;
    totalIndustrialCost?: unknown;
    costAnalysisPartial?: boolean;
    details?: { materials?: CurrentCostSnapshot["materials"] };
  };

  if (a.productId == null || a.sku == null) return null;

  const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
  if (!resolved.ok) return null;

  const detailsMaterials = a.details?.materials;

  return {
    productId: a.productId,
    sku: a.sku,
    totalMaterialCost: Number(a.totalMaterialCost),
    totalHH_Unit: Number(a.totalHH_Unit),
    totalHM_Unit: Number(a.totalHM_Unit),
    totalIndustrialCost: resolved.finalUnitCost,
    costAnalysisPartial: resolved.costAnalysisPartial,
    materials: Array.isArray(detailsMaterials) ? detailsMaterials : undefined,
  };
}
