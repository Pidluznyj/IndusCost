import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type {
  ProductionCostBulkPublishItemStatus,
  ProductionCostBulkPublishPreviewRow,
  ProductionCostBulkPublishResultRow,
} from "./productionCostBulkPublish.js";
import {
  BULK_PUBLISH_HTTP_CHUNK_SIZE,
  buildBulkPublishChunkRequests,
  runProductionCostBulkPublishInChunks,
  type ProductionCostBulkPublishChunkRequest,
  type ProductionCostBulkPublishRunProgress,
} from "./productionCostBulkPublishChunkedRun.js";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

function previewRow(
  n: number,
  overrides: Partial<ProductionCostBulkPublishPreviewRow> = {}
): ProductionCostBulkPublishPreviewRow {
  return {
    productId: `p${n}`,
    sku: `SKU-${n}`,
    name: `Produto ${n}`,
    productStatus: "ACTIVE",
    productVersion: "1",
    draftVersionId: `draft${n}`,
    draftCode: `AUTO-${n}`,
    draftRevision: 1,
    draftCreatedAt: null,
    draftSource: null,
    draftCreatedBy: null,
    draftUnitCost: 10,
    publishedVersionId: null,
    publishedUnitCost: 9,
    differenceAmount: 1,
    differencePercent: 11.1,
    draftCount: 1,
    traceStatus: "PENDENTE_PUBLICACAO",
    eligible: true,
    status: "ELIGIBLE",
    blockReason: null,
    message: "Apto para publicação.",
    ...overrides,
  };
}

function makePreview(eligibleCount: number, extra: ProductionCostBulkPublishPreviewRow[] = []) {
  return {
    batchRunId: "batch-unico",
    rows: [
      ...Array.from({ length: eligibleCount }, (_, i) => previewRow(i + 1)),
      ...extra,
    ],
  };
}

function resultRow(
  productId: string,
  draftVersionId: string,
  status: ProductionCostBulkPublishItemStatus = "PUBLISHED"
): ProductionCostBulkPublishResultRow {
  return {
    productId,
    sku: productId,
    name: productId,
    productVersion: "1",
    draftVersionId,
    previousPublishedVersionId: null,
    previousUnitCost: 9,
    publishedUnitCost: status === "PUBLISHED" ? 10 : null,
    differenceAmount: null,
    differencePercent: null,
    status,
    message: status,
    processedAt: "2026-10-05T00:00:00.000Z",
  };
}

function respond(
  request: ProductionCostBulkPublishChunkRequest,
  statusFor: (productId: string) => ProductionCostBulkPublishItemStatus = () =>
    request.phase === "finalize" ? "PUBLISHED" : "VALIDATED"
) {
  return {
    phase: request.phase,
    completePublishedVersionId: request.phase === "finalize" ? "complete-pub-1" : null,
    rows: request.productIds.map((id) =>
      resultRow(id, request.draftVersionIdsByProduct[id], statusFor(id))
    ),
  };
}

