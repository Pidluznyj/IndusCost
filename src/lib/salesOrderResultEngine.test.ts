import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sumTaxRuleComponentPercents } from "./pricingCalculations.js";
import { computeSalesTaxAmount } from "./averageSalesTaxEngine.js";
import {
  aggregateSalesOrderResultTotals,
  computeSalesOrderResultItem,
  naiveAverageResultMarginPercent,
} from "./salesOrderResultMath.js";
import {
  buildSalesOrderResultRealizedVsProjected,
  countRemainingWorkdaysInMonth,
  projectCurrentMonthSales,
} from "./salesOrderResultProjection.js";

describe("salesOrderResultMath", () => {
  it("receita líquida = valor vendido - imposto", () => {
    const item = computeSalesOrderResultItem({
      salesOrderItemId: "1",
      orderId: "o1",
      issueMonth: 6,
      productId: "p1",
      quantity: 10,
      marginStatus: "OK",
      salesAmount: 1000,
      costAmount: 400,
      taxPercent: 18,
    });
    assert.equal(item.salesAmount, 1000);
    assert.equal(item.taxAmount, 180);
    assert.equal(item.netSalesAmount, 820);
  });

  it("margem R$ = receita líquida - custo", () => {
    const item = computeSalesOrderResultItem({
      salesOrderItemId: "1",
      orderId: "o1",
      issueMonth: 6,
      productId: "p1",
      quantity: 10,
      marginStatus: "OK",
      salesAmount: 1000,
      costAmount: 400,
      taxPercent: 18,
    });
    assert.equal(item.marginAmount, 420);
  });

  it("margem % = margem R$ / receita líquida", () => {
    const item = computeSalesOrderResultItem({
      salesOrderItemId: "1",
      orderId: "o1",
      issueMonth: 6,
      productId: "p1",
      quantity: 10,
      marginStatus: "OK",
      salesAmount: 1000,
      costAmount: 400,
      taxPercent: 18,
    });
    assert.ok(Math.abs((item.marginPercent ?? 0) - 51.22) < 0.1);
  });

  it("margem agregada é ponderada por receita", () => {
    const a = computeSalesOrderResultItem({
      salesOrderItemId: "1",
      orderId: "o1",
      issueMonth: 6,
      productId: "p1",
      quantity: 1,
      marginStatus: "OK",
      salesAmount: 1000,
      costAmount: 400,
      taxPercent: 10,
    });
    const b = computeSalesOrderResultItem({
      salesOrderItemId: "2",
      orderId: "o2",
      issueMonth: 6,
      productId: "p2",
      quantity: 1,
      marginStatus: "OK",
      salesAmount: 100,
      costAmount: 90,
      taxPercent: 10,
    });
    const totals = aggregateSalesOrderResultTotals([a, b], {
      taxPercentApplied: 10,
      taxSourceLabel: "Teste",
    });
    const naive = naiveAverageResultMarginPercent([a, b]);
    assert.notEqual(totals.marginPercent, naive);
    assert.ok((totals.marginPercent ?? 0) > (naive ?? 0));
  });

  it("item sem custo gera alerta", () => {
    const item = computeSalesOrderResultItem({
      salesOrderItemId: "1",
      orderId: "o1",
      issueMonth: 6,
      productId: null,
      quantity: 1,
      marginStatus: "SEM_CUSTO",
      salesAmount: 500,
      costAmount: 0,
      taxPercent: 12,
    });
    const totals = aggregateSalesOrderResultTotals([item], {
      taxPercentApplied: 12,
      taxSourceLabel: "Teste",
    });
    assert.equal(totals.missingCostCount, 1);
  });

  it("mês sem vendas retorna zero seguro", () => {
    const totals = aggregateSalesOrderResultTotals([], {
      taxPercentApplied: 0,
      taxSourceLabel: "Teste",
    });
    assert.equal(totals.salesAmount, 0);
    assert.equal(totals.marginPercent, null);
    assert.ok(Number.isFinite(totals.ordersCount));
  });
});

describe("salesOrderResultProjection", () => {
  const ref = new Date(2026, 5, 15, 12, 0, 0, 0);

  it("projeção do mês = média diária × dias úteis totais", () => {
    const realized = 500_000;
    const projected = projectCurrentMonthSales(realized, ref);
    const elapsed = ref.getDate() <= 15 ? 11 : 0;
    assert.ok(projected != null);
    if (elapsed > 0) {
      const daily = realized / elapsed;
      const totalDays = countRemainingWorkdaysInMonth(ref) + elapsed;
      assert.ok(Math.abs((projected ?? 0) - daily * totalDays) < 1);
    }
  });

  it("dias úteis restantes do mês", () => {
    const remaining = countRemainingWorkdaysInMonth(ref);
    assert.ok(remaining >= 0);
  });

  it("meses passados usam realizado; futuros usam projeção", () => {
    const { rows } = buildSalesOrderResultRealizedVsProjected({
      monthlySales: [{ month: 6, amount: 800_000 }],
      year: 2026,
      referenceDate: ref,
    });
    const june = rows.find((r) => r.month === 6)!;
    const july = rows.find((r) => r.month === 7)!;
    assert.equal(june.realizedAmount, 800_000);
    assert.ok(june.projectedAmount != null);
    assert.equal(july.realizedAmount, 0);
    assert.ok(july.isFuture);
  });

  it("imposto usa soma TaxComponent", () => {
    const pct = sumTaxRuleComponentPercents([{ percentage: 12 }, { percentage: 6 }]);
    assert.equal(pct, 18);
    assert.equal(computeSalesTaxAmount(1000, pct), 180);
  });
});
