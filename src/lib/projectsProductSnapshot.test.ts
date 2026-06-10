import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateLaborLineTotal } from "./projectsUiUtils.js";
import { calculateStructureLineTotalCost } from "./projectsCalculations.js";

describe("projectsProductSnapshot", () => {
  it("mapeamento BOM para estrutura usa snapshot de custo", () => {
    const qty = 2;
    const unit = 15;
    const loss = 5;
    const total = calculateStructureLineTotalCost(qty, unit, loss);
    assert.equal(total, 31.5);
    assert.equal(Number.isFinite(total), true);
  });

  it("roteiro convertido para HH mantém cálculo finito", () => {
    const hours = 1.5;
    const rate = 42.5;
    const total = calculateLaborLineTotal(hours, rate, 0);
    assert.equal(total, 63.75);
    assert.equal(Number.isNaN(total), false);
  });
});
