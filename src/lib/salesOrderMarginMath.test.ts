import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSalesOrderItemMargin,
  calculateSalesOrderMarginSummary,
  naiveAverageMarginPercent,
} from "./salesOrderMarginMath.js";

function itemInput(
  overrides: Partial<Parameters<typeof calculateSalesOrderItemMargin>[0]> = {}
) {
  return {
    salesOrderItemId: "item-1",
    productId: "prod-1",
    productSku: "100.01AA",
    productName: "Produto teste",
    quantity: 10,
    netTotalValue: 1000,
    unitCost: 60,
    costSource: "OFFICIAL_FINAL_COST" as const,
    costConfidence: "HIGH" as const,
    ...overrides,
  };
}

describe("salesOrderMarginMath", () => {
  it("1. item simples calcula margem correta", () => {
    const result = calculateSalesOrderItemMargin(itemInput());
    assert.equal(result.netRevenue, 1000);
    assert.equal(result.totalCost, 600);
    assert.equal(result.marginValue, 400);
    assert.equal(result.marginPercent, 40);
    assert.equal(result.markup, 1.666667);
    assert.equal(result.status, "OK");
  });

  it("2. item usa netTotalValue quando disponível", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ netTotalValue: 850, netUnitPrice: 99 })
    );
    assert.equal(result.netRevenue, 850);
    assert.equal(result.netUnitRevenue, 85);
  });

  it("3. item usa quantity × netUnitPrice quando netTotalValue não existe", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ netTotalValue: null, netUnitPrice: 50, quantity: 4 })
    );
    assert.equal(result.netRevenue, 200);
    assert.equal(result.netUnitRevenue, 50);
  });

  it("4. margem percentual = margem / receita", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ netTotalValue: 500, quantity: 5, unitCost: 70 })
    );
    assert.equal(result.marginValue, 150);
    assert.equal(result.marginPercent, 30);
  });

  it("5. markup = receita / custo", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ netTotalValue: 300, quantity: 3, unitCost: 50 })
    );
    assert.equal(result.totalCost, 150);
    assert.equal(result.markup, 2);
  });

  it("6. pedido com dois itens usa margem ponderada", () => {
    const a = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "a", netTotalValue: 1000, unitCost: 50, quantity: 10 })
    );
    const b = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "b", netTotalValue: 500, unitCost: 100, quantity: 5 })
    );
    const summary = calculateSalesOrderMarginSummary([a, b]);
    assert.equal(summary.netRevenue, 1500);
    assert.equal(summary.totalCost, 1000);
    assert.equal(summary.marginValue, 500);
    assert.equal(summary.marginPercent, 33.33);
  });

  it("7. não usa média simples de percentuais", () => {
    const a = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "a", netTotalValue: 1000, unitCost: 50, quantity: 10 })
    );
    const b = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "b", netTotalValue: 100, unitCost: 90, quantity: 1 })
    );
    const summary = calculateSalesOrderMarginSummary([a, b]);
    const naive = naiveAverageMarginPercent([a, b]);
    assert.notEqual(summary.marginPercent, naive);
    assert.equal(summary.marginPercent, 46.36);
    assert.equal(naive, 30);
  });

  it("8. item cancelado é ignorado na margem consolidada", () => {
    const active = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "active", netTotalValue: 800, unitCost: 40, quantity: 8 })
    );
    const canceled = calculateSalesOrderItemMargin(
      itemInput({
        salesOrderItemId: "canceled",
        isCanceled: true,
        netTotalValue: 5000,
        unitCost: 10,
      })
    );
    const summary = calculateSalesOrderMarginSummary([active, canceled]);
    assert.equal(canceled.status, "ITEM_CANCELADO");
    assert.equal(summary.validItemsCount, 1);
    assert.equal(summary.ignoredItemsCount, 1);
    assert.equal(summary.netRevenue, 800);
    assert.equal(summary.marginValue, 480);
  });

  it("9. receita zero retorna RECEITA_INVALIDA", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ netTotalValue: 0, netUnitPrice: 0 })
    );
    assert.equal(result.status, "RECEITA_INVALIDA");
    assert.equal(result.marginPercent, null);
    assert.equal(result.markup, null);
  });

  it("10. custo ausente retorna SEM_CUSTO", () => {
    const result = calculateSalesOrderItemMargin(itemInput({ unitCost: null }));
    assert.equal(result.status, "SEM_CUSTO");
    assert.equal(result.costSource, "MISSING_COST");
    assert.equal(result.costConfidence, "MISSING");
  });

  it("11. custo zero retorna CUSTO_ZERO", () => {
    const result = calculateSalesOrderItemMargin(itemInput({ unitCost: 0 }));
    assert.equal(result.status, "CUSTO_ZERO");
    assert.equal(result.marginPercent, null);
  });

  it("12. margem negativa retorna MARGEM_NEGATIVA", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ netTotalValue: 100, quantity: 1, unitCost: 150 })
    );
    assert.equal(result.status, "MARGEM_NEGATIVA");
    assert.equal(result.marginValue, -50);
    assert.equal(result.marginPercent, -50);
  });

  it("13. summary marca hasMissingCost", () => {
    const ok = calculateSalesOrderItemMargin(itemInput({ salesOrderItemId: "ok" }));
    const semCusto = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "sem", unitCost: null })
    );
    const summary = calculateSalesOrderMarginSummary([ok, semCusto]);
    assert.equal(summary.hasMissingCost, true);
  });

  it("14. summary marca hasNegativeMargin", () => {
    const neg = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "neg", netTotalValue: 50, quantity: 1, unitCost: 80 })
    );
    const summary = calculateSalesOrderMarginSummary([neg]);
    assert.equal(summary.hasNegativeMargin, true);
    assert.equal(summary.status, "MARGEM_NEGATIVA");
  });

  it("15. summary mantém status parcial quando há item sem custo", () => {
    const ok = calculateSalesOrderItemMargin(itemInput({ salesOrderItemId: "ok" }));
    const semCusto = calculateSalesOrderItemMargin(
      itemInput({ salesOrderItemId: "sem", unitCost: null })
    );
    const summary = calculateSalesOrderMarginSummary([ok, semCusto]);
    assert.equal(summary.status, "PARTIAL");
    assert.equal(summary.validItemsCount, 1);
    assert.equal(summary.marginPercent, 40);
  });
});

describe("salesOrderMarginStatus helpers", () => {
  it("item cancelado por itemStatus textual", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({ isCanceled: undefined, itemStatus: "CANCELADO" })
    );
    assert.equal(result.status, "ITEM_CANCELADO");
  });

  it("sem produto vinculado", () => {
    const result = calculateSalesOrderItemMargin(
      itemInput({
        productId: null,
        externalProductId: null,
        productSku: null,
        productCode: null,
      })
    );
    assert.equal(result.status, "SEM_PRODUTO_VINCULADO");
  });
});
