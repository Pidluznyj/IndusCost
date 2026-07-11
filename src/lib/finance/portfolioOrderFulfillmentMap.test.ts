import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderFulfillmentMap,
  classifyFinancialStatus,
  classifyOperationalStatus,
} from "./portfolioOrderFulfillmentMap.js";
import type { BuildOrderFulfillmentMapInput } from "./portfolioOrderFulfillmentMap.js";
import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";

function baseFact(
  partial: Partial<PortfolioReconciliationFactApiRow>
): PortfolioReconciliationFactApiRow {
  return {
    id: partial.id ?? "f1",
    runId: partial.runId ?? "run",
    customerId: null,
    customerExternalId: null,
    customerNameSnapshot: null,
    salesOrderId: partial.salesOrderId ?? "order-1",
    externalSalesOrderId: null,
    orderCode: partial.orderCode ?? "PD T",
    orderIssueDate: null,
    expectedDeliveryDate: null,
    salesOrderItemId: partial.salesOrderItemId ?? null,
    externalSalesOrderItemId: null,
    externalProductId: partial.externalProductId ?? null,
    productSkuSnapshot: partial.productSkuSnapshot ?? null,
    productNameSnapshot: null,
    orderQuantity: partial.orderQuantity ?? null,
    orderUnitPrice: partial.orderUnitPrice ?? null,
    orderItemValue: partial.orderItemValue ?? null,
    nomusNfeId: null,
    nfeExternalId: partial.nfeExternalId ?? null,
    nfeNumber: partial.nfeNumber ?? null,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: null,
    nfeHeaderValue: partial.nfeHeaderValue ?? null,
    stockDocumentId: partial.stockDocumentId ?? null,
    stockDocumentExternalId: partial.stockDocumentExternalId ?? null,
    stockDocumentItemId: null,
    stockDocumentItemExternalId: null,
    stockDocumentDate: null,
    stockQuantity: partial.stockQuantity ?? null,
    stockUnitValue: partial.stockUnitValue ?? null,
    stockItemValue: partial.stockItemValue ?? null,
    allocatedQuantity: partial.allocatedQuantity ?? null,
    allocatedValueByOrderPrice: partial.allocatedValueByOrderPrice ?? null,
    allocatedValueByStockPrice: null,
    remainingOrderQuantityAfterAllocation:
      partial.remainingOrderQuantityAfterAllocation ?? null,
    remainingOrderValueAfterAllocation: null,
    priceDifferenceUnit: partial.priceDifferenceUnit ?? null,
    priceDifferenceTotal: null,
    receivableIdsJson: partial.receivableIdsJson ?? null,
    receivableTotalValue: partial.receivableTotalValue ?? null,
    receivedValue: partial.receivedValue ?? null,
    openReceivableValue: partial.openReceivableValue ?? null,
    dueDatesJson: null,
    settlementDatesJson: null,
    forecastSource: "ORDER",
    forecastDate: null,
    forecastValue: null,
    confidenceLevel: "MEDIUM",
    status: partial.status ?? "ORDER_ONLY",
    alertsJson: partial.alertsJson ?? [],
    traceJson: partial.traceJson ?? {},
    ...partial,
  };
}

function pd02339Input(): BuildOrderFulfillmentMapInput {
  const orderId = "3915fa28-1947-4388-bb27-2699c3cbb516";
  return {
    order: {
      id: orderId,
      orderCode: "PD 02339",
      totalNetValue: 158_000,
      externalSalesOrderId: 2335,
    },
    orderItems: [
      { id: "item-456", externalProductId: 456, quantity: 3000, unitPrice: 5.85, productSkuSnapshot: "456" },
      { id: "item-452", externalProductId: 452, quantity: 9000, unitPrice: 5.85, productSkuSnapshot: "452" },
      { id: "item-537", externalProductId: 537, quantity: 5000, unitPrice: 5.86, productSkuSnapshot: "537" },
      { id: "item-455", externalProductId: 455, quantity: 10000, unitPrice: 5.85, productSkuSnapshot: "455" },
    ],
    nfeLinks: [
      { salesOrderId: orderId, nfeExternalId: 6937, nfeNumber: "6845" },
      { salesOrderId: orderId, nfeExternalId: 7188, nfeNumber: "7052" },
      { salesOrderId: orderId, nfeExternalId: 7377, nfeNumber: "7195" },
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
        items: [
          { id: "si-452c", externalProductId: 452, quantity: 3500, unitValue: 5.85 },
          { id: "si-455b", externalProductId: 455, quantity: 10000, unitValue: 5.85 },
        ],
      },
    ],
    paymentTermsAvailable: false,
    receivables: [
      {
        receivableId: 9001,
        dueDate: "2025-06-15",
        totalValue: 158_000,
        receivedValue: 0,
        openValue: 158_000,
        sourceNfe: 6937,
      },
    ],
  };
}

