import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeNomusSyncLineTotalCost,
  formatNomusSyncUnitCostDecimal,
} from "./salesOrderNomusSyncCost.server.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
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

  it("linha com unitCost > 0 usa snapshot histórico na margem", () => {
    const stored = resolveSalesOrderItemCost({
      salesOrderItemId: "i1",
      productId: "p1",
      storedUnitCost: 55,
      analysis: { totalIndustrialCost: 99 },
    });
    assert.equal(stored.unitCost, 55);
    assert.equal(stored.costSource, "HISTORICAL_SNAPSHOT");
  });

  it("linha com unitCost = 0 usa fallback do motor oficial", () => {
    const live = resolveSalesOrderItemCost({
      salesOrderItemId: "i2",
      productId: "p2",
      storedUnitCost: 0,
      analysis: { totalIndustrialCost: 88, costAnalysisPartial: false },
    });
    assert.equal(live.unitCost, 88);
    assert.equal(live.costSource, "OFFICIAL_FINAL_COST");
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

  it("sync Nomus não grava unitCost = 0 silencioso quando custo existe", () => {
    const sync = read("scripts/nomusSalesOrdersSyncV1.ts");
    assert.match(sync, /buildNomusSyncOfficialUnitCostIndex/);
    assert.match(sync, /formatNomusSyncUnitCostDecimal/);
    assert.doesNotMatch(sync, /unitCost:\s*decimalString\(0\)/);
  });
});
