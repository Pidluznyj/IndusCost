import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeMaterialTotalValue,
  normalizeMaterialQuantity,
} from "./materialQuantityTotal.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("materialQuantityTotal", () => {
  it("total = quantidade × custo unitário da unidade adotada", () => {
    assert.equal(computeMaterialTotalValue(10, 1.17), 11.7);
    assert.equal(computeMaterialTotalValue(2.5, 4), 10);
    assert.equal(computeMaterialTotalValue(0, 100), 0);
    assert.equal(computeMaterialTotalValue(3, 0), 0);
  });

  it("normaliza quantidade inválida/negativa para zero", () => {
    assert.equal(normalizeMaterialQuantity(undefined), 0);
    assert.equal(normalizeMaterialQuantity(null), 0);
    assert.equal(normalizeMaterialQuantity(""), 0);
    assert.equal(normalizeMaterialQuantity(-5), 0);
    assert.equal(normalizeMaterialQuantity("abc"), 0);
    assert.equal(normalizeMaterialQuantity("12.5"), 12.5);
  });

  it("preserva precisão decimal em 6 casas", () => {
    assert.equal(computeMaterialTotalValue(3, 0.333333), 0.999999);
  });

  it("UI e API expõem quantidade e valor total sem alterar custo efetivo", () => {
    const ui = read("src/components/MaterialModule.tsx");
    assert.match(ui, /material-quantity-input/);
    assert.match(ui, /material-total-value/);
    assert.match(ui, /computeMaterialTotalValue/);
    assert.match(ui, /Valor MP total/);

    const server = read("server.ts");
    assert.match(server, /totalMaterialValue/);
    assert.match(server, /normalizeMaterialQuantity/);
    assert.match(server, /quantity:/);

    const schema = read("prisma/schema.prisma");
    assert.match(schema, /quantity\s+Decimal/);

    // Custo posto fábrica / efetivo continuam baseados em currentCost + freight / perda.
    assert.match(server, /landedCost = currentCost \+ freight/);
    assert.doesNotMatch(server, /landedCost = .*quantity/);
  });
});