describe("portfolioOrderFulfillmentMap", () => {
  it("1) um item atendido em um documento", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 1", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1, nfeNumber: "100" }],
      nfes: [{ externalId: 1, numero: "100", valorLiquido: 1000 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 501,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 100, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.orderItemsCoverage.length, 1);
    assert.equal(map.orderItemsCoverage[0]!.attendedQuantityCapped, 100);
    assert.equal(map.orderItemsCoverage[0]!.remainingQuantity, 0);
    assert.equal(map.orderItemsCoverage[0]!.documentsUsed.length, 1);
    assert.equal(map.operationalStatus, "OP_TOTALMENTE_ATENDIDO");
    assert.equal(map.fulfillmentSummary.totalExcessQuantity, 0);
  });

  it("2) um item atendido em dois documentos", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 2", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [
        { salesOrderId: "o1", nfeExternalId: 1, nfeNumber: "1" },
        { salesOrderId: "o1", nfeExternalId: 2, nfeNumber: "2" },
      ],
      nfes: [
        { externalId: 1, valorLiquido: 600 },
        { externalId: 2, valorLiquido: 400 },
      ],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 60, unitValue: 10 }],
        },
        {
          id: "d2",
          externalId: 2,
          idNfe: 2,
          items: [{ id: "s2", externalProductId: 10, quantity: 40, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    const item = map.orderItemsCoverage[0]!;
    assert.equal(item.attendedQuantityCapped, 100);
    assert.equal(item.remainingQuantity, 0);
    assert.equal(item.documentsUsed.length, 2);
    assert.equal(map.operationalStatus, "OP_TOTALMENTE_ATENDIDO");
  });

  it("3) parcialmente atendido em múltiplos documentos", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 3", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [
        { salesOrderId: "o1", nfeExternalId: 1 },
        { salesOrderId: "o1", nfeExternalId: 2 },
      ],
      nfes: [
        { externalId: 1, valorLiquido: 300 },
        { externalId: 2, valorLiquido: 200 },
      ],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 30, unitValue: 10 }],
        },
        {
          id: "d2",
          externalId: 2,
          idNfe: 2,
          items: [{ id: "s2", externalProductId: 10, quantity: 20, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.orderItemsCoverage[0]!.attendedQuantityCapped, 50);
    assert.equal(map.orderItemsCoverage[0]!.remainingQuantity, 50);
    assert.equal(map.operationalStatus, "OP_PARCIALMENTE_ATENDIDO");
    assert.ok((map.fulfillmentSummary.fulfillmentPercent ?? 0) <= 100);
  });

  it("4) excedente: pedido 100, docs 60+50 => atendido 100, excedente 10", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 4", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [
        { salesOrderId: "o1", nfeExternalId: 1 },
        { salesOrderId: "o1", nfeExternalId: 2 },
      ],
      nfes: [
        { externalId: 1, valorLiquido: 600 },
        { externalId: 2, valorLiquido: 500 },
      ],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 60, unitValue: 10 }],
        },
        {
          id: "d2",
          externalId: 2,
          idNfe: 2,
          items: [{ id: "s2", externalProductId: 10, quantity: 50, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.orderItemsCoverage[0]!.attendedQuantityCapped, 100);
    assert.equal(map.orderItemsCoverage[0]!.remainingQuantity, 0);
    assert.equal(map.fulfillmentSummary.totalExcessQuantity, 10);
    assert.equal(map.orderItemsCoverage[0]!.excessQuantityForThisProduct, 10);
    assert.equal(map.operationalStatus, "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE");
    assert.ok(map.technicalAlerts.includes("QUANTIDADE_EXCEDENTE_DOCUMENTO"));
    assert.equal(map.fulfillmentSummary.fulfillmentPercent, 100);
  });

  it("5) documento com produto fora do pedido", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 5", totalNetValue: 500 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 50, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1 }],
      nfes: [{ externalId: 1, valorLiquido: 800 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [
            { id: "s1", externalProductId: 10, quantity: 50, unitValue: 10 },
            { id: "s2", externalProductId: 99, quantity: 20, unitValue: 10 },
          ],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.ok(map.fulfillmentSummary.hasProductsOutsideOrder);
    assert.ok(map.technicalAlerts.includes("PRODUTO_FORA_DO_PEDIDO"));
    const outside = map.stockDocumentsCoverage.flatMap((d) => d.itemsOutsideOrder);
    assert.ok(outside.some((x) => (x.externalProductId ?? x.productExternalId) === 99));
    assert.ok(
      outside.some(
        (x) =>
          (x.externalProductId ?? x.productExternalId) === 99 &&
          (x.documentQuantity ?? x.stockQuantity) === 20
      )
    );
    assert.equal(map.orderItemsCoverage[0]!.attendedQuantityCapped, 50);
    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice <=
        map.fulfillmentSummary.orderValue + 0.05
    );
  });

  it("6) cabeçalho NF maior que valor atribuído ao pedido", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 6", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1 }],
      nfes: [{ externalId: 1, valorLiquido: 5000 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 100, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.ok(map.fulfillmentSummary.hasHeaderInflationRisk);
    assert.ok(
      map.fulfillmentSummary.nfeHeaderTotalValue >
        map.fulfillmentSummary.attributedOrderValueByOrderPrice
    );
    assert.ok(map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.equal(map.fulfillmentSummary.orderValue, 1000);
    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice <= 1000 + 0.05
    );
  });

  it("7) divergência de preço", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 7", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1 }],
      nfes: [{ externalId: 1, valorLiquido: 800 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 100, unitValue: 8 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.ok(map.technicalAlerts.includes("DIVERGENCIA_PRECO"));
    assert.equal(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice,
      1000
    );
  });

  it("8) sem NF/doc/CR => OP_NAO_ATENDIDO e FIN_SEM_CR", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 8", totalNetValue: 320070 },
      orderItems: [
        { id: "i1", externalProductId: 1, quantity: 10, unitPrice: 32007 },
      ],
      nfeLinks: [],
      nfes: [],
      stockDocuments: [],
      paymentTermsAvailable: false,
    });

    assert.equal(map.financialStatus, "FIN_SEM_CR");
    assert.equal(map.operationalStatus, "OP_NAO_ATENDIDO");
    assert.equal(map.fulfillmentSummary.totalAttendedQuantityCapped, 0);
  });

  it("9) CR aberto + atendimento parcial: eixos separados", () => {
    const map = buildOrderFulfillmentMap({
      reconciliationFacts: [
        baseFact({
          id: "a",
          salesOrderItemId: "i1",
          externalProductId: 10,
          orderQuantity: 100,
          orderUnitPrice: 10,
          orderItemValue: 1000,
          allocatedQuantity: 40,
          remainingOrderQuantityAfterAllocation: 60,
          nfeExternalId: 1,
          nfeNumber: "1",
          nfeHeaderValue: 400,
          stockDocumentExternalId: 9,
          stockQuantity: 40,
          stockUnitValue: 10,
          stockItemValue: 400,
          status: "ITEM_ALLOCATED",
          receivableTotalValue: 1000,
          receivedValue: 200,
          openReceivableValue: 800,
          receivableIdsJson: [55],
        }),
      ],
      orderValue: 1000,
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.financialStatus, "FIN_CR_ABERTO");
    assert.equal(map.operationalStatus, "OP_PARCIALMENTE_ATENDIDO");
    assert.ok(map.technicalAlerts.includes("ITEM_DO_PEDIDO_NAO_ATENDIDO"));
  });

  it("10) recebido + alerta técnico: FIN_RECEBIDO preservado", () => {
    const map = buildOrderFulfillmentMap({
      reconciliationFacts: [
        baseFact({
          id: "a",
          salesOrderItemId: "i1",
          externalProductId: 10,
          orderQuantity: 100,
          orderUnitPrice: 10,
          orderItemValue: 1000,
          allocatedQuantity: 100,
          nfeExternalId: 1,
          nfeHeaderValue: 5000,
          stockDocumentExternalId: 9,
          stockQuantity: 100,
          stockUnitValue: 8,
          stockItemValue: 800,
          status: "PRICE_MISMATCH",
          priceDifferenceUnit: -2,
          receivableTotalValue: 1000,
          receivedValue: 1000,
          openReceivableValue: 0,
          receivableIdsJson: [1],
        }),
        baseFact({
          id: "b",
          status: "OVER_LINKED_BY_HEADER",
          nfeExternalId: 1,
          nfeHeaderValue: 5000,
          allocatedQuantity: 0,
          alertsJson: ["OVER_LINKED_BY_HEADER"],
        }),
      ],
      orderValue: 1000,
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.financialStatus, "FIN_RECEBIDO");
    assert.ok(map.technicalAlerts.includes("DIVERGENCIA_PRECO"));
    assert.ok(map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.notEqual(map.financialStatus, "FIN_FATURADO_SEM_CR");
  });

  it("fixture PD 02339: cabeçalho não infla; CR vinculado; excesso e fora do pedido", () => {
    const map = buildOrderFulfillmentMap(pd02339Input());

    assert.equal(map.fulfillmentSummary.orderValue, 158_000);
    assert.ok(map.fulfillmentSummary.nfeHeaderTotalValue > 158_000);
    assert.ok(map.fulfillmentSummary.hasHeaderInflationRisk);
    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice <= 158_000 + 0.05
    );
    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice !==
        map.fulfillmentSummary.nfeHeaderTotalValue
    );
    assert.ok(map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.ok(map.technicalAlerts.includes("DIVERGENCIA_PRECO"));
    assert.ok(map.fulfillmentSummary.hasProductsOutsideOrder);
    assert.ok(map.fulfillmentSummary.hasExcessQuantity);
    assert.ok(map.orderItemsCoverage.length >= 4);
    assert.ok(map.stockDocumentsCoverage.length >= 3);
    assert.equal(map.operationalStatus, "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE");
    assert.equal(map.financialStatus, "FIN_CR_ABERTO");
    assert.equal(map.financialStatusLabel, "CR aberto");
    assert.ok(map.operationalStatusLabel.length > 0);
    assert.equal(map.receivablesCoverage.length, 1);
    assert.equal(map.receivablesCoverage[0]!.receivableId, 9001);
    assert.equal(map.fulfillmentSummary.openReceivableValue, 158_000);
    assert.match(map.executiveConclusion, /não deve ser tratado como caixa|CR aberto|Contas a Receber/i);

    for (const item of map.orderItemsCoverage) {
      assert.ok(item.attendedQuantityCapped <= item.orderedQuantity + 0.000001);
      assert.ok((item.fulfillmentPercentCapped ?? 0) <= 100);
      assert.equal(item.sku, item.productCode);
    }

    const matched = map.stockDocumentsCoverage.flatMap((d) => d.matchedItems);
    assert.ok(matched.length > 0);
    assert.ok(matched.every((m) => m.quantityUsedForOrder === m.allocatedQuantity));
    assert.ok(
      matched.every(
        (m) =>
          m.valueAttributedByOrderPrice === m.allocatedValueByOrderPrice &&
          (m.externalProductId ?? m.productExternalId) != null
      )
    );
  });

  it("11) percentual nunca passa de 100%", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 11", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1 }],
      nfes: [{ externalId: 1, valorLiquido: 2000 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 250, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.fulfillmentSummary.fulfillmentPercent, 100);
    assert.ok((map.orderItemsCoverage[0]!.fulfillmentPercentCapped ?? 0) <= 100);
    assert.equal(map.orderItemsCoverage[0]!.attendedQuantityCapped, 100);
  });

  it("12) valor atribuído nunca passa do valor do pedido", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 12", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1 }],
      nfes: [{ externalId: 1, valorLiquido: 9000 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 100, unitValue: 90 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice <=
        map.fulfillmentSummary.orderValue + 0.05
    );
    assert.equal(map.fulfillmentSummary.attributedOrderValueByOrderPrice, 1000);
  });

  it("13) excedente não aumenta carteira (orderValue / atribuído)", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 13", totalNetValue: 1000 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 100, unitPrice: 10 },
      ],
      nfeLinks: [
        { salesOrderId: "o1", nfeExternalId: 1 },
        { salesOrderId: "o1", nfeExternalId: 2 },
      ],
      nfes: [
        { externalId: 1, valorLiquido: 600 },
        { externalId: 2, valorLiquido: 500 },
      ],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [{ id: "s1", externalProductId: 10, quantity: 60, unitValue: 10 }],
        },
        {
          id: "d2",
          externalId: 2,
          idNfe: 2,
          items: [{ id: "s2", externalProductId: 10, quantity: 50, unitValue: 10 }],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.fulfillmentSummary.orderValue, 1000);
    assert.equal(map.fulfillmentSummary.attributedOrderValueByOrderPrice, 1000);
    assert.equal(map.fulfillmentSummary.totalExcessQuantity, 10);
    assert.ok(map.fulfillmentSummary.totalExcessQuantity > 0);
  });

  it("14) produto fora do pedido não aumenta carteira", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD 14", totalNetValue: 500 },
      orderItems: [
        { id: "i1", externalProductId: 10, quantity: 50, unitPrice: 10 },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 1 }],
      nfes: [{ externalId: 1, valorLiquido: 1500 }],
      stockDocuments: [
        {
          id: "d1",
          externalId: 1,
          idNfe: 1,
          items: [
            { id: "s1", externalProductId: 10, quantity: 50, unitValue: 10 },
            { id: "s2", externalProductId: 99, quantity: 100, unitValue: 10 },
          ],
        },
      ],
      paymentTermsAvailable: true,
    });

    assert.equal(map.fulfillmentSummary.orderValue, 500);
    assert.equal(map.fulfillmentSummary.attributedOrderValueByOrderPrice, 500);
    assert.ok(map.fulfillmentSummary.hasProductsOutsideOrder);
    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice <
        map.fulfillmentSummary.nfeHeaderTotalValue
    );
  });

  it("dataStale marca DADO_DESATUALIZADO", () => {
    const map = buildOrderFulfillmentMap({
      order: { id: "o1", orderCode: "PD S", totalNetValue: 100 },
      orderItems: [
        { id: "i1", externalProductId: 1, quantity: 1, unitPrice: 100 },
      ],
      paymentTermsAvailable: true,
      dataStale: true,
    });
    assert.ok(map.technicalAlerts.includes("DADO_DESATUALIZADO"));
  });

  it("classificadores unitários", () => {
    assert.equal(
      classifyFinancialStatus({
        receivedValue: 0,
        openReceivableValue: 0,
        hasNfe: false,
      }),
      "FIN_SEM_CR"
    );
    assert.equal(
      classifyOperationalStatus({
        hasNfe: false,
        hasStockDocument: false,
        hasItemAllocation: false,
        headerOnlyLink: false,
        totalOrderedQuantity: 10,
        totalAttendedQuantityCapped: 0,
        totalRemainingQuantity: 10,
        hasExcessQuantity: false,
      }),
      "OP_NAO_ATENDIDO"
    );
    assert.equal(
      classifyOperationalStatus({
        hasNfe: true,
        hasStockDocument: true,
        hasItemAllocation: true,
        headerOnlyLink: false,
        totalOrderedQuantity: 100,
        totalAttendedQuantityCapped: 100,
        totalRemainingQuantity: 0,
        hasExcessQuantity: true,
      }),
      "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
    );
  });
});
