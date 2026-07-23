/**
 * KAN-LINK-05 — Resolvedor canônico OP → Pedido/item.
 * Sem exceção por pedido na lógica (PD só em comentário/fixture).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  assessProductionOrderCoverage,
  buildProductionOrderAuditAlert,
  buildProductionOrderLinksForItemFlow,
  extractProductionOrderLabelOrderCodes,
  isProductionOrderStatusCanceled,
  resolveSalesOrderProductionOrderLinks,
  sumProductionCoverageQuantity,
} from "./salesOrderProductionOrderLinkResolver.js";

const ORDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa55";
const ORDER_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa66";
const ITEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb55";
const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb66";
const EXT_ORDER = 2757;
const EXT_ITEM = 9010;

const baseItems = [
  {
    id: ITEM,
    salesOrderId: ORDER,
    externalSalesOrderId: EXT_ORDER,
    orderCodeNormalized: "PD02757",
    nomusItemExternalId: EXT_ITEM,
    nomusItemSequence: "00010",
    externalProductId: 100,
  },
];

function candidate(
  partial: Partial<Parameters<typeof resolveSalesOrderProductionOrderLinks>[0]["candidates"][number]> & {
    productionOrderExternalId: number;
  }
) {
  return {
    id: `link-${partial.productionOrderExternalId}`,
    productionOrderId: `op-${partial.productionOrderExternalId}`,
    productionOrderExternalId: partial.productionOrderExternalId,
    salesOrderId:
      partial.salesOrderId !== undefined ? partial.salesOrderId : ORDER,
    salesOrderItemId:
      partial.salesOrderItemId !== undefined ? partial.salesOrderItemId : ITEM,
    externalSalesOrderId:
      partial.externalSalesOrderId !== undefined
        ? partial.externalSalesOrderId
        : EXT_ORDER,
    externalSalesOrderItemId:
      partial.externalSalesOrderItemId !== undefined
        ? partial.externalSalesOrderItemId
        : EXT_ITEM,
    itemNumber: partial.itemNumber !== undefined ? partial.itemNumber : "00010",
    linkedQuantity:
      partial.linkedQuantity !== undefined ? partial.linkedQuantity : 100,
    isCurrent: partial.isCurrent !== undefined ? partial.isCurrent : true,
    productionOrderStatus:
      partial.productionOrderStatus !== undefined
        ? partial.productionOrderStatus
        : "Liberada",
    productionOrderName:
      partial.productionOrderName !== undefined
        ? partial.productionOrderName
        : null,
    rawJson: partial.rawJson,
  };
}

describe("salesOrderProductionOrderLinkResolver — campos e etiqueta", () => {
  it("detecta OP cancelada", () => {
    assert.equal(isProductionOrderStatusCanceled("Cancelada"), true);
    assert.equal(isProductionOrderStatusCanceled("Encerrada"), false);
  });

  it("etiqueta inequívoca vs ambígua", () => {
    const one = extractProductionOrderLabelOrderCodes({
      name: "OP 05800 - PD 02757",
    });
    assert.equal(one.unambiguous, "PD02757");
    assert.equal(one.ambiguous, false);

    const many = extractProductionOrderLabelOrderCodes({
      name: "OP misturada PD 02757 / PD 02000",
    });
    assert.equal(many.ambiguous, true);
    assert.equal(many.unambiguous, null);
  });

  it("alerta de mesmo produto nunca prova vínculo", () => {
    const alert = buildProductionOrderAuditAlert(
      "SAME_PRODUCT",
      "mesmo produto em pedidos distintos"
    );
    assert.equal(alert.provesLink, false);
  });
});

describe("salesOrderProductionOrderLinkResolver — resolução", () => {
  it("vínculo direto por idPedido + idItemPedido", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [candidate({ productionOrderExternalId: 1, linkedQuantity: 600 })],
    });
    assert.equal(resolved[0]!.sourceType, "DIRECT_ORDER_ITEM_REFERENCE");
    assert.equal(resolved[0]!.advancesKanban, true);
    assert.equal(resolved[0]!.linkedQuantity, 600);
  });

  it("vínculo por item (idItem) com pedido oficial", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [
        candidate({
          productionOrderExternalId: 2,
          externalSalesOrderItemId: EXT_ITEM,
          linkedQuantity: 50,
        }),
      ],
    });
    assert.equal(resolved[0]!.itemCoverage, "RESOLVED");
    assert.equal(resolved[0]!.salesOrderItemId, ITEM);
  });

  it("etiqueta inequívoca + número de item resolve", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: null,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [
        candidate({
          productionOrderExternalId: 3,
          externalSalesOrderId: 99999,
          externalSalesOrderItemId: 88888,
          salesOrderId: null,
          salesOrderItemId: null,
          itemNumber: "00010",
          productionOrderName: "OP 01000 - PD 02757",
          linkedQuantity: 40,
        }),
      ],
    });
    assert.equal(resolved[0]!.sourceType, "PRODUCTION_ORDER_REFERENCE");
    assert.equal(resolved[0]!.advancesKanban, true);
  });

  it("etiqueta ambígua não avança", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: null,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [
        candidate({
          productionOrderExternalId: 4,
          externalSalesOrderId: 1,
          externalSalesOrderItemId: 2,
          salesOrderId: null,
          salesOrderItemId: null,
          productionOrderName: "PD 02757 e PD 02000",
        }),
      ],
    });
    assert.equal(resolved[0]!.sourceType, "AMBIGUOUS");
    assert.equal(resolved[0]!.advancesKanban, false);
  });

  it("OP parcial: cobertura PARTIAL e waiting=true", () => {
    const assessment = assessProductionOrderCoverage({
      orderedQuantity: 1000,
      cutQuantity: 0,
      canceledQuantity: 0,
      fulfilledQuantity: 400,
      productionCoveredQuantity: 300,
      requiresProduction: true,
    });
    assert.equal(assessment.remainingFulfillment, 600);
    assert.equal(assessment.coverage, "PARTIAL");
    assert.equal(assessment.waitingProductionOrder, true);
  });

  it("OP de 600 no residual 600: cobertura SUFFICIENT", () => {
    const assessment = assessProductionOrderCoverage({
      orderedQuantity: 1000,
      cutQuantity: 0,
      canceledQuantity: 0,
      fulfilledQuantity: 400,
      productionCoveredQuantity: 600,
      requiresProduction: true,
    });
    assert.equal(assessment.coverage, "SUFFICIENT");
    assert.equal(assessment.waitingProductionOrder, false);
  });

  it("várias OPs somam cobertura", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [
        candidate({ productionOrderExternalId: 10, linkedQuantity: 200 }),
        candidate({ productionOrderExternalId: 11, linkedQuantity: 400 }),
      ],
    });
    assert.equal(sumProductionCoverageQuantity(resolved), 600);
  });

  it("OP cancelada não cobre", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [
        candidate({
          productionOrderExternalId: 12,
          linkedQuantity: 600,
          productionOrderStatus: "Cancelada",
        }),
      ],
    });
    assert.equal(resolved[0]!.isCanceled, true);
    assert.equal(resolved[0]!.advancesKanban, false);
    assert.equal(sumProductionCoverageQuantity(resolved), 0);
  });

  it("ausência de vínculo", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: baseItems,
      targetItemId: ITEM,
      candidates: [
        candidate({
          productionOrderExternalId: 13,
          externalSalesOrderId: 999,
          externalSalesOrderItemId: 998,
          salesOrderId: null,
          salesOrderItemId: null,
          itemNumber: null,
          productionOrderName: null,
        }),
      ],
    });
    assert.equal(resolved[0]!.sourceType, "UNRESOLVED");
    assert.equal(resolved[0]!.advancesKanban, false);
  });

  it("produto igual em pedidos diferentes não prova vínculo", () => {
    const resolved = resolveSalesOrderProductionOrderLinks({
      salesOrderId: ORDER,
      externalSalesOrderId: EXT_ORDER,
      orderCodeNormalized: "PD02757",
      items: [
        ...baseItems,
        {
          id: ITEM_B,
          salesOrderId: ORDER_B,
          externalSalesOrderId: 9999,
          orderCodeNormalized: "PD09999",
          nomusItemExternalId: 7777,
          nomusItemSequence: "00010",
          externalProductId: 100,
        },
      ],
      targetItemId: ITEM,
      candidates: [
        candidate({
          productionOrderExternalId: 14,
          externalSalesOrderId: 9999,
          externalSalesOrderItemId: 7777,
          salesOrderId: ORDER_B,
          salesOrderItemId: ITEM_B,
          linkedQuantity: 100,
        }),
      ],
    });
    assert.equal(resolved[0]!.advancesKanban, false);
    assert.notEqual(resolved[0]!.salesOrderItemId, ITEM);
  });
});

describe("KAN-LINK-05 — integração pack/motor", () => {
  it("atendimento integral sem OP → não Aguardando OP", () => {
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
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: 100,
              nomusItemExternalId: EXT_ITEM,
              nomusItemSequence: "00010",
              quantity: 100,
              nomusQuantityFulfilled: 100,
              nomusItemStatusNormalized: "FULFILLED",
              nomusItemStatusRaw: "4",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      nfeLinks: [{ id: "nl", salesOrderId: ORDER, nfeExternalId: 1, nfeStatus: 100 }],
      nomusNfes: [{ id: "n1", externalId: 1, status: 4 }],
      stockDocuments: [
        { id: "d1", externalId: 1, idNfe: 1, statusRaw: "emitido" },
      ],
      stockDocumentItems: [
        {
          id: "di1",
          stockDocumentId: "d1",
          externalProductId: 100,
          quantity: 100,
          externalSalesOrderItemId: EXT_ITEM,
          externalSalesOrderId: EXT_ORDER,
        },
      ],
      productionLinks: [],
    });
    const flow = resolveSalesOrderItemFlowFromEvidence(map.get(ORDER)!, ITEM)!;
    assert.equal(flow.remainingFulfillmentQuantity.eq(0), true);
    assert.notEqual(flow.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(flow.currentStage, "SHIPPED_COMPLETED");
  });

  it("documento/NF posterior sem OP prevalece sobre Aguardando OP", () => {
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
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: 100,
              nomusItemExternalId: EXT_ITEM,
              nomusItemSequence: "00010",
              quantity: 50,
              nomusQuantityFulfilled: 50,
              nomusItemStatusNormalized: "FULFILLED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      nfeLinks: [{ id: "nl", salesOrderId: ORDER, nfeExternalId: 9 }],
      nomusNfes: [{ id: "n9", externalId: 9, status: 4 }],
      stockDocuments: [
        { id: "d9", externalId: 9, idNfe: 9, statusRaw: "emitido" },
      ],
      stockDocumentItems: [
        {
          id: "di9",
          stockDocumentId: "d9",
          externalProductId: 100,
          quantity: 50,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM,
        },
      ],
    });
    const flow = resolveSalesOrderItemFlowFromEvidence(map.get(ORDER)!, ITEM)!;
    assert.notEqual(flow.currentStage, "WAITING_PRODUCTION_ORDER");
    const order = resolveSalesOrderFlow([flow], { salesOrderId: ORDER });
    assert.notEqual(order.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("OP parcial no residual mantém WAITING_PRODUCTION_ORDER com cobertura parcial", () => {
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
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: 100,
              nomusItemExternalId: EXT_ITEM,
              nomusItemSequence: "00010",
              quantity: 1000,
              nomusQuantityFulfilled: 400,
              nomusItemStatusNormalized: "PARTIAL",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      productionLinks: [
        {
          id: "pl1",
          productionOrderId: "op1",
          productionOrderExternalId: 55,
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM,
          itemNumber: "00010",
          linkedQuantity: 300,
          isCurrent: true,
        },
      ],
      productionOrders: [
        { id: "op1", externalId: 55, status: "Liberada", quantity: 300 },
      ],
    });
    const pack = map.get(ORDER)!;
    const { resolved, motorLinks } = buildProductionOrderLinksForItemFlow(
      pack,
      ITEM
    );
    assert.equal(sumProductionCoverageQuantity(resolved), 300);
    assert.equal(motorLinks.length, 1);

    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM)!;
    assert.equal(flow.remainingFulfillmentQuantity.eq(600), true);
    assert.equal(flow.productionOrderQuantity.eq(300), true);
    assert.equal(flow.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.match(flow.stageReason, /parcial|complementar|insuficiente/i);
  });

  it("OP cancelada no pack não entra no motor", () => {
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
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: 100,
              nomusItemExternalId: EXT_ITEM,
              quantity: 100,
              nomusQuantityFulfilled: 0,
              nomusItemStatusNormalized: "RELEASED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      productionLinks: [
        {
          id: "pl-c",
          productionOrderId: "op-c",
          productionOrderExternalId: 70,
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM,
          linkedQuantity: 100,
          isCurrent: true,
        },
      ],
      productionOrders: [
        { id: "op-c", externalId: 70, status: "Cancelada", quantity: 100 },
      ],
    });
    const flow = resolveSalesOrderItemFlowFromEvidence(map.get(ORDER)!, ITEM)!;
    assert.equal(flow.productionOrderQuantity.eq(0), true);
    assert.equal(flow.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("link por externalSalesOrderId entra no pack mesmo sem FK local", () => {
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
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              externalProductId: 100,
              nomusItemExternalId: EXT_ITEM,
              quantity: 80,
              nomusQuantityFulfilled: 0,
              nomusItemStatusNormalized: "RELEASED",
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      productionLinks: [
        {
          id: "pl-ext",
          productionOrderId: "op-x",
          productionOrderExternalId: 80,
          salesOrderId: null,
          salesOrderItemId: null,
          externalSalesOrderId: EXT_ORDER,
          externalSalesOrderItemId: EXT_ITEM,
          linkedQuantity: 80,
          isCurrent: true,
        },
      ],
      productionOrders: [
        { id: "op-x", externalId: 80, status: "Liberada", quantity: 80 },
      ],
    });
    const pack = map.get(ORDER)!;
    assert.equal(pack.productionLinks.length, 1);
    const flow = resolveSalesOrderItemFlowFromEvidence(pack, ITEM)!;
    assert.equal(flow.productionOrderQuantity.eq(80), true);
    assert.notEqual(flow.currentStage, "WAITING_PRODUCTION_ORDER");
  });
});
