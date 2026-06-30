import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildNomusSyncLineMatchKey,
  buildPreservationMapFromExistingItems,
  computeNomusSyncLineTotalCost,
  createNomusSyncUnitCostApplyStats,
  formatNomusSyncUnitCostDecimal,
  parseNomusSyncStoredUnitCost,
  recordUnitCostSnapshotApplyStats,
  resolveBackfillSalesOrderItemUnitCost,
  resolveSalesOrderItemUnitCostSnapshot,
  type NomusSyncLineUnitCostResult,
} from "./salesOrderNomusSyncCost.server.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function makeIndex(entries: Record<string, number | null>): Map<string, NomusSyncLineUnitCostResult> {
  const index = new Map<string, NomusSyncLineUnitCostResult>();
  for (const [productId, unitCost] of Object.entries(entries)) {
    index.set(productId, {
      unitCost,
      costSource: unitCost != null && unitCost > 0 ? "LIVE_PRODUCT_COST" : "MISSING_COST",
      warning: unitCost == null || unitCost <= 0 ? "Custo indisponível no sync Nomus — unitCost não gravado." : null,
    });
  }
  return index;
}

describe("salesOrderNomusSyncCost", () => {
  it("formatNomusSyncUnitCostDecimal não inventa custo positivo", () => {
    assert.equal(formatNomusSyncUnitCostDecimal(null), "0.000000");
    assert.equal(formatNomusSyncUnitCostDecimal(0), "0.000000");
    assert.equal(formatNomusSyncUnitCostDecimal(42.5), "42.500000");
  });

  it("computeNomusSyncLineTotalCost multiplica quantidade × unitCost", () => {
    assert.equal(computeNomusSyncLineTotalCost(10, 4.5), 45);
    assert.equal(computeNomusSyncLineTotalCost(10, null), 0);
  });

  it("parseNomusSyncStoredUnitCost ignora zero e inválidos", () => {
    assert.equal(parseNomusSyncStoredUnitCost(0), null);
    assert.equal(parseNomusSyncStoredUnitCost("0"), null);
    assert.equal(parseNomusSyncStoredUnitCost(12.5), 12.5);
  });

  it("linha com unitCost > 0 usa snapshot histórico na margem", () => {
    const stored = resolveSalesOrderItemCost({
      salesOrderItemId: "i1",
      productId: "p1",
      storedUnitCost: 55,
      analysis: { totalIndustrialCost: 99 },
    });
    assert.equal(stored.unitCost, 55);
    assert.equal(stored.costSource, "SALES_ORDER_ITEM_SNAPSHOT");
  });

  it("linha com unitCost = 0 usa fallback do motor oficial", () => {
    const live = resolveSalesOrderItemCost({
      salesOrderItemId: "i2",
      productId: "p2",
      storedUnitCost: 0,
      analysis: { totalIndustrialCost: 88, costAnalysisPartial: false },
    });
    assert.equal(live.unitCost, 88);
    assert.equal(live.costSource, "LIVE_PRODUCT_COST");
  });

  it("custo indisponível permanece MISSING_COST", () => {
    const missing = resolveSalesOrderItemCost({
      salesOrderItemId: "i3",
      productId: "p3",
      storedUnitCost: null,
      analysis: { error: "ROUTING_MISSING", message: "Sem roteiro" },
    });
    assert.equal(missing.unitCost, null);
    assert.equal(missing.costSource, "MISSING_COST");
  });

  it("resolveSalesOrderItemUnitCostSnapshot preserva unitCost histórico no re-sync", () => {
    const key = buildNomusSyncLineMatchKey({
      productId: "p1",
      externalProductId: 100,
      proposalItemId: "pi1",
    });
    const preservationMap = new Map([[key, 77]]);
    const index = makeIndex({ p1: 99 });

    const snapshot = resolveSalesOrderItemUnitCostSnapshot({
      productId: "p1",
      externalProductId: 100,
      proposalItemId: "pi1",
      preservationMap,
      unitCostIndex: index,
    });

    assert.equal(snapshot.outcome, "preserved");
    assert.equal(snapshot.unitCost, 77);
    assert.equal(snapshot.costSource, "SALES_ORDER_ITEM_SNAPSHOT");
  });

  it("resolveSalesOrderItemUnitCostSnapshot resolve linha nova com índice oficial", () => {
    const snapshot = resolveSalesOrderItemUnitCostSnapshot({
      productId: "p2",
      externalProductId: 200,
      proposalItemId: null,
      preservationMap: new Map(),
      unitCostIndex: makeIndex({ p2: 42 }),
    });

    assert.equal(snapshot.outcome, "resolved");
    assert.equal(snapshot.unitCost, 42);
  });

  it("resolveSalesOrderItemUnitCostSnapshot tenta resolver linha legada sem snapshot", () => {
    const snapshot = resolveSalesOrderItemUnitCostSnapshot({
      productId: "p3",
      externalProductId: 300,
      proposalItemId: null,
      preservationMap: new Map(),
      unitCostIndex: makeIndex({ p3: null }),
    });

    assert.equal(snapshot.outcome, "unresolved");
    assert.equal(snapshot.unitCost, null);
    assert.match(snapshot.warning ?? "", /Custo indisponível/);
  });

  it("buildPreservationMapFromExistingItems só indexa unitCost > 0", () => {
    const map = buildPreservationMapFromExistingItems([
      {
        productId: "p1",
        externalProductId: 10,
        proposalItemId: null,
        unitCost: "25.500000",
      },
      {
        productId: "p2",
        externalProductId: 20,
        proposalItemId: null,
        unitCost: "0.000000",
      },
    ]);
    assert.equal(map.get("10|p1|"), 25.5);
    assert.equal(map.has("20|p2|"), false);
  });

  it("recordUnitCostSnapshotApplyStats distingue primeira resolução e cache por productId", () => {
    const stats = createNomusSyncUnitCostApplyStats();
    const seen = new Set<string>();
    const resolved = resolveSalesOrderItemUnitCostSnapshot({
      productId: "p1",
      externalProductId: 1,
      proposalItemId: null,
      preservationMap: new Map(),
      unitCostIndex: makeIndex({ p1: 10 }),
    });

    recordUnitCostSnapshotApplyStats(stats, resolved, { orderCode: "PV-1", productId: "p1", sku: "SKU" }, seen);
    recordUnitCostSnapshotApplyStats(stats, resolved, { orderCode: "PV-1", productId: "p1", sku: "SKU" }, seen);

    assert.equal(stats.costsNewlyResolved, 1);
    assert.equal(stats.costsFromProductIndexCache, 1);
  });

  it("sync Nomus reconcilia itens sem deleteMany cego", () => {
    const sync = read("scripts/nomusSalesOrdersSyncV1.ts");
    assert.match(sync, /buildNomusSyncOfficialUnitCostIndex/);
    assert.match(sync, /buildPreservationMapFromExistingItems/);
    assert.match(sync, /resolveSalesOrderItemUnitCostSnapshot/);
    assert.match(sync, /buildNomusSyncItemWritePlan/);
    assert.match(sync, /applyNomusSyncItemWritePlan/);
    assert.match(sync, /changedHeaderTotals/);
    assert.doesNotMatch(sync, /salesOrderItem\.deleteMany/);
  });

  it("resolveBackfillSalesOrderItemUnitCost usa índice oficial", () => {
    const index = makeIndex({ p1: 33 });
    const resolved = resolveBackfillSalesOrderItemUnitCost({ productId: "p1", unitCostIndex: index });
    assert.equal(resolved.outcome, "resolved");
    assert.equal(resolved.unitCost, 33);
  });

  it("resolveBackfillSalesOrderItemUnitCost sinaliza produto ausente", () => {
    const resolved = resolveBackfillSalesOrderItemUnitCost({
      productId: "",
      unitCostIndex: new Map(),
    });
    assert.equal(resolved.outcome, "no_product");
  });
});
