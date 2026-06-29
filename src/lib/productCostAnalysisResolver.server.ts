/**
 * Resolver oficial de getProductCostAnalysis para scripts server-side (sync Nomus, auditorias).
 */
import type { PrismaClient } from "@prisma/client";
import { createProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";

export async function createOfficialProductCostAnalysisResolver(
  prisma: PrismaClient
): Promise<(productId: string) => Promise<unknown>> {
  const { initAnalysisCache, getProductCostAnalysis } = createProductCostAnalysisEngine(prisma);
  const cache = await initAnalysisCache();
  const memo = new Map<string, unknown>();

  return async (productId: string) => {
    if (!memo.has(productId)) {
      memo.set(productId, await getProductCostAnalysis(productId, cache, false));
    }
    return memo.get(productId);
  };
}
