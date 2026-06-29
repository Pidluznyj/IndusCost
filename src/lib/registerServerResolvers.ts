/**
 * Bootstrap compartilhado de resolvers server-side (HTTP e scripts de auditoria).
 */
import type { PrismaClient } from "@prisma/client";
import {
  setSalesOrderMarginProductCostResolver,
  type SalesOrderMarginProductCostAnalysisResolver,
} from "./salesOrderMarginProductCostResolver.js";
import { createCachedSalesOrderMarginCostResolver } from "./salesOrderMarginResolver.server.js";
import { createOfficialProductCostAnalysisResolver } from "./productCostAnalysisResolver.server.js";

/** Registra o resolver oficial de custo usado pelo motor de margem (server HTTP). */
export function registerOfficialServerResolvers(input: {
  resolveProductCostAnalysis: SalesOrderMarginProductCostAnalysisResolver;
}): void {
  setSalesOrderMarginProductCostResolver(input.resolveProductCostAnalysis);
}

async function loadLatestCostLogsForProducts(
  prisma: PrismaClient,
  productIds: string[]
): Promise<Map<string, { totalCiu: number; calculatedAt: string }>> {
  if (productIds.length === 0) return new Map();

  const rows = await prisma.costCalculationLog.findMany({
    where: { productId: { in: productIds } },
    orderBy: { calculatedAt: "desc" },
    select: { productId: true, totalCiu: true, calculatedAt: true },
  });

  const map = new Map<string, { totalCiu: number; calculatedAt: string }>();
  for (const row of rows) {
    if (map.has(row.productId)) continue;
    const totalCiu = Number(row.totalCiu);
    if (!Number.isFinite(totalCiu) || totalCiu <= 0) continue;
    map.set(row.productId, {
      totalCiu,
      calculatedAt: row.calculatedAt.toISOString(),
    });
  }
  return map;
}

/**
 * Bootstrap para scripts de auditoria sem subir HTTP.
 * Usa CostCalculationLog (mesma prioridade secundária do motor após unitCost da linha).
 */
export async function registerOfficialServerResolversForNomusSyncScript(
  prisma: PrismaClient
): Promise<void> {
  const resolveProductCostAnalysis = await createOfficialProductCostAnalysisResolver(prisma);
  setSalesOrderMarginProductCostResolver(resolveProductCostAnalysis);
}

export async function registerOfficialServerResolversForAuditScripts(
  prisma: PrismaClient,
  productIds: string[]
): Promise<void> {
  const costLogs = await loadLatestCostLogsForProducts(prisma, productIds);
  setSalesOrderMarginProductCostResolver(
    createCachedSalesOrderMarginCostResolver(async () => null, costLogs)
  );
}
