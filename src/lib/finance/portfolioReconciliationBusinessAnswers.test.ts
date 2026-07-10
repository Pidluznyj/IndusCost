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
import {
  buildPortfolioReconciliationBusinessAnswers,
  buildReceiptTimingBuckets,
} from "./portfolioReconciliationBusinessAnswers.js";

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

describe("portfolioReconciliationBusinessAnswers", () => {
  it("Britânia/run 1dc2ead7: respostas batem com summaryJson oficial", () => {
    const orderTotals = new Map<string, number>();
    const facts: PortfolioReconciliationFactApiRow[] = [];
    for (let i = 0; i < 31; i++) {
      const id = `order-${i}`;
      orderTotals.set(id, i === 0 ? 3324636.5 - 30 * 1000 : 1000);
      facts.push(
        fact({
          id: `f-${i}`,
          salesOrderId: id,
          orderCode: `PD ${String(i).padStart(5, "0")}`,
          salesOrderItemId: `item-${i}`,
          orderItemValue: 500,
          allocatedQuantity: i < 18 ? 1 : null,
          allocatedValueByOrderPrice: i < 18 ? 500 : null,
          receivableTotalValue: i < 17 ? 500 : null,
          receivedValue: 0,
          openReceivableValue: i < 17 ? 500 : null,
          forecastDate: i < 17 ? "2026-08-10" : "2026-09-10",
          forecastValue: i < 17 ? 500 : 1000,
          status: i < 17 ? "RECEIVABLE_CONFIRMED" : "ORDER_ONLY",
          forecastSource: i < 17 ? "RECEIVABLE" : "ORDER",
          confidenceLevel: "HIGH",
          alertsJson: i < 17 ? ["alerta"] : [],
          dueDatesJson: i < 17 ? ["2026-08-10"] : null,
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

    assert.ok(payload.businessAnswers);
    const a = payload.businessAnswers!;
    assert.equal(a.quantoTenhoParaReceber.value, 1591373.5);
    assert.equal(a.jaVirouContasReceber.value, 1449198);
    assert.equal(a.precisaRevisar.ordersCount, 17);
    assert.equal(a.precisaRevisar.alertsCount, 58);
    assert.equal(payload.summary!.totalValorPedidos, 3324636.5);
    assert.notEqual(a.quantoTenhoParaReceber.value, 4114297.78);
    assert.notEqual(a.jaVirouContasReceber.value, 1_610_000);
    assert.match(a.quantoTenhoParaReceber.explanation, /sem duplicar/i);
  });

  it("PD 02339: tenho para receber / CR / forecast sem 20/05", () => {
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
      }),
      fact({
        id: "rollup",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastDate: new Date(2026, 4, 20),
        forecastValue: 158000,
        allocatedQuantity: null,
        confidenceLevel: "MEDIUM",
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

    const rows = aggregateFactsToOrderRows(facts, {
      orderTotalBySalesOrderId: new Map([["order-1", 158000]]),
    });
    const summary = buildPortfolioReconciliationSummaryCards(rows, { facts });
    const answers = buildPortfolioReconciliationBusinessAnswers({
      orderRows: rows,
      facts,
      summary,
      asOfDate: "2026-07-01",
    });

    assert.equal(answers.quantoTenhoParaReceber.value, 158000);
    assert.equal(answers.jaVirouContasReceber.value, 158000);
    assert.equal(rows[0]!.forecastSource, "RECEIVABLE");
    assert.equal(rows[0]!.forecastLabel, "10/07/2026 + 1 vencimento");
    assert.notEqual(rows[0]!.forecastDate, "2026-05-20");
    assert.ok(answers.precisaRevisar.ordersCount >= 1);
    assert.ok(
      answers.precisaRevisar.mainReasons.some((r) => /cabeçalho/i.test(r.reason))
    );
    assert.notEqual(answers.quantoTenhoParaReceber.value, 355290);
  });

  it("buckets de recebimento: vencido, 7d, 30d, depois, sem data", () => {
    const factsByOrder = new Map<string, PortfolioReconciliationFactApiRow[]>([
      [
        "o-overdue",
        [
          fact({
            id: "a",
            salesOrderId: "o-overdue",
            salesOrderItemId: "i1",
            allocatedQuantity: 1,
            allocatedValueByOrderPrice: 100,
            openReceivableValue: 100,
            receivableTotalValue: 100,
            forecastSource: "RECEIVABLE",
            forecastDate: "2026-06-01",
            dueDatesJson: ["2026-06-01"],
            status: "RECEIVABLE_CONFIRMED",
            confidenceLevel: "HIGH",
            forecastValue: 100,
          }),
        ],
      ],
      [
        "o-7",
        [
          fact({
            id: "b",
            salesOrderId: "o-7",
            salesOrderItemId: "i2",
            allocatedQuantity: 1,
            allocatedValueByOrderPrice: 200,
            openReceivableValue: 200,
            receivableTotalValue: 200,
            forecastSource: "RECEIVABLE",
            forecastDate: "2026-07-05",
            dueDatesJson: ["2026-07-05"],
            status: "RECEIVABLE_CONFIRMED",
            confidenceLevel: "HIGH",
            forecastValue: 200,
          }),
        ],
      ],
      [
        "o-30",
        [
          fact({
            id: "c",
            salesOrderId: "o-30",
            salesOrderItemId: "i3",
            allocatedQuantity: 1,
            allocatedValueByOrderPrice: 300,
            openReceivableValue: 300,
            receivableTotalValue: 300,
            forecastSource: "RECEIVABLE",
            forecastDate: "2026-07-20",
            dueDatesJson: ["2026-07-20"],
            status: "RECEIVABLE_CONFIRMED",
            confidenceLevel: "HIGH",
            forecastValue: 300,
          }),
        ],
      ],
      [
        "o-after",
        [
          fact({
            id: "d",
            salesOrderId: "o-after",
            salesOrderItemId: "i4",
            allocatedQuantity: 1,
            allocatedValueByOrderPrice: 400,
            openReceivableValue: 400,
            receivableTotalValue: 400,
            forecastSource: "RECEIVABLE",
            forecastDate: "2026-09-01",
            dueDatesJson: ["2026-09-01"],
            status: "RECEIVABLE_CONFIRMED",
            confidenceLevel: "HIGH",
            forecastValue: 400,
          }),
        ],
      ],
      [
        "o-nodate",
        [
          fact({
            id: "e",
            salesOrderId: "o-nodate",
            salesOrderItemId: "i5",
            orderItemValue: 500,
            forecastSource: "ORDER",
            forecastDate: null,
            forecastValue: 500,
            status: "ORDER_ONLY",
            confidenceLevel: "LOW",
          }),
        ],
      ],
    ]);

    const timing = buildReceiptTimingBuckets({
      factsByOrder,
      asOfDate: "2026-07-01",
    });

    assert.equal(timing.overdueValue, 100);
    assert.equal(timing.next7DaysValue, 200);
    assert.equal(timing.next30DaysValue, 500); // 7d + 8-30d
    assert.equal(timing.over30DaysValue, 400);
    assert.equal(timing.withoutReliableDateValue, 500);
    assert.equal(timing.nextDate, "2026-07-05");
    assert.equal(timing.nextDateValue, 200);

    // Múltiplas datas no mesmo pedido não duplicam o valor total do pedido
    const multi = new Map<string, PortfolioReconciliationFactApiRow[]>([
      [
        "pd",
        [
          fact({
            id: "m1",
            salesOrderId: "pd",
            salesOrderItemId: "a",
            allocatedQuantity: 1,
            openReceivableValue: 17550,
            receivableTotalValue: 17550,
            forecastSource: "RECEIVABLE",
            forecastDate: "2026-07-10",
            dueDatesJson: ["2026-07-10"],
            status: "RECEIVABLE_CONFIRMED",
            confidenceLevel: "HIGH",
            forecastValue: 17550,
          }),
          fact({
            id: "m2",
            salesOrderId: "pd",
            salesOrderItemId: "b",
            allocatedQuantity: 1,
            openReceivableValue: 140450,
            receivableTotalValue: 140450,
            forecastSource: "RECEIVABLE",
            forecastDate: "2026-08-10",
            dueDatesJson: ["2026-08-10"],
            status: "RECEIVABLE_CONFIRMED",
            confidenceLevel: "HIGH",
            forecastValue: 140450,
          }),
          fact({
            id: "rollup",
            salesOrderId: "pd",
            status: "FULLY_ALLOCATED",
            forecastSource: "NFE",
            forecastDate: "2026-05-20",
            forecastValue: 158000,
            allocatedQuantity: null,
            confidenceLevel: "MEDIUM",
          }),
        ],
      ],
    ]);
    const multiTiming = buildReceiptTimingBuckets({
      factsByOrder: multi,
      asOfDate: "2026-07-01",
    });
    const totalBuckets = multiTiming.buckets.reduce((s, b) => s + b.value, 0);
    assert.equal(totalBuckets, 158000);
    assert.notEqual(totalBuckets, 158000 + 158000);
  });
});
