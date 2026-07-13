import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOrderPaymentPlan,
  buildOrderToCashAuditRows,
  classifyOrderToCashStage,
  classifyPaymentStatus,
  detectOrderToCashAlerts,
  resolveOrderSeller,
  type OrderToCashAuditOrderInput,
  type OrderToCashAuditOrderItemInput,
  type OrderToCashAuditNfeInput,
  type OrderToCashAuditNfeLinkInput,
  type OrderToCashAuditReceivableInput,
  type OrderToCashAuditStockDocumentInput,
  type OrderToCashAuditStockItemInput,
} from "./orderToCashAuditBuilder.js";

const TODAY = new Date(2026, 6, 11); // 2026-07-11

function order(partial: Partial<OrderToCashAuditOrderInput> = {}): OrderToCashAuditOrderInput {
  return {
    id: "ord-1",
    externalSalesOrderId: 2720,
    orderCode: "PD 02720",
    status: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 5, 1),
    expectedDeliveryDate: new Date(2026, 7, 1),
    totalNetValue: 1000,
    totalGrossValue: 1000,
    paymentTerms: "30 dias",
    sellerName: "Maria Vendedora",
    externalSellerId: 99,
    customerName: "Cliente X",
    ...partial,
  };
}

function item(
  partial: Partial<OrderToCashAuditOrderItemInput> = {}
): OrderToCashAuditOrderItemInput {
  return {
    id: "item-1",
    salesOrderId: "ord-1",
    externalProductId: 100,
    sku: "SKU-100",
    productCode: "SKU-100",
    productName: "Produto A",
    quantity: 10,
    unitPrice: 100,
    totalNetValue: 1000,
    ...partial,
  };
}

function nfeLink(
  partial: Partial<OrderToCashAuditNfeLinkInput> = {}
): OrderToCashAuditNfeLinkInput {
  return {
    salesOrderId: "ord-1",
    nfeExternalId: 5001,
    nfeNumber: "123",
    ...partial,
  };
}

function nfe(partial: Partial<OrderToCashAuditNfeInput> = {}): OrderToCashAuditNfeInput {
  return {
    id: "nfe-1",
    externalId: 5001,
    numero: "123",
    valorLiquido: 1000,
    dataProcessamento: new Date(2026, 5, 20),
    ...partial,
  };
}

function stockDoc(
  partial: Partial<OrderToCashAuditStockDocumentInput> = {}
): OrderToCashAuditStockDocumentInput {
  return {
    id: "doc-1",
    externalId: 8001,
    idNfe: 5001,
    dataDocumento: new Date(2026, 5, 18),
    ...partial,
  };
}

function stockItem(
  partial: Partial<OrderToCashAuditStockItemInput> = {}
): OrderToCashAuditStockItemInput {
  return {
    id: "sitem-1",
    stockDocumentId: "doc-1",
    externalProductId: 100,
    quantity: 10,
    unitValue: 100,
    ...partial,
  };
}

function receivable(
  partial: Partial<OrderToCashAuditReceivableInput> = {}
): OrderToCashAuditReceivableInput {
  return {
    externalId: 9001,
    sourceInvoiceId: 5001,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    dueDate: new Date(2026, 7, 1),
    ...partial,
  };
}

