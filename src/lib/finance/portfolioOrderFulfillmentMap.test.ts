import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPortfolioReconciliationFacts } from "./portfolioReconciliationAllocationEngine.js";
import type { PortfolioReconciliationSnapshot } from "./portfolioReconciliationAllocationEngine.js";
import type { SnapshotOrder } from "./portfolioReconciliationAllocationEngine.js";
import {
  buildPortfolioOrderFulfillmentMap,
  resolveFinancialStatus,
  resolveOperationalStatus,
} from "./portfolioOrderFulfillmentMap.js";
import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";

function pd02339Snapshot(): PortfolioReconciliationSnapshot {
  const order: SnapshotOrder = {
    id: "3915fa28-1947-4388-bb27-2699c3cbb516",
    externalSalesOrderId: 2335,
    orderCode: "PD 02339",
    issueDate: new Date(2026, 4, 1),
    customerNameSnapshot: "Britania",
    totalNetValue: 158000,
    items: [
      {
        id: "item-456",
        externalProductId: 456,
        quantity: 3000,
        unitPrice: 5.85,
        productSkuSnapshot: "456",
      },
      {
        id: "item-452",
        externalProductId: 452,
        quantity: 9000,
        unitPrice: 5.85,
        productSkuSnapshot: "452",
      },
      {
        id: "item-537",
        externalProductId: 537,
        quantity: 5000,
        unitPrice: 5.86,
        productSkuSnapshot: "537",
      },
      {
        id: "item-455",
        externalProductId: 455,
        quantity: 10000,
        unitPrice: 5.85,
        productSkuSnapshot: "455",
      },
    ],
  };

  return {
    orders: [order],
    nfeLinks: [
      {
        salesOrderId: order.id,
        nfeExternalId: 6937,
        nfeNumber: "6845",
        dataProcessamento: new Date(2026, 4, 13, 8, 10, 33),
      },
      {
        salesOrderId: order.id,
        nfeExternalId: 7188,
        nfeNumber: "7052",
        dataProcessamento: new Date(2026, 5, 8, 14, 58, 10),
      },
      {
        salesOrderId: order.id,
        nfeExternalId: 7377,
        nfeNumber: "7195",
        dataProcessamento: new Date(2026, 5, 26, 15, 6, 10),
      },
    ],
    nfes: [
      { id: "nfe-6937", externalId: 6937, numero: "6845", valorLiquido: 108240 },
      { id: "nfe-7188", externalId: 7188, numero: "7052", valorLiquido: 168075 },
      { id: "nfe-7377", externalId: 7377, numero: "7195", valorLiquido: 78975 },
    ],
    stockDocuments: [
      {
        id: "doc-7951",
        externalId: 7951,
        idNfe: 6937,
        dataDocumento: new Date(2026, 4, 13, 8, 10, 33),
        items: [
          { id: "si-456", externalProductId: 456, quantity: 3000, unitValue: 4.92 },
          { id: "si-452", externalProductId: 452, quantity: 9000, unitValue: 4.92 },
          { id: "si-455", externalProductId: 455, quantity: 10000, unitValue: 4.92 },
        ],
      },
      {
        id: "doc-8175",
        externalId: 8175,
        idNfe: 7188,
        dataDocumento: new Date(2026, 5, 8, 14, 58, 10),
        items: [
          { id: "si-537", externalProductId: 537, quantity: 10000, unitValue: 5.86 },
          { id: "si-452b", externalProductId: 452, quantity: 4500, unitValue: 5.85 },
          { id: "si-538", externalProductId: 538, quantity: 6200, unitValue: 5.85 },
          { id: "si-453", externalProductId: 453, quantity: 8000, unitValue: 5.86 },
        ],
      },
      {
        id: "doc-8422",
        externalId: 8422,
        idNfe: 7377,
        dataDocumento: new Date(2026, 5, 26, 15, 6, 10),
        items: [
          { id: "si-452c", externalProductId: 452, quantity: 3500, unitValue: 5.85 },
          { id: "si-455b", externalProductId: 455, quantity: 10000, unitValue: 5.85 },
        ],
      },
    ],
  };
}

