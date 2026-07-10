import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateFactsToOrderRows,
  applyRunSummaryJsonToCards,
  buildListPayload,
  buildNoRunPayload,
  buildOrderDetailFromFacts,
  buildPortfolioReconciliationSummaryCards,
  computeOrderRateadoReceivableTotals,
  parsePortfolioReconciliationListFilters,
  parsePortfolioRunSummaryJson,
  PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE,
  sanitizeTraceJson,
  type PortfolioReconciliationFactApiRow,
  type PortfolioReconciliationRunMeta,
} from "./portfolioReconciliationApi.js";

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
  id: "run-1",
  status: "SUCCESS",
  mode: "manual",
  startedAt: new Date("2026-07-10T12:00:00.000Z"),
  finishedAt: new Date("2026-07-10T12:05:00.000Z"),
  fromDate: null,
  toDate: null,
  customerExternalId: 200,
  filtersJson: { customerExternalId: 200 },
  summaryJson: { factsGenerated: 2 },
  errorMessage: null,
  createdAt: new Date("2026-07-10T12:00:00.000Z"),
};

describe("portfolioReconciliationApi", () => {
  it("parse filtros com paginação e onlyIssues", () => {
    const filters = parsePortfolioReconciliationListFilters({
      customerExternalId: "200",
      year: "2026",
      month: "5",
      orderCode: "PD 02339",
      status: "PRICE_MISMATCH",
      confidenceLevel: "medium",
      forecastSource: "receivable",
      onlyIssues: "true",
      page: "2",
      pageSize: "25",
      runId: "abc",
    });
    assert.equal(filters.customerExternalId, 200);
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, 5);
    assert.equal(filters.orderCode, "PD 02339");
    assert.equal(filters.status, "PRICE_MISMATCH");
    assert.equal(filters.confidenceLevel, "MEDIUM");
    assert.equal(filters.forecastSource, "RECEIVABLE");
    assert.equal(filters.onlyIssues, true);
    assert.equal(filters.page, 2);
    assert.equal(filters.pageSize, 25);
    assert.equal(filters.runId, "abc");
  });

  it("agrega fatos itemizados em linha de pedido sem duplicar CR", () => {
    const facts = [
      fact({
        id: "f1",
        salesOrderItemId: "item-a",
        orderItemValue: 1000,
        allocatedQuantity: 10,
        allocatedValueByOrderPrice: 800,
        allocatedValueByStockPrice: 700,
        receivableTotalValue: 2000,
        receivedValue: 800,
        openReceivableValue: 1200,
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        forecastSource: "RECEIVABLE",
        forecastDate: new Date(2026, 5, 10),
        alertsJson: [],
      }),
      fact({
        id: "f2",
        salesOrderItemId: "item-b",
        orderItemValue: 2000,
        allocatedQuantity: 20,
        allocatedValueByOrderPrice: 1500,
        allocatedValueByStockPrice: 1400,
        receivableTotalValue: 3000,
        receivedValue: 1200,
        openReceivableValue: 1800,
        status: "PRICE_MISMATCH",
        confidenceLevel: "MEDIUM",
        forecastSource: "RECEIVABLE",
        forecastDate: new Date(2026, 5, 20),
        alertsJson: ["Diferença de preço"],
      }),
      fact({
        id: "rollup",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastValue: 3000,
        allocatedQuantity: null,
        confidenceLevel: "MEDIUM",
        alertsJson: [],
      }),
    ];

    const rows = aggregateFactsToOrderRows(facts);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.valorPedido, 3000);
    assert.equal(rows[0]!.valorAlocado, 2300);
    assert.equal(rows[0]!.valorCR, 5000);
    assert.equal(rows[0]!.recebido, 2000);
    assert.equal(rows[0]!.saldo, 3000);
    assert.equal(rows[0]!.forecastSource, "RECEIVABLE");
    assert.equal(rows[0]!.forecastDate, "2026-06-10");
    assert.notEqual(rows[0]!.forecastDate, "2026-05-20");
    assert.deepEqual(rows[0]!.forecastDates, ["2026-06-10", "2026-06-20"]);
    assert.equal(rows[0]!.forecastDueCount, 2);
    assert.match(rows[0]!.forecastLabel, /10\/06\/2026/);
    assert.match(rows[0]!.forecastLabel, /\+ 1 vencimento/);
    assert.equal(rows[0]!.confidenceLevel, "MEDIUM");
    assert.deepEqual(rows[0]!.alertas, ["Diferença de preço"]);
    assert.equal(rows[0]!.hasIssues, true);
  });

  it("PD 02339: forecast agregado usa vencimentos CR e ignora FULLY_ALLOCATED 20/05", () => {
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
        alertsJson: [],
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
        alertsJson: ["Diferença de preço"],
      }),
      fact({
        id: "rollup",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastDate: new Date(2026, 4, 20),
        forecastValue: 158000,
        allocatedQuantity: null,
        confidenceLevel: "MEDIUM",
        alertsJson: [],
        expectedDeliveryDate: new Date(2026, 4, 15),
      }),
    ];

    const rows = aggregateFactsToOrderRows(facts);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.valorPedido, 158000);
    assert.equal(rows[0]!.saldo, 158000);
    assert.equal(rows[0]!.forecastSource, "RECEIVABLE");
    assert.equal(rows[0]!.forecastDate, "2026-07-10");
    assert.notEqual(rows[0]!.forecastDate, "2026-05-20");
    assert.deepEqual(rows[0]!.forecastDates, ["2026-07-10", "2026-08-10"]);
    assert.equal(rows[0]!.forecastDueCount, 2);
    assert.equal(rows[0]!.forecastLabel, "10/07/2026 + 1 vencimento");

    const cards = buildPortfolioReconciliationSummaryCards(rows);
    assert.equal(cards.totalPedidos, 1);
    assert.equal(cards.totalValorPedidos, 158000);
    assert.notEqual(cards.totalValorPedidos, cards.totalPedidos);
  });

  it("summary cards e onlyIssues no payload de lista", () => {
    const facts = [
      fact({
        id: "ok",
        salesOrderId: "order-ok",
        orderCode: "PD OK",
        salesOrderItemId: "i1",
        orderItemValue: 100,
        allocatedValueByOrderPrice: 100,
        status: "ITEM_ALLOCATED",
        confidenceLevel: "HIGH",
        alertsJson: [],
      }),
      fact({
        id: "bad",
        salesOrderId: "order-bad",
        orderCode: "PD BAD",
        salesOrderItemId: "i2",
        orderItemValue: 200,
        allocatedValueByOrderPrice: 50,
        status: "HEADER_ONLY_LINK",
        confidenceLevel: "LOW",
        alertsJson: ["NF vinculada só por cabeçalho"],
        nfeExternalId: 1,
      }),
    ];

    const filters = parsePortfolioReconciliationListFilters({ onlyIssues: "true" });
    const payload = buildListPayload({ run: runMeta, facts, filters });
    assert.equal(payload.ok, true);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.pedido, "PD BAD");
    assert.equal(payload.summary.totalPedidos, 1);
    assert.equal(payload.summary.nfsHeaderOnly, 1);
    assert.equal(payload.summary.pedidosComAlerta, 1);
    assert.ok(payload.run);
    assert.equal(payload.run.id, "run-1");
    assert.ok(payload.availableFilters.statuses.includes("HEADER_ONLY_LINK"));
  });

  it("mensagem amigável sem run materializado", () => {
    const payload = buildNoRunPayload();
    assert.equal(payload.ok, false);
    assert.equal(payload.message, PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE);
    assert.equal(payload.rows.length, 0);
    assert.equal(payload.run, null);
  });

  it("sanitizeTraceJson omite payloads brutos", () => {
    const sanitized = sanitizeTraceJson({
      rule: "ITEM_ALLOCATED",
      rawPayload: { huge: true },
      note: "ok",
    });
    assert.equal(sanitized!.rule, "ITEM_ALLOCATED");
    assert.equal(sanitized!.rawPayload, "[omitido]");
    assert.equal(sanitized!.note, "ok");
  });

  it("detalhe do pedido monta seções sem vazar raw", () => {
    const facts = [
      fact({
        id: "f1",
        salesOrderItemId: "item-a",
        externalProductId: 456,
        productSkuSnapshot: "SKU-456",
        orderQuantity: 10,
        orderUnitPrice: 5,
        orderItemValue: 50,
        nfeExternalId: 6937,
        nfeNumber: "6845",
        nfeProcessedAt: new Date(2026, 4, 10),
        stockDocumentExternalId: 7951,
        stockDocumentDate: new Date(2026, 4, 13),
        allocatedQuantity: 10,
        allocatedValueByOrderPrice: 50,
        allocatedValueByStockPrice: 49,
        receivableIdsJson: [11, 12],
        receivableTotalValue: 50,
        receivedValue: 0,
        openReceivableValue: 50,
        dueDatesJson: ["2026-06-10"],
        status: "PRICE_MISMATCH",
        confidenceLevel: "MEDIUM",
        alertsJson: ["Diferença de preço"],
        traceJson: { rule: "PRICE_MISMATCH", raw: { secret: 1 } },
      }),
    ];

    const detail = buildOrderDetailFromFacts("order-1", facts, runMeta);
    assert.equal(detail.salesOrderId, "order-1");
    assert.equal(detail.orderItems.length, 1);
    assert.equal(detail.documentLinks.length, 1);
    assert.equal(detail.stockDocuments.length, 1);
    assert.equal(detail.allocations.length, 1);
    assert.ok(detail.receivables);
    assert.deepEqual(detail.receivables!.receivableIds, [11, 12]);
    assert.ok(detail.timeline.length >= 2);
    assert.deepEqual(detail.alertas, ["Diferença de preço"]);
    assert.equal(detail.traces[0]!.trace!.raw, "[omitido]");
    assert.ok(detail.managerNotes.length > 0);
    assert.ok(detail.technical.nfeExternalIds.includes(6937));
  });

  it("cards agregam totais confiáveis do conjunto filtrado", () => {
    const rows = aggregateFactsToOrderRows([
      fact({
        id: "a",
        salesOrderId: "o1",
        orderCode: "A",
        salesOrderItemId: "i1",
        orderItemValue: 1000,
        allocatedQuantity: 10,
        allocatedValueByOrderPrice: 900,
        allocatedValueByStockPrice: 850,
        receivableTotalValue: 1000,
        receivedValue: 400,
        openReceivableValue: 600,
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        confidenceLevel: "HIGH",
      }),
      fact({
        id: "b",
        salesOrderId: "o2",
        orderCode: "B",
        salesOrderItemId: "i2",
        orderItemValue: 500,
        allocatedQuantity: 5,
        allocatedValueByOrderPrice: 100,
        allocatedValueByStockPrice: 90,
        receivableTotalValue: 500,
        receivedValue: 0,
        openReceivableValue: 500,
        status: "PRICE_MISMATCH",
        forecastSource: "RECEIVABLE",
        confidenceLevel: "LOW",
        alertsJson: ["x"],
      }),
    ]);
    const cards = buildPortfolioReconciliationSummaryCards(rows);
    assert.equal(cards.totalPedidos, 2);
    assert.equal(cards.totalValorPedidos, 1500);
    assert.equal(cards.totalAlocadoPorPrecoPedido, 1000);
    assert.equal(cards.totalAlocadoPorPrecoDocumento, 940);
    assert.equal(cards.totalContasReceber, 1500);
    assert.equal(cards.totalRecebido, 400);
    assert.equal(cards.saldoCarteira, 1100);
    assert.equal(cards.pedidosComAlerta, 1);
    assert.ok(cards.valorComDivergencia >= 500);
    assert.ok(cards.valorSemConfianca >= 500);
  });

  it("recebido/CR não duplica rollup sintético + linhas itemizadas da mesma NF", () => {
    const facts = [
      fact({
        id: "line-1",
        nfeExternalId: 6937,
        salesOrderItemId: "item-a",
        orderItemValue: 80000,
        allocatedQuantity: 10,
        allocatedValueByOrderPrice: 80000,
        receivableTotalValue: 40000,
        receivedValue: 20000,
        openReceivableValue: 20000,
        status: "RECEIVED",
        forecastSource: "RECEIVABLE",
        confidenceLevel: "HIGH",
      }),
      fact({
        id: "line-2",
        nfeExternalId: 6937,
        salesOrderItemId: "item-b",
        orderItemValue: 78000,
        allocatedQuantity: 10,
        allocatedValueByOrderPrice: 78000,
        receivableTotalValue: 38000,
        receivedValue: 18000,
        openReceivableValue: 20000,
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        confidenceLevel: "HIGH",
      }),
      fact({
        id: "rollup",
        nfeExternalId: 6937,
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        forecastValue: 158000,
        allocatedQuantity: null,
        receivableTotalValue: 158000,
        receivedValue: 158000,
        openReceivableValue: 0,
        confidenceLevel: "MEDIUM",
        alertsJson: [],
        traceJson: { rule: "ORDER_ROLLUP" },
      }),
    ];

    const totals = computeOrderRateadoReceivableTotals(facts);
    assert.equal(totals.receivable, 78000);
    assert.equal(totals.received, 38000);
    assert.notEqual(totals.received, 158000 + 38000);

    const rows = aggregateFactsToOrderRows(facts);
    assert.equal(rows[0]!.valorCR, 78000);
    assert.equal(rows[0]!.recebido, 38000);
    assert.equal(rows[0]!.valorAlocado, 158000);
  });

  it("não usa CR bruto de NF sem alocação itemizada no total do pedido", () => {
    const facts = [
      fact({
        id: "header-cr",
        nfeExternalId: 1,
        nfeHeaderValue: 108240,
        receivableTotalValue: 108240,
        receivedValue: 50000,
        status: "DATA_QUALITY_ISSUE",
        allocatedQuantity: null,
        confidenceLevel: "BLOCKED",
        alertsJson: ["CR associado à NF sem alocação itemizada confiável ao pedido"],
      }),
      fact({
        id: "item",
        salesOrderItemId: "i1",
        orderItemValue: 158000,
        allocatedQuantity: 100,
        allocatedValueByOrderPrice: 158000,
        nfeExternalId: 2,
        receivableTotalValue: 158000,
        receivedValue: 0,
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        confidenceLevel: "HIGH",
      }),
    ];
    const rows = aggregateFactsToOrderRows(facts);
    assert.equal(rows[0]!.valorCR, 158000);
    assert.equal(rows[0]!.recebido, 0);
    assert.notEqual(rows[0]!.valorCR, 108240 + 158000);
  });

  it("Britânia/run 1dc2ead7: cards alinham ao summaryJson oficial da run", () => {
    const britaniaSummary = {
      ordersAnalyzed: 31,
      ordersOrderOnly: 13,
      alertCount: 58,
      divergenceCount: 8,
      totalOrderValue: 3324636.5,
      totalAllocatedValue: 1449445.5,
      totalReceivableValue: 1449198,
      projectedOpenBalance: 1591373.5,
      factsGenerated: 106,
    };

    const run: PortfolioReconciliationRunMeta = {
      ...runMeta,
      id: "1dc2ead7-533d-4ad4-bc4c-621061fa5623",
      summaryJson: britaniaSummary,
    };

    // Facts incompletos de propósito (simulando agregação parcial) — summaryJson manda.
    const facts = [
      fact({
        id: "partial-a",
        salesOrderId: "o1",
        orderCode: "PD A",
        salesOrderItemId: "i1",
        orderItemValue: 100000,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 100000,
        receivableTotalValue: 100000,
        receivedValue: 0,
        openReceivableValue: 100000,
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        confidenceLevel: "HIGH",
        alertsJson: ["a"],
      }),
    ];

    // 31 pedidos via orderTotals + placeholders não — usamos apply direto + buildList com 31 rows
    const orderTotals = new Map<string, number>();
    const manyFacts: PortfolioReconciliationFactApiRow[] = [];
    for (let i = 0; i < 31; i++) {
      const id = `order-${i}`;
      orderTotals.set(id, i === 0 ? 3324636.5 - 30 * 1000 : 1000);
      manyFacts.push(
        fact({
          id: `f-${i}`,
          salesOrderId: id,
          orderCode: `PD ${String(i).padStart(5, "0")}`,
          salesOrderItemId: `item-${i}`,
          orderItemValue: 500, // propositalmente baixo vs totalNetValue
          allocatedQuantity: i < 18 ? 1 : null,
          allocatedValueByOrderPrice: i < 18 ? 500 : null,
          receivableTotalValue: i < 17 ? 500 : null,
          receivedValue: 0,
          openReceivableValue: i < 17 ? 500 : null,
          status: i < 17 ? "RECEIVABLE_CONFIRMED" : "ORDER_ONLY",
          forecastSource: i < 17 ? "RECEIVABLE" : "ORDER",
          confidenceLevel: i % 3 === 0 ? "LOW" : "HIGH",
          alertsJson: i < 17 ? ["alerta"] : [],
        })
      );
    }

    const filters = parsePortfolioReconciliationListFilters({
      customerExternalId: "200",
      pageSize: "50",
    });
    const payload = buildListPayload({
      run,
      facts: manyFacts,
      filters,
      orderTotalBySalesOrderId: orderTotals,
    });

    assert.equal(payload.summary.totalPedidos, 31);
    assert.equal(payload.summary.totalValorPedidos, 3324636.5);
    assert.equal(payload.summary.totalAlocadoPorPrecoPedido, 1449445.5);
    assert.equal(payload.summary.totalContasReceber, 1449198);
    assert.equal(payload.summary.saldoCarteira, 1591373.5);
    assert.equal(payload.summary.alertasEncontrados, 58);
    assert.equal(payload.summary.divergenciasEncontradas, 8);
    assert.notEqual(payload.summary.totalValorPedidos, 2830000);
    assert.ok(payload.summary.totalValorPedidos > 3_000_000);
    assert.notEqual(payload.summary.totalContasReceber, 1_610_000);
    // Não usar soma bruta de forecastValue
    const rawForecastSum = manyFacts.reduce((s, f) => s + (f.forecastValue ?? 0), 0);
    assert.notEqual(payload.summary.saldoCarteira, rawForecastSum);

    const parsed = parsePortfolioRunSummaryJson(britaniaSummary);
    assert.equal(parsed?.totalOrderValue, 3324636.5);
    const merged = applyRunSummaryJsonToCards(
      buildPortfolioReconciliationSummaryCards(aggregateFactsToOrderRows(facts)),
      parsed,
      { orderRowCount: 1 }
    );
    // ordersAnalyzed (31) ≠ orderRowCount (1) → não aplica summaryJson
    assert.equal(merged.totalValorPedidos, 100000);
  });

  it("PD 02339: cards e forecast agregados não regredem", () => {
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
        alertsJson: ["Diferença de preço"],
      }),
      fact({
        id: "rollup",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastDate: new Date(2026, 4, 20),
        forecastValue: 158000,
        allocatedQuantity: null,
        confidenceLevel: "MEDIUM",
        alertsJson: [],
      }),
    ];

    const orderTotals = new Map([["order-1", 158000]]);
    const rows = aggregateFactsToOrderRows(facts, { orderTotalBySalesOrderId: orderTotals });
    assert.equal(rows[0]!.valorPedido, 158000);
    assert.equal(rows[0]!.valorAlocado, 158000);
    assert.equal(rows[0]!.valorCR, 158000);
    assert.equal(rows[0]!.saldo, 158000);
    assert.equal(rows[0]!.forecastSource, "RECEIVABLE");
    assert.equal(rows[0]!.forecastLabel, "10/07/2026 + 1 vencimento");
    assert.notEqual(rows[0]!.forecastDate, "2026-05-20");

    const cards = buildPortfolioReconciliationSummaryCards(rows, { facts });
    assert.equal(cards.totalValorPedidos, 158000);
    assert.equal(cards.totalAlocadoPorPrecoPedido, 158000);
    assert.equal(cards.totalContasReceber, 158000);
    assert.equal(cards.saldoCarteira, 158000);
  });
});
