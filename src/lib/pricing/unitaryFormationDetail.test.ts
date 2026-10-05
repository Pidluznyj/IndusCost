import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildUnitaryFormationProductDetailResponse,
  buildUnitaryFormationProductDetailUrl,
  deriveUnitaryProcessTotal,
  mapUnitaryFormationBomLines,
  mapUnitaryFormationDraftCost,
  mapUnitaryFormationLiveCost,
  mapUnitaryFormationPublishedCost,
  parseUnitaryFormationProductDetailRequest,
  resolveUnitaryFormationComparison,
  resolveUnitaryFormationComparisons,
  resolveUnitaryFormationProcessSource,
  resolveUnitaryFormationWorkflowState,
  unitaryFormationComparisonStatusLabel,
  type UnitaryFormationDraftVersionRow,
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

function publishedOk(overrides?: {
  unitProductionCost?: number;
  processCost?: number;
  laborCost?: number;
  machineCost?: number;
}) {
  return {
    status: "OK" as const,
    productId: product.id,
    unitProductionCost: overrides?.unitProductionCost ?? 1.7,
    costTableVersionId: "ver-pub-1",
    costTableItemId: "item-pub-1",
    effectiveDate: new Date(2026, 9, 1),
    versionName: "PCT",
    versionCode: "PCT-2026-10-01",
    revision: 2,
    publishedAt: new Date("2026-10-01T14:00:00.000Z"),
    currency: "BRL",
    breakdown: {
      materialCost: 1.2,
      processCost: overrides?.processCost ?? 0,
      laborCost: overrides?.laborCost ?? 0.3,
      machineCost: overrides?.machineCost ?? 0.2,
      overheadCost: 0,
      otherCost: 0,
    },
    calculationSnapshot: null,
  };
}

function draftRow(
  overrides?: Partial<UnitaryFormationDraftVersionRow>
): UnitaryFormationDraftVersionRow {
  return {
    versionId: "draft-v1",
    code: "AUTO-2026-10-05-320.03AA",
    revision: 1,
    status: "DRAFT",
    createdAt: "2026-10-05T12:00:00.000Z",
    createdBy: "user@test",
    source: "PRICING_MODULE_PRODUCTION_COST",
    materialCost: 1.2,
    laborCost: 0.3,
    machineCost: 0.2,
    processCost: 0,
    overheadCost: 0,
    otherCost: 0,
    unitProductionCost: 1.7,
    calculationHash: "hash-live",
    ...overrides,
  };
}

