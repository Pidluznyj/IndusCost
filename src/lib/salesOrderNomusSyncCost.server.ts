/**
 * Snapshot de custo unitário oficial na importação Nomus de Pedidos de Venda.
 * Usa getProductCostAnalysis (CIU = MP + HH + HM) via resolver compartilhado.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createOfficialProductCostAnalysisResolver,
  type OfficialProductCostAnalysisResolverStats,
} from "./productCostAnalysisResolver.server.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";
import type { SalesOrderCostSource } from "./salesOrderMarginTypes.js";

export type NomusSyncLineUnitCostResult = {
  unitCost: number | null;
  costSource: SalesOrderCostSource;
  warning: string | null;
};

export type UnitCostSnapshotOutcome = "preserved" | "resolved" | "unresolved" | "no_product";

export type UnitCostSnapshotResult = {
  unitCost: number | null;
  outcome: UnitCostSnapshotOutcome;
  warning: string | null;
  costSource?: SalesOrderCostSource;
};

export type NomusSyncUnitCostIndexBuildResult = {
  index: Map<string, NomusSyncLineUnitCostResult>;
  resolverStats: OfficialProductCostAnalysisResolverStats;
  uniqueProducts: number;
  productsResolved: number;
  productsUnresolved: number;
};

export type NomusSyncUnitCostApplyStats = {
  itemsProcessed: number;
  costsPreserved: number;
  costsNewlyResolved: number;
  costsFromProductIndexCache: number;
  costsUnresolved: number;
  costsNoProduct: number;
  warnings: string[];
};

export type NomusSyncUnitCostSummary = NomusSyncUnitCostApplyStats & {
  resolverStats: OfficialProductCostAnalysisResolverStats;
  uniqueProducts: number;
  productsResolved: number;
  productsUnresolved: number;
  durationMs: number;
};

export function createNomusSyncUnitCostApplyStats(): NomusSyncUnitCostApplyStats {
  return {
    itemsProcessed: 0,
    costsPreserved: 0,
    costsNewlyResolved: 0,
    costsFromProductIndexCache: 0,
    costsUnresolved: 0,
    costsNoProduct: 0,
    warnings: [],
  };
}

export function parseNomusSyncStoredUnitCost(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildNomusSyncLineMatchKey(input: {
  productId: string;
  externalProductId: number;
  proposalItemId: string | null;
}): string {
  return `${input.externalProductId}|${input.productId}|${input.proposalItemId ?? ""}`;
}

export function buildPreservationMapFromExistingItems(
  items: Array<{
    productId: string;
    externalProductId: number | null;
    proposalItemId: string | null;
    unitCost: unknown;
  }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const stored = parseNomusSyncStoredUnitCost(item.unitCost);
    if (stored == null || item.externalProductId == null) continue;
    const key = buildNomusSyncLineMatchKey({
      productId: item.productId,
      externalProductId: item.externalProductId,
      proposalItemId: item.proposalItemId,
    });
    if (!map.has(key)) map.set(key, stored);
    const fallbackKey = buildNomusSyncLineMatchKey({
      productId: item.productId,
      externalProductId: item.externalProductId,
      proposalItemId: null,
    });
    if (!map.has(fallbackKey)) map.set(fallbackKey, stored);
  }
  return map;
}

function lookupPreservedUnitCost(
  preservationMap: Map<string, number>,
  line: {
    productId: string;
    externalProductId: number;
    proposalItemId: string | null;
  }
): number | null {
  const keys = [
    buildNomusSyncLineMatchKey(line),
    buildNomusSyncLineMatchKey({ ...line, proposalItemId: null }),
  ];
  for (const key of keys) {
    const stored = preservationMap.get(key);
    if (stored != null && stored > 0) return stored;
  }
  return null;
}

/** Decide unitCost da linha: preserva histórico > 0; senão índice oficial; senão warning. */
export function resolveSalesOrderItemUnitCostSnapshot(input: {
  productId: string | null | undefined;
  externalProductId: number;
  proposalItemId: string | null;
  preservationMap: Map<string, number>;
  unitCostIndex: Map<string, NomusSyncLineUnitCostResult>;
}): UnitCostSnapshotResult {
  const productId = typeof input.productId === "string" && input.productId.trim() ? input.productId : null;

  if (!productId) {
    return {
      unitCost: null,
      outcome: "no_product",
      warning: "Linha sem productId confiável — custo não resolvido.",
    };
  }

  const preserved = lookupPreservedUnitCost(input.preservationMap, {
    productId,
    externalProductId: input.externalProductId,
    proposalItemId: input.proposalItemId,
  });
  if (preserved != null) {
    return {
      unitCost: preserved,
      outcome: "preserved",
      warning: null,
      costSource: "SALES_ORDER_ITEM_SNAPSHOT",
    };
  }

  const indexed = input.unitCostIndex.get(productId);
  if (indexed?.unitCost != null && indexed.unitCost > 0) {
    return {
      unitCost: indexed.unitCost,
      outcome: "resolved",
      warning: null,
      costSource: indexed.costSource,
    };
  }

  return {
    unitCost: null,
    outcome: "unresolved",
    warning:
      indexed?.warning ??
      "Custo indisponível no sync Nomus — unitCost não gravado (fallback legado na margem).",
    costSource: indexed?.costSource ?? "MISSING_COST",
  };
}

