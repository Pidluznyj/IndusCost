/**
 * KAN-LINK-04 — Resolvedor canônico DS → Pedido/item.
 * Fixture genérica equivalente ao caso PD 02757 (nome só em comentário/teste).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.js";
import { buildSalesOrderItemFlowAllocationsFromEvidence } from "./salesOrderItemFlowAllocations.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  extractOutputDocumentOrderRefsFromRaw,
  normalizeOutputDocumentOrderCode,
  resolveOutputDocumentLineLinks,
  sumDocumentedQuantityBySalesOrderItem,
} from "./salesOrderOutputDocumentLinkResolver.js";

const ORDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
const ITEM_10 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10";
const ITEM_20 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb20";
const EXT_ORDER = 2757;
const EXT_ITEM_10 = 9010;
const EXT_ITEM_20 = 9020;
const EXT_PROD_10 = 5010;
const EXT_PROD_20 = 5020;

describe("salesOrderOutputDocumentLinkResolver — extração", () => {
  it("extrai idPedido / idItemPedido / sequência oficiais", () => {
    const refs = extractOutputDocumentOrderRefsFromRaw({
      idPedido: EXT_ORDER,
      codigoPedido: "PD 02757",
      idItemPedido: EXT_ITEM_10,
      item: "00010",
      idProduto: EXT_PROD_10,
      unidade: "UN",
      qtde: "114.000",
    });
    assert.equal(refs.externalSalesOrderId, EXT_ORDER);
    assert.equal(refs.orderCodeNormalized, "PD02757");
    assert.equal(refs.externalSalesOrderItemId, EXT_ITEM_10);
    assert.equal(refs.salesOrderItemSequence, "00010");
    assert.equal(refs.externalProductId, EXT_PROD_10);
    assert.equal(refs.unitCode, "UN");
  });

  it("normalizeOutputDocumentOrderCode", () => {
    assert.equal(normalizeOutputDocumentOrderCode("PD 02757"), "PD02757");
    assert.equal(normalizeOutputDocumentOrderCode("pd-02757"), "PD02757");
    assert.equal(normalizeOutputDocumentOrderCode("x"), null);
  });
});

describe("salesOrderOutputDocumentLinkResolver — resolução", () => {
  const items = [
    {
      id: ITEM_10,
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      nomusItemExternalId: EXT_ITEM_10,
      nomusItemSequence: "00010",
      externalProductId: EXT_PROD_10,
    },
    {
      id: ITEM_20,
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      nomusItemExternalId: EXT_ITEM_20,
      nomusItemSequence: "00020",
      externalProductId: EXT_PROD_20,
    },
  ];

  it("vínculo direto por idItemPedido (sem exigir NF)", () => {
    const links = resolveOutputDocumentLineLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items,
      documents: [
        {
          id: "ds1",
          externalId: 4525,
          idNfe: null,
          isCancelled: false,
          statusRaw: "emitido",
        },
      ],
      lines: [
        {
          id: "line-10",
          stockDocumentId: "ds1",
          stockDocumentExternalId: 4525,
          externalProductId: EXT_PROD_10,
          quantity: 114,
          refs: extractOutputDocumentOrderRefsFromRaw({
            idPedido: EXT_ORDER,
            idItemPedido: EXT_ITEM_10,
            item: "00010",
          }),
        },
        {
          id: "line-20",
          stockDocumentId: "ds1",
          stockDocumentExternalId: 4525,
          externalProductId: EXT_PROD_20,
          quantity: 360,
          refs: extractOutputDocumentOrderRefsFromRaw({
            idPedido: EXT_ORDER,
            idItemPedido: EXT_ITEM_20,
            item: "00020",
          }),
        },
      ],
    });
    assert.equal(links.length, 2);
    assert.equal(links[0]!.salesOrderItemId, ITEM_10);
    assert.equal(links[0]!.quantity, 114);
    assert.equal(links[0]!.advancesKanban, true);
    assert.equal(links[0]!.sourceType, "DIRECT_ORDER_ITEM_REFERENCE");
    assert.equal(links[1]!.salesOrderItemId, ITEM_20);
    assert.equal(links[1]!.quantity, 360);
    const byItem = sumDocumentedQuantityBySalesOrderItem(links);
    assert.equal(byItem.get(ITEM_10), 114);
    assert.equal(byItem.get(ITEM_20), 360);
  });

  it("produto ambíguo no pedido não distribui quantidade", () => {
    const sameProductItems = [
      { ...items[0]!, externalProductId: 999 },
      { ...items[1]!, externalProductId: 999 },
    ];
    const links = resolveOutputDocumentLineLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: sameProductItems,
      documents: [
        {
          id: "ds1",
          externalId: 1,
          idNfe: 10,
          linkedViaSalesOrderNfeLink: true,
          isCancelled: false,
        },
      ],
      lines: [
        {
          id: "line-x",
          stockDocumentId: "ds1",
          stockDocumentExternalId: 1,
          externalProductId: 999,
          quantity: 50,
          refs: {
            externalSalesOrderId: EXT_ORDER,
            orderCode: null,
            orderCodeNormalized: "PD02757",
            externalSalesOrderItemId: null,
            salesOrderItemSequence: null,
            externalProductId: 999,
            unitCode: null,
            descriptionHintOrderCode: null,
          },
        },
      ],
    });
    assert.equal(links[0]!.itemCoverage, "AMBIGUOUS");
    assert.equal(links[0]!.advancesKanban, false);
    assert.equal(sumDocumentedQuantityBySalesOrderItem(links).size, 0);
  });

  it("documento multi-pedido: só linhas do pedido em escopo avançam", () => {
    const links = resolveOutputDocumentLineLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items,
      documents: [
        {
          id: "ds-multi",
          externalId: 99,
          idNfe: null,
          isCancelled: false,
        },
      ],
      lines: [
        {
          id: "ours",
          stockDocumentId: "ds-multi",
          stockDocumentExternalId: 99,
          externalProductId: EXT_PROD_10,
          quantity: 114,
          refs: extractOutputDocumentOrderRefsFromRaw({
            idPedido: EXT_ORDER,
            idItemPedido: EXT_ITEM_10,
          }),
        },
        {
          id: "theirs",
          stockDocumentId: "ds-multi",
          stockDocumentExternalId: 99,
          externalProductId: 888,
          quantity: 5,
          refs: extractOutputDocumentOrderRefsFromRaw({
            idPedido: 9999,
            idItemPedido: 111,
          }),
        },
      ],
    });
    const ours = links.find((l) => l.stockDocumentItemId === "ours")!;
    const theirs = links.find((l) => l.stockDocumentItemId === "theirs")!;
    assert.equal(ours.advancesKanban, true);
    assert.equal(theirs.advancesKanban, false);
    assert.equal(theirs.itemCoverage, "UNRESOLVED");
  });

  it("documento cancelado não avança", () => {
    const links = resolveOutputDocumentLineLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items,
      documents: [
        {
          id: "ds-c",
          externalId: 1,
          idNfe: null,
          isCancelled: true,
        },
      ],
      lines: [
        {
          id: "l1",
          stockDocumentId: "ds-c",
          stockDocumentExternalId: 1,
          externalProductId: EXT_PROD_10,
          quantity: 114,
          refs: extractOutputDocumentOrderRefsFromRaw({
            idPedido: EXT_ORDER,
            idItemPedido: EXT_ITEM_10,
          }),
        },
      ],
    });
    assert.equal(links[0]!.documentValidity, "CANCELLED");
    assert.equal(links[0]!.advancesKanban, false);
  });
});

describe("KAN-LINK-04 — regressão fixture (equivalente PD 02757)", () => {
  /**
   * Pedido com dois itens (00010=114, 00020=360), DS 4525 válido,
   * NF autorizada, linhas com idItemPedido — sem hardcode na lógica.
   */
  it("reconhece DS por item, qty correta, sem dupla contagem, não fica Aguardando DS", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD 02757",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          externalSalesOrderId: EXT_ORDER,
          expectedDeliveryDate: null,
          totalNetValue: 12650.4,
          items: [
            {
              id: ITEM_10,
              salesOrderId: ORDER,
              productId: "p10",
              externalProductId: EXT_PROD_10,
              nomusItemExternalId: EXT_ITEM_10,
              nomusItemSequence: "00010",
              skuSnapshot: "A",
              productNameSnapshot: "Item 10",
              quantity: 114,
              nomusQuantityFulfilled: 114,
              nomusItemStatusRaw: "4",
              nomusItemStatusNormalized: "FULFILLED",
            },
            {
              id: ITEM_20,
              salesOrderId: ORDER,
              productId: "p20",
              externalProductId: EXT_PROD_20,
              nomusItemExternalId: EXT_ITEM_20,
              nomusItemSequence: "00020",
              skuSnapshot: "B",
              productNameSnapshot: "Item 20",
              quantity: 360,
              nomusQuantityFulfilled: 360,
              nomusItemStatusRaw: "4",
              nomusItemStatusNormalized: "FULFILLED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p10",
          type: "PRODUCT",
          costingMode: "BOM_ONLY",
          hasProductRouting: false,
          hasProductBom: true,
        },
        {
          id: "p20",
          type: "PRODUCT",
          costingMode: "BOM_ONLY",
          hasProductRouting: false,
          hasProductBom: true,
        },
      ],
      nfeLinks: [
        {
          id: "nl1",
          salesOrderId: ORDER,
          nfeExternalId: 9001,
          nfeNumber: "7394",
          nfeStatus: 100,
        },
      ],
      nomusNfes: [
        {
          id: "nfe1",
          externalId: 9001,
          numero: "7394",
          serie: "2",
          status: 4,
        },
      ],
      stockDocuments: [
        {
          id: "ds-4525",
          externalId: 4525,
          idNfe: 9001,
          statusRaw: "emitido",
          isCancelled: false,
          externalSalesOrderId: EXT_ORDER,
          orderCodeNormalized: "PD02757",
          totalValue: 12650.4,
        },
      ],
      stockDocumentItems: [
        {
          id: "dsi-10",
          stockDocumentId: "ds-4525",
          externalProductId: EXT_PROD_10,
          quantity: 114,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM_10,
          salesOrderItemSequence: "00010",
          orderCodeNormalized: "PD02757",
        },
        {
          id: "dsi-20",
          stockDocumentId: "ds-4525",
          externalProductId: EXT_PROD_20,
          quantity: 360,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM_20,
          salesOrderItemSequence: "00020",
          orderCodeNormalized: "PD02757",
        },
      ],
    });

    const pack = map.get(ORDER)!;
    assert.equal(pack.stockDocuments.length, 1);
    assert.equal(pack.stockDocuments[0]!.externalId, 4525);

    const alloc10 = buildSalesOrderItemFlowAllocationsFromEvidence(
      pack,
      pack.items.find((i) => i.id === ITEM_10)!
    );
    const alloc20 = buildSalesOrderItemFlowAllocationsFromEvidence(
      pack,
      pack.items.find((i) => i.id === ITEM_20)!
    );

    const docQty10 = alloc10.documentAllocations
      .filter((d) => d.isValid !== false && d.isCanceled !== true)
      .reduce((s, d) => s + Number(d.quantity), 0);
    const docQty20 = alloc20.documentAllocations
      .filter((d) => d.isValid !== false && d.isCanceled !== true)
      .reduce((s, d) => s + Number(d.quantity), 0);
    assert.equal(docQty10, 114);
    assert.equal(docQty20, 360);

    const flow10 = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_10)!;
    const flow20 = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_20)!;
    assert.equal(flow10.documentedQuantity.eq(114), true);
    assert.equal(flow20.documentedQuantity.eq(360), true);
    assert.equal(flow10.invoicedQuantity.eq(114), true);
    assert.equal(flow20.invoicedQuantity.eq(360), true);
    assert.notEqual(flow10.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.notEqual(flow20.currentStage, "WAITING_OUTPUT_DOCUMENT");

    const order = resolveSalesOrderFlow([flow10, flow20], {
      salesOrderId: ORDER,
      orderStatus: pack.order.status,
    });
    assert.notEqual(order.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
  });

  it("DS com ref direta entra no pack sem SalesOrderNfeLink", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD02757",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          externalSalesOrderId: EXT_ORDER,
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM_10,
              salesOrderId: ORDER,
              productId: "p10",
              externalProductId: EXT_PROD_10,
              nomusItemExternalId: EXT_ITEM_10,
              nomusItemSequence: "00010",
              quantity: 114,
              nomusQuantityFulfilled: 0,
              nomusItemStatusNormalized: "RELEASED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p10",
          type: "PRODUCT",
          costingMode: "BOM_ONLY",
          hasProductRouting: false,
          hasProductBom: true,
        },
      ],
      stockDocuments: [
        {
          id: "ds-only",
          externalId: 4525,
          idNfe: null,
          statusRaw: "emitido",
          externalSalesOrderId: EXT_ORDER,
        },
      ],
      stockDocumentItems: [
        {
          id: "dsi-only",
          stockDocumentId: "ds-only",
          externalProductId: EXT_PROD_10,
          quantity: 114,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM_10,
          salesOrderItemSequence: "00010",
        },
      ],
    });
    const pack = map.get(ORDER)!;
    assert.equal(pack.stockDocuments.length, 1);
    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_10)!;
    assert.equal(flow.documentedQuantity.eq(114), true);
    assert.notEqual(flow.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });
});
