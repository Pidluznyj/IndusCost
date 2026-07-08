/**
 * Orquestração server-side do impacto financeiro 360º — reutiliza motor de custo e preços comerciais.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "./financeCivilDate.js";
import { buildCurrentCostSnapshotFromAnalysis } from "./productCostSnapshot.js";
import { createProductCostAnalysisEngine, type ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  computeMaterialProductFinancialImpacts,
  mapProductImpactToFinancialImpactRow,
  buildMaterialProductFinancialImpactResponse,
  resolveDefaultMaterialSimulationPrices,
  sumMaterialLineCostFromAnalysis,
  type MaterialProductBomUsageInput,
  type MaterialProductFinancialImpactResponse,
} from "./materialProductFinancialImpact.js";
import { mapProductPricingRates } from "./materialMarketSimulation.js";
import {
  readPublishedPriceItemMetrics,
  resolveCommercialPublishedTableContexts,
} from "./pricing/commercialPublishedPrices.server.js";
import { COMMERCIAL_TABLE_CODE_PRIORITY } from "./pricing/commercialPublishedPrices.types.js";

function decimalToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function resolvePrimarySellingPriceForProduct(
  db: PrismaClient,
  productId: string,
  referenceDate: Date
): Promise<{ salePrice: number | null; tableCode: string | null; targetMarginPct: number | null }> {
  const tables = await resolveCommercialPublishedTableContexts(db, {
    referenceDate,
    maxTables: 8,
  });
  if (tables.length === 0) {
    return { salePrice: null, tableCode: null, targetMarginPct: null };
  }

  const versionIds = tables.map((table) => table.versionId);
  const items = await db.priceTableItem.findMany({
    where: { productId, priceTableVersionId: { in: versionIds } },
    select: {
      priceTableVersionId: true,
      salePrice: true,
      frozenTotalCost: true,
      marginPct: true,
      commissionPerc: true,
      formulaSnapshotJson: true,
    },
  });
  const byVersionId = new Map(items.map((item) => [item.priceTableVersionId, item]));

  const orderedTables = [
    ...COMMERCIAL_TABLE_CODE_PRIORITY.flatMap((code) =>
      tables.filter((table) => table.tableCode === code)
    ),
    ...tables.filter(
      (table) => !COMMERCIAL_TABLE_CODE_PRIORITY.includes(table.tableCode as never)
    ),
  ];

  for (const table of orderedTables) {
    const item = byVersionId.get(table.versionId);
    if (!item) continue;
    const metrics = readPublishedPriceItemMetrics(item);
    if (metrics.salePrice != null && metrics.salePrice > 0) {
      return {
        salePrice: metrics.salePrice,
        tableCode: table.tableCode,
        targetMarginPct: metrics.marginPercent,
      };
    }
  }

  return { salePrice: null, tableCode: null, targetMarginPct: null };
}

async function loadProductsForFinancialImpact(
  db: PrismaClient,
  materialId: string,
  getProductCostAnalysis: (productId: string) => Promise<unknown>
): Promise<MaterialProductBomUsageInput[]> {
  const bomRows = await db.productBOM.findMany({
    where: { materialId },
    select: {
      id: true,
      quantity: true,
      lossPercentage: true,
      ParentProduct: {
        select: { id: true, sku: true, name: true, status: true },
      },
    },
  });

  const products: MaterialProductBomUsageInput[] = [];

  for (const row of bomRows) {
    const parent = row.ParentProduct;
    if (!parent || (parent.status != null && parent.status !== "ACTIVE")) continue;

    const analysis = await getProductCostAnalysis(parent.id);
    const snapshot = buildCurrentCostSnapshotFromAnalysis(analysis);
    if (!snapshot) continue;

    const pricing = await db.productPricing.findFirst({
      where: { productId: parent.id, status: "ACTIVE" },
      include: { TaxRule: { include: { TaxComponent: { select: { percentage: true } } } } },
    });
    const pricingRates = pricing ? mapProductPricingRates(pricing) : null;

    const detailMaterials =
      analysis &&
      typeof analysis === "object" &&
      "details" in analysis &&
      analysis.details &&
      typeof analysis.details === "object" &&
      "materials" in analysis.details &&
      Array.isArray((analysis.details as { materials?: unknown }).materials)
        ? ((analysis.details as { materials: Array<Record<string, unknown>> }).materials)
        : undefined;

    products.push({
      productId: parent.id,
      sku: parent.sku,
      name: parent.name,
      bomLineId: row.id,
      bomQuantity: decimalToNumber(row.quantity),
      lossPercentage: decimalToNumber(row.lossPercentage),
      costAnalysis: {
        totalIndustrialCost: snapshot.totalIndustrialCost,
        materialLineCost: sumMaterialLineCostFromAnalysis(
          detailMaterials as Parameters<typeof sumMaterialLineCostFromAnalysis>[0],
          materialId,
          row.id
        ),
      },
      pricingRates,
    });
  }

  return products;
}

export async function buildMaterialProductFinancialImpactForApi(
  db: PrismaClient,
  input: {
    materialId: string;
    currentCost: unknown;
    quotes: Array<{
      quoteDate: Date | string;
      netPrice: unknown;
      currency?: string | null;
      status?: string | null;
    }>;
    baselineMaterialPriceBRL?: number | null;
    simulatedMaterialPriceBRL?: number | null;
    referenceDate?: Date;
    engine?: ProductCostAnalysisEngine;
  }
): Promise<MaterialProductFinancialImpactResponse> {
  const referenceDate = startOfCivilDate(input.referenceDate ?? new Date());
  const prices = resolveDefaultMaterialSimulationPrices({
    currentCost: input.currentCost as number,
    quotes: input.quotes.map((quote) => ({
      quoteDate: quote.quoteDate,
      netPrice: quote.netPrice as number,
      currency: quote.currency ?? "BRL",
      status: quote.status ?? "ACTIVE",
    })),
    baselineMaterialPriceBRL: input.baselineMaterialPriceBRL,
    simulatedMaterialPriceBRL: input.simulatedMaterialPriceBRL,
  });

  if (prices.baselineMaterialPriceBRL == null || prices.simulatedMaterialPriceBRL == null) {
    return buildMaterialProductFinancialImpactResponse({
      materialId: input.materialId,
      prices,
      rows: [],
    });
  }

  const engine = input.engine ?? createProductCostAnalysisEngine(db);
  const getAnalysis = async (productId: string) => {
    const cache = await engine.initAnalysisCache();
    return engine.getProductCostAnalysis(productId, cache, true);
  };

  const products = await loadProductsForFinancialImpact(db, input.materialId, getAnalysis);

  const financial = computeMaterialProductFinancialImpacts({
    materialId: input.materialId,
    currentMaterialPriceBRL: prices.baselineMaterialPriceBRL,
    simulatedMaterialPriceBRL: prices.simulatedMaterialPriceBRL,
    products,
  });

  const bomQtyByProductId = new Map<string, number>();
  for (const product of products) {
    const current = bomQtyByProductId.get(product.productId) ?? 0;
    bomQtyByProductId.set(
      product.productId,
      Math.round((current + product.bomQuantity) * 1_000_000) / 1_000_000
    );
  }

  const rows = await Promise.all(
    financial.productImpacts.map(async (impact) => {
      const selling = await resolvePrimarySellingPriceForProduct(db, impact.productId, referenceDate);
      return mapProductImpactToFinancialImpactRow({
        impact,
        bomQuantity: bomQtyByProductId.get(impact.productId) ?? 0,
        sellingPrice: selling.salePrice,
        sellingPriceTableCode: selling.tableCode,
        targetMarginPct: selling.targetMarginPct,
      });
    })
  );

  return buildMaterialProductFinancialImpactResponse({
    materialId: input.materialId,
    prices,
    rows,
  });
}
