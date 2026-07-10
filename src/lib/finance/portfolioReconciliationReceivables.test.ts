import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PortfolioReconciliationFactDraft } from "./portfolioReconciliationAllocationEngine.js";
import {
  computeReceivableAllocationRatio,
  enrichPortfolioFactsWithReceivables,
  isReceivableSettled,
  matchReceivablesToNfe,
  resolveDominantForecastSource,
  wouldMatchReceivableByCustomerAndValueOnly,
  type SnapshotReceivable,
} from "./portfolioReconciliationReceivables.js";

function baseFact(
  partial: Partial<PortfolioReconciliationFactDraft> &
    Pick<PortfolioReconciliationFactDraft, "status" | "forecastSource" | "confidenceLevel">
): PortfolioReconciliationFactDraft {
  return {
    runId: "run-1",
    customerId: null,
    customerExternalId: null,
    customerNameSnapshot: "Britania",
    salesOrderId: "order-1",
    externalSalesOrderId: 2335,
    orderCode: "PD 02339",
    orderIssueDate: null,
    expectedDeliveryDate: null,
    salesOrderItemId: null,
    externalSalesOrderItemId: null,
    externalProductId: null,
    productSkuSnapshot: null,
    productNameSnapshot: null,
    orderQuantity: null,
    orderUnitPrice: null,
    orderItemValue: null,
    nomusNfeId: "nfe-1",
    nfeExternalId: 6937,
    nfeNumber: "6845",
    nfeSerie: "1",
    nfeKey: "CHAVE6845",
    nfeProcessedAt: null,
    nfeHeaderValue: 108240,
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
    forecastDate: null,
    forecastValue: null,
    alertsJson: [],
    traceJson: {},
    ...partial,
  };
}

