import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSalesOrderItemMargin,
  calculateSalesOrderMarginSummary,
} from "./salesOrderMarginMath.js";
import { computeSalesOrderResultItem } from "./salesOrderResultMath.js";
import {
  auditSalesMarginRules,
  buildSalesMarginRulesResult,
  calculateSalesMarginItem,
  calculateSalesMarginOrder,
  explainSalesMarginMetric,
  listSalesMarginMetricDefinitions,
  naiveAverageMarginPercent,
  naiveAverageResultMarginPercent,
} from "./salesMarginRulesEngine.js";
import type {
  SalesMarginRulesItemInput,
  SalesMarginRulesOrderInput,
} from "./salesMarginRulesEngine.types.js";

const TAX_CONTEXT = {
  productTaxIndex: new Map([["prod-1", 10]]),
  defaultTaxPercent: 8,
  defaultTaxLabel: "Regra padrão",
};

function item(overrides: Partial<SalesMarginRulesItemInput> = {}): SalesMarginRulesItemInput {
  return {
    salesOrderItemId: "item-1",
    productId: "prod-1",
    productSku: "SKU-1",
    productName: "Produto",
    quantity: 10,
    netTotalValue: 1000,
    unitCost: 60,
    costSource: "OFFICIAL_FINAL_COST",
    costConfidence: "HIGH",
    ...overrides,
  };
}

function order(
  overrides: Partial<SalesMarginRulesOrderInput> & { items?: SalesMarginRulesItemInput[] } = {}
): SalesMarginRulesOrderInput {
  return {
    id: "so-1",
    orderCode: "PD-100",
    customerId: "cust-1",
    sellerId: "seller-1",
    issueDate: new Date(2026, 5, 10),
    items: [item()],
    ...overrides,
  };
}

