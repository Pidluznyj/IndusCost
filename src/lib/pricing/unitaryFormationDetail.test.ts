import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildUnitaryFormationProductDetailResponse,
  buildUnitaryFormationProductDetailUrl,
  mapUnitaryFormationBomLines,
  mapUnitaryFormationLiveCost,
  mapUnitaryFormationPublishedCost,
  parseUnitaryFormationProductDetailRequest,
  resolveUnitaryFormationComparison,
  resolveUnitaryFormationProcessSource,
  unitaryFormationComparisonStatusLabel,
  type UnitaryFormationProductRow,
} from "./unitaryFormationDetail.js";
import { OFFICIAL_PRODUCT_FINAL_COST_SOURCE } from "../productOfficialFinalCost.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const product: UnitaryFormationProductRow = {
  id: "11111111-1111-4111-8111-111111111111",
  sku: "320.03AA",
  name: "Tampa Superior",
  type: "PRODUCT",
  status: "ACTIVE",
  costingMode: "OWN_PROCESS",
  cycleTimeSeconds: 12.5,
  cavities: 4,
  efficiencyExpected: 85,
  setupTimeMin: 30,
  defaultLotSize: 1000,
  routingStepCount: 0,
};

function liveAnalysis(partial = false) {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    totalMaterialCost: 1.2,
    totalHH_Unit: 0.3,
    totalHM_Unit: 0.2,
    totalCIF_Unit: 0.05,
    totalOPEX_Unit: 0.01,
    totalIndustrialCost: 1.7,
    costAnalysisPartial: partial,
    warnings: [
      {
        code: "TEST_WARN",
        severity: "warning",
        message: "aviso de teste",
        context: "BOM_LINE",
      },
    ],
    details: {
      materials: [
        {
          lineType: "MATERIAL",
          bomLineId: "bom-1",
          sku: "MP-01",
          description: "Resina",
          quantity: 0.01,
          lossPercentage: 2,
          unitCostUsed: 10,
          unitCost: 0.102040816,
          materialId: "mat-1",
          childProductId: null,
          excludedFromCost: false,
        },
        {
          lineType: "COMPONENT",
          bomLineId: "bom-2",
          sku: "CMP-01",
          name: "Inserto",
          quantity: 1,
          lossPercentage: 0,
          unitCostUsed: 0.5,
          unitCost: 0.5,
          materialId: null,
          childProductId: "child-1",
          excludedFromCost: false,
        },
      ],
    },
  };
}

