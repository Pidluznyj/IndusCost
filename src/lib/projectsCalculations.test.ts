import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCostBreakdown,
  calculateAmortizedMoldCostPerUnit,
  calculateStructureLineTotalCost,
  calculateSuggestedPrice,
  formatProjectCode,
  sanitizeFinite,
} from "./projectsCalculations.js";

describe("projectsCalculations", () => {
  it("calcula custo de linha com quantidade e perda", () => {
    assert.ok(Math.abs(calculateStructureLineTotalCost(10, 5, 10) - 55) < 0.001);
    assert.equal(calculateStructureLineTotalCost(2, 100, 0), 200);
  });

  it("calcula molde amortizado por unidade", () => {
    assert.equal(calculateAmortizedMoldCostPerUnit(50000, 10000), 5);
    assert.equal(calculateAmortizedMoldCostPerUnit(50000, 0), null);
  });

  it("calcula preço sugerido respeitando margem alvo", () => {
    assert.equal(calculateSuggestedPrice(70, 30), 100);
    assert.equal(calculateSuggestedPrice(100, 100), null);
  });

  it("payload de custos não retorna NaN/Infinity", () => {
    const breakdown = buildCostBreakdown({
      structureLines: [
        { lineType: "RAW_MATERIAL", quantity: 1, unitCostSnapshot: 10, lossPercent: 5 },
        { lineType: "COMPONENT", quantity: 2, unitCostSnapshot: 20, lossPercent: 0 },
      ],
      molds: [
        {
          chargeMode: "AMORTIZED_IN_PRODUCT",
          constructionCost: 1000,
          amortizationQuantity: 100,
        },
      ],
      targetMarginPercent: 25,
      targetPrice: 90,
    });
    for (const value of Object.values(breakdown)) {
      if (value != null) {
        assert.equal(Number.isFinite(value), true, String(value));
      }
    }
    assert.equal(breakdown.unitCost > 0, true);
    assert.ok(Math.abs((breakdown.suggestedPrice ?? 0) - 80.66666666666667) < 0.001);
  });

  it("sanitizeFinite evita NaN", () => {
    assert.equal(sanitizeFinite(Number.NaN), null);
    assert.equal(sanitizeFinite(12.5), 12.5);
  });

  it("formatProjectCode gera código interno", () => {
    assert.equal(formatProjectCode(1), "PRJ-00001");
    assert.equal(formatProjectCode(42), "PRJ-00042");
  });
});
