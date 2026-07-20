/**
 * Explosão recursiva de matéria-prima (Open Book) — mesma semântica de
 * `buildOpenBookRawMaterialExplosionPerUnit` em server.ts / Inteligência de MP.
 */
import type { PrismaClient } from "@prisma/client";
import {
  addDirectMaterialRow,
  cloneExplosionMap,
  mergeExplosionMaps,
  type ExplosionRowCore,
} from "./openBookMaterialExplosion.js";
import {
  createProductCostAnalysisEngine,
  type AnalysisCache,
} from "./productCostAnalysisEngine.server.js";

export type OpenBookRawMaterialExplosionResult =
  | { ok: true; rows: ExplosionRowCore[] }
  | { ok: false; error: string; message?: string };

/**
 * Explode a BOM do produto até MPs folha (via componentes), por 1 unidade do produto.
 */
export async function explodeProductRawMaterialsPerUnit(
  prisma: PrismaClient,
  productId: string,
  options?: {
    cache?: AnalysisCache;
    memo?: Map<string, Map<string, ExplosionRowCore>>;
  }
): Promise<OpenBookRawMaterialExplosionResult> {
  const engine = createProductCostAnalysisEngine(prisma);
  const cache = options?.cache ?? (await engine.initAnalysisCache());
  const memo = options?.memo ?? new Map<string, Map<string, ExplosionRowCore>>();

  const walk = async (
    id: string,
    pathStack: Set<string>
  ): Promise<Map<string, ExplosionRowCore> | { error: string; message?: string }> => {
    if (memo.has(id)) {
      return cloneExplosionMap(memo.get(id)!);
    }
    if (pathStack.has(id)) {
      return { error: "BOM_CYCLE", message: "Ciclo na BOM ao explodir matérias-primas." };
    }
    pathStack.add(id);
    try {
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          ProductBOM: { orderBy: { id: "asc" }, include: { Material: true } },
        },
      });
      if (!product) {
        return { error: "NOT_FOUND", message: "Produto não encontrado." };
      }

      const into = new Map<string, ExplosionRowCore>();

      for (const item of product.ProductBOM) {
        if (item.Material) {
          const mat = item.Material;
          const landedCost = Number(mat.currentCost) + Number(mat.freight ?? 0);
          const matStandardLoss = Number(mat.standardLoss ?? 0) / 100;
          const bomLoss = Number(item.lossPercentage ?? 0) / 100;
          const requiredQty = Number(item.quantity) / (1 - bomLoss);
          const matEffectiveCost = landedCost / (1 - matStandardLoss);
          const lineTotal = matEffectiveCost * requiredQty;
          addDirectMaterialRow(into, {
            materialId: mat.id,
            code: mat.code,
            description: mat.description,
            unit: mat.unit,
            quantity: requiredQty,
            totalCost: lineTotal,
          });
          continue;
        }

        if (item.childProductId) {
          const childAnalysis = await engine.getProductCostAnalysis(
            item.childProductId,
            cache,
            false,
            pathStack
          );
          if (childAnalysis === null || engine.isCostAnalysisFailure(childAnalysis)) {
            continue;
          }
          const sub = await walk(item.childProductId, pathStack);
          if (!(sub instanceof Map)) {
            return sub;
          }
          const bomLoss = Number(item.lossPercentage ?? 0) / 100;
          const requiredQty = Number(item.quantity) / (1 - bomLoss);
          mergeExplosionMaps(into, sub, requiredQty);
        }
      }

      memo.set(id, cloneExplosionMap(into));
      return into;
    } finally {
      pathStack.delete(id);
    }
  };

  const result = await walk(productId, new Set<string>());
  if (!(result instanceof Map)) {
    return { ok: false, error: result.error, message: result.message };
  }
  return {
    ok: true,
    rows: [...result.values()].sort((a, b) => b.totalCost - a.totalCost),
  };
}
