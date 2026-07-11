import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import {
  buildPortfolioIntelligenceDataFreshness,
  PORTFOLIO_INTELLIGENCE_FRESHNESS_LAYMAN,
  PORTFOLIO_INTELLIGENCE_SYNC_REBUILD_NOTICE,
} from "./portfolioIntelligenceDataFreshness.js";
import {
  buildPortfolioIntelligenceOrderDetailPayload,
} from "./portfolioMaturityIntelligenceApi.js";

function fact(
  partial: Partial<PortfolioReconciliationFactApiRow> & { id: string }
): PortfolioReconciliationFactApiRow {
  return {
    runId: "run-1",
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Cliente",
    salesOrderId: "order-1",
    externalSalesOrderId: 2339,
    orderCode: "PD 02339",
    orderIssueDate: "2026-01-01",
    expectedDeliveryDate: null,
    salesOrderItemId: null,
    externalSalesOrderItemId: null,
    externalProductId: null,
    productSkuSnapshot: null,
    productNameSnapshot: null,
    orderQuantity: null,
    orderUnitPrice: null,
    orderItemValue: 158000,
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
    forecastDate: "2026-09-15",
    forecastValue: 158000,
    confidenceLevel: "LOW",
    status: "ORDER_ONLY",
    alertsJson: [],
    traceJson: {},
    ...partial,
  };
}

const runMeta = {
  id: "1dc2ead7-533d-4ad4-bc4c-621061fa5623",
  status: "SUCCESS",
  mode: "apply",
  startedAt: "2026-07-10T12:00:00.000Z",
  finishedAt: "2026-07-10T12:05:00.000Z",
  fromDate: null,
  toDate: null,
  customerExternalId: 200,
  filtersJson: {},
  summaryJson: {},
  errorMessage: null,
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:06:00.000Z",
};

describe("portfolioIntelligenceDataFreshness", () => {
  it("detail retorna runUpdatedAt e lastReceivableEvidenceAt quando houver", () => {
    const detail = buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId: "order-1",
      run: runMeta,
      facts: [
        fact({
          id: "cr",
          salesOrderItemId: "i1",
          receivableIdsJson: [99],
          receivableTotalValue: 158000,
          openReceivableValue: 158000,
          receivedValue: 0,
          dueDatesJson: ["2026-07-01"],
          settlementDatesJson: null,
          status: "RECEIVABLE_CONFIRMED",
          confidenceLevel: "HIGH",
          forecastSource: "RECEIVABLE",
        }),
      ],
      enrichment: {
        salesOrderId: "order-1",
        updatedAt: "2026-07-09T18:00:00.000Z",
      },
      orderTotalBySalesOrderId: new Map([["order-1", 158000]]),
      asOfDate: "2026-07-10",
      latestRunId: runMeta.id,
    });

    assert.equal(detail.ok, true);
    assert.ok(detail.dataFreshness);
    assert.equal(detail.dataFreshness!.runUpdatedAt, "2026-07-10T12:06:00.000Z");
    assert.ok(detail.dataFreshness!.lastReceivableEvidenceAt);
    assert.match(
      detail.dataFreshness!.lastReceivableEvidenceAt!,
      /2026-07-01/
    );
    assert.equal(detail.detail!.dataFreshness!.runId, runMeta.id);
    assert.match(
      detail.dataFreshness!.syncRebuildNotice,
      /sincronização do Contas a Receber e rebuild/
    );
    assert.equal(detail.dataFreshness!.hasSettlementEvidence, false);
    assert.ok(
      detail.dataFreshness!.warnings.some(
        (w) => /baixa|settlement|sincronização do Contas a Receber/i.test(w)
      )
    );
    assert.ok(
      !detail.dataFreshness!.hasSettlementEvidence,
      "não inventa baixa sem settlementDatesJson"
    );
  });

  it("não inventa baixa se não existir no dado", () => {
    const freshness = buildPortfolioIntelligenceDataFreshness({
      run: runMeta,
      facts: [
        fact({
          id: "oo",
          receivedValue: 0,
          openReceivableValue: 0,
          receivableTotalValue: 0,
          settlementDatesJson: null,
        }),
      ],
      scope: "order",
      latestRunId: runMeta.id,
    });
    assert.equal(freshness.hasSettlementEvidence, false);
    assert.equal(freshness.lastSettlementAt, null);
    assert.equal(freshness.receivedValue, 0);
    assert.ok(freshness.warnings.some((w) => /Nenhuma baixa encontrada/i.test(w)));
    assert.equal(freshness.laymanNotice, PORTFOLIO_INTELLIGENCE_FRESHNESS_LAYMAN);
    assert.equal(freshness.syncRebuildNotice, PORTFOLIO_INTELLIGENCE_SYNC_REBUILD_NOTICE);
  });

  it("avisa quando a run não é a mais recente", () => {
    const freshness = buildPortfolioIntelligenceDataFreshness({
      run: runMeta,
      facts: [],
      latestRunId: "outra-run-mais-nova",
      scope: "list",
    });
    assert.equal(freshness.isLatestRun, false);
    assert.ok(freshness.warnings.some((w) => /não é a conciliação SUCCESS mais recente/i.test(w)));
  });

  it("com settlement + receivedValue marca evidência de baixa", () => {
    const freshness = buildPortfolioIntelligenceDataFreshness({
      run: runMeta,
      facts: [
        fact({
          id: "paid",
          receivableIdsJson: [1],
          receivableTotalValue: 100,
          receivedValue: 100,
          openReceivableValue: 0,
          settlementDatesJson: ["2026-07-08"],
          dueDatesJson: ["2026-07-01"],
          status: "RECEIVED",
        }),
      ],
      scope: "order",
      latestRunId: runMeta.id,
    });
    assert.equal(freshness.hasSettlementEvidence, true);
    assert.equal(freshness.lastSettlementAt, "2026-07-08");
    assert.ok(freshness.receivedValue > 0);
  });
});