describe("unitaryFormationDetail pure", () => {
  it("mapeia LIVE a partir do motor oficial sem recalcular fórmula", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis());
    assert.equal(live.origin, "LIVE");
    assert.equal(live.source, OFFICIAL_PRODUCT_FINAL_COST_SOURCE);
    assert.equal(live.status, "OK");
    assert.equal(live.materialCost, 1.2);
    assert.equal(live.laborCost, 0.3);
    assert.equal(live.machineCost, 0.2);
    assert.equal(live.processCost, 0.5);
    assert.equal(live.totalIndustrialCost, 1.7);
    assert.equal(live.costAnalysisPartial, false);
    assert.equal(live.warnings.length, 1);
  });

  it("LIVE parcial e LIVE com erro", () => {
    const partial = mapUnitaryFormationLiveCost(liveAnalysis(true));
    assert.equal(partial.status, "PARTIAL");
    assert.equal(partial.costAnalysisPartial, true);

    const failed = mapUnitaryFormationLiveCost({
      error: "CONFIG_MISSING",
      message: "FACTORY_HOURS_MONTHLY inválido.",
    });
    assert.equal(failed.status, "ERROR");
    assert.equal(failed.error?.code, "CONFIG_MISSING");
    assert.equal(failed.totalIndustrialCost, null);
  });

  it("mapeia PUBLISHED vigente e SEM_CUSTO", () => {
    const ok = mapUnitaryFormationPublishedCost(
      {
        status: "OK",
        productId: product.id,
        unitProductionCost: 1.7,
        costTableVersionId: "ver-1",
        costTableItemId: "item-1",
        effectiveDate: new Date(2026, 9, 1),
        versionName: "PCT",
        versionCode: "PCT-2026-10-01",
        revision: 2,
        publishedAt: new Date("2026-10-01T14:00:00.000Z"),
        currency: "BRL",
        breakdown: {
          materialCost: 1.2,
          processCost: 0.5,
          laborCost: 0.3,
          machineCost: 0.2,
          overheadCost: 0,
          otherCost: 0,
        },
        calculationSnapshot: null,
      },
      "PUBLISHED"
    );
    assert.equal(ok.status, "OK");
    assert.equal(ok.versionId, "ver-1");
    assert.equal(ok.code, "PCT-2026-10-01");
    assert.equal(ok.revision, 2);
    assert.equal(ok.versionStatus, "PUBLISHED");
    assert.equal(ok.unitProductionCost, 1.7);

    const missing = mapUnitaryFormationPublishedCost(
      { status: "SEM_CUSTO", productId: product.id, referenceDate: new Date(2026, 9, 5) },
      null
    );
    assert.equal(missing.status, "SEM_CUSTO");
    assert.equal(missing.unitProductionCost, null);
  });

  it("comparison: IGUAL, ALTERADO, SEM_CUSTO_PUBLICADO, ERRO_CALCULO, CUSTO_PARCIAL", () => {
    const liveOk = mapUnitaryFormationLiveCost(liveAnalysis());
    const publishedOk = mapUnitaryFormationPublishedCost(
      {
        status: "OK",
        productId: product.id,
        unitProductionCost: 1.7,
        costTableVersionId: "ver-1",
        costTableItemId: "item-1",
        effectiveDate: new Date(2026, 9, 1),
        versionName: "PCT",
        versionCode: "PCT-2026-10-01",
        revision: 1,
        publishedAt: null,
        currency: "BRL",
        breakdown: {
          materialCost: 1.2,
          processCost: 0.5,
          laborCost: 0.3,
          machineCost: 0.2,
          overheadCost: 0,
          otherCost: 0,
        },
        calculationSnapshot: null,
      },
      "PUBLISHED"
    );
    assert.equal(resolveUnitaryFormationComparison(liveOk, publishedOk).status, "IGUAL");

    const publishedChanged = { ...publishedOk, unitProductionCost: 1.5 };
    const altered = resolveUnitaryFormationComparison(liveOk, publishedChanged);
    assert.equal(altered.status, "ALTERADO");
    assert.ok(altered.diffValue != null && altered.diffValue > 0);

    const publishedMissing = mapUnitaryFormationPublishedCost(
      { status: "SEM_CUSTO", productId: product.id, referenceDate: new Date() },
      null
    );
    assert.equal(
      resolveUnitaryFormationComparison(liveOk, publishedMissing).status,
      "SEM_CUSTO_PUBLICADO"
    );

    const liveErr = mapUnitaryFormationLiveCost({ error: "BOM_CYCLE", message: "ciclo" });
    assert.equal(
      resolveUnitaryFormationComparison(liveErr, publishedOk).status,
      "ERRO_CALCULO"
    );

    const livePartial = mapUnitaryFormationLiveCost(liveAnalysis(true));
    assert.equal(
      resolveUnitaryFormationComparison(livePartial, publishedOk).status,
      "CUSTO_PARCIAL"
    );
  });

  it("BOM reutiliza details.materials do motor", () => {
    const bom = mapUnitaryFormationBomLines(liveAnalysis());
    assert.equal(bom.length, 2);
    assert.equal(bom[0]?.lineType, "MATERIAL");
    assert.equal(bom[0]?.sku, "MP-01");
    assert.equal(bom[0]?.materialId, "mat-1");
    assert.equal(bom[1]?.lineType, "COMPONENT");
    assert.equal(bom[1]?.childProductId, "child-1");
  });

  it("processSource espelha precedência do motor", () => {
    assert.equal(
      resolveUnitaryFormationProcessSource({
        type: "PRODUCT",
        cycleTimeSeconds: 10,
        routingStepCount: 3,
      }),
      "STANDARD_PROCESS"
    );
    assert.equal(
      resolveUnitaryFormationProcessSource({
        type: "COMPONENT",
        cycleTimeSeconds: null,
        routingStepCount: 2,
      }),
      "ROUTING"
    );
    assert.equal(
      resolveUnitaryFormationProcessSource({
        type: "COMPONENT",
        cycleTimeSeconds: null,
        routingStepCount: 0,
      }),
      "NONE"
    );
  });

  it("resposta consolidada é determinística com generatedAt fixo", () => {
    const response = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: liveAnalysis(),
      effective: {
        status: "OK",
        productId: product.id,
        unitProductionCost: 1.7,
        costTableVersionId: "ver-1",
        costTableItemId: "item-1",
        effectiveDate: new Date(2026, 9, 1),
        versionName: "PCT",
        versionCode: "PCT-2026-10-01",
        revision: 2,
        publishedAt: new Date("2026-10-01T14:00:00.000Z"),
        currency: "BRL",
        breakdown: {
          materialCost: 1.2,
          processCost: 0.5,
          laborCost: 0.3,
          machineCost: 0.2,
          overheadCost: 0,
          otherCost: 0,
        },
        calculationSnapshot: null,
      },
      publishedVersionStatus: "PUBLISHED",
    });

    assert.equal(response.meta.readOnly, true);
    assert.equal(response.meta.capabilities.canPublish, false);
    assert.equal(response.identification.sku, "320.03AA");
    assert.equal(response.process.processSource, "STANDARD_PROCESS");
    assert.equal(response.liveCost.origin, "LIVE");
    assert.equal(response.publishedCost.origin, "PUBLISHED");
    assert.equal(response.comparison.status, "IGUAL");
    assert.equal(response.bom.length, 2);
    assert.deepEqual(response, buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: liveAnalysis(),
      effective: {
        status: "OK",
        productId: product.id,
        unitProductionCost: 1.7,
        costTableVersionId: "ver-1",
        costTableItemId: "item-1",
        effectiveDate: new Date(2026, 9, 1),
        versionName: "PCT",
        versionCode: "PCT-2026-10-01",
        revision: 2,
        publishedAt: new Date("2026-10-01T14:00:00.000Z"),
        currency: "BRL",
        breakdown: {
          materialCost: 1.2,
          processCost: 0.5,
          laborCost: 0.3,
          machineCost: 0.2,
          overheadCost: 0,
          otherCost: 0,
        },
        calculationSnapshot: null,
      },
      publishedVersionStatus: "PUBLISHED",
    }));
  });

  it("parse da request valida UUID e data", () => {
    const badId = parseUnitaryFormationProductDetailRequest({ productId: "not-uuid" });
    assert.equal(badId.ok, false);

    const badDate = parseUnitaryFormationProductDetailRequest({
      productId: product.id,
      referenceDateRaw: "05/10/2026",
    });
    assert.equal(badDate.ok, false);

    const ok = parseUnitaryFormationProductDetailRequest({
      productId: product.id,
      referenceDateRaw: "2026-10-05",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.referenceDateKey, "2026-10-05");
  });

  it("URL estável", () => {
    assert.equal(
      buildUnitaryFormationProductDetailUrl(product.id, "2026-10-05"),
      `/api/pricing/unitary-formation/products/${product.id}?referenceDate=2026-10-05`
    );
  });
});