describe("portfolioReconciliationReceivables", () => {
  it("vincula CR por idNfe", () => {
    const match = matchReceivablesToNfe({
      nfeExternalId: 6937,
      nfeNumber: "6845",
      receivables: [
        {
          externalId: 101,
          sourceInvoiceId: 6937,
          sourceInvoiceNumber: "6845",
          amountReceivable: 50000,
          amountReceived: 0,
          balanceReceivable: 50000,
          dueDate: new Date(2026, 6, 1),
          settlementDate: null,
        },
        {
          externalId: 102,
          sourceInvoiceId: 6937,
          sourceInvoiceNumber: "6845",
          amountReceivable: 58240,
          amountReceived: 0,
          balanceReceivable: 58240,
          dueDate: new Date(2026, 7, 1),
          settlementDate: null,
        },
        {
          externalId: 999,
          sourceInvoiceId: 7188,
          sourceInvoiceNumber: "7052",
          amountReceivable: 1,
          amountReceived: 0,
          balanceReceivable: 1,
          dueDate: null,
          settlementDate: null,
        },
      ],
    });
    assert.equal(match.matchMethod, "ID_NFE");
    assert.equal(match.confidence, "HIGH");
    assert.deepEqual(
      match.receivables.map((r) => r.externalId).sort(),
      [101, 102]
    );
  });

  it("não vincula por cliente+valor isolado", () => {
    const receivable: SnapshotReceivable = {
      externalId: 1,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      personName: "Britania",
      amountReceivable: 158000,
      amountReceived: 0,
      balanceReceivable: 158000,
      dueDate: null,
      settlementDate: null,
    };
    assert.equal(
      wouldMatchReceivableByCustomerAndValueOnly(receivable, {
        customerName: "Britania",
        value: 158000,
      }),
      true
    );

    const match = matchReceivablesToNfe({
      nfeExternalId: 6937,
      nfeNumber: "6845",
      receivables: [receivable],
    });
    assert.equal(match.matchMethod, "NONE");
    assert.equal(match.receivables.length, 0);

    const enriched = enrichPortfolioFactsWithReceivables({
      facts: [
        baseFact({
          status: "ITEM_ALLOCATED",
          forecastSource: "NFE",
          confidenceLevel: "HIGH",
          allocatedQuantity: 3000,
          allocatedValueByOrderPrice: 17550,
          externalProductId: 456,
        }),
      ],
      receivables: [receivable],
      nfes: [{ externalId: 6937, numero: "6845", valorLiquido: 108240 }],
    });
    assert.equal(enriched[0]!.receivableIdsJson, null);
    assert.notEqual(enriched[0]!.forecastSource, "RECEIVABLE");
  });

  it("rateia CR quando NF é parcialmente alocada ao pedido", () => {
    const facts = [
      baseFact({
        status: "ITEM_ALLOCATED",
        forecastSource: "NFE",
        confidenceLevel: "HIGH",
        nfeExternalId: 7188,
        nfeNumber: "7052",
        nfeHeaderValue: 168075,
        externalProductId: 537,
        allocatedQuantity: 5000,
        allocatedValueByOrderPrice: 29300,
      }),
    ];
    const receivables: SnapshotReceivable[] = [
      {
        externalId: 201,
        sourceInvoiceId: 7188,
        sourceInvoiceNumber: "7052",
        amountReceivable: 168075,
        amountReceived: 0,
        balanceReceivable: 168075,
        dueDate: new Date(2026, 7, 15),
        settlementDate: null,
      },
    ];

    const ratio = computeReceivableAllocationRatio(29300, 168075);
    assert.ok(ratio != null);
    assert.ok(ratio! < 1);
    assert.ok(Math.abs(ratio! - 29300 / 168075) < 1e-5);

    const enriched = enrichPortfolioFactsWithReceivables({
      facts,
      receivables,
      nfes: [{ externalId: 7188, numero: "7052", valorLiquido: 168075 }],
    });
    const row = enriched[0]!;
    assert.equal(row.forecastSource, "RECEIVABLE");
    assert.equal(row.status, "RECEIVABLE_CONFIRMED");
    assert.deepEqual(row.receivableIdsJson, [201]);
    assert.ok(row.receivableTotalValue != null);
    assert.ok(Math.abs(row.receivableTotalValue! - 29300) < 0.01);
    assert.ok(row.openReceivableValue != null);
    assert.ok(Math.abs(row.openReceivableValue! - 29300) < 0.01);
    assert.ok(row.dueDatesJson?.[0]);
  });

  it("não rateia se alocação for HEADER_ONLY_LINK", () => {
    const enriched = enrichPortfolioFactsWithReceivables({
      facts: [
        baseFact({
          status: "HEADER_ONLY_LINK",
          forecastSource: "NFE",
          confidenceLevel: "LOW",
          nfeHeaderValue: 108240,
        }),
      ],
      receivables: [
        {
          externalId: 301,
          sourceInvoiceId: 6937,
          sourceInvoiceNumber: "6845",
          amountReceivable: 108240,
          amountReceived: 0,
          balanceReceivable: 108240,
          dueDate: new Date(2026, 6, 1),
          settlementDate: null,
        },
      ],
      nfes: [{ externalId: 6937, numero: "6845", valorLiquido: 108240 }],
    });
    const row = enriched[0]!;
    assert.deepEqual(row.receivableIdsJson, [301]);
    assert.equal(row.receivableTotalValue, 108240);
    assert.equal(row.status, "DATA_QUALITY_ISSUE");
    assert.equal(row.forecastSource, "UNRESOLVED");
    assert.equal(row.confidenceLevel, "BLOCKED");
    assert.equal(row.traceJson.receivableRateadoToOrder, false);
  });

  it("RECEIVABLE tem prioridade sobre NFE e ORDER", () => {
    assert.equal(
      resolveDominantForecastSource(["ORDER", "NFE", "RECEIVABLE", "UNRESOLVED"]),
      "RECEIVABLE"
    );
    assert.equal(resolveDominantForecastSource(["ORDER", "NFE"]), "NFE");
    assert.equal(resolveDominantForecastSource(["ORDER"]), "ORDER");

    const enriched = enrichPortfolioFactsWithReceivables({
      facts: [
        baseFact({
          status: "PRICE_MISMATCH",
          forecastSource: "NFE",
          confidenceLevel: "MEDIUM",
          allocatedQuantity: 3000,
          allocatedValueByOrderPrice: 17550,
          externalProductId: 456,
        }),
      ],
      receivables: [
        {
          externalId: 401,
          sourceInvoiceId: 6937,
          sourceInvoiceNumber: "6845",
          amountReceivable: 108240,
          amountReceived: 0,
          balanceReceivable: 108240,
          dueDate: new Date(2026, 6, 10),
          settlementDate: null,
        },
      ],
      nfes: [{ externalId: 6937, numero: "6845", valorLiquido: 108240 }],
    });
    assert.equal(enriched[0]!.forecastSource, "RECEIVABLE");
    assert.notEqual(enriched[0]!.forecastSource, "NFE");
    assert.notEqual(enriched[0]!.forecastSource, "ORDER");
  });

  it("Received/baixado altera status para RECEIVED", () => {
    const settled: SnapshotReceivable = {
      externalId: 501,
      sourceInvoiceId: 6937,
      sourceInvoiceNumber: "6845",
      amountReceivable: 108240,
      amountReceived: 108240,
      balanceReceivable: 0,
      dueDate: new Date(2026, 5, 1),
      settlementDate: new Date(2026, 5, 20),
    };
    assert.equal(isReceivableSettled(settled), true);

    const enriched = enrichPortfolioFactsWithReceivables({
      facts: [
        baseFact({
          status: "ITEM_ALLOCATED",
          forecastSource: "NFE",
          confidenceLevel: "HIGH",
          allocatedQuantity: 3000,
          allocatedValueByOrderPrice: 108240,
          externalProductId: 456,
          nfeHeaderValue: 108240,
        }),
      ],
      receivables: [settled],
      nfes: [{ externalId: 6937, numero: "6845", valorLiquido: 108240 }],
    });
    assert.equal(enriched[0]!.status, "RECEIVED");
    assert.equal(enriched[0]!.forecastSource, "RECEIVABLE");
    assert.ok(enriched[0]!.settlementDatesJson?.[0]);
    assert.ok((enriched[0]!.receivedValue ?? 0) > 0);
  });
});
