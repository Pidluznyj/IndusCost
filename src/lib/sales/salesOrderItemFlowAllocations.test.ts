/**
 * Alocações DS/NF por item — vínculo canônico sem qty fallback do pedido inteiro.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.js";
import { buildSalesOrderItemFlowAllocationsFromEvidence } from "./salesOrderItemFlowAllocations.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";

const ORDER = "33333333-3333-3333-3333-333333333333";
const ITEM_A = "cccccccc-cccc-cccc-cccc-ccccccccccc1";
const ITEM_B = "dddddddd-dddd-dddd-dddd-dddddddddddd1";
const ITEM_PARTIAL = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1";
const EXT_PROD_A = 1001;
const EXT_PROD_B = 1002;
const EXT_PROD_PARTIAL = 1003;

function mixedOrderPack() {
  return assembleSalesOrderFlowEvidenceBatch({
    orders: [
      {
        id: ORDER,
        orderCode: "PD-MIX",
        status: "SENT_TO_NOMUS",
        customerId: "c1",
        expectedDeliveryDate: null,
        items: [
          {
            id: ITEM_A,
            salesOrderId: ORDER,
            productId: "p-stock",
            externalProductId: EXT_PROD_A,
            skuSnapshot: "STK",
            productNameSnapshot: "Estoque",
            quantity: 10,
            nomusQuantityFulfilled: 0,
            nomusItemStatusRaw: "2",
            nomusItemStatusNormalized: "RELEASED",
            nomusItemExternalId: 701,
          },
          {
            id: ITEM_B,
            salesOrderId: ORDER,
            productId: "p-mfg",
            externalProductId: EXT_PROD_B,
            skuSnapshot: "MFG",
            productNameSnapshot: "Fabricado",
            quantity: 20,
            nomusQuantityFulfilled: 0,
            nomusItemStatusRaw: "2",
            nomusItemStatusNormalized: "RELEASED",
            nomusItemExternalId: 702,
          },
        ],
      },
    ],
    products: [
      {
        id: "p-stock",
        type: "PRODUCT",
        costingMode: "BOM_ONLY",
        hasProductRouting: false,
        hasProductBom: true,
      },
      {
        id: "p-mfg",
        type: "PRODUCT",
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        hasProductBom: true,
      },
    ],
    nfeLinks: [
      {
        id: "nl1",
        salesOrderId: ORDER,
        nfeExternalId: 5001,
        nfeStatus: 100,
      },
    ],
    stockDocuments: [
      {
        id: "doc1",
        externalId: 8001,
        idNfe: 5001,
        statusRaw: "EMITIDO",
        isCancelled: false,
      },
    ],
    stockDocumentItems: [
      {
        id: "di-a",
        stockDocumentId: "doc1",
        externalProductId: EXT_PROD_A,
        quantity: 10,
      },
      {
        id: "di-b",
        stockDocumentId: "doc1",
        externalProductId: EXT_PROD_B,
        quantity: 8,
      },
    ],
    productionLinks: [
      {
        id: "l1",
        productionOrderId: "op1",
        productionOrderExternalId: 1,
        salesOrderId: ORDER,
        salesOrderItemId: ITEM_B,
        externalSalesOrderId: 1,
        externalSalesOrderItemId: 702,
        linkedQuantity: 12,
        isCurrent: true,
      },
    ],
    productionOrders: [
      { id: "op1", externalId: 1, quantity: 12, status: "Liberada" },
    ],
  });
}

describe("salesOrderItemFlowAllocations", () => {
  it("NF linkada sem O2C aloca qty por externalProductId (não qty total do item)", () => {
    const pack = mixedOrderPack().get(ORDER)!;
    const itemA = pack.items.find((i) => i.id === ITEM_A)!;
    const itemB = pack.items.find((i) => i.id === ITEM_B)!;

    const allocA = buildSalesOrderItemFlowAllocationsFromEvidence(pack, itemA);
    assert.equal(allocA.documentAllocations.length, 1);
    assert.equal(allocA.documentAllocations[0]!.quantity, 10);
    assert.equal(allocA.nfeAllocations.length, 1);
    assert.equal(allocA.nfeAllocations[0]!.quantity, 10);

    const allocB = buildSalesOrderItemFlowAllocationsFromEvidence(pack, itemB);
    assert.equal(allocB.documentAllocations[0]!.quantity, 8);
    assert.equal(allocB.nfeAllocations[0]!.quantity, 8);
  });

  it("item estoque com BOM não exige OP; fabricado com OP parcial mantém residual", () => {
    const pack = mixedOrderPack().get(ORDER)!;
    const stockItem = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_A)!;
    const mfgItem = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_B)!;

    assert.equal(pack.items.find((i) => i.id === ITEM_A)!.productCommercialClass, "STOCK");
    assert.equal(stockItem.requiresProduction, false);
    assert.notEqual(stockItem.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(stockItem.currentStage, "SHIPPED_COMPLETED");

    assert.equal(mfgItem.requiresProduction, true);
    assert.equal(mfgItem.productionOrderQuantity.eq(12), true);
    assert.equal(mfgItem.documentedQuantity.eq(8), true);
    assert.equal(mfgItem.invoicedQuantity.eq(8), true);
    assert.equal(mfgItem.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("O2C + DS do mesmo documento não duplica qty documentada", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-DEDUP",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM_A,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: EXT_PROD_A,
              skuSnapshot: "SKU",
              productNameSnapshot: "Prod",
              quantity: 10,
              nomusQuantityFulfilled: 0,
              nomusItemStatusRaw: "2",
              nomusItemStatusNormalized: "RELEASED",
            },
          ],
        },
      ],
      stockDocuments: [
        {
          id: "doc1",
          externalId: 8001,
          idNfe: 5001,
          statusRaw: "EMITIDO",
        },
      ],
      stockDocumentItems: [
        {
          id: "di1",
          stockDocumentId: "doc1",
          externalProductId: EXT_PROD_A,
          quantity: 10,
        },
      ],
      nfeLinks: [
        { id: "nl1", salesOrderId: ORDER, nfeExternalId: 5001, nfeStatus: 100 },
      ],
      allocations: [
        {
          auditKey: "o2c-doc-1",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM_A,
          stockDocumentExternalId: 8001,
          quantityUsedForOrder: 10,
        },
      ],
    });
    const pack = map.get(ORDER)!;
    const item = pack.items[0]!;
    const alloc = buildSalesOrderItemFlowAllocationsFromEvidence(pack, item);
    assert.equal(alloc.documentAllocations.length, 1);
    assert.equal(alloc.documentAllocations[0]!.quantity, 10);

    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_A)!;
    assert.equal(flow.documentedQuantity.eq(10), true);
  });

  it("DS sem NF conta documentado; NF via idNfe do DS sem SalesOrderNfeLink", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-DS-NF",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM_A,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: EXT_PROD_A,
              skuSnapshot: "SKU",
              productNameSnapshot: "Prod",
              quantity: 10,
              nomusQuantityFulfilled: 0,
              nomusItemStatusRaw: "2",
              nomusItemStatusNormalized: "RELEASED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "BOM_ONLY",
          hasProductRouting: false,
          hasProductBom: true,
        },
      ],
      nomusNfes: [{ id: "n1", externalId: 5002, status: 100 }],
      stockDocuments: [
        {
          id: "doc2",
          externalId: 8002,
          idNfe: 5002,
          statusRaw: "EMITIDO",
        },
      ],
      stockDocumentItems: [
        {
          id: "di2",
          stockDocumentId: "doc2",
          externalProductId: EXT_PROD_A,
          quantity: 10,
        },
      ],
      allocations: [
        {
          auditKey: "o2c-doc-only",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM_A,
          stockDocumentExternalId: 8002,
          quantityUsedForOrder: 10,
        },
      ],
    });
    const pack = map.get(ORDER)!;
    const alloc = buildSalesOrderItemFlowAllocationsFromEvidence(pack, pack.items[0]!);
    assert.equal(alloc.documentAllocations[0]!.quantity, 10);
    assert.equal(alloc.nfeAllocations.length, 1);
    assert.equal(alloc.nfeAllocations[0]!.nfeExternalId, 5002);
    assert.equal(alloc.nfeAllocations[0]!.quantity, 10);
    assert.equal(alloc.nfeAllocations[0]!.hasDocument, true);
  });

  it("DS emitido sem NF → WAITING_NFE (documentado parcial)", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-NO-NF",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM_A,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: EXT_PROD_A,
              skuSnapshot: "SKU",
              productNameSnapshot: "Prod",
              quantity: 10,
              nomusQuantityFulfilled: 0,
              nomusItemStatusRaw: "2",
              nomusItemStatusNormalized: "RELEASED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "BOM_ONLY",
          hasProductRouting: false,
          hasProductBom: false,
        },
      ],
      stockDocuments: [
        {
          id: "doc3",
          externalId: 8003,
          idNfe: null,
          statusRaw: "EMITIDO",
        },
      ],
      stockDocumentItems: [
        {
          id: "di3",
          stockDocumentId: "doc3",
          externalProductId: EXT_PROD_A,
          quantity: 10,
        },
      ],
      allocations: [
        {
          auditKey: "o2c-open-ds",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM_A,
          stockDocumentExternalId: 8003,
          quantityUsedForOrder: 10,
        },
      ],
    });
    const pack = map.get(ORDER)!;
    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_A)!;
    assert.equal(flow.requiresProduction, false);
    assert.equal(flow.documentedQuantity.eq(10), true);
    assert.equal(flow.invoicedQuantity.eq(0), true);
    assert.equal(flow.currentStage, "WAITING_NFE");
  });

  it("mesmo item fabricado: parte estoque (atendido) + residual exige OP", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-PARTIAL-STOCK",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM_PARTIAL,
              salesOrderId: ORDER,
              productId: "p-mfg",
              externalProductId: EXT_PROD_PARTIAL,
              skuSnapshot: "MFG",
              productNameSnapshot: "Misto",
              quantity: 100,
              nomusQuantityFulfilled: 40,
              nomusItemStatusRaw: "3",
              nomusItemStatusNormalized: "PARTIAL",
              nomusItemExternalId: 801,
            },
          ],
        },
      ],
      products: [
        {
          id: "p-mfg",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      nfeLinks: [
        { id: "nl2", salesOrderId: ORDER, nfeExternalId: 5003, nfeStatus: 100 },
      ],
      stockDocuments: [
        {
          id: "doc4",
          externalId: 8004,
          idNfe: 5003,
          statusRaw: "EMITIDO",
        },
      ],
      stockDocumentItems: [
        {
          id: "di4",
          stockDocumentId: "doc4",
          externalProductId: EXT_PROD_PARTIAL,
          quantity: 40,
        },
      ],
      allocations: [
        {
          auditKey: "o2c-partial",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM_PARTIAL,
          stockDocumentExternalId: 8004,
          nfeExternalId: 5003,
          quantityUsedForOrder: 40,
        },
      ],
    });
    const pack = map.get(ORDER)!;
    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_PARTIAL)!;

    assert.equal(flow.requiresProduction, true);
    assert.equal(flow.remainingFulfillmentQuantity.eq(60), true);
    assert.equal(flow.documentedQuantity.eq(40), true);
    assert.equal(flow.invoicedQuantity.eq(40), true);
    assert.equal(flow.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(flow.fulfilledWithoutProduction, false);

    const mapWithOp = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-PARTIAL-STOCK",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM_PARTIAL,
              salesOrderId: ORDER,
              productId: "p-mfg",
              externalProductId: EXT_PROD_PARTIAL,
              skuSnapshot: "MFG",
              productNameSnapshot: "Misto",
              quantity: 100,
              nomusQuantityFulfilled: 40,
              nomusItemStatusRaw: "3",
              nomusItemStatusNormalized: "PARTIAL",
              nomusItemExternalId: 801,
            },
          ],
        },
      ],
      products: [
        {
          id: "p-mfg",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      nfeLinks: [
        { id: "nl2", salesOrderId: ORDER, nfeExternalId: 5003, nfeStatus: 100 },
      ],
      stockDocuments: [
        {
          id: "doc4",
          externalId: 8004,
          idNfe: 5003,
          statusRaw: "EMITIDO",
        },
      ],
      stockDocumentItems: [
        {
          id: "di4",
          stockDocumentId: "doc4",
          externalProductId: EXT_PROD_PARTIAL,
          quantity: 40,
        },
      ],
      allocations: [
        {
          auditKey: "o2c-partial",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM_PARTIAL,
          stockDocumentExternalId: 8004,
          nfeExternalId: 5003,
          quantityUsedForOrder: 40,
        },
      ],
      productionLinks: [
        {
          id: "l2",
          productionOrderId: "op2",
          productionOrderExternalId: 2,
          salesOrderId: ORDER,
          salesOrderItemId: ITEM_PARTIAL,
          externalSalesOrderId: 1,
          externalSalesOrderItemId: 801,
          linkedQuantity: 60,
          isCurrent: true,
        },
      ],
      productionOrders: [{ id: "op2", externalId: 2, quantity: 60, status: "Liberada" }],
    });
    const flowWithOp = resolveSalesOrderItemFlowFromEvidence(
      mapWithOp.get(ORDER)!,
      ITEM_PARTIAL
    )!;
    assert.equal(flowWithOp.productionOrderQuantity.eq(60), true);
    assert.notEqual(flowWithOp.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(flowWithOp.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("SalesOrderNfeLink sem linha DS do item não aloca qty total do pedido", () => {
    const pack = mixedOrderPack().get(ORDER)!;
    const itemC = {
      ...pack.items[0]!,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff1",
      externalProductId: 9999,
      productId: "p-other",
    };
    const packExtra = {
      ...pack,
      items: [...pack.items, itemC],
    };
    const alloc = buildSalesOrderItemFlowAllocationsFromEvidence(packExtra, itemC);
    assert.equal(alloc.documentAllocations.length, 0);
    assert.equal(alloc.nfeAllocations.length, 0);
  });

  it("PD 02049-like: FULFILLED sem OP + SalesOrderNfeLink/DS → SHIPPED_COMPLETED (vínculos visíveis)", () => {
    const ORDER_STOCK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa02049";
    const ITEM_STOCK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb02049";
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER_STOCK,
          orderCode: "PD 02049",
          status: "SENT_TO_NOMUS",
          customerId: "c-netfiltros",
          expectedDeliveryDate: "2026-01-19",
          items: [
            {
              id: ITEM_STOCK,
              salesOrderId: ORDER_STOCK,
              productId: "p-stock",
              externalProductId: 777001,
              skuSnapshot: "FILTRO",
              productNameSnapshot: "Filtro",
              quantity: 15,
              nomusQuantityFulfilled: 15,
              nomusItemStatusRaw: "4",
              nomusItemStatusNormalized: "FULFILLED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p-stock",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      nfeLinks: [
        {
          id: "link-2049",
          salesOrderId: ORDER_STOCK,
          nfeExternalId: 92049,
          nfeNumber: "92049",
        },
      ],
      nomusNfes: [{ id: "nfe-2049", externalId: 92049, status: 100 }],
      stockDocuments: [
        {
          id: "ds-2049",
          externalId: 82049,
          idNfe: 92049,
          statusRaw: "EMITIDO",
          isCancelled: false,
        },
      ],
      // Sem linha DS por produto e sem O2C — só vínculo pedido↔NF↔DS.
      stockDocumentItems: [],
      allocations: [],
      productionLinks: [],
    });
    const pack = map.get(ORDER_STOCK)!;
    const alloc = buildSalesOrderItemFlowAllocationsFromEvidence(pack, pack.items[0]!);
    assert.ok(alloc.nfeAllocations.length >= 1, "NF do pedido deve ficar visível");
    assert.ok(alloc.documentAllocations.length >= 1, "DS via idNfe deve ficar visível");
    assert.equal(alloc.nfeAllocations[0]!.nfeExternalId, 92049);
    assert.equal(alloc.nfeAllocations[0]!.hasDocument, true);

    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_STOCK)!;
    assert.equal(flow.requiresProduction, true);
    assert.equal(flow.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(flow.fulfilledWithoutProduction, true);
    assert.equal(flow.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(flow.currentStage, "WAITING_PRODUCTION_ORDER");
  });
});