describe("productionCostBulkPublishChunkedRun — blocos HTTP", () => {
  it("chunk HTTP é 25", () => {
    assert.equal(BULK_PUBLISH_HTTP_CHUNK_SIZE, 25);
  });

  for (const [count, expectedRequests] of [
    [1, 1],
    [24, 1],
    [25, 1],
    [26, 2],
    [50, 2],
    [354, 15],
  ] as const) {
    it(`${count} produto(s) → ${expectedRequests} request(s) (validate* + finalize)`, async () => {
      const calls: ProductionCostBulkPublishChunkRequest[] = [];
      const run = await runProductionCostBulkPublishInChunks({
        preview: makePreview(count),
        publishChunk: async (request) => {
          calls.push(request);
          return respond(request);
        },
      });

      assert.equal(calls.length, expectedRequests);
      assert.equal(run.status, "COMPLETED");
      assert.equal(run.chunkTotal, expectedRequests);
      assert.equal(run.confirmedChunks, expectedRequests);
      assert.equal(run.total, count);
      assert.equal(run.processed, count);
      assert.equal(run.pending, 0);
      assert.equal(run.rows.length, count);
      assert.equal(run.summary.published, count);
      assert.equal(run.completePublishedVersionId, "complete-pub-1");

      // Mesmo batchRunId em todos; finalize é o último e carrega TODOS os elegíveis.
      assert.deepEqual([...new Set(calls.map((c) => c.batchRunId))], ["batch-unico"]);
      const finalize = calls[calls.length - 1]!;
      assert.equal(finalize.phase, "finalize");
      assert.deepEqual(
        finalize.productIds,
        Array.from({ length: count }, (_, i) => `p${i + 1}`)
      );
      assert.equal(finalize.chunkIndex, expectedRequests);
      assert.equal(finalize.chunkTotal, expectedRequests);

      for (let i = 0; i < calls.length - 1; i += 1) {
        const call = calls[i]!;
        assert.equal(call.phase, "validate");
        assert.equal(call.confirm, true);
        assert.ok(call.productIds.length <= BULK_PUBLISH_HTTP_CHUNK_SIZE);
        assert.deepEqual(Object.keys(call.draftVersionIdsByProduct), call.productIds);
      }
      if (count === 26) {
        assert.equal(calls[0]!.productIds.length, 25);
        assert.equal(calls[0]!.phase, "validate");
      }
      if (count === 354) {
        assert.equal(calls[13]!.phase, "validate");
        assert.equal(calls[14]!.phase, "finalize");
        assert.equal(calls[14]!.productIds.length, 354);
      }
    });
  }

  it("envia apenas elegíveis com DRAFT da prévia", () => {
    const requests = buildBulkPublishChunkRequests(
      makePreview(2, [
        previewRow(90, { eligible: false, status: "BLOCKED", blockReason: "STALE_DRAFT" }),
        previewRow(91, { eligible: false, status: "ALREADY_PUBLISHED", draftVersionId: null }),
        previewRow(92, { eligible: true, draftVersionId: null }),
      ])
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.phase, "finalize");
    assert.deepEqual(requests[0]!.productIds, ["p1", "p2"]);
    assert.deepEqual(requests[0]!.draftVersionIdsByProduct, { p1: "draft1", p2: "draft2" });
  });

  it("sem elegíveis não chama o endpoint", async () => {
    let calls = 0;
    const run = await runProductionCostBulkPublishInChunks({
      preview: makePreview(0, [previewRow(1, { eligible: false, status: "BLOCKED" })]),
      publishChunk: async (request) => {
        calls += 1;
        return respond(request);
      },
    });
    assert.equal(calls, 0);
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.total, 0);
  });

  it("requests são sequenciais: o bloco seguinte só começa após o anterior terminar", async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const run = await runProductionCostBulkPublishInChunks({
      preview: makePreview(60),
      publishChunk: async (request, chunk) => {
        events.push(`start-${chunk.index}`);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
        events.push(`end-${chunk.index}`);
        return respond(request);
      },
    });
    assert.equal(run.status, "COMPLETED");
    assert.equal(maxInFlight, 1);
    assert.deepEqual(events, ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
    assert.equal(run.summary.published, 60);
  });

  it("falha no bloco 3 interrompe o bloco 4 e NÃO deixa PUBLISHED", async () => {
    const started: number[] = [];
    const progress: ProductionCostBulkPublishRunProgress[] = [];
    const run = await runProductionCostBulkPublishInChunks({
      preview: makePreview(100),
      publishChunk: async (request, chunk) => {
        started.push(chunk.index);
        if (chunk.index === 3) throw new Error("HTTP 524");
        return respond(request);
      },
      onProgress: (p) => progress.push(p),
    });

    assert.deepEqual(started, [1, 2, 3]);
    assert.equal(run.status, "INTERRUPTED");
    assert.equal(run.failedChunk, 3);
    assert.equal(run.errorMessage, "HTTP 524");
    assert.equal(run.confirmedChunks, 2);
    assert.equal(run.chunkTotal, 4);
    assert.equal(run.total, 100);
    assert.equal(run.processed, 50);
    assert.equal(run.pending, 50);
    assert.equal(run.rows.length, 50);
    assert.equal(run.summary.published, 0);
    assert.equal(run.summary.validated, 50);
    assert.equal(run.completePublishedVersionId ?? null, null);
    assert.deepEqual(
      run.rows.map((r) => r.productId),
      Array.from({ length: 50 }, (_, i) => `p${i + 1}`)
    );
    assert.deepEqual(progress.map((p) => p.processed), [0, 25, 50]);
  });

  it("resposta sem rows é tratada como falha do bloco", async () => {
    const run = await runProductionCostBulkPublishInChunks({
      preview: makePreview(30),
      publishChunk: async () => ({}) as never,
    });
    assert.equal(run.status, "INTERRUPTED");
    assert.equal(run.failedChunk, 1);
    assert.equal(run.processed, 0);
    assert.equal(run.summary.published, 0);
  });

  it("progresso: validate acumula; só finalize marca published", async () => {
    const progress: ProductionCostBulkPublishRunProgress[] = [];
    await runProductionCostBulkPublishInChunks({
      preview: makePreview(354),
      publishChunk: async (request) => respond(request),
      onProgress: (p) => progress.push(p),
    });
    assert.equal(progress.length, 16);
    assert.deepEqual(
      progress.map((p) => p.processed),
      [...Array.from({ length: 14 }, (_, i) => i * 25), 350, 354]
    );
    assert.deepEqual(
      progress.map((p) => p.confirmedChunks),
      Array.from({ length: 16 }, (_, i) => i)
    );
    for (const p of progress) {
      assert.equal(p.total, 354);
      assert.equal(p.pending, 354 - p.processed);
      assert.equal(p.chunkTotal, 15);
      assert.equal(p.batchRunId, "batch-unico");
    }
    // Antes do finalize: só VALIDATED
    assert.equal(progress[14]!.summary.published, 0);
    assert.equal(progress[14]!.summary.validated, 350);
    // Após finalize: PUBLISHED completo (rows substituídos)
    assert.equal(progress[15]!.summary.published, 354);
    assert.equal(progress[15]!.summary.validated, 0);
  });

  it("resumo global vem dos rows do finalize (ALREADY_PUBLISHED, bloqueios, conflitos, erros)", async () => {
    const statusFor = (productId: string): ProductionCostBulkPublishItemStatus => {
      const n = Number(productId.slice(1));
      if (n <= 5) return "ALREADY_PUBLISHED";
      if (n >= 30 && n < 33) return "BLOCKED";
      if (n >= 100 && n < 104) return "CONFLICT";
      if (n >= 350 && n < 352) return "ERROR";
      if (n === 200) return "SKIPPED";
      return "PUBLISHED";
    };
    const run = await runProductionCostBulkPublishInChunks({
      preview: makePreview(354),
      publishChunk: async (request) => respond(request, statusFor),
    });
    assert.equal(run.rows.length, 354);
    assert.deepEqual(run.summary, {
      selected: 354,
      processed: 354,
      validated: 0,
      published: 339,
      alreadyPublished: 5,
      skipped: 1,
      blocked: 3,
      conflict: 4,
      error: 2,
    });
  });
});

