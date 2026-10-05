import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractOwnProcessDecompositionFromAnalysis } from "./productCostBaseline.js";
import { resolveProductCostBaseline } from "./productCostBaseline.server.js";
import {
  createFakeDb,
  createFakeEngine,
  liveAnalysis,
  publishedCost,
  TEST_IDS,
} from "./simulationsTestSupport.js";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} ≉ ${expected}`);

const NOW = new Date("2026-10-05T15:00:00.000Z");

function setup(analysis: unknown = liveAnalysis()) {
  const db = createFakeDb();
  const { engine, calls } = createFakeEngine(analysis);
  const publishedReads: string[] = [];
  const deps = {
    now: () => NOW,
    getEffectiveCost: async (_db: unknown, productId: string) => {
      publishedReads.push(productId);
      return publishedCost(productId);
    },
  };
  return { db, engine, calls, publishedReads, deps };
}

describe("resolveProductCostBaseline — LIVE ≠ PUBLISHED", () => {
  it("PUBLISHED = 1,70 com versão, revisão e vigência; LIVE = 1,30 com instante do cálculo", async () => {
    const { db, engine, deps } = setup();
    const published = await resolveProductCostBaseline(
      db.prisma,
      engine,
      { productId: TEST_IDS.product, source: "PUBLISHED", context: "ENGINEERING_SCENARIO" },
      deps
    );
    const live = await resolveProductCostBaseline(
      db.prisma,
      engine,
      { productId: TEST_IDS.product, source: "LIVE", context: "ENGINEERING_SCENARIO" },
      deps
    );
    assert.equal(published.status, "OK");
    assert.equal(live.status, "OK");
    if (published.status === "OK" && live.status === "OK") {
      near(published.totalIndustrialCost, 1.7);
      near(published.totalMaterialCost, 1.2);
      near(published.totalHHUnit, 0.3);
      near(published.totalHMUnit, 0.2);
      assert.equal(published.productionCostVersionId, TEST_IDS.version);
      assert.equal(published.productionCostVersionCode, "2026-10");
      assert.equal(published.productionCostRevision, 2);
      assert.equal(published.effectiveDate, "2026-10-01");
      assert.equal(published.calculatedAt, null);

      near(live.totalIndustrialCost, 1.3);
      assert.equal(live.productionCostVersionId, null);
      assert.equal(live.calculatedAt, NOW.toISOString());
      assert.equal(live.sku, "610.01AA");
    }
  });

  it("PUBLISHED não chama o motor; LIVE não lê custo publicado", async () => {
    const a = setup();
    await resolveProductCostBaseline(
      a.db.prisma,
      a.engine,
      { productId: TEST_IDS.product, source: "PUBLISHED", context: "COMMERCIAL_PRICING" },
      a.deps
    );
    assert.deepEqual(a.calls, [], "PUBLISHED sem includeOwnProcess não roda o motor");
    const b = setup();
    await resolveProductCostBaseline(
      b.db.prisma,
      b.engine,
      { productId: TEST_IDS.product, source: "LIVE", context: "ENGINEERING_PREVIEW" },
      b.deps
    );
    assert.deepEqual(b.publishedReads, []);
  });

  it("sem custo publicado → NO_PUBLISHED_COST, sem fallback para LIVE", async () => {
    const { db, engine, calls, deps } = setup();
    const result = await resolveProductCostBaseline(
      db.prisma,
      engine,
      { productId: TEST_IDS.productNoPublished, source: "PUBLISHED", context: "ENGINEERING_SCENARIO", includeOwnProcess: true },
      deps
    );
    assert.equal(result.status, "NO_PUBLISHED_COST");
    assert.deepEqual(calls, [], "não tenta o motor para preencher o custo que falta");
    assert.match(result.message, /não possui custo oficial publicado/);
  });

  it("produto inexistente e falha do motor têm estados próprios", async () => {
    const { db, engine, deps } = setup();
    const missing = await resolveProductCostBaseline(
      db.prisma,
      engine,
      { productId: TEST_IDS.missing, source: "PUBLISHED", context: "ENGINEERING_SCENARIO" },
      deps
    );
    assert.equal(missing.status, "PRODUCT_NOT_FOUND");
    const liveMissing = await resolveProductCostBaseline(
      db.prisma,
      engine,
      { productId: TEST_IDS.missing, source: "LIVE", context: "ENGINEERING_SCENARIO" },
      deps
    );
    assert.equal(liveMissing.status, "PRODUCT_NOT_FOUND");

    const failing = setup({ error: "ROUTING_MISSING", message: "Componente sem processo." });
    const failed = await resolveProductCostBaseline(
      failing.db.prisma,
      failing.engine,
      { productId: TEST_IDS.product, source: "LIVE", context: "ENGINEERING_SCENARIO" },
      failing.deps
    );
    assert.equal(failed.status, "LIVE_COST_UNAVAILABLE");
    assert.equal(failed.message, "Componente sem processo.");
  });

  it("o resolver só lê: nenhuma escrita em nenhum modelo", async () => {
    const { db, engine, deps } = setup();
    for (const source of ["PUBLISHED", "LIVE"] as const) {
      await resolveProductCostBaseline(
        db.prisma,
        engine,
        { productId: TEST_IDS.product, source, context: "ENGINEERING_SCENARIO", includeOwnProcess: true },
        deps
      );
    }
    assert.deepEqual(db.writes, []);
    assert.deepEqual([...db.touched], ["product"]);
  });
});

describe("resolveProductCostBaseline — decomposição do processo próprio", () => {
  it("LIVE traz transformação × setup do detalhe do motor", async () => {
    const { db, engine, deps } = setup();
    const live = await resolveProductCostBaseline(
      db.prisma,
      engine,
      { productId: TEST_IDS.product, source: "LIVE", context: "ENGINEERING_SCENARIO" },
      deps
    );
    if (live.status === "OK") {
      assert.ok(live.ownProcess);
      near(
        (live.ownProcess?.transformHh ?? 0) + (live.ownProcess?.transformHm ?? 0),
        0.24
      );
      near((live.ownProcess?.setupHh ?? 0) + (live.ownProcess?.setupHm ?? 0), 0.06);
    }
  });

  it("PUBLISHED só herda a decomposição viva quando HH/HM coincidem", async () => {
    const differs = setup();
    const noMatch = await resolveProductCostBaseline(
      differs.db.prisma,
      differs.engine,
      { productId: TEST_IDS.product, source: "PUBLISHED", context: "ENGINEERING_SCENARIO", includeOwnProcess: true },
      differs.deps
    );
    if (noMatch.status === "OK") {
      assert.equal(noMatch.ownProcess, null);
      assert.ok(noMatch.warnings.some((w) => w.code === "OWN_PROCESS_DECOMPOSITION_UNAVAILABLE"));
    }
    const same = setup(liveAnalysis({ mp: 1.2, hh: 0.3, hm: 0.2, setup: 0.1 }));
    const match = await resolveProductCostBaseline(
      same.db.prisma,
      same.engine,
      { productId: TEST_IDS.product, source: "PUBLISHED", context: "ENGINEERING_SCENARIO", includeOwnProcess: true },
      same.deps
    );
    if (match.status === "OK") {
      assert.ok(match.ownProcess);
      near(match.totalIndustrialCost, 1.7);
    }
  });

  it("extractOwnProcessDecompositionFromAnalysis ignora linhas de filhos e detalhe incompleto", () => {
    assert.equal(extractOwnProcessDecompositionFromAnalysis(null), null);
    assert.equal(extractOwnProcessDecompositionFromAnalysis({ details: {} }), null);
    const analysis = liveAnalysis();
    (analysis.details.processBreakdown as unknown[]).push({
      rollupFromBom: true,
      total: 99,
      laborCost: 50,
      machineCost: 49,
    });
    const own = extractOwnProcessDecompositionFromAnalysis(analysis);
    near((own?.transformHh ?? 0) + (own?.transformHm ?? 0) + (own?.setupHh ?? 0) + (own?.setupHm ?? 0), 0.3);
    const incomplete = liveAnalysis();
    (incomplete.details.processBreakdown[0] as { calculationDetails?: unknown }).calculationDetails = undefined;
    assert.equal(extractOwnProcessDecompositionFromAnalysis(incomplete), null);
  });
});
