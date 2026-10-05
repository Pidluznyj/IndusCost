import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { HttpError } from "../http.js";
import {
  buildUnitaryFormationProductDetailResponse,
  type UnitaryFormationProductRow,
} from "./unitaryFormationDetail.js";
import {
  shouldApplyUnitaryFormationMutationResult,
} from "./unitaryFormationRequestGuard.js";
import {
  buildUnitaryProductionCostDraftUrl,
  buildUnitaryProductionCostPublishBody,
  buildUnitaryProductionCostPublishUrl,
  buildUnitaryPublishReviewModel,
  canGenerateUnitaryProductionCostDraft,
  canPublishUnitaryProductionCostDraft,
  formatUnitaryDraftMutationError,
  formatUnitaryPublishMutationError,
  isUnitaryStaleOrConflictCode,
  resolvePostPublishStatus,
  shouldShowGenerateUnitaryDraftAction,
  shouldShowMultipleUnitaryDraftsHint,
  shouldShowReviewPublishUnitaryDraftAction,
  shouldShowUnitaryStaleDraftBanner,
} from "./unitaryFormationWorkflowUi.js";

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

function liveAnalysis() {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    totalMaterialCost: 1.2,
    totalHH_Unit: 0.3,
    totalHM_Unit: 0.2,
    totalCIF_Unit: 0,
    totalOPEX_Unit: 0,
    totalIndustrialCost: 1.7,
    costAnalysisPartial: false,
    warnings: [],
    details: { materials: [] },
  };
}

function detailWith(opts?: {
  withDraft?: boolean;
  stale?: boolean;
  draftCount?: number;
  publishedCost?: number;
  liveHash?: string;
  draftHash?: string;
  traceStatus?: "PENDENTE_PUBLICACAO" | "ATUALIZADO" | "CUSTO_DIVERGENTE" | "SEM_CUSTO_CONGELADO";
}) {
  const withDraft = opts?.withDraft ?? false;
  const liveHash = opts?.liveHash ?? "hash-live";
  const draftHash = opts?.stale ? "hash-old" : opts?.draftHash ?? liveHash;
  return buildUnitaryFormationProductDetailResponse({
    product,
    referenceDate: "2026-10-05",
    generatedAt: "2026-10-05T18:00:00.000Z",
    analysis: liveAnalysis(),
    effective: {
      status: "OK",
      productId: product.id,
      unitProductionCost: opts?.publishedCost ?? 1.5,
      costTableVersionId: "ver-pub",
      costTableItemId: "item-pub",
      effectiveDate: new Date(2026, 9, 1),
      versionName: "PCT",
      versionCode: "PCT-1",
      revision: 1,
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      currency: "BRL",
      breakdown: {
        materialCost: 1.0,
        processCost: 0,
        laborCost: 0.3,
        machineCost: 0.2,
        overheadCost: 0,
        otherCost: 0,
      },
      calculationSnapshot: null,
    },
    publishedVersionStatus: "PUBLISHED",
    liveCalculationHash: liveHash,
    publishedBy: "auditor@test",
    draft: withDraft
      ? {
          versionId: "draft-v1",
          code: "AUTO-320",
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
          unitProductionCost: opts?.stale ? 1.1 : 1.7,
          calculationHash: draftHash,
        }
      : null,
    draftCount: opts?.draftCount ?? (withDraft ? 1 : 0),
    traceStatus:
      opts?.traceStatus ??
      (withDraft && !opts?.stale ? "PENDENTE_PUBLICACAO" : "CUSTO_DIVERGENTE"),
  });
}

