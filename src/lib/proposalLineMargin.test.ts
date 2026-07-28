import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "./proposalLineMargin.ts";

describe("proposalLineMargin — margem de formação da tabela", () => {
  it("preço manual sem comissão/frete: (receita − imposto − custo) / receita", () => {
    const proposal = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 0,
      taxesPerc: 10,
      unitCost: 600,
    });
    assert.equal(proposal.taxesValue, 100);
    assert.equal(proposal.netSalesAmount, 900);
    // 1000 − 100 − 600 = 300 → 30% sobre 1000 (PV), não 33,33% sobre 900
    assert.equal(proposal.marginValue, 300);
    assert.equal(proposal.marginPerc, 30);
  });

  it("comissão e frete% entram na margem (formação Atacado)", () => {
    // Fixture 610.35AA: tax 28.75%, comm 2%, freight 3%, margin formação 32%
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 3.423215,
      discountValue: 0,
      taxesPerc: 28.75,
      commissionPerc: 2,
      freightPerc: 3,
      unitCost: 1.172451,
    });
    assert.ok(Math.abs(r.marginPerc - 32) < 0.05, `expected ~32%, got ${r.marginPerc}`);
    assert.ok(Math.abs(r.marginValue - 1.095429) < 0.01, `margin R$ ${r.marginValue}`);
  });

  it("desconto reduz a margem % abaixo da formação", () => {
    const full = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 3.423215,
      taxesPerc: 28.75,
      commissionPerc: 2,
      freightPerc: 3,
      unitCost: 1.172451,
    });
    const discounted = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 3.423215,
      discountValue: 0.5,
      taxesPerc: 28.75,
      commissionPerc: 2,
      freightPerc: 3,
      unitCost: 1.172451,
    });
    assert.ok(discounted.marginPerc < full.marginPerc);
    assert.ok(discounted.net < full.net);
  });

  it("frete absoluto legado soma ao frete percentual", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 100,
      taxesPerc: 0,
      commissionPerc: 0,
      freightPerc: 3,
      freightValue: 2,
      unitCost: 50,
    });
    // frete = 3 + 2 = 5; margem = 100 − 0 − 0 − 5 − 50 = 45 → 45%
    assert.equal(r.freightValue, 5);
    assert.equal(r.marginValue, 45);
    assert.equal(r.marginPerc, 45);
  });

  it("resumo pondera % pela receita PV (não média simples)", () => {
    const a = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      taxesPerc: 0,
      unitCost: 600,
    });
    const b = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 100,
      taxesPerc: 0,
      unitCost: 10,
    });
    const summary = calculateProposalMarginSummary([a, b]);
    assert.equal(a.marginValue, 400);
    assert.equal(b.marginValue, 90);
    assert.equal(summary.totalMarginValue, 490);
    // (490 / 1100) * 100 → 44.55
    assert.equal(summary.totalMarginPerc, 44.55);
  });
});
