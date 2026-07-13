import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderToCashAuditFactRecord } from "./orderToCashAuditApi.js";
import { resolveOrderToCashAuditLineBilledValue } from "./orderToCashAuditApi.js";
import {
  aggregateFactsToOrderStatusRows,
  buildOrderStatusPedidosDetailPayload,
  buildOrderStatusPedidosSummary,
  classifyOrderStatusPedidos,
  filterOrderStatusPedidosRows,
  paginateOrderStatusPedidosRows,
  sortOrderStatusPedidosRows,
} from "./orderStatusPedidosApi.js";

const GENERAL_RUN_ID = "41c2470a-b685-4765-a954-77110fd8cf5c";
const PD02534_ORDER_ID = "order-pd-02534";
const TITLE_CR = 183_612;

function fact(
  partial: Partial<OrderToCashAuditFactRecord> & { id: string }
): OrderToCashAuditFactRecord {
  return {
    runId: GENERAL_RUN_ID,
    orderCode: "PD 02534",
    orderIssueDate: new Date(2026, 5, 1),
    orderExpectedDeliveryDate: null,
    orderNetValue: 120_000,
    customerId: "cust-esmaltec",
    customerName: "Esmaltec",
    externalCustomerId: 500,
    sellerName: "Vendedor",
    sellerQualityStatus: "OK",
    productCode: "612.03AA",
    sku: "612.03AA",
    productName: "Produto",
    lineType: "ORDER_ITEM_ALLOCATED",
    orderedQuantity: 10,
    orderUnitPrice: 3.35,
    orderItemTotalValue: 33.5,
    stockDocumentId: "doc-8457",
    stockDocumentExternalId: 8457,
    stockDocumentDate: new Date(2026, 5, 10),
    stockDocumentItemQuantity: 10,
    quantityUsedForOrder: 10,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    allocatedValueByOrderPrice: 33.5,
    allocatedValueByDocumentPrice: 33.5,
    stockDocumentItemUnitValue: 3.35,
    stockDocumentItemTotalValue: 33.5,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    nfeNumber: "7228",
    nfeIssueDate: new Date(2026, 5, 11),
    nfeHeaderValue: TITLE_CR,
    receivableTotalValue: TITLE_CR,
    receivableOpenValue: 50_000,
    receivableReceivedValue: 133_612,
    paymentDueDate: new Date(2026, 6, 1),
    paymentSettlementDate: null,
    paymentStatus: "OPEN",
    operationalStage: "PARTIALLY_FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "PEDIDO_PARCIALMENTE_ATENDIDO",
    temperature: "AMARELO",
    confidenceScore: 0.7,
    confidenceLabel: "MEDIA",
    responsibleArea: "Comercial",
    recommendedAction: "Atender pendência",
    alertsJson: [],
    blockingReasonsJson: [],
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: true,
    hasFullFulfillment: false,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
    salesOrderId: PD02534_ORDER_ID,
    ...partial,
  };
}