describe("unitaryFormationDetail pure", () => {
  it("mapeia LIVE a partir do motor oficial sem recalcular fórmula", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live");
    assert.equal(live.origin, "LIVE");
    assert.equal(live.source, OFFICIAL_PRODUCT_FINAL_COST_SOURCE);
    assert.equal(live.status, "OK");
    assert.equal(live.materialCost, 1.2);
    assert.equal(live.laborCost, 0.3);
    assert.equal(live.machineCost, 0.2);
    assert.equal(live.processTotal, 0.5);
    assert.equal(live.processCost, 0.5);
    assert.equal(live.totalIndustrialCost, 1.7);
    assert.equal(live.calculationHash, "hash-live");
    assert.equal(live.costAnalysisPartial, false);
    assert.equal(live.diagnostics.warningCount, 1);
    assert.equal(live.warnings.length, 1);
  });

  it("LIVE parcial e LIVE com erro de motor", () => {
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
    assert.equal(failed.diagnostics.error?.code, "CONFIG_MISSING");
  });

  it("processTotal deriva HH+HM quando processCost persistido = 0 (caso 320.03AA)", () => {
    assert.equal(
      deriveUnitaryProcessTotal({ laborCost: 0.42, machineCost: 0.18, storedProcessCost: 0 }),
      0.6
    );
    const published = mapUnitaryFormationPublishedCost(
      publishedOk({ processCost: 0, laborCost: 0.42, machineCost: 0.18 }),
      "PUBLISHED",
      { publishedBy: "auditor@test", calculationHash: "hash-pub" }
    );
    assert.equal(published.exists, true);
    assert.equal(published.processCost, 0.6);
    assert.equal(published.processTotal, 0.6);
    assert.equal(published.publishedBy, "auditor@test");
    assert.notEqual(published.processTotal, 0);
  });

  it("mapeia PUBLISHED SEM_CUSTO", () => {
    const missing = mapUnitaryFormationPublishedCost(
      { status: "SEM_CUSTO", productId: product.id, referenceDate: new Date(2026, 9, 5) },
      null
    );
    assert.equal(missing.status, "SEM_CUSTO");
    assert.equal(missing.exists, false);
    assert.equal(missing.unitProductionCost, null);
  });

  it("sem DRAFT", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live");
    const draft = mapUnitaryFormationDraftCost(null, live);
    assert.equal(draft.exists, false);
    assert.equal(draft.staleRelativeToLive, null);
    assert.equal(draft.versionId, null);
  });

  it("com DRAFT alinhado ao LIVE", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live");
    const draft = mapUnitaryFormationDraftCost(draftRow(), live);
    assert.equal(draft.exists, true);
    assert.equal(draft.versionId, "draft-v1");
    assert.equal(draft.staleRelativeToLive, false);
    assert.equal(draft.processTotal, 0.5);
  });

  it("DRAFT stale quando LIVE mudou", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live-novo");
    const draft = mapUnitaryFormationDraftCost(
      draftRow({ calculationHash: "hash-antigo", unitProductionCost: 1.5 }),
      live
    );
    assert.equal(draft.exists, true);
    assert.equal(draft.staleRelativeToLive, true);
  });

  it("múltiplos DRAFTs: builder usa o row informado (server escolhe o mais recente)", () => {
    const older = draftRow({
      versionId: "draft-old",
      createdAt: "2026-10-01T10:00:00.000Z",
      calculationHash: "hash-old",
    });
    const newer = draftRow({
      versionId: "draft-new",
      createdAt: "2026-10-05T18:00:00.000Z",
      calculationHash: "hash-live",
    });
    void older;
    const live = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live");
    const mapped = mapUnitaryFormationDraftCost(newer, live);
    assert.equal(mapped.versionId, "draft-new");
    assert.equal(mapped.staleRelativeToLive, false);
  });

  it("comparison LIVE×PUBLISHED: IGUAL, ALTERADO, SEM_CUSTO, ERRO, PARCIAL", () => {
    const liveOk = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live");
    const publishedEqual = mapUnitaryFormationPublishedCost(publishedOk(), "PUBLISHED");
    assert.equal(resolveUnitaryFormationComparison(liveOk, publishedEqual).status, "IGUAL");

    const publishedChanged = mapUnitaryFormationPublishedCost(
      publishedOk({ unitProductionCost: 1.5 }),
      "PUBLISHED"
    );
    assert.equal(resolveUnitaryFormationComparison(liveOk, publishedChanged).status, "ALTERADO");

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
      resolveUnitaryFormationComparison(liveErr, publishedEqual).status,
      "ERRO_CALCULO"
    );

    const livePartial = mapUnitaryFormationLiveCost(liveAnalysis(true), "hash-live");
    assert.equal(
      resolveUnitaryFormationComparison(livePartial, publishedEqual).status,
      "CUSTO_PARCIAL"
    );
  });

  it("comparisons DRAFT×PUBLISHED e DRAFT×LIVE", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis(), "hash-live");
    const published = mapUnitaryFormationPublishedCost(publishedOk(), "PUBLISHED");
    const draft = mapUnitaryFormationDraftCost(draftRow(), live);
    const comps = resolveUnitaryFormationComparisons({ live, draft, published });
    assert.equal(comps.liveVsPublished.status, "IGUAL");
    assert.equal(comps.draftVsPublished.status, "IGUAL");
    assert.equal(comps.draftVsLive.status, "IGUAL");

    const noDraft = mapUnitaryFormationDraftCost(null, live);
    const without = resolveUnitaryFormationComparisons({
      live,
      draft: noDraft,
      published,
    });
    assert.equal(without.draftVsPublished.status, "SEM_DRAFT");
    assert.equal(without.draftVsLive.status, "SEM_DRAFT");
  });

  it("workflow: UPDATED / DRAFT_READY / DRAFT_STALE / NO_PUBLISHED / LIVE_CHANGED / INVALID / TECHNICAL_ONLY / NO_DRAFT", () => {
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: true,
        hasDraft: false,
        draftMatchesLive: null,
        traceStatus: "ATUALIZADO",
      }),
      "UPDATED"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: true,
        hasDraft: true,
        draftMatchesLive: true,
        traceStatus: "PENDENTE_PUBLICACAO",
      }),
      "DRAFT_READY"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: true,
        hasDraft: true,
        draftMatchesLive: false,
        traceStatus: "CUSTO_DIVERGENTE",
      }),
      "DRAFT_STALE"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: false,
        hasDraft: false,
        draftMatchesLive: null,
        traceStatus: "SEM_CUSTO_CONGELADO",
      }),
      "NO_PUBLISHED"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: true,
        hasDraft: false,
        draftMatchesLive: null,
        traceStatus: "CUSTO_DIVERGENTE",
      }),
      "LIVE_CHANGED"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "ERROR",
        hasPublished: false,
        hasDraft: false,
        draftMatchesLive: null,
        traceStatus: "SEM_CUSTO",
      }),
      "INVALID"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: true,
        hasDraft: true,
        draftMatchesLive: true,
        traceStatus: "SNAPSHOT_TECNICO_SEM_IMPACTO",
      }),
      "TECHNICAL_ONLY"
    );
    assert.equal(
      resolveUnitaryFormationWorkflowState({
        liveStatus: "OK",
        hasPublished: true,
        hasDraft: false,
        draftMatchesLive: null,
        traceStatus: null,
      }),
      "NO_DRAFT"
    );
  });

  it("resposta consolidada traz LIVE + DRAFT + PUBLISHED + comparisons + workflow", () => {
    const response = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: liveAnalysis(),
      effective: publishedOk(),
      publishedVersionStatus: "PUBLISHED",
      liveCalculationHash: "hash-live",
      publishedBy: "pub@test",
      publishedCalculationHash: "hash-pub",
      draft: draftRow(),
      traceStatus: "PENDENTE_PUBLICACAO",
    });

    assert.equal(response.meta.readOnly, true);
    assert.equal(response.meta.capabilities.canPublish, false);
    assert.equal(response.identification.sku, "320.03AA");
    assert.equal(response.liveCost.origin, "LIVE");
    assert.equal(response.draftCost.exists, true);
    assert.equal(response.publishedCost.exists, true);
    assert.equal(response.publishedCost.publishedBy, "pub@test");
    assert.equal(response.publishedCost.processTotal, 0.5);
    assert.equal(response.comparison.status, "IGUAL");
    assert.equal(response.comparisons.liveVsPublished.status, "IGUAL");
    assert.equal(response.comparisons.draftVsLive.status, "IGUAL");
    assert.equal(response.workflow.state, "DRAFT_READY");
    assert.equal(response.workflow.traceStatus, "PENDENTE_PUBLICACAO");
    assert.equal(response.bom.length, 2);
  });

  it("LIVE = PUBLISHED → IGUAL; LIVE != PUBLISHED → ALTERADO", () => {
    const equal = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: liveAnalysis(),
      effective: publishedOk(),
      publishedVersionStatus: "PUBLISHED",
      liveCalculationHash: "hash-live",
      draft: null,
      traceStatus: "ATUALIZADO",
    });
    assert.equal(equal.comparisons.liveVsPublished.status, "IGUAL");
    assert.equal(equal.workflow.state, "UPDATED");

    const diverged = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: liveAnalysis(),
      effective: publishedOk({ unitProductionCost: 9.99 }),
      publishedVersionStatus: "PUBLISHED",
      liveCalculationHash: "hash-live",
      draft: null,
      traceStatus: "CUSTO_DIVERGENTE",
    });
    assert.equal(diverged.comparisons.liveVsPublished.status, "ALTERADO");
    assert.equal(diverged.workflow.state, "LIVE_CHANGED");
  });

  it("BOM e process source", () => {
    const bom = mapUnitaryFormationBomLines(liveAnalysis());
    assert.equal(bom.length, 2);
    assert.equal(
      resolveUnitaryFormationProcessSource({
        type: "PRODUCT",
        cycleTimeSeconds: 12,
        routingStepCount: 2,
      }),
      "STANDARD_PROCESS"
    );
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
  });

  it("URL estável", () => {
    assert.equal(
      buildUnitaryFormationProductDetailUrl(product.id, "2026-10-05"),
      `/api/pricing/unitary-formation/products/${product.id}?referenceDate=2026-10-05`
    );
  });
});

