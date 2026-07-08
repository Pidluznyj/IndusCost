/**
 * Produtos impactados pela matéria-prima (BOM direta oficial).
 * Thin wrapper: reutiliza where-used (ProductBOM) e resolução oficial de custo efetivo.
 * Read-only — nunca altera ProductBOM.
 */
import type { PrismaClient } from "@prisma/client";
import {
  resolveMaterialLineCostForEngine,
  type ResolvedMaterialLineCost,
} from "./materialCostEngineResolver.js";
import {
  buildMaterialMarketSavingsOpportunityFromRows,
  type MaterialMarketSavingsOpportunityResult,
} from "./materialMarketSavingsOpportunity.js";
import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";
import { computeRequiredMaterialQuantity } from "./materialProductFinancialImpact.js";
import { resolveProductBomUsage, type BomUsageLine } from "./productBomUsage.js";

export const MATERIAL_BOM_IMPACT_EMPTY_MESSAGE =
  "Nenhum produto vinculado a esta matéria-prima na BOM oficial.";

export type MaterialBomImpactItem = {
  componentId?: string | null;
  componentName?: string | null;
  productId: string;
  productSku: string;
  productName: string;
  quantityConsumed: number;
  unit: string;
  estimatedCurrentCost: number;
  potentialImpact?: number | null;
};

export type MaterialBomImpactResponse = {
  items: MaterialBomImpactItem[];
  totalProducts: number;
  hasLinks: boolean;
};

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
