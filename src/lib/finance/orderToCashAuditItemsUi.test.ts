import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderToCashAuditListRow } from "./orderToCashAuditApi.js";
import {
  countOrderToCashAuditItemChips,
  filterOrderToCashAuditRowsByChip,
  isOrderToCashAuditPendingLine,
  matchesOrderToCashAuditItemChip,
  pendingQuantityOfAuditRow,
} from "./orderToCashAuditItemsUi.js";
import { mapOrderToCashAuditFactToListRow } from "./orderToCashAuditApi.js";

function baseRow(
  overrides: Partial<OrderToCashAuditListRow> = {}
): OrderToCashAuditListRow {
  return {
    id: "r1",
    runId: "run",
    orderCode: "PD 02207",
    orderIssueDate: null,
    orderExpectedDeliveryDate: null,
    customerName: "Cliente",
    externalCustomerId: 1,
    sellerName: null,
    sellerQualityStatus: null,
    productCode: "SKU-1",
    sku: "SKU-1",
    productName: "Item",
    lineType: "ORDER_ITEM_ALLOCATED",
    orderedQuantity: 10,
    orderUnitPrice: 1,
    orderItemTotalValue: 10,
    stockDocumentExternalId: 99,
    stockDocumentDate: null,
    stockDocumentItemQuantity: 10,
    quantityUsedForOrder: 10,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    allocatedValueByOrderPrice: 10,
    allocatedValueByDocumentPrice: 10,
    stockDocumentItemUnitValue: 1,
    stockDocumentItemTotalValue: 10,
    nfeItemQuantity: 10,
    nfeItemUnitValue: 1,
    nfeItemTotalValue: 10,
    lineBilledValue: 10,
    lineBilledValueSource: "STOCK_DOCUMENT_ITEM",
    lineBilledValueLabel: "Documento",
    titleReceivableTotalValue: null,
    titleReceivableOpenValue: null,
    titleNfeNumber: null,
    titleNfeExternalId: null,
    evidenceLevel: "ITEM",
    nfeNumber: "100",
    nfeIssueDate: null,
    nfeHeaderValue: null,
    receivableTotalValue: 100,
    receivableOpenValue: 40,
    receivableReceivedValue: 60,
    paymentDueDate: null,
    paymentSettlementDate: null,
    paymentStatus: "PARTIAL",
    operationalStage: "FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "CR_ABERTO",
    temperature: null,
    confidenceScore: null,
    confidenceLabel: null,
    responsibleArea: null,
    recommendedAction: null,
    alerts: [],
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: true,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
    orderItemStatus: null,
    itemFulfillmentStatus: null,
    canceledOrderValue: null,
    ...overrides,
  };
}

describe("orderToCashAuditItemsUi", () => {
  it("PD 02207-like: classifica atendido e pendente", () => {
    const attended = baseRow({ id: "a", lineType: "ORDER_ITEM_ALLOCATED" });
    const pending = baseRow({
      id: "p",
      lineType: "ORDER_ITEM_PENDING",
      quantityUsedForOrder: 0,
      allocatedValueByOrderPrice: 0,
      lineBilledValue: null,
      lineBilledValueSource: "NOT_BILLED",
      nfeNumber: null,
      stockDocumentExternalId: null,
      receivableOpenValue: null,
    });
    assert.equal(matchesOrderToCashAuditItemChip(attended, "attended"), true);
    assert.equal(matchesOrderToCashAuditItemChip(pending, "pending"), true);
    assert.equal(matchesOrderToCashAuditItemChip(pending, "attended"), false);
    const filtered = filterOrderToCashAuditRowsByChip([attended, pending], "pending");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.id, "p");
  });

  it("PD 02534 PENDING 309.86AA: sem NF/documento; qtd pendente = pedida", () => {
    const pending = baseRow({
      productCode: "309.86AA",
      sku: "309.86AA",
      lineType: "ORDER_ITEM_PENDING",
      orderedQuantity: 5,
      quantityUsedForOrder: 0,
      lineBilledValue: null,
      nfeNumber: null,
      stockDocumentExternalId: null,
    });
    assert.ok(isOrderToCashAuditPendingLine(pending));
    assert.equal(pendingQuantityOfAuditRow(pending), 5);
    assert.equal(pending.nfeNumber, null);
    assert.equal(pending.stockDocumentExternalId, null);
    assert.equal(pending.lineBilledValue, null);
  });

  it("mapper PENDING zera documento/NF do item", () => {
    const row = mapOrderToCashAuditFactToListRow({
      id: "f1",
      runId: "run",
      orderCode: "PD 02534",
      lineType: "ORDER_ITEM_PENDING",
      productCode: "309.86AA",
      sku: "309.86AA",
      orderedQuantity: 2,
      quantityUsedForOrder: 0,
      stockDocumentExternalId: 7228,
      nfeNumber: "7228",
      nfeHeaderValue: 183612,
      receivableTotalValue: 183612,
      receivableOpenValue: 183612,
      receivableReceivedValue: 0,
    } as never);
    assert.equal(row.nfeNumber, null);
    assert.equal(row.stockDocumentExternalId, null);
    assert.equal(row.lineBilledValue, null);
    assert.equal(row.receivableTotalValue, null);
  });

  it("chips contam sem tratar CR título como valor de item", () => {
    const rows = [
      baseRow({ id: "1", receivableOpenValue: 50 }),
      baseRow({
        id: "2",
        lineType: "ORDER_ITEM_PENDING",
        receivableOpenValue: null,
        titleReceivableOpenValue: 183612,
        quantityUsedForOrder: 0,
        allocatedValueByOrderPrice: 0,
        lineBilledValue: null,
      }),
      baseRow({
        id: "3",
        lineType: "DOCUMENT_EXTRA_ITEM",
        hasProductOutsideOrder: true,
        outsideOrderQuantity: 1,
        receivableOpenValue: 0,
      }),
    ];
    const counts = countOrderToCashAuditItemChips(rows);
    assert.equal(counts.pending, 1);
    assert.equal(counts.outside, 1);
    assert.equal(counts.cr_open, 1);
    assert.ok(counts.attended >= 1);
  });
});
