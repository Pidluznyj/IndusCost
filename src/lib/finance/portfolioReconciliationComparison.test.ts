import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateFactsToOrderRows,
  buildListPayload,
  buildPortfolioReconciliationSummaryCards,
  parsePortfolioReconciliationListFilters,
  type PortfolioReconciliationFactApiRow,
  type PortfolioReconciliationRunMeta,
} from "./portfolioReconciliationApi.js";
import { buildPortfolioReconciliationBusinessAnswers } from "./portfolioReconciliationBusinessAnswers.js";
import {
  buildPortfolioReconciliationComparison,
  sumUniqueNfeHeaderValue,
} from "./portfolioReconciliationComparison.js";

function fact(
  partial: Partial<PortfolioReconciliationFactApiRow> & { id: string }
): PortfolioReconciliationFactApiRow {
  return {
    runId: "run-1",
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Britânia",
    salesOrderId: "order-1",
    externalSalesOrderId: 2335,
    orderCode: "PD 02339",
    orderIssueDate: new Date(2026, 4, 1),
    expectedDeliveryDate: null,
    salesOrderItemId: null,
    externalSalesOrderItemId: null,
    externalProductId: null,
    productSkuSnapshot: null,
    productNameSnapshot: null,
    orderQuantity: null,
    orderUnitPrice: null,
    orderItemValue: null,
    nomusNfeId: null,
    nfeExternalId: null,
    nfeNumber: null,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: null,
    nfeHeaderValue: null,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentItemId: null,
    stockDocumentItemExternalId: null,
    stockDocumentDate: null,
    stockQuantity: null,
    stockUnitValue: null,
    stockItemValue: null,
    allocatedQuantity: null,
    allocatedValueByOrderPrice: null,
    allocatedValueByStockPrice: null,
    remainingOrderQuantityAfterAllocation: null,
    remainingOrderValueAfterAllocation: null,
    priceDifferenceUnit: null,
    priceDifferenceTotal: null,
    receivableIdsJson: null,
    receivableTotalValue: null,
    receivedValue: null,
    openReceivableValue: null,
    dueDatesJson: null,
    settlementDatesJson: null,
    forecastSource: "UNRESOLVED",
    forecastDate: null,
    forecastValue: null,
    confidenceLevel: "LOW",
    status: "ORDER_ONLY",
    alertsJson: [],
    traceJson: { rule: "ORDER_ONLY" },
    ...partial,
  };
}

const runMeta: PortfolioReconciliationRunMeta = {
  id: "1dc2ead7-533d-4ad4-bc4c-621061fa5623",
  status: "SUCCESS",
  mode: "apply",
  startedAt: new Date("2026-07-10T12:00:00.000Z"),
  finishedAt: new Date("2026-07-10T12:05:00.000Z"),
  fromDate: null,
  toDate: null,
  customerExternalId: 200,
  filtersJson: { customerExternalId: 200 },
  summaryJson: {
    ordersAnalyzed: 31,
    alertCount: 58,
    divergenceCount: 8,
    totalOrderValue: 3324636.5,
    totalAllocatedValue: 1449445.5,
    totalReceivableValue: 1449198,
    projectedOpenBalance: 1591373.5,
    factsGenerated: 106,
  },
  errorMessage: null,
  createdAt: new Date("2026-07-10T12:00:00.000Z"),
};

