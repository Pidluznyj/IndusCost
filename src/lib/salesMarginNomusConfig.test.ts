import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessSalesMarginNomusFiscalConfig,
  DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
  parseSalesMarginNomusConfigJson,
  SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE,
  salesMarginNomusConfigToCostPolicy,
  serializeSalesMarginNomusConfig,
  validateSalesMarginNomusConfigForSave,
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
    assert.equal(config.useFrozenUnitCostFirst, false);
  });

  it("JSON parcial usa allowLiveCostFallback false por padrão", () => {
    const config = parseSalesMarginNomusConfigJson({ taxMode: "none" });
    assert.equal(config.allowLiveCostFallback, false);
    assert.equal(config.useFrozenUnitCostFirst, false);
  });

  it("serializa e reparseia config", () => {
    const raw = serializeSalesMarginNomusConfig({
      ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
      defaultTaxRuleId: "rule-1",
    });
    const parsed = parseSalesMarginNomusConfigJson(JSON.parse(raw));
    assert.equal(parsed.defaultTaxRuleId, "rule-1");
  });

  it("cost policy ignora useFrozenUnitCostFirst legado", () => {
    const policy = salesMarginNomusConfigToCostPolicy({
      ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
      allowLiveCostFallback: false,
      useFrozenUnitCostFirst: true,
    });
    assert.equal(policy.allowLiveCostFallback, false);
    assert.equal(policy.useFrozenUnitCostFirst, false);
  });

  it("bloqueia save deductFromGross sem TaxRule", () => {
    const result = validateSalesMarginNomusConfigForSave({
      ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG,
      defaultTaxRuleId: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "TAX_RULE_REQUIRED");
      assert.equal(result.error, SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE);
    }
  });

  it("permite save deductFromGross com TaxRule ACTIVE e percentual > 0", () => {
    const result = validateSalesMarginNomusConfigForSave(
      { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG, defaultTaxRuleId: "rule-1" },
      { status: "ACTIVE", totalPercent: 27.25 }
    );
    assert.equal(result.ok, true);
  });

  it("bloqueia TaxRule inativa no save", () => {
    const result = validateSalesMarginNomusConfigForSave(
      { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG, defaultTaxRuleId: "rule-1" },
      { status: "INACTIVE", totalPercent: 10 }
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TAX_RULE_INACTIVE");
  });

  it("fallback 0% não passa como OK na auditoria fiscal", () => {
    const assessment = assessSalesMarginNomusFiscalConfig(
      { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG, defaultTaxRuleId: "rule-1" },
      { status: "ACTIVE", totalPercent: 0 }
    );
    assert.equal(assessment.status, "BLOQUEANTE");
  });

  it("TaxRule inativa gera BLOQUEANTE na auditoria", () => {
    const assessment = assessSalesMarginNomusFiscalConfig(
      { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG, defaultTaxRuleId: "rule-1" },
      { status: "INACTIVE", totalPercent: 27.25 }
    );
    assert.equal(assessment.status, "BLOQUEANTE");
  });

  it("taxMode none não exige TaxRule", () => {
    const assessment = assessSalesMarginNomusFiscalConfig(
      { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG, taxMode: "none", defaultTaxRuleId: null },
      null
    );
    assert.equal(assessment.status, "OK");
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

  it("ignora storedUnitCost comercial mesmo com flag legada useFrozenUnitCostFirst", () => {
    const result = resolveSalesOrderItemCost({
      salesOrderItemId: "item-1",
      productId: "prod-1",
      storedUnitCost: 12.5,
      analysis: { summary: { totalIndustrialCost: 99 } },
      costPolicy: { useFrozenUnitCostFirst: true, allowLiveCostFallback: true },
    });
    assert.equal(result.costSource, "LIVE_PRODUCT_COST");
    assert.equal(result.unitCost, 99);
  });
});
