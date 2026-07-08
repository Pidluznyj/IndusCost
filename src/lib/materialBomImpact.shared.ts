/**
 * Cálculos puros de impacto BOM da MP — client-safe (sem Prisma).
 */
import type { ResolvedMaterialLineCost } from "./materialCostEngineResolver.js";
import { computeRequiredMaterialQuantity } from "./materialProductFinancialImpact.js";
import type { BomUsageLine } from "./productBomUsage.types.js";
import type { MaterialBomImpactItem, MaterialBomImpactResponse } from "./materialBomImpact.types.js";

export {
  MATERIAL_BOM_IMPACT_EMPTY_MESSAGE,
  type MaterialBomImpactItem,
  type MaterialBomImpactResponse,
} from "./materialBomImpact.types.js";

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Custo unitário efetivo alinhado ao motor industrial / GET /api/materials. */
export function resolveOfficialMaterialEffectiveUnitCost(
  costResolved: ResolvedMaterialLineCost
): number {
  if (!costResolved.ok) return 0;
  const lossFrac = costResolved.standardLossPct / 100;
  const denom = 1 - lossFrac;
  if (denom <= 0 || !Number.isFinite(denom)) return roundMoney(costResolved.landedCost);
  return roundMoney(costResolved.landedCost / denom);
}

export type AggregateMaterialBomImpactInput = {
  usages: BomUsageLine[];
  materialUnit: string;
  effectiveUnitCost: number;
  unitSavings?: number | null;
};

/**
 * Agrega linhas BOM por produto (dedupe), calcula consumo e custos.
 * Exportada para testes unitários sem Prisma.
 */
export function aggregateMaterialBomImpactItems(
  input: AggregateMaterialBomImpactInput
): MaterialBomImpactItem[] {
  const byProductId = new Map<
    string,
    {
      productId: string;
      productSku: string;
      productName: string;
      parentType: BomUsageLine["parentType"];
      quantityConsumed: number;
    }
  >();

  for (const usage of input.usages) {
    const qty = computeRequiredMaterialQuantity(usage.quantity, usage.lossPercentage ?? 0);
    const existing = byProductId.get(usage.parentProductId);
    if (existing) {
      existing.quantityConsumed = roundMoney(existing.quantityConsumed + qty);
      continue;
    }
    byProductId.set(usage.parentProductId, {
      productId: usage.parentProductId,
      productSku: usage.parentSku,
      productName: usage.parentName,
      parentType: usage.parentType,
      quantityConsumed: roundMoney(qty),
    });
  }

  const unitSavings =
    input.unitSavings != null && Number.isFinite(input.unitSavings) && input.unitSavings > 0
      ? input.unitSavings
      : null;

  return [...byProductId.values()]
    .map((row) => {
      const estimatedCurrentCost = roundMoney(row.quantityConsumed * input.effectiveUnitCost);
      const potentialImpact =
        unitSavings != null ? roundMoney(row.quantityConsumed * unitSavings) : null;
      const isComponent = row.parentType === "COMPONENT";
      return {
        componentId: isComponent ? row.productId : null,
        componentName: isComponent ? row.productName : null,
        productId: row.productId,
        productSku: row.productSku,
        productName: row.productName,
        quantityConsumed: row.quantityConsumed,
        unit: input.materialUnit,
        estimatedCurrentCost,
        potentialImpact,
      } satisfies MaterialBomImpactItem;
    })
    .sort((a, b) => a.productSku.localeCompare(b.productSku, "pt-BR"));
}

export function buildMaterialBomImpactResponse(
  items: MaterialBomImpactItem[]
): MaterialBomImpactResponse {
  return {
    items,
    totalProducts: items.length,
    hasLinks: items.length > 0,
  };
}
