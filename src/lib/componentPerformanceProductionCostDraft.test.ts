/**
 * Performance operacional (ciclo/cavidades) → novo DRAFT de custo de produção.
 * Motor único: getProductCostAnalysis lê Product.cycleTimeSeconds / cavities vivos.
 * Publicações antigas permanecem congeladas no calculationSnapshot.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import { computeStandardProcessUnitCosts } from "./componentStandardProcessCost.js";
import {
  buildProductionCostPerformanceAuditWarnings,
  extractProductionCostProcessPerformanceFromAnalysis,
  PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE,
} from "./productionCostCalculationSnapshotAudit.js";
import {
  buildProductionCostCalculationHash,
  buildProductionCostCalculationSnapshot,
  buildProductionCostDraftItemFromAnalysis,
} from "./productionCostPublication.js";
import type { OfficialProductFinalCostSuccess } from "./productOfficialFinalCost.js";
import {
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";
import { resolveSalesOrderItemCostFromVersionedProduction } from "./salesOrderMarginResolver.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const HH_HM = {
  globalHhCostPerHour: 25,
  machineHourCostPerHour: 50000 / 220,
};

const PROCESS_BASE = {
  efficiencyExpectedPercent: 100,
  setupTimeMin: 0,
  lotSize: 1,
  ...HH_HM,
};

function componentAnalysis(cycle: number, cavities: number, materialCost = 0) {
  const computed = computeStandardProcessUnitCosts({
    cycleTimeSeconds: cycle,
    cavities,
    ...PROCESS_BASE,
  });
  assert.equal(computed.ok, true);
  if (!computed.ok) throw new Error("unexpected compute failure");

  const totalHH = computed.totalHH_Unit;
  const totalHM = computed.totalHM_Unit;
  const finalUnitCost = materialCost + totalHH + totalHM;

  return {
    productId: "comp-perf-1",
    sku: "309.86AA",
    name: "Mangote teste",
    productType: "COMPONENT",
    totalMaterialCost: materialCost,
    totalHH_Unit: totalHH,
    totalHM_Unit: totalHM,
    totalIndustrialCost: finalUnitCost,
    costAnalysisPartial: false,
    warnings: [],
    details: {
      materials: [],
      processBreakdown: [
        {
          source: "STANDARD_PROCESS",
          description: "Processo Padrão do Componente",
          laborCost: totalHH,
          machineCost: totalHM,
          total: computed.totalStepCost,
          calculationDetails: {
            cycle,
            cavities,
            efficiency: 100,
            setupTimeMin: 0,
            netPph: computed.netPph,
          },
        },
      ],
    },
  };
}

function resolvedFromAnalysis(analysis: ReturnType<typeof componentAnalysis>): OfficialProductFinalCostSuccess {
  return {
    ok: true,
    productId: analysis.productId,
    sku: analysis.sku,
    finalUnitCost: analysis.totalIndustrialCost,
    source: "PRODUCT_ENGINEERING_FINAL_COST",
    costAnalysisPartial: false,
    breakdown: {
      totalMaterialCost: analysis.totalMaterialCost,
      totalHH_Unit: analysis.totalHH_Unit,
      totalHM_Unit: analysis.totalHM_Unit,
      totalCIF_Unit: 0,
      totalOPEX_Unit: 0,
    },
  };
}

function d(iso: string): Date {
  return civilDateToLocalDate(iso);
}

describe("componentPerformanceProductionCostDraft — motor e campos vivos", () => {
  it("getProductCostAnalysis já lê cycleTimeSeconds e cavities do Product (caracterização)", () => {
    const engine = read("src/lib/productCostAnalysisEngine.server.ts");
    assert.match(engine, /product\.cycleTimeSeconds/);
    assert.match(engine, /product\.cavities/);
    assert.match(engine, /buildStandardOperationItems/);
    assert.match(engine, /computeStandardProcessUnitCosts/);
  });

  it("patchComponentPerformanceProduct atualiza os mesmos campos vivos do cadastro", () => {
    const service = read("src/lib/componentPerformanceChange.server.ts");
    assert.match(service, /cycleTimeSeconds: after\.cycleTimeSeconds/);
    assert.match(service, /cavities: after\.cavities/);
    assert.doesNotMatch(service, /productionCostTableItem\.update/);
    assert.doesNotMatch(service, /PriceTableItem/);
  });
});

describe("componentPerformanceProductionCostDraft — impacto em novo DRAFT", () => {
  it("alterar ciclo no componente altera HH/HM e custo final do novo snapshot", () => {
    const before = componentAnalysis(64, 24);
    const after = componentAnalysis(128, 24);

    assert.ok(after.totalHH_Unit > before.totalHH_Unit);
    assert.ok(after.totalHM_Unit > before.totalHM_Unit);
    assert.ok(after.totalIndustrialCost > before.totalIndustrialCost);

    const snapBefore = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(before),
      before,
      { name: "Mangote teste", type: "COMPONENT" },
      new Date("2026-07-01T10:00:00.000Z")
    );
    const snapAfter = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(after),
      after,
      { name: "Mangote teste", type: "COMPONENT" },
      new Date("2026-07-02T10:00:00.000Z")
    );

    assert.equal(snapBefore.processPerformance.cycleTimeSeconds, 64);
    assert.equal(snapAfter.processPerformance.cycleTimeSeconds, 128);
    assert.equal(snapBefore.processPerformance.dataSource, "PRODUCT_LIVE_FIELDS");
    assert.ok(snapAfter.finalUnitCost > snapBefore.finalUnitCost);
    assert.notEqual(
      buildProductionCostCalculationHash(snapBefore),
      buildProductionCostCalculationHash(snapAfter)
    );
  });

  it("alterar cavidades no componente altera HH/HM e custo final do novo snapshot", () => {
    const before = componentAnalysis(64, 24);
    const after = componentAnalysis(64, 12);

    assert.ok(after.totalIndustrialCost > before.totalIndustrialCost);

    const snapBefore = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(before),
      before,
      { name: "Mangote teste", type: "COMPONENT" }
    );
    const snapAfter = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(after),
      after,
      { name: "Mangote teste", type: "COMPONENT" }
    );

    assert.equal(snapBefore.processPerformance.cavities, 24);
    assert.equal(snapAfter.processPerformance.cavities, 12);
    assert.ok(snapAfter.finalUnitCost > snapBefore.finalUnitCost);
  });

  it("calculationSnapshot inclui ciclo, cavidades, fonte, SKU e aviso operacional", () => {
    const analysis = componentAnalysis(45, 8);
    const snapshot = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(analysis),
      analysis,
      { name: "Mangote teste", type: "COMPONENT" },
      new Date("2026-07-01T12:00:00.000Z")
    );

    assert.equal(snapshot.productId, "comp-perf-1");
    assert.equal(snapshot.sku, "309.86AA");
    assert.equal(snapshot.calculatedAt, "2026-07-01T12:00:00.000Z");
    assert.equal(snapshot.processPerformance.processSource, "STANDARD_PROCESS");
    assert.equal(snapshot.processPerformance.cycleTimeSeconds, 45);
    assert.equal(snapshot.processPerformance.cavities, 8);
    assert.equal(snapshot.processPerformance.dataSource, "PRODUCT_LIVE_FIELDS");
    assert.match(snapshot.processPerformance.liveOperationalNotice, /Performance/);
    assert.equal(snapshot.analysisSummary.cycleTimeSeconds, 45);
    assert.equal(snapshot.analysisSummary.cavities, 8);
    assert.equal(snapshot.calculationHashInputVersion, 4);
  });

  it("componente sem processo gera warning PERFORMANCE_DATA_MISSING", () => {
    const analysis = {
      productId: "comp-empty",
      sku: "EMPTY-01",
      productType: "COMPONENT",
      ownProcessSkipped: false,
      warnings: [],
      details: { materials: [], processBreakdown: [] },
    };
    const performance = extractProductionCostProcessPerformanceFromAnalysis(analysis);
    const warnings = buildProductionCostPerformanceAuditWarnings(performance, "COMPONENT");
    assert.equal(warnings.some((w) => w.code === "PERFORMANCE_DATA_MISSING"), true);
  });
});

describe("componentPerformanceProductionCostDraft — congelamento de publicação", () => {
  it("custo publicado anterior não muda quando campos vivos são alterados (simulado)", () => {
    const publishedAt = new Date("2026-06-01T08:00:00.000Z");
    const analysisBefore = componentAnalysis(64, 24);
    const frozenItem = buildProductionCostDraftItemFromAnalysis(
      { id: "comp-perf-1", sku: "309.86AA", name: "Mangote teste", type: "COMPONENT" },
      resolvedFromAnalysis(analysisBefore),
      analysisBefore,
      publishedAt
    );

    const originalJson = JSON.stringify(frozenItem.calculationSnapshot);
    const originalHash = frozenItem.calculationHash;
    const originalCost = frozenItem.unitProductionCost;

    const analysisAfter = componentAnalysis(90, 16);
    const liveDraft = buildProductionCostDraftItemFromAnalysis(
      { id: "comp-perf-1", sku: "309.86AA", name: "Mangote teste", type: "COMPONENT" },
      resolvedFromAnalysis(analysisAfter),
      analysisAfter,
      new Date("2026-07-02T08:00:00.000Z")
    );

    assert.equal(JSON.stringify(frozenItem.calculationSnapshot), originalJson);
    assert.equal(frozenItem.calculationHash, originalHash);
    assert.equal(frozenItem.unitProductionCost, originalCost);
    assert.notEqual(liveDraft.unitProductionCost, frozenItem.unitProductionCost);

    const frozenSnap = frozenItem.calculationSnapshot as {
      processPerformance: { cycleTimeSeconds: number; cavities: number };
    };
    const liveSnap = liveDraft.calculationSnapshot as {
      processPerformance: { cycleTimeSeconds: number; cavities: number };
    };
    assert.equal(frozenSnap.processPerformance.cycleTimeSeconds, 64);
    assert.equal(frozenSnap.processPerformance.cavities, 24);
    assert.equal(liveSnap.processPerformance.cycleTimeSeconds, 90);
    assert.equal(liveSnap.processPerformance.cavities, 16);
  });

  it("calculationSnapshot antigo mantém ciclo/cavidades; novo usa valores atualizados", () => {
    const oldSnap = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(componentAnalysis(50, 4)),
      componentAnalysis(50, 4),
      { name: "Comp", type: "COMPONENT" }
    );
    const newSnap = buildProductionCostCalculationSnapshot(
      resolvedFromAnalysis(componentAnalysis(40, 6)),
      componentAnalysis(40, 6),
      { name: "Comp", type: "COMPONENT" }
    );

    assert.equal(oldSnap.processPerformance.cycleTimeSeconds, 50);
    assert.equal(oldSnap.processPerformance.cavities, 4);
    assert.equal(newSnap.processPerformance.cycleTimeSeconds, 40);
    assert.equal(newSnap.processPerformance.cavities, 6);
    assert.equal(
      oldSnap.processPerformance.liveOperationalNotice,
      PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE
    );
  });

  it("margem de pedido antigo continua usando custo publicado congelado", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      {
        id: "v-pub",
        code: "2026-06",
        name: "Jun/2026",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        publishedAt: d("2026-06-01"),
        createdAt: d("2026-06-01"),
        items: [
          {
            id: "item-1",
            costTableVersionId: "v-pub",
            productId: "comp-perf-1",
            productCodeSnapshot: "309.86AA",
            productNameSnapshot: "Mangote",
            unitProductionCost: 1.25,
            currency: "BRL",
            calculationHash: "hash-frozen",
            calculationSnapshot: buildProductionCostCalculationSnapshot(
              {
                ok: true,
                productId: "comp-perf-1",
                sku: "309.86AA",
                finalUnitCost: 1.25,
                source: "PRODUCT_ENGINEERING_FINAL_COST",
                costAnalysisPartial: false,
                breakdown: {
                  totalMaterialCost: 0,
                  totalHH_Unit: 0.75,
                  totalHM_Unit: 0.5,
                  totalCIF_Unit: 0,
                  totalOPEX_Unit: 0,
                },
              },
              componentAnalysis(64, 24),
              { name: "Mangote", type: "COMPONENT" }
            ),
            createdAt: d("2026-06-01"),
            breakdown: {
              materialCost: 0,
              processCost: 0,
              laborCost: 0.75,
              machineCost: 0.5,
              overheadCost: 0,
              otherCost: 0,
            },
          },
        ],
      },
    ];

    const effective = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "comp-perf-1",
      d("2026-06-15")
    );
    assert.equal(effective.status, "OK");

    const marginCost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "so-line-old",
      productId: "comp-perf-1",
      referenceDate: d("2026-06-15"),
      effectiveCost: effective.status === "OK" ? effective : null,
    });

    assert.equal(marginCost.costSource, "VERSIONED_PRODUCTION_COST");
    assert.equal(marginCost.unitCost, 1.25);
    assert.equal(marginCost.marginCostMode, "HISTORICAL_FROZEN");

    const liveWouldBe = computeStandardProcessUnitCosts({
      cycleTimeSeconds: 90,
      cavities: 16,
      ...PROCESS_BASE,
    });
    assert.equal(liveWouldBe.ok, true);
    if (!liveWouldBe.ok) return;
    assert.notEqual(liveWouldBe.totalHH_Unit + liveWouldBe.totalHM_Unit, 1.25);
  });
});
