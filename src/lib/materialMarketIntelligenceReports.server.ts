/**
 * Carrega dados para o relatório executivo de Inteligência de Mercado (Prisma).
 */
import type { PrismaClient } from "@prisma/client";
import { buildMaterialBomImpactForApi } from "./materialBomImpact.js";
import {
  buildMaterialMarketIntelligenceReport,
  parseMaterialMarketReportQuery,
  type MaterialMarketIntelligenceReport,
  type MaterialMarketReportMaterialInput,
} from "./materialMarketIntelligenceReports.js";
import { loadMarketGlobalIndicators } from "./marketGlobalIndicators.server.js";

const BOM_LOAD_MATERIAL_LIMIT = 25;

export async function buildMaterialMarketIntelligenceReportForApi(
  db: PrismaClient,
  query: Record<string, unknown> = {}
): Promise<MaterialMarketIntelligenceReport> {
  const filters = parseMaterialMarketReportQuery(query);

  const materials = await db.material.findMany({
    where: {
      isMarketMonitored: true,
      ...(filters.materialId ? { id: filters.materialId } : {}),
      ...(filters.criticality ? { marketCriticality: filters.criticality } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    include: {
      MaterialPriceHistory: { orderBy: { effectiveDate: "desc" }, take: 1 },
      MaterialMarketQuote: {
        orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
      },
      MaterialMarketPurchaseLink: {
        orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
      },
    },
    orderBy: [{ marketCriticality: "desc" }, { code: "asc" }],
  });

  const materialIds = materials.map((material) => material.id);

  const [alerts, globalIndicators, bomByMaterial] = await Promise.all([
    materialIds.length
      ? db.materialMarketAlert.findMany({
          where: {
            materialId: { in: materialIds },
            ...(filters.alertStatus === "ALL" ? {} : { status: filters.alertStatus }),
          },
          include: {
            Material: { select: { code: true, description: true } },
          },
          orderBy: [{ triggeredAt: "desc" }],
          take: 200,
        })
      : Promise.resolve([]),
    loadMarketGlobalIndicators().catch(() => null),
    loadBomImpacts(db, materialIds),
  ]);

  const reportMaterials: MaterialMarketReportMaterialInput[] = materials.map((material) => ({
    id: material.id,
    code: material.code,
    description: material.description,
    unit: material.unit,
    category: material.category,
    currentCost: material.currentCost,
    isMarketMonitored: material.isMarketMonitored,
    marketCriticality: material.marketCriticality,
    supplier: material.supplier,
    marketMonitoringFrequencyDays: material.marketMonitoringFrequencyDays,
    MaterialPriceHistory: material.MaterialPriceHistory,
    MaterialMarketQuote: material.MaterialMarketQuote,
    purchaseLinks: material.MaterialMarketPurchaseLink,
    bomImpactItems: bomByMaterial.get(material.id) ?? [],
  }));

  return buildMaterialMarketIntelligenceReport({
    materials: reportMaterials,
    alerts,
    globalIndicators,
    filters,
  });
}

async function loadBomImpacts(
  db: PrismaClient,
  materialIds: string[]
): Promise<Map<string, NonNullable<MaterialMarketReportMaterialInput["bomImpactItems"]>>> {
  const map = new Map<string, NonNullable<MaterialMarketReportMaterialInput["bomImpactItems"]>>();
  const ids = materialIds.slice(0, BOM_LOAD_MATERIAL_LIMIT);
  if (!ids.length) return map;

  await Promise.all(
    ids.map(async (materialId) => {
      const payload = await buildMaterialBomImpactForApi(db, materialId);
      if ("notFound" in payload) return;
      map.set(materialId, payload.items);
    })
  );

  return map;
}
