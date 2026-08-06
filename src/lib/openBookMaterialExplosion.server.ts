/**
 * Explosão de BOM (Open Book) — parte que toca Prisma/engine de custeio.
 * Separado de openBookMaterialExplosion.ts (puro) porque esse arquivo é
 * importado pelo frontend (OpenBookCompositionTab.tsx) — não pode carregar
 * @prisma/client.
 *
 * Extraído de server.ts (função `buildOpenBookRawMaterialExplosionPerUnit`,
 * historicamente inline) para ser reaproveitado por outros consumidores
 * server-side sem duplicar a lógica de explosão — hoje: o próprio server.ts
 * (Análise de Custo) e o Orquestrador de Matéria-Prima
 * (rawMaterialPlanning.server.ts).
 */
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  addDirectMaterialRow,
  cloneExplosionMap,
  mergeExplosionMaps,
  type ExplosionRowCore,
} from "./openBookMaterialExplosion.js";
import type { AnalysisCache } from "./productCostAnalysisEngine.server.js";

export type OpenBookExplosionDeps = {
  prisma: Pick<PrismaClient, "product">;
  getProductCostAnalysis: ProductCostAnalysisEngine["getProductCostAnalysis"];
  isCostAnalysisFailure: ProductCostAnalysisEngine["isCostAnalysisFailure"];
};

/**
 * Explode a BOM de 1 produto em matérias-primas diretas, recursivamente
 * (produto-filho consolidado pela mesma explosão, escalado pela quantidade
 * na BOM do pai). `quantity` no resultado é sempre por 1 unidade do produto
 * raiz. Memoizado por `productId` em `memo` — reaproveitar o MESMO `memo`
 * entre chamadas do mesmo lote evita reexplodir o mesmo produto.
 */
export async function buildOpenBookRawMaterialExplosionPerUnit(
  productId: string,
  cache: AnalysisCache,
  pathStack: Set<string>,
  memo: Map<string, Map<string, ExplosionRowCore>>,
  deps: OpenBookExplosionDeps
): Promise<Map<string, ExplosionRowCore> | { error: string; message?: string }> {
  if (memo.has(productId)) {
    return cloneExplosionMap(memo.get(productId)!);
  }
  if (pathStack.has(productId)) {
    return { error: "BOM_CYCLE", message: "Ciclo na BOM ao explodir matérias-primas." };
  }
  pathStack.add(productId);
  try {
    const product = await deps.prisma.product.findUnique({
      where: { id: productId },
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
        const childAnalysis = await deps.getProductCostAnalysis(
          item.childProductId,
          cache,
          false,
          pathStack
        );
        if (childAnalysis === null || deps.isCostAnalysisFailure(childAnalysis)) {
          continue;
        }
        const sub = await buildOpenBookRawMaterialExplosionPerUnit(
          item.childProductId,
          cache,
          pathStack,
          memo,
          deps
        );
        if (!(sub instanceof Map)) {
          return sub;
        }
        const bomLoss = Number(item.lossPercentage ?? 0) / 100;
        const requiredQty = Number(item.quantity) / (1 - bomLoss);
        mergeExplosionMaps(into, sub, requiredQty);
        continue;
      }
    }

    memo.set(productId, cloneExplosionMap(into));
    return into;
  } finally {
    pathStack.delete(productId);
  }
}
