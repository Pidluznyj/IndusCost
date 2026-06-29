/**
 * Snapshot de custo unitário oficial na importação Nomus de Pedidos de Venda.
 * Usa o mesmo motor de custo do backend (getProductCostAnalysis) via resolver compartilhado.
 */
import type { PrismaClient } from "@prisma/client";
import { createOfficialProductCostAnalysisResolver } from "./productCostAnalysisResolver.server.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";
import type { SalesOrderCostSource } from "./salesOrderMarginTypes.js";

export type NomusSyncLineUnitCostResult = {
  unitCost: number | null;
  costSource: SalesOrderCostSource;
  warning: string | null;
};

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

/** Resolve custo unitário oficial para linhas do sync (sem usar unitCost legado zero). */
export async function buildNomusSyncOfficialUnitCostIndex(
  prisma: PrismaClient,
  productIds: string[]
): Promise<Map<string, NomusSyncLineUnitCostResult>> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const results = new Map<string, NomusSyncLineUnitCostResult>();
  if (uniqueIds.length === 0) return results;

  const resolveAnalysis = await createOfficialProductCostAnalysisResolver(prisma);
  const costLogs = await loadLatestCostLogsForProducts(prisma, uniqueIds);

  for (const productId of uniqueIds) {
    const analysis = await resolveAnalysis(productId);
    const resolution = resolveSalesOrderItemCost({
      salesOrderItemId: `nomus-sync:${productId}`,
      productId,
      storedUnitCost: null,
      costLog: costLogs.get(productId) ?? null,
      analysis,
    });

    const unavailable =
      resolution.unitCost == null || !Number.isFinite(resolution.unitCost) || resolution.unitCost <= 0;

    results.set(productId, {
      unitCost: unavailable ? null : resolution.unitCost,
      costSource: resolution.costSource,
      warning: unavailable
        ? resolution.notes.join(" ") || "Custo indisponível no sync Nomus — unitCost não gravado."
        : null,
    });
  }

  return results;
}

export function formatNomusSyncUnitCostDecimal(unitCost: number | null | undefined): string {
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) return "0.000000";
  return unitCost.toFixed(6);
}

export function computeNomusSyncLineTotalCost(
  quantity: number,
  unitCost: number | null
): number {
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return quantity * unitCost;
}
