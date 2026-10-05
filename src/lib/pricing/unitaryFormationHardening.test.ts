import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { HttpError } from "../http.js";
import {
  buildUnitaryFormationProductDetailResponse,
  mapUnitaryFormationBomLines,
  mapUnitaryFormationLiveCost,
  mapUnitaryFormationPublishedCost,
  resolveUnitaryFormationComparison,
  type UnitaryFormationProductRow,
} from "./unitaryFormationDetail.js";
import {
  rankUnitaryFormationProductSearchResults,
  UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS,
  UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT,
} from "./unitaryFormationProductSearch.js";
import {
  appendUnitaryFormationCacheBust,
  countUnitaryFormationBomIssues,
  createUnitaryFormationRequestSequencer,
  formatUnitaryFormationDetailLoadError,
  formatUnitaryFormationSearchLoadError,
  shouldApplyUnitaryFormationDetailResult,
  shouldApplyUnitaryFormationSearchResult,
  shouldShowUnitaryFormationSearchCapHint,
  shouldShowUnitaryFormationSlowDetailHint,
} from "./unitaryFormationRequestGuard.js";

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

function liveAnalysis(partial = false, withBomError = false) {
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
    warnings: [],
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
          unitCost: 0.102,
          materialId: "mat-1",
          childProductId: null,
          excludedFromCost: withBomError,
          errorCode: withBomError ? "CHILD_COST_FAILED" : null,
          message: withBomError ? "filho sem custo" : null,
        },
      ],
    },
  };
}

describe("unitaryFormation hardening — autocomplete", () => {
  it("debounce e teto de 20 resultados estão fixados", () => {
    assert.equal(UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS, 280);
    assert.equal(UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT, 20);
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `id-${i}`,
      sku: `SKU-${String(i).padStart(3, "0")}`,
      name: `Item comum ${i}`,
      type: "PRODUCT" as const,
      status: "ACTIVE",
    }));
    const ranked = rankUnitaryFormationProductSearchResults(many, "comum", 99);
    assert.equal(ranked.length, 20);
    assert.equal(shouldShowUnitaryFormationSearchCapHint(20), true);
    assert.equal(shouldShowUnitaryFormationSearchCapHint(19), false);
  });

  it("cache-bust evita reuso de resposta HTTP no autocomplete", () => {
    const base = "/api/pricing/unitary-formation/product-search?q=320&limit=20";
    assert.equal(appendUnitaryFormationCacheBust(base, 123), `${base}&_r=123`);
    assert.equal(
      appendUnitaryFormationCacheBust("/api/pricing/unitary-formation/products/abc", 9),
      "/api/pricing/unitary-formation/products/abc?_r=9"
    );
  });
});

describe("unitaryFormation hardening — seleção / race / stale", () => {
  it("race de busca: só aplica o token mais recente", () => {
    const seq = createUnitaryFormationRequestSequencer();
    const t1 = seq.begin();
    const t2 = seq.begin();
    assert.equal(shouldApplyUnitaryFormationSearchResult(t1, seq.latest), false);
    assert.equal(shouldApplyUnitaryFormationSearchResult(t2, seq.latest), true);
  });

  it("troca rápida de SKU: detalhe do produto antigo é descartado", () => {
    assert.equal(
      shouldApplyUnitaryFormationDetailResult("prod-A", "prod-B"),
      false
    );
    assert.equal(
      shouldApplyUnitaryFormationDetailResult("prod-B", "prod-B"),
      true
    );
    assert.equal(shouldApplyUnitaryFormationDetailResult("prod-A", null), false);
  });

  it("loading lento dispara hint sem alterar regra de negócio", () => {
    assert.equal(shouldShowUnitaryFormationSlowDetailHint(true, 3999), false);
    assert.equal(shouldShowUnitaryFormationSlowDetailHint(true, 4000), true);
    assert.equal(shouldShowUnitaryFormationSlowDetailHint(false, 9000), false);
  });
});