describe("unitaryFormationWorkflowUi permissions/actions", () => {
  it("permissões oficiais: generate = manage array; publish = publish array", () => {
    assert.equal(
      canGenerateUnitaryProductionCostDraft({
        hasPermission: (p) => p === "pricing.generate_tables",
      }),
      true
    );
    assert.equal(
      canGenerateUnitaryProductionCostDraft({
        hasPermission: (p) => p === "settings.price_tables.manage",
      }),
      true
    );
    assert.equal(
      canGenerateUnitaryProductionCostDraft({ hasPermission: () => false }),
      false
    );
    // view-only não gera
    assert.equal(
      canGenerateUnitaryProductionCostDraft({
        hasPermission: (p) => p === "pricing.view",
      }),
      false
    );
    // publish_tables sozinho não gera draft
    assert.equal(
      canGenerateUnitaryProductionCostDraft({
        hasPermission: (p) => p === "pricing.publish_tables",
      }),
      false
    );
    assert.equal(
      canPublishUnitaryProductionCostDraft({
        hasPermission: (p) => p === "pricing.publish_tables",
      }),
      true
    );
    assert.equal(
      canPublishUnitaryProductionCostDraft({
        hasPermission: (p) => p === "pricing.generate_tables",
      }),
      false
    );
    // view-only não publica
    assert.equal(
      canPublishUnitaryProductionCostDraft({
        hasPermission: (p) => p === "pricing.view",
      }),
      false
    );
  });

  it("botão gerar aparece com permissão e LIVE ok; some sem permissão ou LIVE erro", () => {
    const ok = detailWith({ withDraft: false, traceStatus: "SEM_CUSTO_CONGELADO" });
    assert.equal(
      shouldShowGenerateUnitaryDraftAction({ canGenerate: true, detail: ok }),
      true
    );
    assert.equal(
      shouldShowGenerateUnitaryDraftAction({ canGenerate: false, detail: ok }),
      false
    );
    assert.equal(
      shouldShowGenerateUnitaryDraftAction({ canGenerate: true, detail: ok, mutating: true }),
      false
    );
    const failed = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: "2026-10-05",
      generatedAt: "2026-10-05T18:00:00.000Z",
      analysis: { error: "BOM_CYCLE", message: "ciclo" },
      effective: { status: "SEM_CUSTO", productId: product.id, referenceDate: new Date() },
      publishedVersionStatus: null,
      traceStatus: "SEM_CUSTO",
    });
    assert.equal(
      shouldShowGenerateUnitaryDraftAction({ canGenerate: true, detail: failed }),
      false
    );
  });

  it("revisar/publicar só com DRAFT_READY e permissão de publish", () => {
    const ready = detailWith({ withDraft: true, stale: false, publishedCost: 1.5 });
    assert.equal(ready.workflow.state, "DRAFT_READY");
    assert.equal(
      shouldShowReviewPublishUnitaryDraftAction({ canPublish: true, detail: ready }),
      true
    );
    assert.equal(
      shouldShowReviewPublishUnitaryDraftAction({ canPublish: false, detail: ready }),
      false
    );

    const stale = detailWith({
      withDraft: true,
      stale: true,
      draftCount: 1,
      traceStatus: "CUSTO_DIVERGENTE",
    });
    assert.equal(shouldShowUnitaryStaleDraftBanner(stale), true);
    assert.equal(
      shouldShowReviewPublishUnitaryDraftAction({ canPublish: true, detail: stale }),
      false
    );
  });

  it("hint de múltiplos DRAFTs", () => {
    const multi = detailWith({ withDraft: true, draftCount: 3 });
    assert.equal(shouldShowMultipleUnitaryDraftsHint(multi), true);
    const single = detailWith({ withDraft: true, draftCount: 1 });
    assert.equal(shouldShowMultipleUnitaryDraftsHint(single), false);
  });

  it("publish body envia só draftVersionId", () => {
    const body = buildUnitaryProductionCostPublishBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.deepEqual(body, {
      draftVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    assert.equal("unitCost" in body, false);
    assert.equal(
      buildUnitaryProductionCostDraftUrl(product.id),
      `/api/pricing/unitary-formation/products/${product.id}/production-cost/draft`
    );
    assert.equal(
      buildUnitaryProductionCostPublishUrl(product.id),
      `/api/pricing/unitary-formation/products/${product.id}/production-cost/publish`
    );
  });

  it("review model decompõe Material / Processo / HH / HM / Overhead / Outros / Total", () => {
    const ready = detailWith({ withDraft: true });
    const model = buildUnitaryPublishReviewModel(ready);
    assert.ok(model);
    assert.equal(model!.draftVersionId, "draft-v1");
    assert.equal(model!.officialTotal, 1.5);
    assert.equal(model!.draftTotal, 1.7);
    assert.equal(model!.diffValue, 0.2);
    const keys = model!.lines.map((l) => l.key);
    assert.deepEqual(keys, [
      "material",
      "processTotal",
      "hh",
      "hm",
      "overhead",
      "others",
      "total",
    ]);
    const processo = model!.lines.find((l) => l.key === "processTotal");
    assert.equal(processo?.draft, 0.5);
    assert.notEqual(processo?.draft, 0);
  });

  it("stale/conflict e unauthorized formatados sem resolver no frontend", () => {
    assert.equal(isUnitaryStaleOrConflictCode("STALE_DRAFT"), true);
    assert.equal(isUnitaryStaleOrConflictCode("CONFLICT_NEWER_DRAFT"), true);
    const stale = formatUnitaryPublishMutationError(
      new HttpError(409, "draft antigo", "STALE_DRAFT")
    );
    assert.equal(stale.stale, true);
    assert.match(stale.message, /não representa mais o custo LIVE/);

    const unauthorized = formatUnitaryPublishMutationError(
      new HttpError(403, "forbidden", "PERMISSION")
    );
    assert.equal(unauthorized.stale, false);
    assert.match(unauthorized.message, /permissão/i);

    const draftUnauthorized = formatUnitaryDraftMutationError(
      new HttpError(403, "forbidden")
    );
    assert.match(draftUnauthorized, /permissão/i);

    const network = formatUnitaryDraftMutationError(new Error("network down"));
    assert.equal(network, "network down");

    const engine = formatUnitaryDraftMutationError(
      new HttpError(422, "motor falhou", "LIVE_COST_ERROR")
    );
    assert.match(engine, /LIVE|motor|falhou/i);
  });

  it("pós-publicação ATUALIZADO quando LIVE = PUBLISHED", () => {
    const equal = detailWith({
      withDraft: false,
      publishedCost: 1.7,
      traceStatus: "ATUALIZADO",
    });
    assert.equal(
      resolvePostPublishStatus({ live: equal.liveCost, published: equal.publishedCost }),
      "ATUALIZADO"
    );
  });

  it("race: mutation de outro SKU / token antigo é descartada", () => {
    assert.equal(
      shouldApplyUnitaryFormationMutationResult({
        requestedProductId: "a",
        selectedProductId: "b",
        mutationToken: 1,
        latestMutationToken: 1,
      }),
      false
    );
    assert.equal(
      shouldApplyUnitaryFormationMutationResult({
        requestedProductId: "a",
        selectedProductId: "a",
        mutationToken: 1,
        latestMutationToken: 2,
      }),
      false
    );
    assert.equal(
      shouldApplyUnitaryFormationMutationResult({
        requestedProductId: "a",
        selectedProductId: "a",
        mutationToken: 3,
        latestMutationToken: 3,
      }),
      true
    );
  });
});

