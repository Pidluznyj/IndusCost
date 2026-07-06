/**
 * Montagem read-only da auditoria de rastreabilidade de custo — usa serviços existentes.
 */
import type { PrismaClient } from "@prisma/client";
import { civilDateToLocalDate, formatCivilDate, startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import { createProductCostAnalysisEngine, type ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import { evaluateProductEngineeringCost } from "./productEngineeringCostSnapshot.server.js";
import { getEffectiveProductProductionCost } from "./productionCostTables.server.js";
import { resolveProductEngineeringCostWarning } from "./productEngineeringCostWarning.js";
import {
  extractProductionCostBomAuditStructureFromAnalysis,
  extractProductionCostProcessPerformanceFromAnalysis,
  extractProductionCostWarningsFromAnalysis,
} from "./productionCostCalculationSnapshotAudit.js";
import { resolveCommercialPublishedTableContexts } from "./pricing/commercialPublishedPrices.server.js";
import { readPublishedPriceItemMetrics } from "./pricing/commercialPublishedPrices.server.js";
import { hasProductionCostDifference } from "./productEngineeringCostWarning.js";
import {
  buildEmptyProductCostTraceReport,
  buildProductCostTraceAlerts,
  mapBomLineToCostLine,
  mapProcessAuditToTrace,
  rankCostLinesByTotal,
  roundCost,
  type ProductCostTraceAuditQuery,
  type ProductCostTraceAuditReport,
  type ProductCostTraceCommercialPrice,
  type ProductCostTraceDataSource,
} from "./productCostTraceAudit.js";
import { OFFICIAL_PRODUCT_FINAL_COST_SOURCE } from "./productOfficialFinalCost.js";

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function buildProductCostTraceAudit(
  db: PrismaClient,
  query: ProductCostTraceAuditQuery,
  engine?: ProductCostAnalysisEngine
): Promise<ProductCostTraceAuditReport> {
  const refDate = startOfCivilDate(query.referenceDate);
  const referenceDateKey = toCivilDateKey(refDate) ?? formatCivilDate(refDate);
  const includeBom = query.includeBom !== false;
  const includeProcess = query.includeProcess !== false;
  const includeMaterials = query.includeMaterials !== false;

  const sku = query.sku?.trim() || null;
  const productId = query.productId?.trim() || null;

  if (!sku && !productId) {
    return buildEmptyProductCostTraceReport(referenceDateKey, "Informe --sku ou --product-id.");
  }

  const product = productId
    ? await db.product.findUnique({
        where: { id: productId },
        select: { id: true, sku: true, name: true, type: true, status: true },
      })
    : await db.product.findUnique({
        where: { sku: sku! },
        select: { id: true, sku: true, name: true, type: true, status: true },
      });

  if (!product) {
    const label = sku ?? productId ?? "—";
    return buildEmptyProductCostTraceReport(
      referenceDateKey,
      `Produto não encontrado para identificador: ${label}`
    );
  }

  const costEngine = engine ?? createProductCostAnalysisEngine(db);
  const evaluated = await evaluateProductEngineeringCost(db, costEngine, product.id);
  const resolved = evaluated.resolved;
  const engineeringCost =
    evaluated.calculable && resolved.ok ? roundCost(resolved.finalUnitCost) : null;

  const effective = await getEffectiveProductProductionCost(db, product.id, refDate);
  const hasOfficialCost = effective.status === "OK";
  const officialCost = hasOfficialCost ? roundCost(effective.unitProductionCost) : null;

  let publishedHash: string | null = null;
  let materialCostTableVersionId: string | null = null;
  let materialCostTableVersionCode: string | null = null;
  let versionPublishedAt: string | null = null;

  if (hasOfficialCost) {
    const [pubItem, pubVersion] = await Promise.all([
      db.productionCostTableItem.findUnique({
        where: { id: effective.costTableItemId },
        select: { calculationHash: true },
      }),
      db.productionCostTableVersion.findUnique({
        where: { id: effective.costTableVersionId },
        select: {
          publishedAt: true,
          materialCostTableVersionId: true,
          materialCostTableVersion: { select: { code: true } },
        },
      }),
    ]);
    publishedHash = pubItem?.calculationHash ?? null;
    materialCostTableVersionId = pubVersion?.materialCostTableVersionId ?? null;
    materialCostTableVersionCode = pubVersion?.materialCostTableVersion?.code ?? null;
    versionPublishedAt = pubVersion?.publishedAt?.toISOString() ?? null;
  }

  const draftItem = await db.productionCostTableItem.findFirst({
    where: { productId: product.id, costTableVersion: { status: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: { calculationHash: true, unitProductionCost: true },
  });

  const warning = resolveProductEngineeringCostWarning({
    officialCost,
    calculatedCost: engineeringCost,
    officialHash: publishedHash,
    calculatedHash: evaluated.calculationHash,
    hasDraft: draftItem != null,
    hasOfficialPublished: hasOfficialCost,
    errorMessage: evaluated.errorMessage,
  });

  const difference =
    engineeringCost != null && officialCost != null ? roundCost(engineeringCost - officialCost) : null;

  const breakdownSource = hasOfficialCost ? "ProductionCostTableItem (publicado)" : OFFICIAL_PRODUCT_FINAL_COST_SOURCE;
  const breakdown = hasOfficialCost
    ? {
        materialCost: roundCost(effective.breakdown.materialCost),
        laborCost: roundCost(effective.breakdown.laborCost),
        machineCost: roundCost(effective.breakdown.machineCost),
        overheadCost: roundCost(effective.breakdown.overheadCost),
        otherCost: roundCost(effective.breakdown.otherCost),
        totalCost: officialCost,
        source: breakdownSource,
      }
    : resolved.ok
      ? {
          materialCost: roundCost(resolved.breakdown.totalMaterialCost),
          laborCost: roundCost(resolved.breakdown.totalHH_Unit),
          machineCost: roundCost(resolved.breakdown.totalHM_Unit),
          overheadCost: roundCost(
            (resolved.breakdown.totalCIF_Unit ?? 0) + (resolved.breakdown.totalOPEX_Unit ?? 0)
          ),
          otherCost: null,
          totalCost: engineeringCost,
          source: breakdownSource,
        }
      : {
          materialCost: null,
          laborCost: null,
          machineCost: null,
          overheadCost: null,
          otherCost: null,
          totalCost: null,
          source: breakdownSource,
        };

  const baseTotal = breakdown.totalCost ?? engineeringCost ?? officialCost;
  const bomStructure = evaluated.analysis
    ? extractProductionCostBomAuditStructureFromAnalysis(evaluated.analysis)
    : { lines: [], lineCount: 0, materialLineCount: 0, componentLineCount: 0, excludedLineCount: 0, excludedBomLines: [] };

  const componentLines = includeBom
    ? bomStructure.lines
        .filter((line) => line.lineType === "COMPONENT")
        .map((line) => mapBomLineToCostLine(line, baseTotal))
    : [];

  const materialLinesRaw = includeMaterials
    ? bomStructure.lines.filter((line) => line.lineType === "MATERIAL")
    : [];
  const materialLines = materialLinesRaw.map((line) => mapBomLineToCostLine(line, baseTotal));
  const topCostRanking = rankCostLinesByTotal(materialLines);

  const processPerformance = evaluated.analysis
    ? extractProductionCostProcessPerformanceFromAnalysis(evaluated.analysis)
    : null;
  const processTrace =
    includeProcess && processPerformance
      ? mapProcessAuditToTrace(processPerformance, {
          laborCost: breakdown.laborCost,
          machineCost: breakdown.machineCost,
        })
      : null;

  const commercialPrices = await loadCommercialPricesForProduct(db, product.id, refDate, officialCost);

  const engineWarnings = evaluated.analysis
    ? extractProductionCostWarningsFromAnalysis(evaluated.analysis).map((w) => ({
        code: w.code,
        message: w.message,
        severity: w.severity,
      }))
    : [];

  const alerts = buildProductCostTraceAlerts({
    bomLines: bomStructure.lines,
    warning,
    hasOfficialCost,
    engineeringCost,
    officialCost,
    commercialPrices,
    engineWarnings,
  });

  const dataSources: ProductCostTraceDataSource[] = [
    {
      field: "engineeringCost",
      source: "evaluateProductEngineeringCost → ProductCostAnalysisEngine",
      note: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
    },
    {
      field: "officialPublishedCost",
      source: "getEffectiveProductProductionCost",
      note: "ProductionCostTableVersion PUBLISHED/SUPERSEDED vigente",
    },
    {
      field: "bom",
      source: "extractProductionCostBomAuditStructureFromAnalysis",
      note: "Motor vivo (não recalcula nem grava)",
    },
    {
      field: "process",
      source: "extractProductionCostProcessPerformanceFromAnalysis",
      note: "Ciclo/cavidades do motor vivo",
    },
    {
      field: "materialCostTable",
      source: materialCostTableVersionId ? "ProductionCostTableVersion.materialCostTableVersionId" : "—",
    },
    {
      field: "commercialPrices",
      source: "resolveCommercialPublishedTableContexts + priceTableItem",
    },
  ];

  const checklist: Record<string, boolean | string> = {
    hasIndustrialCostEngine: true,
    hasBomTree: bomStructure.lineCount > 0,
    hasProcessData: processPerformance?.processSource !== "NONE",
    hasPublishedMaterialCostTable: materialCostTableVersionId != null,
    hasPublishedProductionCostTable: hasOfficialCost,
    productUsesOfficialCost: hasOfficialCost,
    officialVersionCode: hasOfficialCost ? effective.versionCode : "—",
    bomComponentsHaveOfficialCost: componentLines.every((line) => (line.unitCost ?? 0) > 0),
    materialsHaveVigentCost: materialLines.every((line) => (line.unitCost ?? 0) > 0),
    usesExistingServices: true,
  };

  return {
    status: "PASS",
    auditedAt: new Date().toISOString(),
    referenceDate: referenceDateKey,
    product: {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      type: product.type,
      status: product.status,
    },
    currentCost: {
      engineeringCost,
      engineeringSource: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
      officialPublishedCost: officialCost,
      officialSource: "getEffectiveProductProductionCost",
      difference,
      warning,
    },
    officialVersion: {
      versionId: hasOfficialCost ? effective.costTableVersionId : null,
      versionCode: hasOfficialCost ? effective.versionCode : null,
      versionName: hasOfficialCost ? effective.versionName : null,
      revision: hasOfficialCost ? effective.revision : null,
      status: hasOfficialCost ? "PUBLISHED" : null,
      effectiveDate: hasOfficialCost ? toCivilDateKey(effective.effectiveDate) : null,
      publishedAt: versionPublishedAt,
      materialCostTableVersionId,
      materialCostTableVersionCode,
    },
    costBreakdown: breakdown,
    bom: {
      included: includeBom,
      componentCount: componentLines.length,
      components: componentLines,
      source: "ProductCostAnalysisEngine (vivo)",
    },
    materials: {
      included: includeMaterials,
      materialCount: materialLines.length,
      materials: materialLines,
      topCostRanking,
      source: "ProductCostAnalysisEngine (vivo)",
    },
    process: {
      included: includeProcess,
      cycleTimeSeconds: processTrace?.cycleTimeSeconds ?? null,
      cavities: processTrace?.cavities ?? null,
      laborCost: processTrace?.laborCost ?? null,
      machineCost: processTrace?.machineCost ?? null,
      efficiencyExpectedPercent: processTrace?.efficiencyExpectedPercent ?? null,
      setupTimeMin: processTrace?.setupTimeMin ?? null,
      netPiecesPerHour: processTrace?.netPiecesPerHour ?? null,
      processSource: processTrace?.processSource ?? null,
      dataSource: processTrace?.dataSource ?? null,
      source: "ProductCostAnalysisEngine (vivo)",
    },
    commercialPrices,
    alerts,
    dataSources,
    checklist,
  };
}

async function loadCommercialPricesForProduct(
  db: PrismaClient,
  productId: string,
  referenceDate: Date,
  officialCost: number | null
): Promise<ProductCostTraceCommercialPrice[]> {
  const tables = await resolveCommercialPublishedTableContexts(db, { referenceDate, maxTables: 8 });
  if (tables.length === 0) return [];

  const versionIds = tables.map((t) => t.versionId);
  const items = await db.priceTableItem.findMany({
    where: { productId, priceTableVersionId: { in: versionIds } },
    select: {
      priceTableVersionId: true,
      salePrice: true,
      frozenTotalCost: true,
      formulaSnapshotJson: true,
      marginPct: true,
      commissionPerc: true,
      PriceTableVersion: {
        select: {
          versionNumber: true,
          publishedAt: true,
          PriceTable: { select: { code: true, name: true } },
        },
      },
    },
  });

  const byVersionId = new Map(items.map((item) => [item.priceTableVersionId, item]));

  return tables
    .map((table) => {
      const item = byVersionId.get(table.versionId);
      if (!item) return null;
      const metrics = readPublishedPriceItemMetrics(item);
      const frozen = decimalToNumber(item.frozenTotalCost);
      const stale =
        officialCost != null &&
        frozen != null &&
        hasProductionCostDifference(officialCost, frozen);
      return {
        priceTableCode: table.tableCode,
        priceTableName: table.tableName,
        versionNumber: item.PriceTableVersion.versionNumber,
        salePrice: metrics.salePrice,
        frozenTotalCost: frozen,
        publishedAt: item.PriceTableVersion.publishedAt?.toISOString() ?? null,
        staleVsOfficialCost: stale,
        costDifference:
          officialCost != null && frozen != null ? roundCost(frozen - officialCost) : null,
      } satisfies ProductCostTraceCommercialPrice;
    })
    .filter((row): row is ProductCostTraceCommercialPrice => row != null);
}

export function parseProductCostTraceReferenceDate(raw: string | undefined): Date {
  if (!raw?.trim()) return startOfCivilDate(new Date());
  const parsed = civilDateToLocalDate(raw.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data inválida em --date: ${raw}. Use YYYY-MM-DD.`);
  }
  return parsed;
}