describe("unitaryFormation hardening — detalhe / erros de motor", () => {
  it("produto inexistente e 403 viram mensagens claras", () => {
    assert.match(
      formatUnitaryFormationDetailLoadError(
        new HttpError(404, "Produto ou componente não encontrado.", "PRODUCT_NOT_FOUND")
      ),
      /não encontrado/i
    );
    assert.match(
      formatUnitaryFormationDetailLoadError(new HttpError(403, "Forbidden")),
      /permissão/i
    );
    assert.match(
      formatUnitaryFormationSearchLoadError(new HttpError(403, "Forbidden")),
      /permissão/i
    );
  });

  it("produto sem custo publicado", () => {
    const live = mapUnitaryFormationLiveCost(liveAnalysis());
    const published = mapUnitaryFormationPublishedCost(
      { status: "SEM_CUSTO", productId: product.id, referenceDate: new Date() },
      null
    );
    assert.equal(published.status, "SEM_CUSTO");
    assert.equal(published.origin, "PUBLISHED");
    assert.equal(resolveUnitaryFormationComparison(live, published).status, "SEM_CUSTO_PUBLICADO");

    const response = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: liveAnalysis(),
      effective: { status: "SEM_CUSTO", productId: product.id, referenceDate: new Date() },
      publishedVersionStatus: null,
    });
    assert.equal(response.publishedCost.status, "SEM_CUSTO");
    assert.equal(response.liveCost.origin, "LIVE");
    assert.equal(response.publishedCost.origin, "PUBLISHED");
    assert.equal(response.comparison.status, "SEM_CUSTO_PUBLICADO");
  });

  it("custo parcial e erro de motor LIVE", () => {
    const partial = mapUnitaryFormationLiveCost(liveAnalysis(true));
    assert.equal(partial.status, "PARTIAL");
    assert.equal(partial.origin, "LIVE");

    const failed = mapUnitaryFormationLiveCost({
      error: "CONFIG_MISSING",
      message: "FACTORY_HOURS_MONTHLY inválido.",
    });
    assert.equal(failed.status, "ERROR");
    assert.equal(failed.origin, "LIVE");
    assert.equal(failed.totalIndustrialCost, null);

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
    assert.equal(resolveUnitaryFormationComparison(partial, publishedOk).status, "CUSTO_PARCIAL");
    assert.equal(resolveUnitaryFormationComparison(failed, publishedOk).status, "ERRO_CALCULO");
  });

  it("BOM com erro/exclusão é contabilizado para UI", () => {
    const bom = mapUnitaryFormationBomLines(liveAnalysis(false, true));
    assert.equal(bom.length, 1);
    assert.equal(bom[0]?.errorCode, "CHILD_COST_FAILED");
    assert.equal(bom[0]?.excludedFromCost, true);
    const issues = countUnitaryFormationBomIssues(bom);
    assert.equal(issues.errorLines, 1);
    assert.equal(issues.excludedLines, 1);
  });
});