describe("portfolioReconciliationComparison", () => {
  it("Britânia/run 1dc2ead7: comparação bate com visão validada", () => {
    const orderTotals = new Map<string, number>();
    const facts: PortfolioReconciliationFactApiRow[] = [];
    // 18 com NF/CR (4 com alerta) + 13 ORDER_ONLY LOW com alerta = 31; 17 pedidos com alerta
    // ORDER_ONLY totais somam 1.380.296 (produção Britânia)
    const orderOnlyBase = Math.floor(1_380_296 / 13);
    const orderOnlyRemainder = 1_380_296 - orderOnlyBase * 12;

    for (let i = 0; i < 31; i++) {
      const id = `order-${i}`;
      const isOrderOnly = i >= 18;
      const hasAlert = isOrderOnly || i < 4;
      const orderOnlyValue = i === 18 ? orderOnlyRemainder : orderOnlyBase;
      orderTotals.set(
        id,
        isOrderOnly ? orderOnlyValue : i === 0 ? 3_324_636.5 - 30 * 50_000 : 50_000
      );
      facts.push(
        fact({
          id: `f-${i}`,
          salesOrderId: id,
          orderCode: `PD ${String(i).padStart(5, "0")}`,
          salesOrderItemId: `item-${i}`,
          orderItemValue: 500,
          allocatedQuantity: isOrderOnly ? null : 1,
          allocatedValueByOrderPrice: isOrderOnly ? null : 500,
          receivableTotalValue: isOrderOnly ? null : 500,
          receivedValue: 0,
          openReceivableValue: isOrderOnly ? null : 500,
          forecastDate: isOrderOnly ? "2026-09-10" : "2026-08-10",
          forecastValue: isOrderOnly ? orderOnlyValue : 500,
          status: isOrderOnly ? "ORDER_ONLY" : "RECEIVABLE_CONFIRMED",
          forecastSource: isOrderOnly ? "ORDER" : "RECEIVABLE",
          confidenceLevel: isOrderOnly ? "LOW" : "HIGH",
          alertsJson: hasAlert
            ? [isOrderOnly ? "Pedido sem NF vinculada" : "alerta"]
            : [],
          dueDatesJson: isOrderOnly ? null : ["2026-08-10"],
        })
      );
    }

    const filters = parsePortfolioReconciliationListFilters({
      customerExternalId: "200",
      pageSize: "50",
    });
    const payload = buildListPayload({
      run: runMeta,
      facts,
      filters,
      orderTotalBySalesOrderId: orderTotals,
    });

    assert.ok(payload.comparison);
    const c = payload.comparison!;
    assert.equal(c.reconciliationView.projectedOpenBalance, 1_591_373.5);
    assert.equal(c.reconciliationView.receivableConfirmedValue, 1_449_198);
    assert.equal(c.reconciliationView.orderOnlyReviewValue, 1_380_296);
    assert.equal(c.reconciliationView.reviewRequiredOrders, 17);
    assert.equal(c.reconciliationView.alertsCount, 58);

    assert.notEqual(c.reconciliationView.projectedOpenBalance, 4_114_297.78);
    assert.ok(c.currentView.officialNfeHeaderValue < 4_114_297.78);
    // Cabeçalho NF não vira carteira
    assert.notEqual(
      c.reconciliationView.projectedOpenBalance,
      c.currentView.officialNfeHeaderValue
    );
    assert.match(c.differences.explanation, /saldo projetado/i);
    assert.match(c.currentView.explanation, /cabeçalhos de NF/i);
  });

  it("PD 02339: breakdown explica inflação de cabeçalho sem usar 355290 como carteira", () => {
    const facts = [
      fact({
        id: "cr-jul",
        salesOrderItemId: "item-a",
        orderItemValue: 17550,
        allocatedQuantity: 3000,
        allocatedValueByOrderPrice: 17550,
        receivableTotalValue: 17550,
        receivedValue: 0,
        openReceivableValue: 17550,
        dueDatesJson: ["2026-07-10"],
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        forecastSource: "RECEIVABLE",
        forecastDate: new Date(2026, 6, 10),
        forecastValue: 17550,
        nfeExternalId: 1001,
        nfeHeaderValue: 108240,
        alertsJson: ["Soma de cabeçalhos de NF maior que o pedido"],
      }),
      fact({
        id: "cr-ago",
        salesOrderItemId: "item-b",
        orderItemValue: 140450,
        allocatedQuantity: 24000,
        allocatedValueByOrderPrice: 140450,
        receivableTotalValue: 140450,
        receivedValue: 0,
        openReceivableValue: 140450,
        dueDatesJson: ["2026-08-10"],
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        forecastSource: "RECEIVABLE",
        forecastDate: new Date(2026, 7, 10),
        forecastValue: 140450,
        nfeExternalId: 1002,
        nfeHeaderValue: 168075,
      }),
      fact({
        id: "rollup",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastDate: new Date(2026, 4, 20),
        forecastValue: 158000,
        allocatedQuantity: null,
        confidenceLevel: "MEDIUM",
        nfeExternalId: 1003,
        nfeHeaderValue: 78975,
        alertsJson: ["Soma de cabeçalhos de NF maior que o pedido"],
        traceJson: { rule: "ORDER_ROLLUP", orderTotal: 158000, headerSum: 355290 },
      }),
      fact({
        id: "over",
        status: "OVER_LINKED_BY_HEADER",
        forecastSource: "UNRESOLVED",
        forecastValue: null,
        confidenceLevel: "MEDIUM",
        alertsJson: ["Soma de cabeçalhos de NF maior que o pedido"],
        traceJson: { rule: "OVER_LINKED_BY_HEADER", orderTotal: 158000, headerSum: 355290 },
      }),
    ];

    assert.equal(sumUniqueNfeHeaderValue(facts), 355290);

    const rows = aggregateFactsToOrderRows(facts, {
      orderTotalBySalesOrderId: new Map([["order-1", 158000]]),
    });
    const summary = buildPortfolioReconciliationSummaryCards(rows, { facts });
    const businessAnswers = buildPortfolioReconciliationBusinessAnswers({
      orderRows: rows,
      facts,
      summary,
      asOfDate: "2026-07-01",
    });
    const comparison = buildPortfolioReconciliationComparison({
      orderRows: rows,
      facts,
      summary,
      businessAnswers,
      asOfDate: "2026-07-01",
    });

    const pd = comparison.orderBreakdown.find((o) => o.orderCode === "PD 02339");
    assert.ok(pd);
    assert.equal(pd!.orderValue, 158000);
    assert.equal(pd!.nfeHeaderValue, 355290);
    assert.equal(pd!.projectedOpenBalance, 158000);
    assert.ok(pd!.headerInflationRiskValue > 0);
    assert.ok(pd!.alerts.some((a) => /cabeçalho/i.test(a)));
    assert.match(
      pd!.mainExplanation,
      /Pedido de R\$\s*158\.000,00 possui NFs vinculadas com cabeçalhos somando R\$\s*355\.290,00/
    );
    assert.match(pd!.mainExplanation, /limita ao pedido/i);

    assert.equal(comparison.reconciliationView.projectedOpenBalance, 158000);
    assert.notEqual(comparison.reconciliationView.projectedOpenBalance, 355290);
    assert.equal(comparison.differences.headerInflationRiskValue, 355290 - 158000);
    assert.ok(comparison.currentView.officialNfeHeaderValue === 355290);
  });

  it("não usa forecastValue bruto nem duplica rollup+item no breakdown", () => {
    const facts = [
      fact({
        id: "item",
        salesOrderItemId: "a",
        orderItemValue: 1000,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 1000,
        receivableTotalValue: 1000,
        receivedValue: 0,
        openReceivableValue: 1000,
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-08-01",
        forecastValue: 1000,
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        orderCode: "PD X",
        salesOrderId: "ox",
      }),
      fact({
        id: "rollup",
        salesOrderId: "ox",
        orderCode: "PD X",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastValue: 999999,
        allocatedQuantity: null,
        confidenceLevel: "MEDIUM",
        traceJson: { rule: "ORDER_ROLLUP", orderTotal: 1000, headerSum: 5000 },
      }),
    ];
    const rows = aggregateFactsToOrderRows(facts, {
      orderTotalBySalesOrderId: new Map([["ox", 1000]]),
    });
    const summary = buildPortfolioReconciliationSummaryCards(rows, { facts });
    const businessAnswers = buildPortfolioReconciliationBusinessAnswers({
      orderRows: rows,
      facts,
      summary,
    });
    const comparison = buildPortfolioReconciliationComparison({
      orderRows: rows,
      facts,
      summary,
      businessAnswers,
    });
    const row = comparison.orderBreakdown[0]!;
    assert.equal(row.projectedOpenBalance, 1000);
    assert.equal(row.itemizedAllocatedValue, 1000);
    assert.notEqual(row.projectedOpenBalance, 999999);
    assert.notEqual(row.projectedOpenBalance, 5000);
  });
});
