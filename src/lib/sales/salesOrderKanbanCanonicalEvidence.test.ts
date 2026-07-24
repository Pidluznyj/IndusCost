/**
 * KAN-LINK-07 â€” Motor Kanban consome exclusivamente o grafo canÃ´nico.
 * Fixture genÃ©rica equivalente a PD 02757 (sem hardcode de estÃ¡gio final).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  resolveSalesOrderItemFlow,
  resolveSalesOrderItemFlowFromEvidence,
} from "./salesOrderItemFlowEngine.js";
import { buildSalesOrderItemFlowAllocationsFromEvidence } from "./salesOrderItemFlowAllocations.js";
import {
  adaptPackItemToMotorAllocations,
  buildSalesOrderOperationalEvidenceGraphFromPack,
  getSalesOrderOperationalEvidenceGraphFromPack,
} from "./salesOrderOperationalEvidenceFromPack.js";
import { buildSalesOrderFlowRecomputeDraft } from "./salesOrderFlowRecompute.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
  SALES_ORDER_FLOW_COMPUTATION_VERSION,
} from "./salesOrderFlowFingerprint.js";
import { adaptOperationalEvidenceItemToMotorAllocations } from "./salesOrderOperationalEvidenceGraph.js";

const ORDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
const ITEM_10 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10";
const ITEM_20 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb20";
const EXT_ORDER = 2757;
const EXT_ITEM_10 = 9010;
const EXT_ITEM_20 = 9020;
const EXT_PROD_10 = 5010;
const EXT_PROD_20 = 5020;

function pd02757EquivalentPack(options?: {
  withNfe?: boolean;
  fulfilled?: boolean;
}) {
  const withNfe = options?.withNfe !== false;
  const fulfilled = options?.fulfilled !== false;
  return assembleSalesOrderFlowEvidenceBatch({
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
            nomusQuantityFulfilled: fulfilled ? 114 : 0,
            nomusItemStatusRaw: fulfilled ? "4" : "1",
            nomusItemStatusNormalized: fulfilled ? "FULFILLED" : "RELEASED",
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
            nomusQuantityFulfilled: fulfilled ? 360 : 0,
            nomusItemStatusRaw: fulfilled ? "4" : "1",
            nomusItemStatusNormalized: fulfilled ? "FULFILLED" : "RELEASED",
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
    nfeLinks: withNfe
      ? [
          {
            id: "nl1",
            salesOrderId: ORDER,
            nfeExternalId: 9001,
            nfeNumber: "7394",
            nfeStatus: 100,
          },
        ]
      : [],
    nomusNfes: withNfe
      ? [
          {
            id: "nfe1",
            externalId: 9001,
            numero: "7394",
            serie: "2",
            status: 4,
          },
        ]
      : [],
    stockDocuments: [
      {
        id: "ds-4525",
        externalId: 4525,
        idNfe: withNfe ? 9001 : null,
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
  }).get(ORDER)!;
}

describe("KAN-LINK-07 â€” consumo exclusivo do grafo canÃ´nico", () => {
  it("pack â†’ grafo â†’ adapt Ã© a Ãºnica fonte de alocaÃ§Ãµes do motor", () => {
    const pack = pd02757EquivalentPack();
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const viaGraph = adaptOperationalEvidenceItemToMotorAllocations(
      graph,
      ITEM_10
    );
    const viaPack = adaptPackItemToMotorAllocations(pack, ITEM_10);
    const viaAlloc = buildSalesOrderItemFlowAllocationsFromEvidence(
      pack,
      pack.items.find((i) => i.id === ITEM_10)!
    );

    assert.deepEqual(viaPack.documentAllocations, viaGraph.documentAllocations);
    assert.deepEqual(viaPack.nfeAllocations, viaGraph.nfeAllocations);
    assert.deepEqual(
      viaAlloc.documentAllocations,
      viaGraph.documentAllocations
    );
    assert.deepEqual(viaAlloc.nfeAllocations, viaGraph.nfeAllocations);
    assert.ok(graph.reconciliation.items.length === 2);
  });

  it("fixture PD 02757: DS 4525 + NF 7394/2 cobrem itens 00010 e 00020 sem Aguardando DS", () => {
    const pack = pd02757EquivalentPack();
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
    // EstÃ¡gio final depende das evidÃªncias (nÃ£o hardcode de pedido).
    assert.equal(order.currentStage, flow10.currentStage);
  });

  it("pedido genÃ©rico equivalente sem hardcode de cÃ³digo", () => {
    const pack = pd02757EquivalentPack();
    // Troca sÃ³ o cÃ³digo â€” mesma lÃ³gica.
    const generic = {
      ...pack,
      order: { ...pack.order, orderCode: "PD 99999" },
    };
    const flow = resolveSalesOrderItemFlowFromEvidence(generic, ITEM_10)!;
    assert.equal(flow.documentedQuantity.eq(114), true);
    assert.notEqual(flow.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("mÃºltiplos itens: gargalo = estÃ¡gio mais anterior pendente", () => {
    const pack = pd02757EquivalentPack({ withNfe: false, fulfilled: false });
    // Item 20 sem cobertura documental (remove linha).
    const trimmed = {
      ...pack,
      stockDocumentItems: pack.stockDocumentItems.filter(
        (i) => i.id === "dsi-10"
      ),
    };
    // Invalidate cache by cloning pack object.
    const pack2 = { ...trimmed };
    const a = resolveSalesOrderItemFlowFromEvidence(pack2, ITEM_10)!;
    const b = resolveSalesOrderItemFlowFromEvidence(pack2, ITEM_20)!;
    assert.equal(a.documentedQuantity.eq(114), true);
    assert.equal(b.documentedQuantity.eq(0), true);
    const order = resolveSalesOrderFlow([a, b], {
      salesOrderId: ORDER,
      orderStatus: "SENT_TO_NOMUS",
    });
    assert.ok(order.currentBottleneck);
    assert.equal(order.currentBottleneck!.salesOrderItemId, ITEM_20);
  });

  it("parcial / corte / sem OP / DS parcial / NF parcial / envio completo", () => {
    // Parcial
    const partial = resolveSalesOrderItemFlow({
      salesOrderItemId: ITEM_10,
      statusNormalized: "PARTIAL",
      orderedQuantity: 100,
      fulfilledQuantity: 40,
      productionOrderLinks: [{ linkedQuantity: 60, isCurrent: true }],
      documentAllocations: [{ allocationKey: "d", quantity: 40 }],
      nfeAllocations: [],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(partial.remainingFulfillmentQuantity.eq(60), true);
    assert.equal(partial.isActiveForKanban, true);

    // Corte
    const cut = resolveSalesOrderItemFlow({
      salesOrderItemId: ITEM_10,
      statusNormalized: "FULFILLED_WITH_CUT",
      orderedQuantity: 100,
      fulfilledQuantity: 70,
      nomusIsCut: true,
      documentAllocations: [{ allocationKey: "d", quantity: 70 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 70,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductBom: true,
    });
    assert.equal(cut.cutQuantity.eq(30), true);
    assert.equal(cut.currentStage, "SHIPPED_COMPLETED");

    // Sem OP + NF
    const noOp = resolveSalesOrderItemFlow({
      salesOrderItemId: ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 10,
      fulfilledQuantity: 10,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 10 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 10,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductBom: true,
      hasProductRouting: true,
    });
    assert.notEqual(noOp.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(noOp.currentStage, "SHIPPED_COMPLETED");

    // Documento cancelado nÃ£o cobre (histÃ³rico); qty documentada = 0.
    const canceledDoc = resolveSalesOrderItemFlow({
      salesOrderItemId: ITEM_10,
      statusNormalized: "RELEASED",
      orderedQuantity: 10,
      documentAllocations: [
        { allocationKey: "c", quantity: 10, isCanceled: true, isValid: false },
      ],
      nfeAllocations: [],
      productCommercialClass: "STOCK",
      hasProductBom: true,
      hasProductRouting: false,
      explicitRequiresProduction: false,
    });
    assert.equal(canceledDoc.documentedQuantity.eq(0), true);
    assert.notEqual(canceledDoc.currentStage, "SHIPPED_COMPLETED");
    assert.equal(canceledDoc.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("nenhuma regressÃ£o terminal: SHIPPED nÃ£o volta por ausÃªncia de OP", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 100,
      fulfilledQuantity: 100,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 100 }],
      nfeAllocations: [
        {
          nfeExternalId: 9,
          quantity: 100,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("fingerprint determinÃ­stico e computationVersion v2", () => {
    assert.equal(SALES_ORDER_FLOW_COMPUTATION_VERSION, "sales-order-flow/v2");
    const pack = pd02757EquivalentPack();
    const item = resolveSalesOrderItemFlowFromEvidence(pack, ITEM_10)!;
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: ORDER,
      orderStatus: pack.order.status,
    });
    const fp1 = buildSalesOrderItemFlowFingerprint(item);
    const fp2 = buildSalesOrderItemFlowFingerprint(item);
    assert.equal(fp1, fp2);

    const draftA = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: ORDER,
      itemResults: [item],
      orderResult: order,
      existingItems: [],
      computedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const draftB = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: ORDER,
      itemResults: [item],
      orderResult: order,
      existingItems: [],
      computedAt: new Date("2026-07-22T23:00:00.000Z"),
    });
    assert.equal(draftA.orderWrite.fingerprint, draftB.orderWrite.fingerprint);
    assert.equal(
      draftA.orderWrite.computationVersion,
      SALES_ORDER_FLOW_COMPUTATION_VERSION
    );
    assert.ok(draftA.orderWrite.bottleneckSalesOrderItemId === null ||
      /^[0-9a-f-]{36}$/i.test(draftA.orderWrite.bottleneckSalesOrderItemId));

    const orderFp = buildSalesOrderFlowFingerprint(order, [fp1]);
    assert.equal(orderFp.length, 64);
  });

  it("snapshot draft persiste campos de gargalo e progresso", () => {
    const pack = pd02757EquivalentPack();
    const items = pack.items.map(
      (i) => resolveSalesOrderItemFlowFromEvidence(pack, i.id)!
    );
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: ORDER,
      orderStatus: pack.order.status,
    });
    const draft = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: ORDER,
      itemResults: items,
      orderResult: order,
      existingItems: [],
      computedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const w = draft.orderWrite;
    assert.ok(w.currentStage);
    assert.ok(w.bottleneckStage);
    assert.ok(typeof w.nextAction === "string");
    assert.ok(typeof w.responsibleArea === "string");
    assert.ok(w.progressDocumented != null);
    assert.ok(w.progressInvoiced != null);
    assert.ok(w.progressShipped != null);
    assert.ok(w.fingerprint);
    assert.equal(w.computationVersion, SALES_ORDER_FLOW_COMPUTATION_VERSION);
  });

  it("grafo fromPack expÃµe reconciliaÃ§Ã£o sem recalcular estÃ¡gio no FE", () => {
    const pack = pd02757EquivalentPack();
    const graph = buildSalesOrderOperationalEvidenceGraphFromPack(pack);
    const item = graph.items.find((i) => i.salesOrderItemId === ITEM_10)!;
    assert.ok(item.reconciliation.linkStatus);
    assert.ok(item.reconciliation.coverageStatus);
    assert.ok(item.reconciliation.operationalEvidenceTimeline.length > 0);
    assert.equal(item.coverage.documentedQuantity, 114);
  });
});