describe("unitaryFormation hardening — wiring segurança / cache / regressão", () => {
  it("rotas READ exigem auth + commercial.pricing view e Cache-Control no-store", () => {
    const server = read("server.ts");
    for (const path of [
      '"/api/pricing/unitary-formation/product-search"',
      '"/api/pricing/unitary-formation/products/:productId"',
    ]) {
      const idx = server.indexOf(path);
      assert.ok(idx > 0, path);
      const block = server.slice(idx, idx + 900);
      assert.match(block, /requireAppAuth/);
      assert.match(block, /requireResource\("commercial\.pricing", "view"\)/);
      assert.match(block, /Cache-Control["'],\s*["']no-store/);
      assert.doesNotMatch(block, /\.create\(/);
      assert.doesNotMatch(block, /\.update\(/);
      assert.doesNotMatch(block, /\.delete\(/);
      assert.doesNotMatch(block, /\.upsert\(/);
    }
  });

  it("rotas MUTATION exigem auth + permissão específica (view não basta)", () => {
    const server = read("server.ts");

    const draftIdx = server.indexOf(
      '"/api/pricing/unitary-formation/products/:productId/production-cost/draft"'
    );
    assert.ok(draftIdx > 0);
    const draftBlock = server.slice(draftIdx, draftIdx + 1400);
    assert.match(draftBlock, /requireAppAuth/);
    assert.match(draftBlock, /requireAnyPermission\(\["pricing\.generate_tables"/);
    assert.match(draftBlock, /settings\.price_tables\.manage/);
    assert.doesNotMatch(draftBlock, /requireResource\("commercial\.pricing", "view"\)/);
    assert.doesNotMatch(draftBlock, /pricing\.publish_tables/);
    assert.match(draftBlock, /createUnitaryProductionCostDraftFromLive/);

    const publishIdx = server.indexOf(
      '"/api/pricing/unitary-formation/products/:productId/production-cost/publish"'
    );
    assert.ok(publishIdx > 0);
    const publishBlock = server.slice(publishIdx, publishIdx + 1400);
    assert.match(publishBlock, /requireAppAuth/);
    assert.match(publishBlock, /PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS/);
    assert.doesNotMatch(publishBlock, /requireResource\("commercial\.pricing", "view"\)/);
    assert.doesNotMatch(publishBlock, /pricing\.generate_tables/);
    assert.match(publishBlock, /publishUnitaryProductionCostDraft/);
    assert.doesNotMatch(publishBlock, /productionCostTableVersion\.update/);
  });

  it("catálogo comercial e contrato de permissão listam endpoints unitários READ+MUTATION", () => {
    const access = read("src/lib/commercialAccess.ts");
    const contract = read("src/lib/security/permissionContract/resources.ts");
    assert.match(access, /unitary-formation\/product-search/);
    assert.match(access, /unitary-formation\/products\/:productId"/);
    assert.match(access, /production-cost\/draft/);
    assert.match(access, /production-cost\/publish/);
    assert.match(contract, /unitary-formation\/product-search/);
    assert.match(contract, /unitary-formation\/products\/:productId"/);
    assert.match(contract, /production-cost\/draft/);
    assert.match(contract, /production-cost\/publish/);

    // commercialAccess: GET = view; POST draft/publish = manage (catálogo)
    assert.match(
      access,
      /path:\s*"\/api\/pricing\/unitary-formation\/product-search"[\s\S]*?action:\s*"view"/
    );
    assert.match(
      access,
      /path:\s*"\/api\/pricing\/unitary-formation\/products\/:productId"[\s\S]*?action:\s*"view"/
    );
    assert.match(
      access,
      /path:\s*"\/api\/pricing\/unitary-formation\/products\/:productId\/production-cost\/draft"[\s\S]*?action:\s*"manage"/
    );
    assert.match(
      access,
      /path:\s*"\/api\/pricing\/unitary-formation\/products\/:productId\/production-cost\/publish"[\s\S]*?action:\s*"manage"/
    );
  });

  it("UI cobre seleção, detalhe, LIVE×DRAFT×PUBLISHED, race guards e mutações protegidas", () => {
    const tab = read("src/components/pricing/UnitaryPriceFormationTab.tsx");
    assert.match(tab, /appendUnitaryFormationCacheBust/);
    assert.match(tab, /createUnitaryFormationRequestSequencer/);
    assert.match(tab, /shouldApplyUnitaryFormationDetailResult/);
    assert.match(tab, /shouldApplyUnitaryFormationSearchResult/);
    assert.match(tab, /shouldApplyUnitaryFormationMutationResult/);
    assert.match(tab, /cache:\s*["']no-store["']/);
    assert.match(tab, /UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS/);
    assert.match(tab, /unitary-formation-search-cap-hint/);
    assert.match(tab, /unitary-formation-slow-detail-hint/);
    assert.match(tab, /unitary-formation-live-origin/);
    assert.match(tab, /unitary-formation-published-origin/);
    assert.match(tab, /unitary-formation-draft-origin/);
    assert.match(tab, /unitary-formation-live-error/);
    assert.match(tab, /unitary-formation-live-partial/);
    assert.match(tab, /unitary-formation-published-missing/);
    assert.match(tab, /unitary-formation-version-refs/);
    assert.match(tab, /unitary-formation-published-version-meta/);
    assert.match(tab, /unitary-formation-bom-issues/);
    assert.match(tab, /unitary-formation-generate-draft/);
    assert.match(tab, /unitary-formation-review-publish/);
    assert.match(tab, /buildUnitaryProductionCostPublishBody/);
    assert.match(tab, /canGenerateDraft/);
    assert.match(tab, /canPublishDraft/);
    assert.doesNotMatch(tab, /method:\s*["']PUT["']/);
    assert.doesNotMatch(tab, /method:\s*["']PATCH["']/);
    assert.doesNotMatch(tab, /method:\s*["']DELETE["']/);
  });

  it("regressão: aba antiga Preços publicados permanece default e intacta", () => {
    const module = read("src/components/PricingModule.tsx");
    const nav = read("src/lib/pricingNavigation.test.ts");
    assert.match(module, /useState<"published" \| "unitary">\("published"\)/);
    assert.match(module, /pricing-main-tab-\$\{tab\.id\}/);
    assert.match(module, /pricing-unit-panel/);
    assert.match(module, /\{ id: "published" as const, label: "Preços publicados" \}/);
    assert.match(module, /Formação de Preço Unitária/);
    assert.match(module, /UnitaryPriceFormationTab/);
    assert.doesNotMatch(module, /Gestão Unitária/);
    assert.doesNotMatch(module, /Simular preço/);
    assert.doesNotMatch(module, /Nova Premissa/);
    assert.match(nav, /Formação de Preço não expõe Indicadores/);
  });
});