describe("unitaryFormationWorkflowUi wiring", () => {
  it("UI tem gerar/revisar/publicar, confirmação, modal, stale e proteções", () => {
    const tab = read("src/components/pricing/UnitaryPriceFormationTab.tsx");
    assert.match(tab, /unitary-formation-generate-draft/);
    assert.match(tab, /unitary-formation-review-publish/);
    assert.match(tab, /unitary-formation-generate-confirm/);
    assert.match(tab, /unitary-formation-review-modal/);
    assert.match(tab, /unitary-formation-publish-submit/);
    assert.match(tab, /unitary-formation-stale-banner/);
    assert.match(tab, /unitary-formation-post-publish/);
    assert.match(tab, /buildUnitaryProductionCostPublishBody/);
    assert.match(tab, /shouldApplyUnitaryFormationMutationResult/);
    assert.match(tab, /appendUnitaryFormationCacheBust/);
    assert.match(tab, /method:\s*["']POST["']/);
    assert.match(tab, /disabled=\{mutating\}|disabled=\{generating\}|disabled=\{publishing\}/);
    assert.match(tab, /canGenerateDraft/);
    assert.match(tab, /canPublishDraft/);
    assert.doesNotMatch(tab, /unitCost\s*:/);
    assert.doesNotMatch(tab, /unitProductionCost\s*:/);
  });

  it("PricingModule passa permissões oficiais generate/publish", () => {
    const mod = read("src/components/PricingModule.tsx");
    assert.match(mod, /canGenerateDraft=/);
    assert.match(mod, /canPublishDraft=/);
    assert.match(mod, /pricing\.generate_tables|allowGenerateTables/);
    assert.match(mod, /pricing\.publish_tables|allowPublishTables/);
    assert.match(mod, /settings\.price_tables\.manage/);
  });

  it("bulk publish não é alterado", () => {
    const bulk = read("src/lib/productionCostBulkPublish.ts");
    assert.doesNotMatch(bulk, /unitaryFormationWorkflowUi/);
  });
});
