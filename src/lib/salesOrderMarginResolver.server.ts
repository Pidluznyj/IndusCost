/**
 * Orquestração server-only: carrega produtos/custos em lote e monta inputs do motor de margem.
 */
import type { PrismaClient } from "@prisma/client";
import { normalizeSku } from "./nomusBomComparison.js";
import type { SalesOrderMarginItemInput } from "./salesOrderMarginTypes.js";
import {
  buildSalesOrderMarginInputsFromResolutions,
  createEmptySalesOrderMarginProductBatchIndex,
  indexSalesOrderMarginProducts,
  registerSalesOrderMarginCatalogMapping,
  registerSalesOrderMarginExternalProductMapping,
  resolveSalesOrderItemCosts,
  resolveSalesOrderItemProducts,
  type SalesOrderMarginProductBatchIndex,
  type SalesOrderMarginProductCostResolver,
  type SalesOrderMarginResolverItem,
} from "./salesOrderMarginResolver.js";

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  sourceExternalId: true,
} as const;

function collectLookupKeys(items: SalesOrderMarginResolverItem[]) {
  const productIds = new Set<string>();
  const externalIds = new Set<string>();
  const skus = new Set<string>();

  for (const item of items) {
    if (item.productId) productIds.add(item.productId);
    if (item.externalProductId != null && String(item.externalProductId).trim() !== "") {
      externalIds.add(String(item.externalProductId));
    }
    if (item.skuSnapshot?.trim()) {
      skus.add(item.skuSnapshot.trim());
      skus.add(normalizeSku(item.skuSnapshot));
    }
    const raw = item.nomusRawItem;
    if (raw) {
      const code = raw.codigo ?? raw.codigoProduto;
      if (typeof code === "string" && code.trim()) {
        skus.add(code.trim());
        skus.add(normalizeSku(code));
      }
      const rawExt = raw.idProduto ?? raw.id;
      if (rawExt != null && String(rawExt).trim() !== "") {
        externalIds.add(String(rawExt));
      }
    }
  }

  return {
    productIds: [...productIds],
    externalIds: [...externalIds],
    skus: [...skus],
    externalNumericIds: [...externalIds]
      .map((id) => Number.parseInt(id, 10))
      .filter((n) => Number.isFinite(n)),
  };
}

export async function loadSalesOrderMarginProductBatchIndex(
  prisma: PrismaClient,
  items: SalesOrderMarginResolverItem[]
): Promise<SalesOrderMarginProductBatchIndex> {
  const keys = collectLookupKeys(items);
  if (
    keys.productIds.length === 0 &&
    keys.externalIds.length === 0 &&
    keys.skus.length === 0
  ) {
    return createEmptySalesOrderMarginProductBatchIndex();
  }

  const [byIdRows, bySourceRows, bySkuRows, catalogRows, proposalRows] = await Promise.all([
    keys.productIds.length > 0
      ? prisma.product.findMany({ where: { id: { in: keys.productIds } }, select: PRODUCT_SELECT })
      : Promise.resolve([]),
    keys.externalIds.length > 0
      ? prisma.product.findMany({
          where: { sourceExternalId: { in: keys.externalIds } },
          select: PRODUCT_SELECT,
        })
      : Promise.resolve([]),
    keys.skus.length > 0
      ? prisma.product.findMany({ where: { sku: { in: keys.skus } }, select: PRODUCT_SELECT })
      : Promise.resolve([]),
    keys.externalIds.length > 0 || keys.skus.length > 0
      ? prisma.nomusProductCatalog.findMany({
          where: {
            OR: [
              ...(keys.externalIds.length > 0
                ? [{ externalProductId: { in: keys.externalIds } }]
                : []),
              ...(keys.skus.length > 0 ? [{ code: { in: keys.skus } }] : []),
            ],
          },
          select: { externalProductId: true, code: true },
        })
      : Promise.resolve([]),
    keys.externalNumericIds.length > 0
      ? prisma.proposalItem.findMany({
          where: { externalProductId: { in: keys.externalNumericIds } },
          select: {
            externalProductId: true,
            Product: { select: PRODUCT_SELECT },
          },
        })
      : Promise.resolve([]),
  ]);

  const mergedProducts = new Map<string, (typeof byIdRows)[number]>();
  for (const row of [...byIdRows, ...bySourceRows, ...bySkuRows]) {
    mergedProducts.set(row.id, row);
  }

  const index = indexSalesOrderMarginProducts([...mergedProducts.values()]);

  for (const row of proposalRows) {
    if (row.externalProductId == null || !row.Product) continue;
    registerSalesOrderMarginExternalProductMapping(index, row.externalProductId, row.Product);
  }

  for (const row of catalogRows) {
    if (row.externalProductId?.trim() && row.code?.trim()) {
      registerSalesOrderMarginCatalogMapping(index, row.externalProductId, row.code);
      const product = index.bySku.get(normalizeSku(row.code));
      if (product && row.externalProductId) {
        registerSalesOrderMarginExternalProductMapping(index, row.externalProductId, product);
      }
    }
  }

  return index;
}

async function loadLatestCostLogs(
  prisma: PrismaClient,
  productIds: string[]
): Promise<Map<string, { totalCiu: number; calculatedAt: string }>> {
  if (productIds.length === 0) return new Map();

  const rows = await prisma.costCalculationLog.findMany({
    where: { productId: { in: productIds } },
    orderBy: { calculatedAt: "desc" },
    select: {
      productId: true,
      totalCiu: true,
      calculatedAt: true,
    },
  });

  const map = new Map<string, { totalCiu: number; calculatedAt: string }>();
  for (const row of rows) {
    if (map.has(row.productId)) continue;
    const totalCiu = Number(row.totalCiu);
    if (!Number.isFinite(totalCiu) || totalCiu <= 0) continue;
    map.set(row.productId, {
      totalCiu,
      calculatedAt: row.calculatedAt?.toISOString() ?? new Date().toISOString(),
    });
  }
  return map;
}

export function createCachedSalesOrderMarginCostResolver(
  resolveAnalysis: (productId: string) => Promise<unknown>,
  costLogs: Map<string, { totalCiu: number; calculatedAt: string }>
): SalesOrderMarginProductCostResolver {
  return async (productId: string) => ({
    analysis: await resolveAnalysis(productId),
    costLog: costLogs.get(productId) ?? null,
  });
}

export async function buildSalesOrderMarginInputs(
  prisma: PrismaClient,
  items: SalesOrderMarginResolverItem[],
  resolveAnalysis: (productId: string) => Promise<unknown>,
  options?: {
    productIndex?: SalesOrderMarginProductBatchIndex;
    costCache?: Map<string, { analysis?: unknown; costLog?: { totalCiu: number; calculatedAt: string } | null }>;
  }
): Promise<SalesOrderMarginItemInput[]> {
  const productIndex =
    options?.productIndex ?? (await loadSalesOrderMarginProductBatchIndex(prisma, items));
  const productResolutions = resolveSalesOrderItemProducts(items, productIndex);

  const productIds = [
    ...new Set(
      [...productResolutions.values()]
        .map((row) => row.productId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const costLogs = await loadLatestCostLogs(prisma, productIds);
  const costResolver = createCachedSalesOrderMarginCostResolver(resolveAnalysis, costLogs);
  const costResolutions = await resolveSalesOrderItemCosts(
    items,
    productResolutions,
    costResolver,
    options?.costCache
  );

  return buildSalesOrderMarginInputsFromResolutions(items, productResolutions, costResolutions);
}
