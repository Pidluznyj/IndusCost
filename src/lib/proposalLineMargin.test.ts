import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "./proposalLineMargin.ts";

describe("proposalLineMargin — paridade Pedido de Venda", () => {
  it("receita − custo / receita (sem imposto/comissão/frete na margem)", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 0,
      taxesPerc: 10,
      commissionPerc: 2,
      freightPerc: 3,
      unitCost: 600,
    });
    assert.equal(r.net, 1000);
    assert.equal(r.totalCost, 600);
    assert.equal(r.marginValue, 400);
    assert.equal(r.marginPerc, 40);
    // Campos comerciais existem, mas não reduzem a margem oficial
    assert.equal(r.taxesValue, 100);
    assert.equal(r.commissionValue, 20);
  });

  it("custo ausente → margem null (não 100%)", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 407.4,
      unitCost: null,
    });
    assert.equal(r.costMissing, true);
    assert.equal(r.marginValue, null);
    assert.equal(r.marginPerc, null);
  });

  it("desconto reduz a receita e a margem", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 100,
      unitCost: 500,
    });
    assert.equal(r.net, 900);
    assert.equal(r.marginValue, 400);
    assert.ok(Math.abs((r.marginPerc ?? 0) - 44.44) < 0.01);
  });

  it("resumo pondera % pela receita (só linhas com custo)", () => {
    const a = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      unitCost: 600,
    });
    const b = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 100,
      unitCost: 10,
    });
    const missing = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 500,
      unitCost: null,
    });
    const summary = calculateProposalMarginSummary([a, b, missing]);
    assert.equal(summary.totalMarginValue, 490);
    assert.equal(summary.totalMarginPerc, 44.55);
    assert.equal(summary.hasAnyCost, true);
  });
});