describe("orderToCashAuditBuilder", () => {
  it("1. pedido sem documento gera linha ORDER_ITEM_PENDING", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      options: { today: TODAY },
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]!.lineType, "ORDER_ITEM_PENDING");
    assert.equal(result.rows[0]!.quantityUsedForOrder, 0);
    assert.equal(result.summary.pendingLines, 1);
  });

  it("1b. item cancelado gera ORDER_ITEM_CANCELED e não PENDING/forecast", () => {
    const result = buildOrderToCashAuditRows({
      orders: [
        order({
          orderCode: "PD 02207",
          totalNetValue: 197_030,
        }),
      ],
      orderItems: [
        item({
          id: "i1",
          externalProductId: 538,
          quantity: 8000,
          unitPrice: 4.92,
          totalNetValue: 39_360,
          itemStatus: "ATENDIDO",
          nomusIsCanceled: false,
        }),
        item({
          id: "i2",
          externalProductId: 453,
          quantity: 6500,
          unitPrice: 4.93,
          totalNetValue: 32_045,
          itemStatus: "ATENDIDO",
          nomusIsCanceled: false,
        }),
        item({
          id: "i3",
          externalProductId: 537,
          quantity: 16500,
          unitPrice: 4.93,
          totalNetValue: 81_345,
          itemStatus: "CANCELADO",
          nomusIsCanceled: true,
        }),
        item({
          id: "i4",
          externalProductId: 452,
          quantity: 9000,
          unitPrice: 4.92,
          totalNetValue: 44_280,
          itemStatus: "CANCELADO",
          nomusIsCanceled: true,
        }),
      ],
      options: { today: TODAY },
    });
    const pending = result.rows.filter((r) => r.lineType === "ORDER_ITEM_PENDING");
    const canceled = result.rows.filter((r) => r.lineType === "ORDER_ITEM_CANCELED");
    assert.equal(canceled.length, 2);
    assert.equal(pending.length, 2);
    assert.equal(result.summary.canceledLines, 2);
    assert.ok(canceled.every((r) => r.plannedReceivableValue == null));
    assert.ok(canceled.every((r) => !r.alertsJson.includes("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO")));
    assert.ok(
      pending.every((r) => (r.plannedReceivableValue ?? 0) <= 71_405 + 0.01)
    );
  });

  it("2. pedido futuro saudável", () => {
    const result = buildOrderToCashAuditRows({
      orders: [
        order({
          issueDate: new Date(2026, 6, 1),
          expectedDeliveryDate: new Date(2026, 8, 1),
        }),
      ],
      orderItems: [item()],
      options: { today: TODAY },
    });
    assert.equal(result.rows[0]!.orderToCashStage, "PEDIDO_FUTURO_SAUDAVEL");
    assert.equal(result.rows[0]!.temperature, "QUENTE");
  });

  it("3. pedido vencido sem documento vira bloqueado/revisão", () => {
    const result = buildOrderToCashAuditRows({
      orders: [
        order({
          issueDate: new Date(2025, 11, 1),
          expectedDeliveryDate: new Date(2026, 0, 1),
        }),
      ],
      orderItems: [item()],
      options: { today: TODAY, diasBloqueio: 60 },
    });
    assert.equal(result.rows[0]!.orderToCashStage, "BLOQUEADO_REVISAO");
    assert.ok(
      result.rows[0]!.alertsJson.includes("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO")
    );
  });

  it("4. documento parcial", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem({ quantity: 4 })],
      options: { today: TODAY },
    });
    const allocated = result.rows.filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    const pending = result.rows.filter((r) => r.lineType === "ORDER_ITEM_PENDING");
    assert.equal(allocated.length, 1);
    assert.equal(allocated[0]!.quantityUsedForOrder, 4);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.quantityRemainingAfterAllocation, 6);
    assert.equal(result.rows[0]!.operationalStage, "PARTIALLY_FULFILLED");
    assert.ok(result.rows.some((r) => r.alertsJson.includes("DOCUMENTO_PARCIAL")));
  });

  it("5. documento total", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem({ quantity: 10 })],
      options: { today: TODAY },
    });
    assert.equal(result.summary.allocatedLines, 1);
    assert.equal(result.summary.pendingLines, 0);
    assert.equal(result.rows[0]!.operationalStage, "FULLY_FULFILLED");
    assert.equal(result.rows[0]!.quantityUsedForOrder, 10);
    assert.equal(result.rows[0]!.allocatedValueByOrderPrice, 1000);
  });

  it("6. documento com excesso", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem({ quantity: 15 })],
      options: { today: TODAY },
    });
    const allocated = result.rows.find((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    const surplus = result.rows.find((r) => r.lineType === "QUANTITY_SURPLUS");
    assert.ok(allocated);
    assert.equal(allocated!.quantityUsedForOrder, 10);
    assert.ok(surplus);
    assert.equal(surplus!.excessQuantity, 5);
    assert.equal(surplus!.allocatedValueByOrderPrice, 0);
    assert.ok(result.rows.some((r) => r.alertsJson.includes("DOCUMENTO_COM_EXCEDENTE")));
  });

  it("7. documento com produto fora do pedido", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [
        stockItem({ quantity: 10 }),
        stockItem({
          id: "sitem-extra",
          externalProductId: 999,
          quantity: 2,
          unitValue: 50,
        }),
      ],
      options: { today: TODAY },
    });
    const extra = result.rows.find((r) => r.lineType === "DOCUMENT_EXTRA_ITEM");
    assert.ok(extra);
    assert.equal(extra!.outsideOrderQuantity, 2);
    assert.equal(extra!.allocatedValueByOrderPrice, 0);
    assert.ok(extra!.alertsJson.includes("PRODUTO_FORA_DO_PEDIDO"));
  });

  it("8. NF cabeçalho maior que pedido", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order({ totalNetValue: 500 })],
      orderItems: [item({ quantity: 5, unitPrice: 100, totalNetValue: 500 })],
      nfeLinks: [nfeLink()],
      nfes: [nfe({ valorLiquido: 900 })],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem({ quantity: 5 })],
      options: { today: TODAY },
    });
    assert.ok(
      result.rows.some((r) => r.hasNfeHeaderGreaterThanOrder || r.alertsJson.includes("NF_CABECALHO_MAIOR_PEDIDO"))
    );
  });

  it("9. CR aberto", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem()],
      receivables: [receivable()],
      options: { today: TODAY },
    });
    assert.equal(result.rows[0]!.financialStage, "CR_OPEN");
    assert.equal(result.rows[0]!.paymentStatus, "OPEN");
    assert.equal(result.rows[0]!.receivableTotalValue, 1000);
    assert.equal(result.rows[0]!.receivableSource, "ID_NFE");
  });

  it("10. CR recebido", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem()],
      receivables: [
        receivable({
          amountReceived: 1000,
          balanceReceivable: 0,
          settlementDate: new Date(2026, 6, 5),
        }),
      ],
      options: { today: TODAY },
    });
    assert.equal(result.rows[0]!.financialStage, "CR_RECEIVED");
    assert.equal(result.rows[0]!.paymentStatus, "PAID");
    assert.equal(result.rows[0]!.orderToCashStage, "RECEBIDO");
    assert.equal(result.rows[0]!.cashStage, "CASH_RECEIVED");
  });

  it("11. pagamento parcial", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem()],
      receivables: [
        receivable({
          amountReceived: 400,
          balanceReceivable: 600,
        }),
      ],
      options: { today: TODAY },
    });
    assert.equal(result.rows[0]!.paymentStatus, "PARTIALLY_PAID");
    assert.equal(result.rows[0]!.financialStage, "CR_PARTIALLY_RECEIVED");
  });

  it("12. condição pagamento ausente", () => {
    const plan = buildOrderPaymentPlan(
      order({ paymentTerms: null, paymentMethod: null, nomusRawResponse: null })
    );
    assert.equal(plan.plannedPaymentStatus, "MISSING_PAYMENT_CONDITION");
    assert.equal(plan.hasPaymentConditionMissing, true);

    const result = buildOrderToCashAuditRows({
      orders: [order({ paymentTerms: null, paymentMethod: null, nomusRawResponse: null })],
      orderItems: [item()],
      options: { today: TODAY },
    });
    assert.ok(result.rows[0]!.hasPaymentConditionMissing);
    assert.ok(result.rows[0]!.alertsJson.includes("CONDICAO_PAGAMENTO_AUSENTE"));
  });

  it("13. preço divergente", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe()],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem({ unitValue: 120 })],
      options: { today: TODAY },
    });
    const allocated = result.rows.find((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.ok(allocated);
    assert.equal(allocated!.hasPriceMismatch, true);
    assert.ok(allocated!.alertsJson.includes("DIVERGENCIA_PRECO"));
    assert.equal(allocated!.allocatedValueByOrderPrice, 1000);
    assert.equal(allocated!.allocatedValueByDocumentPrice, 1200);
  });

  it("14. valor atribuído não passa do pedido", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order({ totalNetValue: 1000 })],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe({ valorLiquido: 5000 })],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [stockItem({ quantity: 10 })],
      options: { today: TODAY },
    });
    const allocatedSum = result.rows
      .filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED")
      .reduce((s, r) => s + (r.allocatedValueByOrderPrice ?? 0), 0);
    assert.ok(allocatedSum <= 1000 + 0.01);
    assert.ok(result.summary.totalAllocatedValueByOrderPrice <= 1000 + 0.01);
  });

  it("15. alertas não duplicam valor", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink()],
      nfes: [nfe({ valorLiquido: 2000 })],
      stockDocuments: [stockDoc()],
      stockDocumentItems: [
        stockItem({ quantity: 10 }),
        stockItem({
          id: "sitem-extra",
          externalProductId: 999,
          quantity: 3,
          unitValue: 50,
        }),
      ],
      options: { today: TODAY },
    });
    const orderValueLines = result.rows
      .filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED")
      .reduce((s, r) => s + (r.allocatedValueByOrderPrice ?? 0), 0);
    const extraValue = result.rows
      .filter((r) => r.lineType === "DOCUMENT_EXTRA_ITEM")
      .reduce((s, r) => s + (r.allocatedValueByOrderPrice ?? 0), 0);
    assert.equal(extraValue, 0);
    assert.ok(orderValueLines <= 1000 + 0.01);
    assert.ok(result.rows.some((r) => r.hasNfeHeaderGreaterThanOrder));
  });

  it("16. proposta não usada", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/sales/orderToCashAuditBuilder.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /from ["'].*proposal/i);
    assert.doesNotMatch(src, /ProposalModule|proposalId|proposalLine/i);
  });

  it("17. comissão não usada", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/sales/orderToCashAuditBuilder.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /from ["'].*commission/i);
    assert.doesNotMatch(src, /CommissionRecord|commissionPerson/i);
  });

  it("18. vendedor vem do pedido", () => {
    const seller = resolveOrderSeller(
      order({ sellerName: "João Pedido", externalSellerId: 55, sellerId: "sel-1" })
    );
    assert.equal(seller.sellerName, "João Pedido");
    assert.equal(seller.externalSellerId, "55");
    assert.equal(seller.sellerQualityStatus, "RESOLVED");

    const empty = resolveOrderSeller(
      order({ sellerName: null, externalSellerId: null, sellerId: null })
    );
    assert.equal(empty.sellerName, "Sem vendedor informado");
    assert.equal(empty.sellerQualityStatus, "NO_SELLER");

    const result = buildOrderToCashAuditRows({
      orders: [order({ sellerName: "Ana Sales", externalSellerId: 7 })],
      orderItems: [item()],
      options: { today: TODAY },
    });
    assert.equal(result.rows[0]!.sellerName, "Ana Sales");
    assert.equal(result.rows[0]!.externalSellerId, "7");
    assert.equal(result.rows[0]!.sellerSource, "SALES_ORDER");
  });

  it("classifyPaymentStatus cobre estados principais", () => {
    assert.equal(
      classifyPaymentStatus({
        hasPaymentCondition: true,
        hasDocOrNfe: false,
        receivableTotal: 0,
        receivableOpen: 0,
        receivableReceived: 0,
        hasOverdue: false,
      }),
      "PLANNED_ONLY"
    );
    assert.equal(
      classifyPaymentStatus({
        hasPaymentCondition: true,
        hasDocOrNfe: true,
        receivableTotal: 0,
        receivableOpen: 0,
        receivableReceived: 0,
        hasOverdue: false,
      }),
      "AWAITING_CR"
    );
  });

  it("múltiplos documentos geram linhas separadas", () => {
    const result = buildOrderToCashAuditRows({
      orders: [order()],
      orderItems: [item()],
      nfeLinks: [nfeLink(), nfeLink({ nfeExternalId: 5002, nfeNumber: "124" })],
      nfes: [nfe(), nfe({ id: "nfe-2", externalId: 5002, numero: "124", valorLiquido: 400 })],
      stockDocuments: [
        stockDoc({ id: "doc-1", externalId: 8001, idNfe: 5001 }),
        stockDoc({ id: "doc-2", externalId: 8002, idNfe: 5002, dataDocumento: new Date(2026, 5, 25) }),
      ],
      stockDocumentItems: [
        stockItem({ id: "s1", stockDocumentId: "doc-1", quantity: 6 }),
        stockItem({ id: "s2", stockDocumentId: "doc-2", quantity: 4 }),
      ],
      options: { today: TODAY },
    });
    const allocated = result.rows.filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.equal(allocated.length, 2);
    assert.equal(
      allocated.reduce((s, r) => s + (r.quantityUsedForOrder ?? 0), 0),
      10
    );
  });

  it("detectOrderToCashAlerts e classifyOrderToCashStage — atraso recente", () => {
    const stage = classifyOrderToCashStage({
      canceled: false,
      commercialStage: "ORDER_ACTIVE",
      operationalStage: "DOCUMENT_NOT_FOUND",
      fiscalStage: "NO_NFE",
      financialStage: "NO_CR",
      cashStage: "NO_CASH",
      expectedDelivery: new Date(2026, 5, 20),
      today: TODAY,
      diasProximoEntrega: 7,
      diasRecemVencido: 15,
      diasBloqueio: 60,
      hasEvidence: false,
    });
    assert.equal(stage, "PEDIDO_ATRASADO_SEM_DOCUMENTO");

    const alerts = detectOrderToCashAlerts({
      expectedDelivery: new Date(2026, 5, 20),
      today: TODAY,
      hasDocument: false,
      operationalStage: "DOCUMENT_NOT_FOUND",
      hasExcess: false,
      hasOutside: false,
      hasNfeHeaderGreater: false,
      hasPriceMismatch: false,
      hasDocWithoutCr: false,
      hasUnsafeCr: false,
      hasPaymentConditionMissing: false,
      hasPaymentDateDivergence: false,
      hasOverdue: false,
      hasRecentPaymentNotReflected: false,
      commercialStage: "ORDER_ACTIVE",
      diasBloqueio: 60,
    });
    assert.ok(alerts.alerts.includes("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO"));
  });

  it("PD 02534: matching por externalProductId + PENDING sem herdar NF/CR", () => {
    const result = buildOrderToCashAuditRows({
      orders: [
        order({
          id: "ord-pd02534",
          orderCode: "PD 02534",
          externalSalesOrderId: 2530,
          totalNetValue: 200_000,
          customerName: "Esmaltec S/A",
          externalCustomerId: 233,
        }),
      ],
      orderItems: [
        item({
          id: "oi-390",
          salesOrderId: "ord-pd02534",
          externalProductId: 390,
          productCode: "612.02AA",
          sku: "612.02AA",
          quantity: 10_000,
          unitPrice: 3.35,
          totalNetValue: 33_500,
          orderItemSequence: 1,
        }),
        item({
          id: "oi-391",
          salesOrderId: "ord-pd02534",
          externalProductId: 391,
          productCode: "612.03AA",
          sku: "612.03AA",
          quantity: 12_200,
          unitPrice: 3.35,
          totalNetValue: 40_870,
          orderItemSequence: 2,
        }),
        item({
          id: "oi-423",
          salesOrderId: "ord-pd02534",
          externalProductId: 423,
          productCode: "619.24AA",
          sku: "619.24AA",
          quantity: 27_800,
          unitPrice: 2.89,
          totalNetValue: 80_342,
          orderItemSequence: 3,
        }),
        item({
          id: "oi-432",
          salesOrderId: "ord-pd02534",
          externalProductId: 432,
          productCode: "619.21AA",
          sku: "619.21AA",
          quantity: 10_000,
          unitPrice: 2.89,
          totalNetValue: 28_900,
          orderItemSequence: 4,
        }),
        item({
          id: "oi-1004",
          salesOrderId: "ord-pd02534",
          externalProductId: 1004,
          productCode: "309.86AA",
          sku: "309.86AA",
          quantity: 1_000,
          unitPrice: 10,
          totalNetValue: 10_000,
          orderItemSequence: 5,
        }),
      ],
      nfeLinks: [nfeLink({ salesOrderId: "ord-pd02534", nfeExternalId: 7420, nfeNumber: "7228" })],
      nfes: [nfe({ id: "nfe-7228", externalId: 7420, numero: "7228", valorLiquido: 183_612 })],
      stockDocuments: [
        stockDoc({ id: "doc-8457", externalId: 8457, idNfe: 7420 }),
      ],
      stockDocumentItems: [
        stockItem({
          id: "si-390",
          stockDocumentId: "doc-8457",
          externalProductId: 390,
          quantity: 10_000,
          unitValue: 3.35,
        }),
        stockItem({
          id: "si-391",
          stockDocumentId: "doc-8457",
          externalProductId: 391,
          quantity: 12_200,
          unitValue: 3.35,
        }),
        stockItem({
          id: "si-423a",
          stockDocumentId: "doc-8457",
          externalProductId: 423,
          quantity: 10_000,
          unitValue: 2.89,
        }),
        stockItem({
          id: "si-423b",
          stockDocumentId: "doc-8457",
          externalProductId: 423,
          quantity: 1_800,
          unitValue: 2.89,
        }),
        stockItem({
          id: "si-423c",
          stockDocumentId: "doc-8457",
          externalProductId: 423,
          quantity: 16_000,
          unitValue: 2.89,
        }),
        stockItem({
          id: "si-432",
          stockDocumentId: "doc-8457",
          externalProductId: 432,
          quantity: 10_000,
          unitValue: 2.89,
        }),
      ],
      receivables: [
        receivable({
          externalId: 1,
          sourceInvoiceId: 7420,
          amountReceivable: 183_612,
          amountReceived: 0,
          balanceReceivable: 183_612,
        }),
      ],
      options: { today: TODAY },
    });

    const byProduct = (code: string) =>
      result.rows.filter((r) => r.productCode === code || r.sku === code);

    const pending1004 = byProduct("309.86AA");
    assert.equal(pending1004.length, 1);
    assert.equal(pending1004[0]!.lineType, "ORDER_ITEM_PENDING");
    assert.equal(pending1004[0]!.nfeNumber, null);
    assert.equal(pending1004[0]!.nfeExternalId, null);
    assert.equal(pending1004[0]!.receivableTotalValue, null);
    assert.equal(pending1004[0]!.stockDocumentExternalId, null);
    assert.equal(pending1004[0]!.operationalStage, "NOT_FULFILLED");

    const alloc391 = byProduct("612.03AA").filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.equal(alloc391.length, 1);
    assert.equal(alloc391[0]!.stockDocumentItemExternalProductId, 391);
    assert.equal(alloc391[0]!.quantityUsedForOrder, 12_200);
    assert.equal(alloc391[0]!.allocatedValueByDocumentPrice, 12_200 * 3.35);

    const alloc390 = byProduct("612.02AA").filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.equal(alloc390.length, 1);
    assert.equal(alloc390[0]!.quantityUsedForOrder, 10_000);
    assert.equal(alloc390[0]!.allocatedValueByDocumentPrice, 10_000 * 3.35);

    const alloc432 = byProduct("619.21AA").filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.equal(alloc432.length, 1);
    assert.equal(alloc432[0]!.quantityUsedForOrder, 10_000);
    assert.equal(alloc432[0]!.allocatedValueByDocumentPrice, 10_000 * 2.89);

    const alloc423 = byProduct("619.24AA").filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.ok(alloc423.length >= 1);
    const used423 = alloc423.reduce((s, r) => s + (r.quantityUsedForOrder ?? 0), 0);
    assert.equal(used423, 27_800);

    const extras = result.rows.filter((r) => r.lineType === "DOCUMENT_EXTRA_ITEM");
    assert.equal(
      extras.filter((r) => [390, 391, 432, 423].includes(r.stockDocumentItemExternalProductId ?? -1))
        .length,
      0,
      "produtos do pedido não podem virar DOCUMENT_EXTRA_ITEM"
    );

    // Ambíguo (2 linhas mesmo externalProductId) deve FIFO, não EXTRA
    const ambig = buildOrderToCashAuditRows({
      orders: [order({ id: "ord-amb", orderCode: "PD AMB", totalNetValue: 2000 })],
      orderItems: [
        item({
          id: "a1",
          salesOrderId: "ord-amb",
          externalProductId: 500,
          quantity: 5,
          unitPrice: 100,
          orderItemSequence: 1,
        }),
        item({
          id: "a2",
          salesOrderId: "ord-amb",
          externalProductId: 500,
          quantity: 5,
          unitPrice: 100,
          orderItemSequence: 2,
        }),
      ],
      nfeLinks: [nfeLink({ salesOrderId: "ord-amb", nfeExternalId: 9001, nfeNumber: "1" })],
      nfes: [nfe({ id: "nfe-amb", externalId: 9001, numero: "1", valorLiquido: 800 })],
      stockDocuments: [stockDoc({ id: "d1", externalId: 1, idNfe: 9001 })],
      stockDocumentItems: [
        stockItem({
          id: "s1",
          stockDocumentId: "d1",
          externalProductId: 500,
          quantity: 8,
          unitValue: 100,
        }),
      ],
      options: { today: TODAY },
    });
    assert.equal(
      ambig.rows.filter((r) => r.lineType === "DOCUMENT_EXTRA_ITEM").length,
      0
    );
    const allocatedAmbig = ambig.rows.filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED");
    assert.equal(allocatedAmbig.length, 2);
    assert.equal(
      allocatedAmbig.reduce((s, r) => s + (r.quantityUsedForOrder ?? 0), 0),
      8
    );
  });
});