describe("unitaryFormationDetail routes/wiring", () => {
  it("rota detalhe existe, é GET read-only e usa motor/resolver oficiais", () => {
    const server = read("server.ts");
    const detailIdx = server.indexOf('"/api/pricing/unitary-formation/products/:productId"');
    const paramCalcIdx = server.indexOf('"/api/pricing/:productId/:taxRuleId/calculate"');
    assert.ok(detailIdx > 0);
    assert.ok(paramCalcIdx > detailIdx);

    const routeEnd = server.indexOf("app.post(\"/api/pricing\"", detailIdx);
    assert.ok(routeEnd > detailIdx);
    const routeBlock = server.slice(detailIdx, routeEnd);
    assert.match(routeBlock, /requireAppAuth/);
    assert.match(routeBlock, /commercial\.pricing/);
    assert.match(routeBlock, /Cache-Control["'],\s*["']no-store/);
    assert.match(routeBlock, /buildUnitaryFormationProductDetail/);
    assert.match(routeBlock, /costAnalysisEngine/);
    assert.doesNotMatch(routeBlock, /\.create\(/);
    assert.doesNotMatch(routeBlock, /\.update\(/);
    assert.doesNotMatch(routeBlock, /\.delete\(/);
    assert.doesNotMatch(routeBlock, /\.upsert\(/);
    assert.doesNotMatch(routeBlock, /publishProductionCost/);
    assert.doesNotMatch(routeBlock, /generateProductionCostTableDraft/);
  });

  it("libs de detalhe não mutam Product nem tabelas de custo", () => {
    const serverLib = read("src/lib/pricing/unitaryFormationDetail.server.ts");
    const pure = read("src/lib/pricing/unitaryFormationDetail.ts");
    assert.match(serverLib, /getEffectiveProductProductionCost/);
    assert.match(serverLib, /getProductCostAnalysis/);
    assert.doesNotMatch(serverLib, /\.create\(/);
    assert.doesNotMatch(serverLib, /\.update\(/);
    assert.doesNotMatch(serverLib, /\.delete\(/);
    assert.doesNotMatch(serverLib, /\.upsert\(/);
    assert.doesNotMatch(pure, /prisma/);
    assert.doesNotMatch(pure, /getProductCostAnalysis/);
  });

  it("UI da aba renderiza blocos LIVE/PUBLISHED/comparação/BOM sem ações de escrita", () => {
    const tab = read("src/components/pricing/UnitaryPriceFormationTab.tsx");
    assert.match(tab, /Custo Atual \/ LIVE/);
    assert.match(tab, /Custo Oficial \/ PUBLISHED/);
    assert.match(tab, /unitary-formation-comparison/);
    assert.match(tab, /unitary-formation-bom/);
    assert.match(tab, /unitary-formation-live-origin/);
    assert.match(tab, /unitary-formation-published-origin/);
    assert.match(tab, /buildUnitaryFormationProductDetailUrl/);
    assert.equal(unitaryFormationComparisonStatusLabel("ERRO_CALCULO"), "ERRO");
    assert.equal(unitaryFormationComparisonStatusLabel("CUSTO_PARCIAL"), "PARCIAL");
    assert.doesNotMatch(tab, /Salvar|Publicar|Gerar DRAFT|Editar premissa/i);
    assert.doesNotMatch(tab, /method:\s*["']POST["']/);
    assert.doesNotMatch(tab, /method:\s*["']PUT["']/);
    assert.doesNotMatch(tab, /method:\s*["']PATCH["']/);
    assert.doesNotMatch(tab, /method:\s*["']DELETE["']/);
  });
});
