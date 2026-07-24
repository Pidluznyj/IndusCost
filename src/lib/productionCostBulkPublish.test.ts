import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PRODUCTION_COST_BULK_PUBLISH_SOURCE,
  chunkIds,
  classifyBulkPublishEligibility,
  draftMatchesCurrentCalculation,
  summarizeBulkPublishPreview,
  summarizeBulkPublishResult,
  type ProductionCostBulkPublishPreviewRow,
  type ProductionCostBulkPublishResultRow,
} from "./productionCostBulkPublish.js";
import { resolveFrozenCostTraceStatus } from "./productEngineeringCostSnapshot.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("productionCostBulkPublish — elegibilidade pura", () => {
  it("DRAFT válido e pendente é elegível", () => {
    const r = classifyBulkPublishEligibility({
      productStatus: "ACTIVE",
      draftVersionId: "v1",
      draftStatus: "DRAFT",
      draftUnitCost: 12,
      draftMatchesCurrent: true,
      draftCount: 1,
      traceStatus: "PENDENTE_PUBLICACAO",
    });
    assert.equal(r.eligible, true);
    assert.equal(r.status, "ELIGIBLE");
  });

  it("sem DRAFT não publica", () => {
    const r = classifyBulkPublishEligibility({
      productStatus: "ACTIVE",
      draftVersionId: null,
      draftStatus: null,
      draftUnitCost: null,
      draftMatchesCurrent: false,
      draftCount: 0,
      traceStatus: "CUSTO_DIVERGENTE",
    });
    assert.equal(r.eligible, false);
    assert.equal(r.blockReason, "NO_DRAFT");
  });

  it("DRAFT antigo (não alinhado ao CIU) é bloqueado", () => {
    const r = classifyBulkPublishEligibility({
      productStatus: "ACTIVE",
      draftVersionId: "v1",
      draftStatus: "DRAFT",
      draftUnitCost: 10,
      draftMatchesCurrent: false,
      draftCount: 1,
      traceStatus: "CUSTO_DIVERGENTE",
    });
    assert.equal(r.eligible, false);
    assert.equal(r.blockReason, "STALE_DRAFT");
  });

  it("múltiplos DRAFTs usam o mais recente e seguem elegíveis", () => {
    const r = classifyBulkPublishEligibility({
      productStatus: "ACTIVE",
      draftVersionId: "v2",
      draftStatus: "DRAFT",
      draftUnitCost: 15,
      draftMatchesCurrent: true,
      draftCount: 3,
      traceStatus: "PENDENTE_PUBLICACAO",
    });
    assert.equal(r.eligible, true);
    assert.equal(r.blockReason, "MULTIPLE_DRAFTS_USES_LATEST");
  });

  it("produto inativo é bloqueado", () => {
    const r = classifyBulkPublishEligibility({
      productStatus: "INACTIVE",
      draftVersionId: "v1",
      draftStatus: "DRAFT",
      draftUnitCost: 10,
      draftMatchesCurrent: true,
      draftCount: 1,
      traceStatus: "PENDENTE_PUBLICACAO",
    });
    assert.equal(r.eligible, false);
    assert.equal(r.blockReason, "INACTIVE_PRODUCT");
  });

  it("chunkIds processa em blocos", () => {
    assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("draftMatchesCurrentCalculation por hash ou custo", () => {
    assert.equal(
      draftMatchesCurrentCalculation({
        draftHash: "a",
        liveHash: "a",
        draftUnitCost: 1,
        liveCiu: 9,
      }),
      true
    );
    assert.equal(
      draftMatchesCurrentCalculation({
        draftHash: "a",
        liveHash: "b",
        draftUnitCost: 5,
        liveCiu: 5,
      }),
      true
    );
    assert.equal(
      draftMatchesCurrentCalculation({
        draftHash: "a",
        liveHash: "b",
        draftUnitCost: 5,
        liveCiu: 9,
      }),
      false
    );
  });

  it("sumários agregam status", () => {
    const previewRows: ProductionCostBulkPublishPreviewRow[] = [
      {
        productId: "1",
        sku: "A",
        name: "A",
        productStatus: "ACTIVE",
        productVersion: "1",
        draftVersionId: "v1",
        draftCode: "AUTO-x",
        draftRevision: 1,
        draftCreatedAt: null,
        draftSource: "PRODUCT_ENGINEERING_CHANGE",
        draftCreatedBy: null,
        draftUnitCost: 10,
        publishedVersionId: null,
        publishedUnitCost: 8,
        differenceAmount: 2,
        differencePercent: 25,
        draftCount: 1,
        traceStatus: "PENDENTE_PUBLICACAO",
        eligible: true,
        status: "ELIGIBLE",
        blockReason: null,
        message: "ok",
      },
      {
        productId: "2",
        sku: "B",
        name: "B",
        productStatus: "ACTIVE",
        productVersion: "1",
        draftVersionId: null,
        draftCode: null,
        draftRevision: null,
        draftCreatedAt: null,
        draftSource: null,
        draftCreatedBy: null,
        draftUnitCost: null,
        publishedVersionId: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        draftCount: 0,
        traceStatus: "CUSTO_DIVERGENTE",
        eligible: false,
        status: "SKIPPED",
        blockReason: "NO_DRAFT",
        message: "sem",
      },
    ];
    assert.equal(summarizeBulkPublishPreview(previewRows).eligible, 1);
    assert.equal(summarizeBulkPublishPreview(previewRows).withoutDraft, 1);

    const resultRows: ProductionCostBulkPublishResultRow[] = [
      {
        productId: "1",
        sku: "A",
        name: "A",
        productVersion: "1",
        draftVersionId: "v1",
        previousPublishedVersionId: null,
        previousUnitCost: 8,
        publishedUnitCost: 10,
        differenceAmount: 2,
        differencePercent: 25,
        status: "PUBLISHED",
        message: "ok",
        processedAt: new Date().toISOString(),
      },
      {
        productId: "2",
        sku: "B",
        name: "B",
        productVersion: "1",
        draftVersionId: "v2",
        previousPublishedVersionId: null,
        previousUnitCost: null,
        publishedUnitCost: null,
        differenceAmount: null,
        differencePercent: null,
        status: "ERROR",
        message: "fail",
        processedAt: new Date().toISOString(),
      },
    ];
    assert.equal(summarizeBulkPublishResult(resultRows).published, 1);
    assert.equal(summarizeBulkPublishResult(resultRows).error, 1);
  });
});

