import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateMarginPercentFromAgreedCustomerPrice,
  calculateMarginPercentFromSalePrice,
  calculateSalePriceFromCost,
  pricingCalculationMetricsAreFinite,
  sumTaxRuleComponentPercents,
} from "./pricingCalculations.js";

describe("pricingCalculations", () => {
  it("usa fórmula preço = custo / (1 - imposto - margem)", () => {
    const result = calculateSalePriceFromCost({
      cost: 10,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Math.abs(result.suggestedPrice - 10 / (1 - 0.2725 - 0.35)) < 0.000001);
    }
  });

  it("custo 1,30901, imposto 27,25%, margem 35% gera preço aproximado R$ 3,468", () => {
    const result = calculateSalePriceFromCost({
      cost: 1.30901,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Math.abs(result.suggestedPrice - 3.468348) < 0.001);
    }
  });

  it("calcula valor dos impostos = preço × imposto%", () => {
    const result = calculateSalePriceFromCost({
      cost: 1.30901,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const expectedTax = result.suggestedPrice * 0.2725;
      assert.ok(Math.abs(result.taxAmount - expectedTax) < 0.0001);
    }
  });

  it("calcula valor da margem = preço × margem%", () => {
    const result = calculateSalePriceFromCost({
      cost: 1.30901,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const expectedMargin = result.suggestedPrice * 0.35;
      assert.ok(Math.abs(result.marginAmount - expectedMargin) < 0.0001);
    }
  });

  it("bloqueia imposto + margem >= 100%", () => {
    const result = calculateSalePriceFromCost({
      cost: 10,
      taxPercent: 60,
      targetMarginPercent: 40,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /menor que 100%/i);
    }
  });

  it("não retorna NaN/Infinity", () => {
    const result = calculateSalePriceFromCost({
      cost: 1.30901,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(pricingCalculationMetricsAreFinite(result), true);
  });

  it("engenharia reversa recupera a margem a partir do preço", () => {
    const forward = calculateSalePriceFromCost({
      cost: 1.369,
      taxPercent: 28.75,
      targetMarginPercent: 30,
    });
    assert.equal(forward.ok, true);
    if (!forward.ok) return;
    const reverse = calculateMarginPercentFromSalePrice({
      salePrice: forward.suggestedPrice,
      cost: 1.369,
      taxPercent: 28.75,
    });
    assert.equal(reverse.ok, true);
    if (reverse.ok) {
      assert.ok(Math.abs(reverse.targetMarginPercent - 30) < 0.05);
    }
  });

  it("margem a partir do preço acordado desconta repasse no preço", () => {
    const pricingCost = 1.423;
    const taxPercent = 28.75;
    const priceAddOn = 0.5;
    const productPrice = 3.1255;
    const agreed = productPrice + priceAddOn;
    const reverse = calculateMarginPercentFromAgreedCustomerPrice({
      agreedCustomerPrice: agreed,
      pricingCost,
      taxPercent,
      priceAddOnUnit: priceAddOn,
    });
    assert.equal(reverse.ok, true);
    if (!reverse.ok) return;
    const forward = calculateSalePriceFromCost({
      cost: pricingCost,
      taxPercent,
      targetMarginPercent: reverse.targetMarginPercent,
    });
    assert.equal(forward.ok, true);
    if (forward.ok) {
      assert.ok(Math.abs(forward.suggestedPrice - productPrice) < 0.01);
    }
  });

  it("soma percentuais de componentes da regra fiscal", () => {
    const total = sumTaxRuleComponentPercents([
      { percentage: 18 },
      { percentage: 9.25 },
    ]);
    assert.equal(total, 27.25);
  });
});