export function recordUnitCostSnapshotApplyStats(
  stats: NomusSyncUnitCostApplyStats,
  snapshot: UnitCostSnapshotResult,
  context: { orderCode: string; productId: string | null; sku: string },
  resolvedProductIdsSeen: Set<string>
): void {
  stats.itemsProcessed += 1;
  switch (snapshot.outcome) {
    case "preserved":
      stats.costsPreserved += 1;
      break;
    case "resolved": {
      const pid = context.productId;
      if (pid && resolvedProductIdsSeen.has(pid)) {
        stats.costsFromProductIndexCache += 1;
      } else {
        if (pid) resolvedProductIdsSeen.add(pid);
        stats.costsNewlyResolved += 1;
      }
      break;
    }
    case "unresolved":
      stats.costsUnresolved += 1;
      if (snapshot.warning) {
        stats.warnings.push(
          `pedido=${context.orderCode} produto=${context.productId ?? "?"} sku=${context.sku}: ${snapshot.warning}`
        );
      }
      break;
    case "no_product":
      stats.costsNoProduct += 1;
      if (snapshot.warning) {
        stats.warnings.push(`pedido=${context.orderCode} sku=${context.sku}: ${snapshot.warning}`);
      }
      break;
  }
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

/** Pré-calcula custo oficial por productId (cache em memória por execução do sync). */
export async function buildNomusSyncOfficialUnitCostIndex(
  prisma: PrismaClient,
  productIds: string[]
): Promise<NomusSyncUnitCostIndexBuildResult> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const index = new Map<string, NomusSyncLineUnitCostResult>();
  if (uniqueIds.length === 0) {
    return {
      index,
      resolverStats: { engineCalls: 0, cacheHits: 0 },
      uniqueProducts: 0,
      productsResolved: 0,
      productsUnresolved: 0,
    };
  }

  const { resolve: resolveAnalysis, stats: resolverStats } =
    await createOfficialProductCostAnalysisResolver(prisma);
  const costLogs = await loadLatestCostLogsForProducts(prisma, uniqueIds);

  let productsResolved = 0;
  let productsUnresolved = 0;

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

    if (unavailable) {
      productsUnresolved += 1;
    } else {
      productsResolved += 1;
    }

    index.set(productId, {
      unitCost: unavailable ? null : resolution.unitCost,
      costSource: resolution.costSource,
      warning: unavailable
        ? resolution.notes.join(" ") || "Custo indisponível no sync Nomus — unitCost não gravado."
        : null,
    });
  }

  return {
    index,
    resolverStats,
    uniqueProducts: uniqueIds.length,
    productsResolved,
    productsUnresolved,
  };
}

export function formatNomusSyncUnitCostDecimal(unitCost: number | null | undefined): string {
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) return "0.000000";
  return unitCost.toFixed(6);
}

export function computeNomusSyncLineTotalCost(quantity: number, unitCost: number | null): number {
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return quantity * unitCost;
}

export function mergeNomusSyncUnitCostSummary(input: {
  applyStats: NomusSyncUnitCostApplyStats;
  indexBuild: NomusSyncUnitCostIndexBuildResult;
  durationMs: number;
}): NomusSyncUnitCostSummary {
  return {
    ...input.applyStats,
    resolverStats: input.indexBuild.resolverStats,
    uniqueProducts: input.indexBuild.uniqueProducts,
    productsResolved: input.indexBuild.productsResolved,
    productsUnresolved: input.indexBuild.productsUnresolved,
    durationMs: input.durationMs,
  };
}