function factsToApiRows(
  drafts: ReturnType<typeof buildPortfolioReconciliationFacts>["facts"]
): PortfolioReconciliationFactApiRow[] {
  return drafts.map((d, i) => ({
    id: `f-${i}`,
    runId: d.runId,
    customerId: null,
    customerExternalId: null,
    customerNameSnapshot: d.customerNameSnapshot,
    salesOrderId: d.salesOrderId,
    externalSalesOrderId: d.externalSalesOrderId,
    orderCode: d.orderCode,
    orderIssueDate: d.orderIssueDate,
    expectedDeliveryDate: null,
    salesOrderItemId: d.salesOrderItemId,
    externalSalesOrderItemId: null,
    externalProductId: d.externalProductId,
    productSkuSnapshot: d.productSkuSnapshot,
    productNameSnapshot: d.productNameSnapshot,
    orderQuantity: d.orderQuantity,
    orderUnitPrice: d.orderUnitPrice,
    orderItemValue: d.orderItemValue,
    nomusNfeId: d.nomusNfeId,
    nfeExternalId: d.nfeExternalId,
    nfeNumber: d.nfeNumber,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: d.nfeProcessedAt,
    nfeHeaderValue: d.nfeHeaderValue,
    stockDocumentId: d.stockDocumentId,
    stockDocumentExternalId: d.stockDocumentExternalId,
    stockDocumentItemId: d.stockDocumentItemId,
    stockDocumentItemExternalId: null,
    stockDocumentDate: d.stockDocumentDate,
    stockQuantity: d.stockQuantity,
    stockUnitValue: d.stockUnitValue,
    stockItemValue: d.stockItemValue,
    allocatedQuantity: d.allocatedQuantity,
    allocatedValueByOrderPrice: d.allocatedValueByOrderPrice,
    allocatedValueByStockPrice: d.allocatedValueByStockPrice,
    remainingOrderQuantityAfterAllocation: d.remainingOrderQuantityAfterAllocation,
    remainingOrderValueAfterAllocation: d.remainingOrderValueAfterAllocation,
    priceDifferenceUnit: d.priceDifferenceUnit,
    priceDifferenceTotal: d.priceDifferenceTotal,
    receivableIdsJson: d.receivableIdsJson ?? null,
    receivableTotalValue: d.receivableTotalValue ?? null,
    receivedValue: d.receivedValue ?? null,
    openReceivableValue: d.openReceivableValue ?? null,
    dueDatesJson: d.dueDatesJson ?? null,
    settlementDatesJson: d.settlementDatesJson ?? null,
    forecastSource: d.forecastSource ?? "UNRESOLVED",
    forecastDate: d.forecastDate ?? null,
    forecastValue: d.forecastValue ?? null,
    confidenceLevel: d.confidenceLevel,
    status: d.status,
    alertsJson: d.alertsJson,
    traceJson: d.traceJson,
  }));
}