describe("orderStatusPedidosApi", () => {
  it("cards contam pedidos distintos, não facts", () => {
    const facts = [
      fact({ id: "f1", salesOrderId: "o1", orderCode: "PD 1", receivableTotalValue: 100 }),
      fact({ id: "f2", salesOrderId: "o1", orderCode: "PD 1", receivableTotalValue: 100 }),
      fact({ id: "f3", salesOrderId: "o2", orderCode: "PD 2", receivableTotalValue: 200 }),
    ];
    const rows = aggregateFactsToOrderStatusRows(facts);
    const summary = buildOrderStatusPedidosSummary(rows);
    assert.equal(rows.length, 2);
    assert.equal(summary.totalOrders, 2);
    assert.equal(summary.totalReceivableValue, 300);
    assert.notEqual(summary.totalOrders, facts.length);
  });

  it("CR agregado uma única vez por pedido (Math.max, não soma linhas)", () => {
    const facts = [
      fact({ id: "a", receivableTotalValue: TITLE_CR, receivableOpenValue: 50_000 }),
      fact({
        id: "b",
        productCode: "612.02AA",
        receivableTotalValue: TITLE_CR,
        receivableOpenValue: 50_000,
      }),
      fact({
        id: "c",
        productCode: "619.21AA",
        receivableTotalValue: TITLE_CR,
        receivableOpenValue: 50_000,
      }),
    ];
    const [row] = aggregateFactsToOrderStatusRows(facts);
    assert.ok(row);
    assert.equal(row.receivableTotalValue, TITLE_CR);
    assert.equal(row.receivableOpenValue, 50_000);
    assert.notEqual(row.receivableTotalValue, TITLE_CR * 3);
  });

  it("PD 02534: parcial com item pendente, CR aberto; PENDING sem parecer faturado", () => {
    const allocated = fact({
      id: "alloc-61203",
      productCode: "612.03AA",
      sku: "612.03AA",
      quantityUsedForOrder: 12_200,
      stockDocumentItemUnitValue: 3.35,
      allocatedValueByOrderPrice: 12_200 * 3.35,
      hasExcessQuantity: true,
      alertsJson: ["EXCESSO_QUANTIDADE"],
    });
    const pending = fact({
      id: "pending-30986",
      productCode: "309.86AA",
      sku: "309.86AA",
      productName: "309.86AA",
      lineType: "ORDER_ITEM_PENDING",
      orderedQuantity: 100,
      orderUnitPrice: 10,
      orderItemTotalValue: 1000,
      stockDocumentId: null,
      stockDocumentExternalId: null,
      stockDocumentDate: null,
      stockDocumentItemQuantity: null,
      stockDocumentItemUnitValue: null,
      stockDocumentItemTotalValue: null,
      quantityUsedForOrder: null,
      allocatedValueByOrderPrice: null,
      allocatedValueByDocumentPrice: null,
      // Materialização correta: PENDING sem NF/CR de item
      nfeNumber: null,
      nfeHeaderValue: null,
      receivableTotalValue: null,
      receivableOpenValue: null,
      receivableReceivedValue: null,
      operationalStage: "NOT_FULFILLED",
      financialStage: "NO_CR",
      orderToCashStage: "PEDIDO_PARCIALMENTE_ATENDIDO",
      hasPartialFulfillment: true,
      hasFullFulfillment: false,
    });

    const rows = aggregateFactsToOrderStatusRows([allocated, pending]);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.orderStatus, "PARCIAL");
    assert.equal(row.hasPendingItems, true);
    assert.equal(row.hasOpenCr, true);
    assert.equal(row.hasDivergences, true);
    assert.equal(row.pendingItemCount, 1);
    assert.equal(row.receivableTotalValue, TITLE_CR);
    assert.deepEqual(row.nfeNumbers, ["7228"]);

    const detail = buildOrderStatusPedidosDetailPayload({
      run: null,
      orderFacts: [allocated, pending],
    });
    const pendingItem = detail.items.find((i) => i.productCode === "309.86AA");
    assert.ok(pendingItem);
    assert.equal(pendingItem.lineType, "ORDER_ITEM_PENDING");
    assert.equal(pendingItem.nfeNumber, null);
    assert.equal(pendingItem.receivableTotalValue, null);
    assert.equal(pendingItem.lineBilledValue, null);
    assert.equal(pendingItem.evidenceLevel, "ORDER_TITLE");
    // CR total título é rastreabilidade — não valor do produto
    assert.equal(pendingItem.titleReceivableTotalValue, TITLE_CR);
    assert.notEqual(pendingItem.lineBilledValue, TITLE_CR);

    const billedPending = resolveOrderToCashAuditLineBilledValue({
      lineType: "ORDER_ITEM_PENDING",
      stockDocumentItemUnitValue: null,
    });
    assert.equal(billedPending.lineBilledValue, null);
    assert.equal(billedPending.lineBilledValueSource, "NOT_BILLED");

    const billedAlloc = resolveOrderToCashAuditLineBilledValue({
      lineType: "ORDER_ITEM_ALLOCATED",
      quantityUsedForOrder: 12_200,
      stockDocumentItemUnitValue: 3.35,
    });
    assert.equal(billedAlloc.lineBilledValue, 12_200 * 3.35);
    assert.notEqual(billedAlloc.lineBilledValue, TITLE_CR);
  });

  it("dois pedidos distintos não misturam CR", () => {
    const facts = [
      fact({
        id: "1",
        salesOrderId: "a",
        orderCode: "PD A",
        receivableTotalValue: 100,
      }),
      fact({
        id: "2",
        salesOrderId: "b",
        orderCode: "PD B",
        receivableTotalValue: 999,
        customerName: "Outro",
      }),
    ];
    const rows = aggregateFactsToOrderStatusRows(facts);
    const summary = buildOrderStatusPedidosSummary(rows);
    assert.equal(summary.totalReceivableValue, 1099);
  });

  it("classifica SEM_ATENDIMENTO e RECEBIDO", () => {
    assert.equal(
      classifyOrderStatusPedidos({
        hasBlocked: false,
        hasDivergences: false,
        hasPendingItems: false,
        hasPartialFulfillment: false,
        hasAnyAllocation: false,
        receivableOpenValue: 0,
        receivableReceivedValue: 0,
        dominantStage: null,
      }),
      "SEM_ATENDIMENTO"
    );
    assert.equal(
      classifyOrderStatusPedidos({
        hasBlocked: false,
        hasDivergences: false,
        hasPendingItems: false,
        hasPartialFulfillment: false,
        hasAnyAllocation: true,
        receivableOpenValue: 0,
        receivableReceivedValue: 100,
        dominantStage: "RECEBIDO",
      }),
      "RECEBIDO"
    );
  });

  it("filtra, ordena e paginate por pedido", () => {
    const facts = [
      fact({ id: "1", salesOrderId: "a", orderCode: "PD A", orderNetValue: 10 }),
      fact({
        id: "2",
        salesOrderId: "b",
        orderCode: "PD B",
        orderNetValue: 20,
        lineType: "ORDER_ITEM_PENDING",
        quantityUsedForOrder: null,
        allocatedValueByOrderPrice: null,
        nfeNumber: null,
        receivableTotalValue: null,
        hasPartialFulfillment: true,
      }),
    ];
    let rows = aggregateFactsToOrderStatusRows(facts);
    rows = filterOrderStatusPedidosRows(rows, { onlyWithPendingItems: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.orderCode, "PD B");

    const all = aggregateFactsToOrderStatusRows(facts);
    const sorted = sortOrderStatusPedidosRows(all, "orderNetValue", "desc");
    assert.equal(sorted[0]!.orderCode, "PD B");
    const page = paginateOrderStatusPedidosRows(sorted, 1, 1);
    assert.equal(page.pageRows.length, 1);
    assert.equal(page.totalPages, 2);
  });
});
