import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSalesOrderResultItem } from "./salesOrderResultMath.ts";
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "./proposalLineMargin.ts";

describe("proposalLineMargin — paridade com Pedido de Venda", () => {
  it("líquido 1000, imposto 10%, custo 600 → mesma margem do Resultado (deductFromGross)", () => {
    const so = computeSalesOrderResultItem({
      salesOrderItemId: "i1",
      orderId: "o1",
      issueMonth: 1,
      productId: "p1",
      quantity: 1,
      marginStatus: "OK",
      salesAmount: 1000,
      costAmount: 600,
      taxPercent: 10,
    });
    const proposal = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 0,
      taxesPerc: 10,
      unitCost: 600,
    });
    assert.equal(proposal.marginValue, so.marginAmount);
    assert.equal(proposal.marginPerc, so.marginPercent);
    assert.equal(proposal.taxesValue, so.taxAmount);
    assert.equal(proposal.netSalesAmount, so.netSalesAmount);
    // 1000 − 100 imposto − 600 custo = 300 → 33,333…% sobre 900
    assert.equal(proposal.marginValue, 300);
  });

  it("comissão e frete NÃO alteram a margem (iguais ao Pedido)", () => {
    const base = calculateProposalLineMargin({
      quantity: 2,
      negotiatedPrice: 500,
      discountValue: 0,
      taxesPerc: 12,
      unitCost: 200,
    });
    // Mesmos inputs de margem — comissão/frete ficam fora do helper
    assert.equal(base.net, 1000);
    assert.equal(base.totalCost, 400);
    assert.ok(base.marginValue !== 1000 - base.taxesValue - 50 - 30 - 400);
  });

  it("desconto reduz a receita vendida antes do imposto (como PV líquido)", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 100,
      taxesPerc: 10,
      unitCost: 500,
    });
    assert.equal(r.net, 900);
    assert.equal(r.taxesValue, 90);
    assert.equal(r.netSalesAmount, 810);
    assert.equal(r.marginValue, 310);
  });

  it("resumo pondera % pela receita líquida gerencial (não média simples)", () => {
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
    // (490 / 1100) * 100 → 44.55 (roundPricingPercent 2 casas) — não média de 40% e 90%
    assert.equal(summary.totalMarginPerc, 44.55);
  });
});