describe("productionCostBulkPublishChunkedRun — wiring na UI", () => {
  it("ProductModule publica via orquestrador por blocos no endpoint existente", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /runProductionCostBulkPublishInChunks/);
    assert.match(mod, /"\/api\/products\/production-cost\/bulk-publish"/);
    assert.match(mod, /batchRunId: request\.batchRunId/);
    assert.match(mod, /productIds: request\.productIds/);
    assert.match(mod, /draftVersionIdsByProduct: request\.draftVersionIdsByProduct/);
    assert.match(mod, /phase: request\.phase/);
  });

  it("orquestrador não paraleliza blocos e separa validate/finalize", () => {
    const src = read("src/lib/productionCostBulkPublishChunkedRun.ts");
    assert.doesNotMatch(src, /Promise\.all/);
    assert.match(src, /phase: "validate"/);
    assert.match(src, /phase: "finalize"/);
    assert.match(src, /HTTP CHUNK ≠ PUBLICATION TRANSACTION/);
  });

  it("diálogo mostra progresso, interrupção e retomada", () => {
    const dialog = read("src/components/product/ProductProductionCostBulkPublishDialog.tsx");
    assert.match(dialog, /data-testid="bulk-publish-progress"/);
    assert.match(dialog, /Publicação interrompida após/);
    assert.match(dialog, /data-testid="bulk-publish-resume"/);
  });

  it("backend materializa snapshot completo só no finalize", () => {
    const server = read("src/lib/productionCostBulkPublish.server.ts");
    assert.match(server, /materializeCompleteProductionCostSnapshot/);
    assert.match(server, /phase === "validate"/);
    assert.match(server, /archiveObsoleteProductDraftsAfterPublication/);
    assert.match(server, /batchRunId/);
  });
});
