/**
 * Resolver oficial de getProductCostAnalysis para scripts server-side (sync Nomus, auditorias).
 */
import type { PrismaClient } from "@prisma/client";
import { createProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";

export type OfficialProductCostAnalysisResolverStats = {
  engineCalls: number;
  cacheHits: number;
};

export type OfficialProductCostAnalysisResolverBundle = {
  resolve: (productId: string) => Promise<unknown>;
  stats: OfficialProductCostAnalysisResolverStats;
};

export async function createOfficialProductCostAnalysisResolver(
  prisma: PrismaClient
): Promise<OfficialProductCostAnalysisResolverBundle> {
  const { initAnalysisCache, getProductCostAnalysis } = createProductCostAnalysisEngine(prisma);
  const cache = await initAnalysisCache();
  const memo = new Map<string, unknown>();
  const stats: OfficialProductCostAnalysisResolverStats = { engineCalls: 0, cacheHits: 0 };

  const resolve = async (productId: string) => {
    if (memo.has(productId)) {
      stats.cacheHits += 1;
      return memo.get(productId);
    }
    stats.engineCalls += 1;
    const analysis = await getProductCostAnalysis(productId, cache, false);
    memo.set(productId, analysis);
    return analysis;
  };

  return { resolve, stats };
}
