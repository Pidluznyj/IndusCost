import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PortfolioReconciliationFactDraft } from "./portfolioReconciliationAllocationEngine.js";
import {
  adjustToCustomerPaymentCalendar,
  applyPortfolioPaymentCalendarToFacts,
  BRITANIA_CUSTOMER_EXTERNAL_ID,
  BRITANIA_PAYMENT_RULE_FALLBACK,
  calculateProjectedReceiptDate,
  resolveCustomerPaymentRule,
} from "./portfolioPaymentCalendar.js";

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

describe("portfolioPaymentCalendar", () => {
  const rule = BRITANIA_PAYMENT_RULE_FALLBACK;

  it("12/07 -> 20/07", () => {
    const adjusted = adjustToCustomerPaymentCalendar(d(2026, 7, 12), rule);
    assert.equal(adjusted.getFullYear(), 2026);
    assert.equal(adjusted.getMonth(), 6);
    assert.equal(adjusted.getDate(), 20);
  });

  it("20/07 -> 20/07", () => {
    const adjusted = adjustToCustomerPaymentCalendar(d(2026, 7, 20), rule);
    assert.equal(adjusted.getDate(), 20);
    assert.equal(adjusted.getMonth(), 6);
  });

  it("21/07 -> 30/07", () => {
    const adjusted = adjustToCustomerPaymentCalendar(d(2026, 7, 21), rule);
    assert.equal(adjusted.getDate(), 30);
    assert.equal(adjusted.getMonth(), 6);
  });

  it("31/07 -> 10/08", () => {
    const adjusted = adjustToCustomerPaymentCalendar(d(2026, 7, 31), rule);
    assert.equal(adjusted.getFullYear(), 2026);
    assert.equal(adjusted.getMonth(), 7);
    assert.equal(adjusted.getDate(), 10);
  });

  it("cliente sem regra mantém data original", () => {
    const original = d(2026, 7, 12);
    const adjusted = adjustToCustomerPaymentCalendar(original, null);
    assert.equal(adjusted.getTime(), original.getTime());
    assert.equal(resolveCustomerPaymentRule(999), null);
  });

  it("resolve Britânia via fallback embutido (externalId 200)", () => {
    const resolved = resolveCustomerPaymentRule(BRITANIA_CUSTOMER_EXTERNAL_ID);
    assert.ok(resolved);
    assert.deepEqual(resolved!.allowedDays, [10, 20, 30]);
    assert.equal(resolved!.moveToNextAllowedDay, true);
  });

  it("calculateProjectedReceiptDate aplica prazo e depois calendário", () => {
    // 01/07 + 11 dias = 12/07 → calendário 20/07
    const projected = calculateProjectedReceiptDate(d(2026, 7, 1), 11, rule);
    assert.equal(projected.getDate(), 20);
    assert.equal(projected.getMonth(), 6);
  });

  it("nunca antecipa (dia 5 sobe para 10, não volta)", () => {
    const adjusted = adjustToCustomerPaymentCalendar(d(2026, 7, 5), rule);
    assert.equal(adjusted.getDate(), 10);
    assert.ok(adjusted.getTime() > d(2026, 7, 5).getTime());
  });

  it("RECEIVABLE não recalcula; NFE/ORDER aplicam calendário", () => {
    const due = d(2026, 7, 12);
    const facts: PortfolioReconciliationFactDraft[] = [
      {
        runId: "r1",
        customerId: null,
        customerExternalId: 200,
        customerNameSnapshot: "Britânia",
        salesOrderId: "o1",
        externalSalesOrderId: null,
        orderCode: "PD X",
        orderIssueDate: d(2026, 6, 1),
        expectedDeliveryDate: d(2026, 7, 12),
        salesOrderItemId: null,
        externalSalesOrderItemId: null,
        externalProductId: null,
        productSkuSnapshot: null,
        productNameSnapshot: null,
        orderQuantity: null,
        orderUnitPrice: null,
        orderItemValue: null,
        nomusNfeId: null,
        nfeExternalId: 1,
        nfeNumber: null,
        nfeSerie: null,
        nfeKey: null,
        nfeProcessedAt: d(2026, 7, 12),
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
        receivableIdsJson: [1],
        receivableTotalValue: 100,
        receivedValue: 0,
        openReceivableValue: 100,
        dueDatesJson: [due.toISOString()],
        settlementDatesJson: null,
        forecastSource: "RECEIVABLE",
        forecastDate: due,
        forecastValue: 100,
        confidenceLevel: "HIGH",
        status: "RECEIVABLE_CONFIRMED",
        alertsJson: [],
        traceJson: {},
      },
      {
        runId: "r1",
        customerId: null,
        customerExternalId: 200,
        customerNameSnapshot: "Britânia",
        salesOrderId: "o1",
        externalSalesOrderId: null,
        orderCode: "PD X",
        orderIssueDate: d(2026, 6, 1),
        expectedDeliveryDate: d(2026, 7, 12),
        salesOrderItemId: null,
        externalSalesOrderItemId: null,
        externalProductId: null,
        productSkuSnapshot: null,
        productNameSnapshot: null,
        orderQuantity: null,
        orderUnitPrice: null,
        orderItemValue: null,
        nomusNfeId: null,
        nfeExternalId: 2,
        nfeNumber: null,
        nfeSerie: null,
        nfeKey: null,
        nfeProcessedAt: d(2026, 7, 12),
        nfeHeaderValue: null,
        stockDocumentId: null,
        stockDocumentExternalId: null,
        stockDocumentItemId: null,
        stockDocumentItemExternalId: null,
        stockDocumentDate: null,
        stockQuantity: null,
        stockUnitValue: null,
        stockItemValue: null,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 10,
        allocatedValueByStockPrice: 10,
        remainingOrderQuantityAfterAllocation: 0,
        remainingOrderValueAfterAllocation: 0,
        priceDifferenceUnit: null,
        priceDifferenceTotal: null,
        receivableIdsJson: null,
        receivableTotalValue: null,
        receivedValue: null,
        openReceivableValue: null,
        dueDatesJson: null,
        settlementDatesJson: null,
        forecastSource: "NFE",
        forecastDate: d(2026, 7, 12),
        forecastValue: 10,
        confidenceLevel: "HIGH",
        status: "ITEM_ALLOCATED",
        alertsJson: [],
        traceJson: {},
      },
      {
        runId: "r1",
        customerId: null,
        customerExternalId: 200,
        customerNameSnapshot: "Britânia",
        salesOrderId: "o1",
        externalSalesOrderId: null,
        orderCode: "PD X",
        orderIssueDate: d(2026, 6, 1),
        expectedDeliveryDate: d(2026, 7, 21),
        salesOrderItemId: null,
        externalSalesOrderItemId: null,
        externalProductId: null,
        productSkuSnapshot: null,
        productNameSnapshot: null,
        orderQuantity: 1,
        orderUnitPrice: 1,
        orderItemValue: 1,
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
        allocatedQuantity: 0,
        allocatedValueByOrderPrice: null,
        allocatedValueByStockPrice: null,
        remainingOrderQuantityAfterAllocation: 1,
        remainingOrderValueAfterAllocation: 1,
        priceDifferenceUnit: null,
        priceDifferenceTotal: null,
        receivableIdsJson: null,
        receivableTotalValue: null,
        receivedValue: null,
        openReceivableValue: null,
        dueDatesJson: null,
        settlementDatesJson: null,
        forecastSource: "ORDER",
        forecastDate: d(2026, 7, 21),
        forecastValue: 1,
        confidenceLevel: "LOW",
        status: "ORDER_ONLY",
        alertsJson: [],
        traceJson: {},
      },
    ];

    const out = applyPortfolioPaymentCalendarToFacts({ facts });
    assert.equal(out[0]!.forecastDate!.getDate(), 12);
    assert.equal(out[0]!.traceJson.paymentCalendarReason, "CR_DUE_DATE_SOVEREIGN");
    assert.equal(out[1]!.forecastDate!.getDate(), 20);
    assert.equal(out[1]!.traceJson.paymentCalendarApplied, true);
    assert.equal(out[2]!.forecastDate!.getDate(), 30);
    assert.equal(out[2]!.traceJson.paymentCalendarApplied, true);
  });
});