describe("unitaryFormationDetail routes/wiring", () => {
  it("rota detalhe existe, é GET read-only, usa motor/resolver oficiais e exige autorização", () => {
    const server = read("server.ts");
    const detailIdx = server.indexOf('"/api/pricing/unitary-formation/products/:productId"');
    assert.ok(detailIdx > 0);

    const draftIdx = server.indexOf(
      '"/api/pricing/unitary-formation/products/:productId/production-cost/draft"',
      detailIdx
    );
    assert.ok(draftIdx > detailIdx);
    const routeBlock = server.slice(detailIdx, draftIdx);
    assert.match(routeBlock, /requireAppAuth/);
    assert.match(routeBlock, /requireResource\("commercial\.pricing",\s*"view"\)/);
    assert.match(routeBlock, /Cache-Control["'],\s*["']no-store/);
    assert.match(routeBlock, /buildUnitaryFormationProductDetail/);
    assert.match(routeBlock, /costAnalysisEngine/);
    assert.doesNotMatch(routeBlock, /\.create\(/);
    assert.doesNotMatch(routeBlock, /\.update\(/);
    assert.doesNotMatch(routeBlock, /\.delete\(/);
    assert.doesNotMatch(routeBlock, /\.upsert\(/);
    assert.doesNotMatch(routeBlock, /publishProductionCost/);
    assert.doesNotMatch(routeBlock, /generateProductionCostTableDraft/);
    assert.doesNotMatch(routeBlock, /createUnitaryProductionCostDraft/);
    assert.doesNotMatch(routeBlock, /publishUnitaryProductionCostDraft/);

    const access = read("src/lib/commercialAccess.ts");
    assert.match(
      access,
      /path:\s*"\/api\/pricing\/unitary-formation\/products\/:productId"/
    );
    assert.match(access, /resourceKey:\s*"commercial\.pricing"/);
  });

  it("libs de detalhe não mutam Product nem tabelas de custo; carregam DRAFT mais recente", () => {
    const serverLib = read("src/lib/pricing/unitaryFormationDetail.server.ts");
    const pure = read("src/lib/pricing/unitaryFormationDetail.ts");
    assert.match(serverLib, /getEffectiveProductProductionCost/);
    assert.match(serverLib, /evaluateProductEngineeringCost/);
    assert.match(serverLib, /loadLatestUnitaryFormationDraft/);
    assert.match(serverLib, /orderBy:\s*\{\s*createdAt:\s*"desc"/);
    assert.match(serverLib, /resolveFrozenCostTraceStatus/);
    assert.doesNotMatch(serverLib, /\.create\(/);
    assert.doesNotMatch(serverLib, /\.update\(/);
    assert.doesNotMatch(serverLib, /\.delete\(/);
    assert.doesNotMatch(serverLib, /\.upsert\(/);
    assert.doesNotMatch(pure, /prisma/);
    assert.doesNotMatch(pure, /getProductCostAnalysis/);
  });

  it("bulk publish não é alterado por este escopo", () => {
    const bulk = read("src/lib/productionCostBulkPublish.ts");
    const bulkServer = read("src/lib/productionCostBulkPublish.server.ts");
    assert.match(bulk, /classifyBulkPublishEligibility/);
    assert.match(bulkServer, /publishProductionCostVersionFromDraft|classifyBulkPublishEligibility/);
    assert.doesNotMatch(bulk, /unitaryFormation/);
    assert.doesNotMatch(bulkServer, /unitaryFormation/);
  });

  it("UI renderiza LIVE/DRAFT/PUBLISHED/comparações/workflow e ações condicionais", () => {
    const tab = read("src/components/pricing/UnitaryPriceFormationTab.tsx");
    assert.match(tab, /Custo Atual \/ LIVE/);
    assert.match(tab, /DRAFT mais recente/);
    assert.match(tab, /Custo Oficial \/ PUBLISHED/);
    assert.match(tab, /unitary-formation-comparison/);
    assert.match(tab, /unitary-formation-draft-cost/);
    assert.match(tab, /unitary-formation-workflow/);
    assert.match(tab, /unitary-formation-bom/);
    assert.match(tab, /processTotal|Processo \(HH\+HM\)/);
    assert.match(tab, /buildUnitaryFormationProductDetailUrl/);
    assert.match(tab, /unitary-formation-generate-draft/);
    assert.match(tab, /unitary-formation-review-publish/);
    assert.equal(unitaryFormationComparisonStatusLabel("ERRO_CALCULO"), "ERRO");
    assert.equal(unitaryFormationComparisonStatusLabel("CUSTO_PARCIAL"), "PARCIAL");
  });
});
