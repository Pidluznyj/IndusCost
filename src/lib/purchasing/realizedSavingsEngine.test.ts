import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateExtrasForQty,
  computeSavingsComparison,
  type SavingsComparisonHeaderInput,
} from "./realizedSavingsEngine.js";

function baseInput(
  overrides: Partial<SavingsComparisonHeaderInput> = {}
): SavingsComparisonHeaderInput {
  return {
    currency: "BRL",
    initialComparableTotalSnapshot: 1200,
    negotiatedComparableTotalSnapshot: 1000,
    totalGainSnapshot: 200,
    orderFreightHeader: 0,
    orderTaxesHeader: 0,
    orderExpensesHeader: 0,
    orderDiscountsHeader: 0,
    freightIncoterm: "FOB",
    evidenceCount: 1,
    lines: [
      {
        purchaseOrderItemId: "l1",
        description: "MP A",
        quantityOrdered: 100,
        initialUnitPrice: 12,
        orderUnitPrice: 10,
        orderFreight: 0,
        orderTaxes: 0,
        orderExpenses: 0,
        orderDiscounts: 0,
        quantityAcceptedConfirmed: 40,
        receivedUnitCost: 10,
        receivedFreight: 0,
        receivedTaxes: 0,
        receivedExpenses: 0,
        receivedDiscounts: 0,
      },
    ],
    ...overrides,
  };
}

describe("realizedSavingsEngine (OP-24)", () => {
  it("preserva ganho negociado histórico e separa realizado / não realizado", () => {
    const result = computeSavingsComparison(baseInput());
    assert.equal(result.gains.negotiatedGain, 200);
    assert.equal(result.meta.negotiationMeritImmutable, true);
    // 40 aceitos × (12-10) = 80 realizado na fatia; 60 pendentes × 2 = 120 não realizado
    assert.equal(result.gains.realizedGain, 80);
    assert.equal(result.gains.unrealizedGain, 120);
    assert.equal(result.prices.initialComparable, 1200);
    assert.equal(result.prices.negotiatedComparable, 1000);
    assert.equal(result.prices.orderComparable, 1000);
  });

  it("trata recebimento parcial na base comparável", () => {
    const partial = computeSavingsComparison(
      baseInput({
        lines: [
          {
            purchaseOrderItemId: "l1",
            description: "MP A",
            quantityOrdered: 100,
            initialUnitPrice: 12,
            orderUnitPrice: 10,
            orderFreight: 100,
            orderTaxes: 0,
            orderExpenses: 0,
            orderDiscounts: 0,
            quantityAcceptedConfirmed: 25,
            receivedUnitCost: 10,
            receivedFreight: 25,
            receivedTaxes: 0,
            receivedExpenses: 0,
            receivedDiscounts: 0,
          },
        ],
      })
    );
    assert.equal(partial.quantities.acceptedConfirmed, 25);
    assert.equal(partial.quantities.pending, 75);
    assert.equal(partial.gains.unrealizedGain, 150);
    assert.ok(partial.gains.realizedGain > 0);
  });

  it("calcula erosão por frete/despesa/divergência e alerta preço acima do pedido", () => {
    const result = computeSavingsComparison(
      baseInput({
        evidenceCount: 0,
        lines: [
          {
            purchaseOrderItemId: "l1",
            description: "MP A",
            quantityOrdered: 10,
            initialUnitPrice: 12,
            orderUnitPrice: 10,
            orderFreight: 0,
            orderTaxes: 0,
            orderExpenses: 0,
            orderDiscounts: 0,
            quantityAcceptedConfirmed: 10,
            receivedUnitCost: 11,
            receivedFreight: 20,
            receivedTaxes: 5,
            receivedExpenses: 15,
            receivedDiscounts: 0,
          },
        ],
      })
    );
    assert.ok(result.gains.gainErosionTotal > 0);
    assert.ok(result.gains.gainErosionBreakdown.priceDivergence > 0);
    assert.ok(result.gains.gainErosionBreakdown.freight > 0);
    assert.ok(result.alerts.some((a) => a.code === "RECEIVED_PRICE_ABOVE_ORDER"));
    assert.ok(result.alerts.some((a) => a.code === "ADDITIONAL_COST"));
    assert.ok(result.alerts.some((a) => a.code === "MISSING_EVIDENCE"));
    assert.ok(result.alerts.some((a) => a.code === "OUTSIDE_NEGOTIATED_CONDITION"));
    assert.equal(result.lines[0]?.outsideNegotiatedCondition, true);
  });

  it("rateia extras proporcionalmente à quantidade", () => {
    const half = allocateExtrasForQty({
      quantityOrdered: 100,
      quantityTarget: 50,
      lineFreight: 40,
      lineTaxes: 10,
      lineExpenses: 20,
      lineDiscounts: 4,
      headerFreightShare: 60,
      headerTaxesShare: 0,
      headerExpensesShare: 0,
      headerDiscountsShare: 0,
    });
    assert.equal(half.freight, 50);
    assert.equal(half.taxes, 5);
    assert.equal(half.expenses, 10);
    assert.equal(half.discounts, 2);
  });
});
