import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
  parseSalesMarginNomusConfigJson,
  salesMarginNomusConfigToCostPolicy,
  serializeSalesMarginNomusConfig,
} from "./salesMarginNomusConfig.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";

describe("salesMarginNomusConfig", () => {
  it("parseia JSON com defaults seguros", () => {
    const config = parseSalesMarginNomusConfigJson({
      defaultTaxRuleId: "abc-123",
      taxMode: "none",
      allowLiveCostFallback: false,
    });
    assert.equal(config.defaultTaxRuleId, "abc-123");
    assert.equal(config.taxMode, "none");
    assert.equal(config.allowLiveCostFallback, false);
    assert.equal(config.useFrozenUnitCostFirst, true);
  });

  it("serializa e reparseia config", () => {
    const raw = serializeSalesMarginNomusConfig({
      ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
      defaultTaxRuleId: "rule-1",
    });
    const parsed = parseSalesMarginNomusConfigJson(JSON.parse(raw));
    assert.equal(parsed.defaultTaxRuleId, "rule-1");
  });

  it("cost policy reflete flags da config", () => {
    const policy = salesMarginNomusConfigToCostPolicy({
      ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
      allowLiveCostFallback: false,
      useFrozenUnitCostFirst: false,
    });
    assert.equal(policy.allowLiveCostFallback, false);
    assert.equal(policy.useFrozenUnitCostFirst, false);
  });
});

describe("salesMarginNomus cost policy resolver", () => {
  it("bloqueia fallback vivo quando desabilitado", () => {
    const result = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-1",
      analysis: { ok: true, finalUnitCost: 10 },
      costPolicy: { useFrozenUnitCostFirst: true, allowLiveCostFallback: false },
    });
    assert.equal(result.costSource, "MISSING_COST");
    assert.match(result.notes.join(" "), /desabilitado/i);
  });

  it("usa snapshot congelado quando useFrozenUnitCostFirst", () => {
    const result = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-1",
      storedUnitCost: 12.5,
      analysis: { ok: true, finalUnitCost: 99 },
      costPolicy: { useFrozenUnitCostFirst: true, allowLiveCostFallback: true },
    });
    assert.equal(result.costSource, "SALES_ORDER_ITEM_SNAPSHOT");
    assert.equal(result.unitCost, 12.5);
  });
});
