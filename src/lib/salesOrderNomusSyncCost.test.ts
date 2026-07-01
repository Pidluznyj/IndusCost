import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeNomusSyncLineTotalCost,
  formatNomusSyncUnitCostDecimal,
  parseNomusSyncStoredUnitCost,
} from "./salesOrderNomusSyncCost.server.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderNomusSyncCost (legado)", () => {
  it("formatNomusSyncUnitCostDecimal formata decimal comercial/campo legado", () => {
    assert.equal(formatNomusSyncUnitCostDecimal(null), "0.000000");
    assert.equal(formatNomusSyncUnitCostDecimal(42.5), "42.500000");
  });

  it("computeNomusSyncLineTotalCost multiplica quantidade × valor unitário", () => {
    assert.equal(computeNomusSyncLineTotalCost(10, 4.5), 45);
    assert.equal(computeNomusSyncLineTotalCost(10, null), 0);
  });

  it("parseNomusSyncStoredUnitCost ignora zero", () => {
    assert.equal(parseNomusSyncStoredUnitCost(0), null);
    assert.equal(parseNomusSyncStoredUnitCost(12.5), 12.5);
  });

  it("margem não trata storedUnitCost comercial como custo de produção", () => {
    const withoutLive = resolveSalesOrderItemCost({
      salesOrderItemId: "i1",
      productId: "p1",
      storedUnitCost: 55,
    });
    assert.equal(withoutLive.unitCost, null);
    assert.notEqual(withoutLive.costSource, "SALES_ORDER_ITEM_SNAPSHOT");

    const withLive = resolveSalesOrderItemCost({
      salesOrderItemId: "i1",
      productId: "p1",
      storedUnitCost: 55,
      analysis: { summary: { totalIndustrialCost: 99 } },
      costPolicy: { allowLiveCostFallback: true, useFrozenUnitCostFirst: false },
    });
    assert.equal(withLive.unitCost, 99);
    assert.notEqual(withLive.costSource, "SALES_ORDER_ITEM_SNAPSHOT");
  });

  it("sync Nomus não preserva unitCost como custo industrial", () => {
    const sync = read("scripts/nomusSalesOrdersSyncV1.ts");
    assert.match(sync, /buildNomusSyncItemWritePlan/);
    assert.doesNotMatch(sync, /buildPreservationMapFromExistingItems/);
    assert.doesNotMatch(sync, /resolveSalesOrderItemUnitCostSnapshot/);
    assert.doesNotMatch(sync, /buildNomusSyncOfficialUnitCostIndex/);
    assert.match(sync, /preço unitário comercial/i);
  });

  it("backfill apply bloqueado", () => {
    const backfill = read("scripts/backfill-sales-order-unit-cost-snapshot.ts");
    assert.match(backfill, /apply desabilitado/i);
  });
});