describe("salesMarginRulesEngine", () => {
  it("1. margem por item com custo e imposto", () => {
    const result = calculateSalesMarginItem(item(), {
      referenceDate: new Date(2026, 5, 15),
      today: new Date(2026, 5, 15),
      year: 2026,
      month: 6,
      sourceMode: "orderBased",
      taxMode: "deductFromGross",
      filters: {},
      taxContext: TAX_CONTEXT,
    });
    assert.equal(result.grossSalesAmount, 1000);
    assert.equal(result.taxAmount, 100);
    assert.equal(result.netSalesAmount, 900);
    assert.equal(result.totalCost, 600);
    assert.equal(result.marginAmount, 300);
    assert.equal(result.marginPercent, 33.33);
    assert.equal(result.status, "OK");
  });

  it("2. margem por item sem imposto (taxMode none)", () => {
    const result = calculateSalesMarginItem(
      item(),
      buildContext({ taxMode: "none" })
    );
    assert.equal(result.taxAmount, 0);
    assert.equal(result.netSalesAmount, 1000);
    assert.equal(result.marginAmount, 400);
  });

  it("3. margem por pedido com múltiplos itens", () => {
    const o = order({
      items: [
        item({ salesOrderItemId: "i1", netTotalValue: 1000, unitCost: 50, quantity: 10 }),
        item({ salesOrderItemId: "i2", netTotalValue: 500, unitCost: 100, quantity: 5 }),
      ],
    });
    const result = calculateSalesMarginOrder(o, buildContext({ taxMode: "none" }));
    assert.equal(result.itemsCount, 2);
    assert.equal(result.validItemsCount, 2);
    assert.equal(result.grossSalesAmount, 1500);
    assert.equal(result.marginAmount, 500);
    assert.equal(result.marginPercent, 33.33);
  });

  it("4. pedido com item sem custo", () => {
    const o = order({
      items: [
        item({ salesOrderItemId: "ok", netTotalValue: 800, unitCost: 40, quantity: 8 }),
        item({ salesOrderItemId: "sem", unitCost: null }),
      ],
    });
    const result = calculateSalesMarginOrder(o, buildContext());
    assert.equal(result.hasMissingCost, true);
    assert.equal(result.status, "PARTIAL");
  });

  it("5. pedido com item sem produto", () => {
    const o = order({
      items: [item({ productId: null, externalProductId: null, productSku: null, productCode: null })],
    });
    const result = calculateSalesMarginOrder(o, buildContext());
    assert.equal(result.hasMissingProduct, true);
    assert.equal(result.items[0]?.status, "SEM_PRODUTO_VINCULADO");
  });

  it("6. margem negativa", () => {
    const result = calculateSalesMarginItem(
      item({ netTotalValue: 100, quantity: 1, unitCost: 150 }),
      buildContext()
    );
    assert.equal(result.status, "MARGEM_NEGATIVA");
    assert.ok((result.marginAmount ?? 0) < 0);
    assert.equal(result.soldMarginPercent, -50);
  });

  it("7. receita líquida = receita bruta - imposto", () => {
    const result = calculateSalesMarginItem(item({ netTotalValue: 500, taxPercent: 20 }), buildContext());
    assert.equal(result.taxAmount, 100);
    assert.equal(result.netSalesAmount, 400);
  });

  it("8. custo total = custo unitário × quantidade", () => {
    const result = calculateSalesMarginItem(item({ quantity: 4, unitCost: 25 }), buildContext());
    assert.equal(result.totalCost, 100);
  });

  it("9. margem R$ = receita líquida - custo", () => {
    const result = calculateSalesMarginItem(
      item({ netTotalValue: 1000, unitCost: 60, quantity: 10, taxPercent: 0 }),
      buildContext({ taxMode: "none" })
    );
    assert.equal(result.marginAmount, 400);
  });

  it("10. margem % = margem R$ / receita líquida", () => {
    const result = calculateSalesMarginItem(
      item({ netTotalValue: 500, quantity: 5, unitCost: 70, taxPercent: 0 }),
      buildContext({ taxMode: "none" })
    );
    assert.equal(result.marginPercent, 30);
  });

  it("11–12. margem agregada ponderada — não média simples", () => {
    const o = order({
      items: [
        item({ salesOrderItemId: "a", netTotalValue: 1000, unitCost: 50, quantity: 10, taxPercent: 0 }),
        item({ salesOrderItemId: "b", netTotalValue: 100, unitCost: 90, quantity: 1, taxPercent: 0 }),
      ],
    });
    const engine = buildSalesMarginRulesResult([o], {
      taxMode: "none",
      taxContext: TAX_CONTEXT,
    });
    const items = o.items.map((raw) => calculateSalesOrderItemMargin({
      ...raw,
      salesOrderItemId: raw.salesOrderItemId,
    }));
    const summary = calculateSalesOrderMarginSummary(items);
    const naive = naiveAverageMarginPercent(items);
    assert.notEqual(engine.metrics.marginPercent, naive);
    assert.ok(
      Math.abs((engine.metrics.marginPercent ?? 0) - (summary.marginPercent ?? 0)) < 0.01
    );
  });

  it("13. receita zero não gera NaN", () => {
    const result = calculateSalesMarginItem(
      item({ netTotalValue: 0, netUnitPrice: 0 }),
      buildContext()
    );
    assert.equal(result.status, "RECEITA_INVALIDA");
    assert.equal(result.marginPercent, null);
    const engine = buildSalesMarginRulesResult([order({ items: [item({ netTotalValue: 0 })] })], {});
    assert.equal(engine.audit.isFinite, true);
  });

  it("14. custo zero não gera NaN", () => {
    const result = calculateSalesMarginItem(item({ unitCost: 0 }), buildContext());
    assert.equal(result.status, "CUSTO_ZERO");
    assert.equal(result.marginPercent, null);
  });

  it("15. valores null/undefined não geram NaN", () => {
    const result = calculateSalesMarginItem(
      item({ netTotalValue: undefined, netUnitPrice: null, unitCost: undefined }),
      buildContext()
    );
    assert.ok(result.marginPercent == null || Number.isFinite(result.marginPercent));
    assert.equal(result.status, "RECEITA_INVALIDA");
  });

  it("16. cancelados excluídos da consolidação", () => {
    const o = order({
      items: [
        item({ salesOrderItemId: "active", netTotalValue: 800, unitCost: 40, quantity: 8 }),
        item({ salesOrderItemId: "canceled", isCanceled: true, netTotalValue: 5000, unitCost: 10 }),
      ],
    });
    const result = calculateSalesMarginOrder(o, buildContext({ taxMode: "none" }));
    assert.equal(result.validItemsCount, 1);
    assert.equal(result.ignoredItemsCount, 1);
  });

  it("17. cortes/parciais — receita usa valor vendido do item", () => {
    const partial = item({ netTotalValue: 600, quantity: 6, unitCost: 50 });
    const result = calculateSalesMarginItem(partial, buildContext({ taxMode: "none" }));
    assert.equal(result.grossSalesAmount, 600);
    assert.equal(result.totalCost, 300);
  });

  it("18. status missingCost", () => {
    const result = calculateSalesMarginItem(item({ unitCost: null }), buildContext());
    assert.equal(result.status, "SEM_CUSTO");
  });

  it("19. status missingProduct", () => {
    const result = calculateSalesMarginItem(
      item({ productId: null, externalProductId: null, productSku: null }),
      buildContext()
    );
    assert.equal(result.status, "SEM_PRODUTO_VINCULADO");
  });

  it("20. status negativeMargin", () => {
    const result = calculateSalesMarginItem(
      item({ netTotalValue: 50, quantity: 1, unitCost: 80 }),
      buildContext({ taxMode: "none" })
    );
    assert.equal(result.status, "MARGEM_NEGATIVA");
  });

  it("21. definições explicáveis retornam fórmula", () => {
    const defs = listSalesMarginMetricDefinitions();
    assert.ok(defs.length >= 6);
    const margin = explainSalesMarginMetric("marginPercent");
    assert.ok(margin);
    assert.match(margin!.formula, /marginAmount/);
    assert.match(margin!.description, /líquida/i);
  });

  it("22. compatibilidade com salesOrderMarginMath e salesOrderResultMath", () => {
    const raw = item({ netTotalValue: 1000, unitCost: 60, quantity: 10, taxPercent: 10 });
    const mathItem = calculateSalesOrderItemMargin({
      salesOrderItemId: raw.salesOrderItemId,
      productId: raw.productId,
      quantity: raw.quantity,
      netTotalValue: raw.netTotalValue,
      unitCost: raw.unitCost,
      costSource: raw.costSource,
      costConfidence: raw.costConfidence,
    });
    const engineItem = calculateSalesMarginItem(raw, buildContext());
    assert.equal(engineItem.soldMarginAmount, mathItem.marginValue);
    assert.equal(engineItem.soldMarginPercent, mathItem.marginPercent);

    const resultItem = computeSalesOrderResultItem({
      salesOrderItemId: "item-1",
      orderId: "so-1",
      issueMonth: 6,
      productId: "prod-1",
      quantity: 10,
      marginStatus: "OK",
      salesAmount: 1000,
      costAmount: 600,
      taxPercent: 10,
    });
    assert.equal(engineItem.marginAmount, resultItem.marginAmount);
    assert.equal(engineItem.marginPercent, resultItem.marginPercent);
  });

  it("buildSalesMarginRulesResult agrega por cliente e timeline mensal", () => {
    const orders = [
      order({ id: "so-1", customerId: "c1", issueDate: new Date(2026, 0, 15) }),
      order({
        id: "so-2",
        customerId: "c1",
        issueDate: new Date(2026, 1, 10),
        items: [item({ salesOrderItemId: "i2", netTotalValue: 500, unitCost: 30, quantity: 5 })],
      }),
    ];
    const result = buildSalesMarginRulesResult(orders, {
      year: 2026,
      taxMode: "none",
      taxContext: TAX_CONTEXT,
    });
    assert.equal(result.orderResults.length, 2);
    assert.equal(result.byCustomer.get("c1")?.ordersCount, 2);
    assert.equal(result.monthlyTimeline[0]?.ordersCount, 1);
    assert.equal(result.monthlyTimeline[1]?.ordersCount, 1);
    const audit = auditSalesMarginRules(result);
    assert.equal(audit.isFinite, true);
  });

  it("invoiceBased rejeita até motor NF estar pronto", () => {
    assert.throws(
      () =>
        calculateSalesMarginItem(item(), {
          ...buildContext(),
          sourceMode: "invoiceBased",
        }),
      /invoiceBased/
    );
  });
});

function buildContext(
  overrides: Partial<ReturnType<typeof buildSalesMarginRulesResult>> & {
    taxMode?: "deductFromGross" | "none";
  } = {}
) {
  return {
    referenceDate: new Date(2026, 5, 15),
    today: new Date(2026, 5, 15),
    year: 2026,
    month: 6,
    sourceMode: "orderBased" as const,
    taxMode: overrides.taxMode ?? "deductFromGross",
    filters: {},
    taxContext: TAX_CONTEXT,
  };
}
