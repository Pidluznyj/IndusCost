/**
 * Produtos impactados pela matéria-prima (BOM direta oficial).
 * Motor server: where-used (ProductBOM) + resolução oficial de custo efetivo.
 * Tipos/cálculos puros: materialBomImpact.types.ts / materialBomImpact.shared.ts
 * Read-only — nunca altera ProductBOM.
 */
import type { PrismaClient } from "@prisma/client";
import { resolveMaterialLineCostForEngine } from "./materialCostEngineResolver.js";
import {
  buildMaterialMarketSavingsOpportunityFromRows,
  type MaterialMarketSavingsOpportunityResult,
} from "./materialMarketSavingsOpportunity.js";
import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import { resolveProductBomUsage } from "./productBomUsage.js";
import {
  aggregateMaterialBomImpactItems,
  buildMaterialBomImpactResponse,
  resolveOfficialMaterialEffectiveUnitCost,
  type MaterialBomImpactResponse,
} from "./materialBomImpact.shared.js";

export {
  MATERIAL_BOM_IMPACT_EMPTY_MESSAGE,
  aggregateMaterialBomImpactItems,
  buildMaterialBomImpactResponse,
  resolveOfficialMaterialEffectiveUnitCost,
  type AggregateMaterialBomImpactInput,
  type MaterialBomImpactItem,
  type MaterialBomImpactResponse,
} from "./materialBomImpact.shared.js";

async function resolveOptionalUnitSavings(
  material: {
    id: string;
    unit: string;
    currentCost: unknown;
  },
  quotes: MaterialMarketQuoteSourceRow[]
): Promise<number | null> {
  const savings: MaterialMarketSavingsOpportunityResult =
    buildMaterialMarketSavingsOpportunityFromRows({
      materialId: material.id,
      unit: material.unit,
      currentCost: material.currentCost as number,
      quotes,
      estimatedVolume: 1,
    });
  if (!savings.hasSavings || savings.unitSavings <= 0) return null;
  return savings.unitSavings;
}

/**
 * Lista produtos/componentes que consomem a MP na ProductBOM oficial.
 * Reutiliza `resolveProductBomUsage` (where-used) e `resolveMaterialLineCostForEngine`.
 */
export async function buildMaterialBomImpactForApi(
  db: PrismaClient,
  materialId: string
): Promise<MaterialBomImpactResponse | { notFound: true }> {
  const material = await db.material.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      currentCost: true,
      freight: true,
      standardLoss: true,
      MaterialMarketQuote: {
        orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!material) {
    return { notFound: true };
  }

  const usageOutcome = await resolveProductBomUsage({
    code: material.code,
    kind: "MATERIAL",
  });

  if (usageOutcome.status !== "ok") {
    return buildMaterialBomImpactResponse([]);
  }

  const costResolved = resolveMaterialLineCostForEngine({
    id: material.id,
    code: material.code,
    description: material.description,
    currentCost: material.currentCost,
    freight: material.freight,
    standardLoss: material.standardLoss,
  });
  const effectiveUnitCost = resolveOfficialMaterialEffectiveUnitCost(costResolved);
  const unitSavings = await resolveOptionalUnitSavings(material, material.MaterialMarketQuote);

  const items = aggregateMaterialBomImpactItems({
    usages: usageOutcome.data.usages,
    materialUnit: material.unit,
    effectiveUnitCost,
    unitSavings,
  });

  return buildMaterialBomImpactResponse(items);
}
