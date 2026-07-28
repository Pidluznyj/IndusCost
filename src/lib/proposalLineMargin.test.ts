import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "./proposalLineMargin.ts";
import { calculateSalesOrderItemMargin } from "./salesOrderMarginMath.ts";

describe("proposalLineMargin — motor Pedido de Venda", () => {
  it("receita − custo / receita (sem imposto/comissão/frete na margem)", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 0,
      taxesPerc: 10,
      commissionPerc: 2,
      freightPerc: 3,
      unitCost: 600,
      productId: "prod-1",
    });
    assert.equal(r.net, 1000);
    assert.equal(r.totalCost, 600);
    assert.equal(r.marginValue, 400);
    assert.equal(r.marginPerc, 40);
    assert.equal(r.costMissing, false);
    assert.equal(r.taxesValue, 100);
    assert.equal(r.commissionValue, 20);
  });

  it("bate o % do calculateSalesOrderItemMargin com os mesmos inputs", () => {
    const quantity = 10;
    const negotiatedPrice = 50;
    const discountValue = 25;
    const unitCost = 12.5;
    const net = quantity * negotiatedPrice - discountValue;
    const proposal = calculateProposalLineMargin({
      quantity,
      negotiatedPrice,
      discountValue,
      unitCost,
      productId: "prod-x",
    });
    const so = calculateSalesOrderItemMargin({
      salesOrderItemId: "so-1",
      productId: "prod-x",
      quantity,
      netTotalValue: net,
      unitCost,
      costSource: "VERSIONED_PRODUCTION_COST",
      costConfidence: "HIGH",
    });
    assert.equal(proposal.marginPerc, so.marginPercent);
    assert.equal(proposal.marginValue, so.marginValue);
    assert.equal(proposal.totalCost, so.totalCost);
  });

  it("custo ausente → margem null (não 100%)", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 407.4,
      unitCost: null,
      productId: "prod-1",
    });
    assert.equal(r.costMissing, true);
    assert.equal(r.marginValue, null);
    assert.equal(r.marginPerc, null);
    assert.equal(r.salesOrderMarginStatus, "SEM_CUSTO");
  });

  it("custo zero → CUSTO_ZERO / margem null (não 100%)", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 407.4,
      unitCost: 0,
      productId: "prod-1",
    });
    assert.equal(r.costMissing, true);
    assert.equal(r.marginPerc, null);
    assert.equal(r.salesOrderMarginStatus, "CUSTO_ZERO");
  });

  it("desconto reduz a receita e a margem", () => {
    const r = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      discountValue: 100,
      unitCost: 500,
      productId: "prod-1",
    });
    assert.equal(r.net, 900);
    assert.equal(r.marginValue, 400);
    assert.ok(Math.abs((r.marginPerc ?? 0) - 44.44) < 0.01);
  });

  it("resumo pondera % pela receita (só linhas com custo válido)", () => {
    const a = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 1000,
      unitCost: 600,
      productId: "a",
    });
    const b = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 100,
      unitCost: 10,
      productId: "b",
    });
    const missing = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 500,
      unitCost: null,
      productId: "c",
    });
    const zero = calculateProposalLineMargin({
      quantity: 1,
      negotiatedPrice: 200,
      unitCost: 0,
      productId: "d",
    });
    const summary = calculateProposalMarginSummary([a, b, missing, zero]);
    assert.equal(summary.totalMarginValue, 490);
    assert.equal(summary.totalMarginPerc, 44.55);
    assert.equal(summary.hasAnyCost, true);
  });
});