describe("portfolioOrderFulfillmentMap", () => {
  it("PD 02339: cabeçalho NF não é valor do pedido; itens e docs aparecem", () => {
    const built = buildPortfolioReconciliationFacts({
      runId: "run-pd",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const facts = factsToApiRows(built.facts);
    const map = buildPortfolioOrderFulfillmentMap({
      facts,
      orderValue: 158000,
      paymentTermsAvailable: false,
    });

    assert.equal(map.fulfillmentSummary.orderValue, 158000);
    assert.ok(map.fulfillmentSummary.nfeHeaderTotal > 158000);
    assert.ok(map.fulfillmentSummary.hasHeaderInflationRisk);
    assert.ok(
      map.fulfillmentSummary.nfeHeaderTotal !== map.fulfillmentSummary.orderValue
    );
    assert.ok(map.orderItemsCoverage.length >= 4);
    for (const item of map.orderItemsCoverage) {
      assert.ok(item.orderedQuantity > 0);
      assert.ok(typeof item.attendedQuantity === "number");
      assert.ok(typeof item.remainingQuantity === "number");
    }
    assert.ok(map.stockDocumentsCoverage.length >= 1);
    assert.ok(map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.ok(
      map.technicalAlerts.includes("DIVERGENCIA_PRECO") ||
        map.stockDocumentsCoverage.some((d) => d.alerts.includes("DIVERGENCIA_PRECO"))
    );
    assert.ok(
      map.technicalAlerts.includes("PRODUTO_FORA_DO_PEDIDO") ||
        map.technicalAlerts.includes("QUANTIDADE_EXCEDENTE_DOCUMENTO")
    );
    assert.equal(map.operationalStatus, "OP_TOTALMENTE_ATENDIDO");
    assert.equal(map.financialStatus, "FIN_FATURADO_SEM_CR");
    assert.match(map.executiveConclusion, /cabeçalho|não é o valor/i);
  });

  it("atendimento parcial → OP_PARCIALMENTE_ATENDIDO", () => {
    const facts: PortfolioReconciliationFactApiRow[] = [
      {
        id: "1",
        runId: "r",
        customerId: null,
        customerExternalId: 1,
        customerNameSnapshot: "X",
        salesOrderId: "o1",
        externalSalesOrderId: 1,
        orderCode: "PD T",
        orderIssueDate: "2026-01-01",
        expectedDeliveryDate: null,
        salesOrderItemId: "i1",
        externalSalesOrderItemId: null,
        externalProductId: 10,
        productSkuSnapshot: "10",
        productNameSnapshot: "P",
        orderQuantity: 100,
        orderUnitPrice: 10,
        orderItemValue: 1000,
        nomusNfeId: null,
        nfeExternalId: 1,
        nfeNumber: "1",
        nfeSerie: null,
        nfeKey: null,
        nfeProcessedAt: null,
        nfeHeaderValue: 500,
        stockDocumentId: "s",
        stockDocumentExternalId: 1,
        stockDocumentItemId: "si",
        stockDocumentItemExternalId: null,
        stockDocumentDate: "2026-02-01",
        stockQuantity: 40,
        stockUnitValue: 10,
        stockItemValue: 400,
        allocatedQuantity: 40,
        allocatedValueByOrderPrice: 400,
        allocatedValueByStockPrice: 400,
        remainingOrderQuantityAfterAllocation: 60,
        remainingOrderValueAfterAllocation: 600,
        priceDifferenceUnit: null,
        priceDifferenceTotal: null,
        receivableIdsJson: null,
        receivableTotalValue: null,
        receivedValue: null,
        openReceivableValue: null,
        dueDatesJson: null,
        settlementDatesJson: null,
        forecastSource: "NFE",
        forecastDate: null,
        forecastValue: null,
        confidenceLevel: "MEDIUM",
        status: "ITEM_ALLOCATED",
        alertsJson: null,
        traceJson: null,
      },
    ];
    const map = buildPortfolioOrderFulfillmentMap({
      facts,
      orderValue: 1000,
      paymentTermsAvailable: true,
    });
    assert.equal(map.operationalStatus, "OP_PARCIALMENTE_ATENDIDO");
    assert.equal(map.orderItemsCoverage[0]!.attendedQuantity, 40);
    assert.equal(map.orderItemsCoverage[0]!.remainingQuantity, 60);
  });

  it("status financeiro e alertas são eixos separados", () => {
    assert.equal(
      resolveFinancialStatus({
        receivedValue: 0,
        openReceivableValue: 500,
        receivableTotalValue: 500,
        hasNfe: true,
        hasStockDocument: true,
        hasAllocation: true,
      }),
      "FIN_CR_ABERTO"
    );
    assert.equal(
      resolveOperationalStatus({
        hasNfe: true,
        hasStockDocument: false,
        hasItemAllocation: false,
        headerOnlyLink: true,
        totalOrderQuantity: 10,
        attendedQuantity: 0,
        remainingQuantity: 10,
      }),
      "OP_VINCULO_APENAS_CABECALHO"
    );
  });

  it("pedido sem NF/doc/CR → FIN_SEM_CR + OP_NAO_ATENDIDO", () => {
    const facts: PortfolioReconciliationFactApiRow[] = [
      {
        id: "1",
        runId: "r",
        customerId: null,
        customerExternalId: 1,
        customerNameSnapshot: "X",
        salesOrderId: "old",
        externalSalesOrderId: 2,
        orderCode: "PD OLD",
        orderIssueDate: "2025-01-01",
        expectedDeliveryDate: null,
        salesOrderItemId: "i1",
        externalSalesOrderItemId: null,
        externalProductId: 1,
        productSkuSnapshot: "1",
        productNameSnapshot: "A",
        orderQuantity: 10,
        orderUnitPrice: 100,
        orderItemValue: 1000,
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
        forecastSource: "ORDER",
        forecastDate: "2025-02-01",
        forecastValue: 1000,
        confidenceLevel: "LOW",
        status: "ORDER_ONLY",
        alertsJson: null,
        traceJson: null,
      },
    ];
    const map = buildPortfolioOrderFulfillmentMap({
      facts,
      orderValue: 1000,
      paymentTermsAvailable: true,
    });
    assert.equal(map.financialStatus, "FIN_SEM_CR");
    assert.equal(map.operationalStatus, "OP_NAO_ATENDIDO");
  });
});