describe("badges — pendente vs divergente", () => {
  it("PENDENTE_PUBLICACAO quando DRAFT alinhado difere do publicado", () => {
    const status = resolveFrozenCostTraceStatus({
      liveCiu: 12,
      liveHash: "h-new",
      publishedCost: 10,
      publishedHash: "h-old",
      publishedVersionStatus: "PUBLISHED",
      draftHash: "h-new",
      draftVersionStatus: "DRAFT",
      draftUnitCost: 12,
    });
    assert.equal(status, "PENDENTE_PUBLICACAO");
  });

  it("CUSTO_DIVERGENTE quando DRAFT existe mas está desatualizado", () => {
    const status = resolveFrozenCostTraceStatus({
      liveCiu: 15,
      liveHash: "h-live",
      publishedCost: 10,
      publishedHash: "h-old",
      publishedVersionStatus: "PUBLISHED",
      draftHash: "h-stale",
      draftVersionStatus: "DRAFT",
      draftUnitCost: 12,
    });
    assert.equal(status, "CUSTO_DIVERGENTE");
  });
});

describe("productionCostBulkPublish — wiring canônico", () => {
  it("lote reutiliza publishProductionCostVersionFromDraft", () => {
    const src = read("src/lib/productionCostBulkPublish.server.ts");
    assert.match(src, /publishProductionCostVersionFromDraft/);
    assert.match(src, /PRODUCTION_COST_BULK_PUBLISH_SOURCE/);
    assert.doesNotMatch(src, /productionCostTableVersion\.update/);
    assert.equal(PRODUCTION_COST_BULK_PUBLISH_SOURCE, "BULK_PUBLISH_ENGINEERING");
  });

  it("endpoints de prévia e lote existem com permissão de publicação", () => {
    const server = read("server.ts");
    assert.match(server, /\/api\/products\/production-cost\/bulk-publish\/preview/);
    assert.match(server, /\/api\/products\/production-cost\/bulk-publish"/);
    assert.match(server, /confirm !== true/);
    assert.match(server, /previewProductionCostBulkPublish/);
    assert.match(server, /executeProductionCostBulkPublish/);
    assert.match(server, /PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS/);
  });

  it("UI usa prévia/confirmação e renomeia geração de rascunhos", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /Gerar rascunhos de custo/);
    assert.match(mod, /openBulkPublishPreview/);
    assert.match(mod, /ProductProductionCostBulkPublishDialog/);
    assert.match(mod, /select-pending-publication-products/);
    assert.match(mod, /select-all-filtered-products/);
    assert.match(mod, /\/api\/products\/production-cost\/bulk-publish\/preview/);
    assert.match(mod, /confirm:\s*true/);
    assert.doesNotMatch(mod, /handleBulkPublishProductionCostDrafts/);
  });

  it("publicação individual continua no endpoint oficial", () => {
    const card = read("src/components/product/ProductCostPublicationPendingCard.tsx");
    const server = read("server.ts");
    assert.match(card, /\/api\/production-cost-table-versions\/\$\{pendingDraft\.versionId\}\/publish/);
    assert.match(server, /publishProductionCostVersionFromDraft/);
  });
});
