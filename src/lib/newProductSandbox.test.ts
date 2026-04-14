import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNewProductSandboxResult,
  materialLineTotal,
  sumMaterialTotal,
  type NewProductMaterialLine,
} from "./newProductSandbox";

const lines: NewProductMaterialLine[] = [
  { code: "MAT-01", description: "Resina", quantity: 2, unit: "kg", unitCost: 10 },
  { code: "MAT-02", description: "Master", quantity: 1, unit: "kg", unitCost: 5 },
];

/** TESTE 1 — soma correta das matérias-primas */
describe("newProductSandbox TESTE 1", () => {
  it("soma total de MP corretamente", () => {
    assert.equal(materialLineTotal(lines[0]), 20);
    assert.equal(materialLineTotal(lines[1]), 5);
    assert.equal(sumMaterialTotal(lines), 25);
  });
});

/** TESTE 2 — custo base = MP + HH + HM */
describe("newProductSandbox TESTE 2", () => {
  it("fecha custo base com MP HH HM", () => {
    const r = computeNewProductSandboxResult({
      lines,
      hh: 3,
      hm: 2,
      mode: "MARGIN",
      desiredMarginPct: 20,
      targetPrice: 0,
    });
    assert.equal(r.costBase, 30);
  });
});

/** TESTE 3 — modo margem desejada calcula preço */
describe("newProductSandbox TESTE 3", () => {
  it("preço = custo/(1-margem)", () => {
    const r = computeNewProductSandboxResult({
      lines,
      hh: 3,
      hm: 2,
      mode: "MARGIN",
      desiredMarginPct: 40,
      targetPrice: 0,
    });
    assert.ok(Math.abs(r.price - 50) < 1e-9); // 30/0.6
  });
});

/** TESTE 4 — modo preço alvo calcula margem */
describe("newProductSandbox TESTE 4", () => {
  it("margem resultante = 1 - custo/preço", () => {
    const r = computeNewProductSandboxResult({
      lines,
      hh: 3,
      hm: 2,
      mode: "TARGET_PRICE",
      desiredMarginPct: 0,
      targetPrice: 50,
    });
    assert.ok(Math.abs(r.marginPct - 40) < 1e-9);
  });
});

/** TESTE 5 — percentuais MP + HH + HM = 100% */
describe("newProductSandbox TESTE 5", () => {
  it("percentuais fecham em 100%", () => {
    const r = computeNewProductSandboxResult({
      lines,
      hh: 3,
      hm: 2,
      mode: "MARGIN",
      desiredMarginPct: 20,
      targetPrice: 0,
    });
    const sum = r.mpPct + r.hhPct + r.hmPct;
    assert.ok(Math.abs(sum - 100) < 1e-9);
  });
});
