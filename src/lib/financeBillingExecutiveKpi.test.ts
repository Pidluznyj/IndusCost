import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceBillingComparisonPeriodTitle,
  buildFinanceBillingSelectedPeriodTitle,
  computeFinanceBillingComparisonDelta,
  formatFinanceBillingDeltaValue,
  formatFinanceBillingShortMonthYear,
  formatFinanceBillingVariationValue,
} from "./financeBillingExecutiveKpi.js";

describe("financeBillingExecutiveKpi", () => {
  it("formata mês abreviado", () => {
    assert.equal(formatFinanceBillingShortMonthYear(6, 2025), "Jun/2025");
    assert.equal(formatFinanceBillingShortMonthYear(12, 2026), "Dez/2026");
  });

  it("monta títulos de grupo", () => {
    assert.equal(
      buildFinanceBillingSelectedPeriodTitle(2026, 6),
      "Período selecionado — Junho/2026"
    );
    assert.equal(buildFinanceBillingSelectedPeriodTitle(2026, null), "Ano selecionado — 2026");
    assert.equal(
      buildFinanceBillingComparisonPeriodTitle(6, 2025),
      "Comparativo — Junho/2025"
    );
  });

  it("calcula diferença e variação sem NaN", () => {
    const cmp = computeFinanceBillingComparisonDelta(284_910, 250_000);
    assert.equal(cmp.delta, 34_910);
    assert.ok(cmp.variationPercent != null && Math.abs(cmp.variationPercent - 13.964) < 0.01);
    assert.equal(computeFinanceBillingComparisonDelta(100, 0).variationPercent, null);
    assert.equal(computeFinanceBillingComparisonDelta(null, 50).delta, null);
    assert.equal(formatFinanceBillingVariationValue(null), "Sem base comparativa");
    assert.doesNotMatch(formatFinanceBillingVariationValue(null), /NaN/);
    assert.doesNotMatch(formatFinanceBillingDeltaValue(1000), /Infinity/);
  });
});
