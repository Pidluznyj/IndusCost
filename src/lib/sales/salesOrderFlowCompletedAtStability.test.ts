/**
 * OP-04 — completedAt e fingerprint determinísticos para pedidos concluídos.
 * Fixture sintética equivalente ao PD 02596 (sem orderCode real em produção).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  resolveSalesOrderItemFlow,
  type ResolveSalesOrderItemFlowInput,
} from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
} from "./salesOrderFlowFingerprint.js";
import {
  buildSalesOrderFlowRecomputeDraft,
  planSalesOrderFlowRecompute,
} from "./salesOrderFlowRecompute.js";
import {
  buildSalesOrderFlowCompletionContextFromPack,
  resolveSalesOrderFlowCompletedAt,
} from "./salesOrderFlowCompletionDates.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";

const D = (v: string | number) => new Prisma.Decimal(v);
const DOC_AT = "2026-06-17T19:49:48.000Z";
const NFE_AT = "2026-06-17T18:00:00.000Z";
const SHIP_AT = "2026-06-18T10:00:00.000Z";
const EVAL_A = "2026-07-21T14:28:24.152Z";
const EVAL_B = "2026-07-21T14:45:50.783Z";

function base(
  partial: Partial<ResolveSalesOrderItemFlowInput> & {
    salesOrderItemId?: string;
  } = {}
): ResolveSalesOrderItemFlowInput {
  return {
    salesOrderItemId: partial.salesOrderItemId ?? "item-1",
    orderedQuantity: partial.orderedQuantity ?? 10,
    fulfilledQuantity: partial.fulfilledQuantity ?? 0,
    status: partial.status ?? 2,
    statusNormalized: partial.statusNormalized ?? "RELEASED",
    ...partial,
  };
}

function completedManufacturedItem(
  salesOrderItemId: string,
  overrides: Partial<ResolveSalesOrderItemFlowInput> = {}
): ResolveSalesOrderItemFlowInput {
  return base({
    salesOrderItemId,
    status: 4,
    statusNormalized: "FULFILLED",
    orderedQuantity: 1000,
    fulfilledQuantity: 1000,
    costingMode: "OWN_PROCESS",
    hasProductRouting: true,
    hasProductBom: true,
    productionOrderLinks: [],
    documentAllocations: [{ allocationKey: `doc-${salesOrderItemId}`, quantity: 1000 }],
    nfeAllocations: [
      {
        nfeExternalId: 7292,
        quantity: 1000,
        isValidForBilling: true,
        hasDocument: true,
        hasShipDate: false,
      },
    ],
    ...overrides,
  });
}

function pdLikeItems() {
  return [
    resolveSalesOrderItemFlow(completedManufacturedItem("a")),
    resolveSalesOrderItemFlow(completedManufacturedItem("b")),
    resolveSalesOrderItemFlow(completedManufacturedItem("c")),
    resolveSalesOrderItemFlow(completedManufacturedItem("d")),
    resolveSalesOrderItemFlow(
      base({
        salesOrderItemId: "e-cut",
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 1000,
        fulfilledQuantity: 700,
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
        documentAllocations: [{ allocationKey: "d-e", quantity: 700 }],
        nfeAllocations: [
          {
            nfeExternalId: 7292,
            quantity: 700,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    ),
  ];
}

function emptyNfe(externalId: number, issuedAt: string | null) {
  return {
    externalId,
    nomusNfeId: null,
    numero: "1",
    serie: "1",
    chave: null,
    statusRaw: 1,
    issuedAt,
    statusNormalized: {
      status: "AUTHORIZED" as const,
      isCanceled: false,
      isValidForBilling: true,
      reason: "test",
    },
    isCanceled: false,
    isValidForBilling: true,
    sources: ["ORDER_LINK" as const],
    linkedSalesOrderIds: ["order-pd-like"],
  };
}

function pdLikePack(loadedAt: string): SalesOrderFlowEvidencePack {
  const itemIds = ["a", "b", "c", "d", "e-cut"] as const;
  return {
    orderId: "order-pd-like",
    order: {
      id: "order-pd-like",
      orderCode: "SYNTH-ORDER",
      status: "FULFILLED",
      externalSalesOrderId: null,
      externalSalesOrderCode: null,
      issueDate: "2026-06-01T00:00:00.000Z",
      expectedDeliveryDate: null,
      totalNetValue: 500,
      totalGrossValue: 500,
      customerId: "c1",
      customerName: "Cliente",
      customerTradeName: null,
      customerTaxId: null,
      externalSellerId: null,
      nomusSellerName: null,
      companyIssuer: null,
      externalCompanyId: null,
      notes: null,
      internalNotes: null,
      responsible: null,
      paymentTerms: null,
      paymentMethod: null,
      freightCondition: null,
      deliveryLocation: null,
    },
    items: itemIds.map((id) => ({
      id,
      salesOrderId: "order-pd-like",
      productId: `p-${id}`,
      productCode: `SKU-${id}`,
      productName: `Item ${id}`,
      quantity: id === "e-cut" ? 1000 : 1000,
      unitPrice: 1,
      totalNetValue: id === "e-cut" ? 700 : 1000,
      lineNumber: 1,
      nomusItemExternalId: null,
      nomusItemStatusRaw: id === "e-cut" ? 5 : 4,
      nomusItemStatusNormalized: id === "e-cut" ? "FULFILLED_WITH_CUT" : "FULFILLED",
      nomusQuantityFulfilled: id === "e-cut" ? 700 : 1000,
      nomusIsStale: false,
      nomusIsCut: id === "e-cut",
      productType: "PRODUCT",
      productCostingMode: "OWN_PROCESS",
      hasProductRouting: true,
      hasProductBom: true,
      fulfillment: {
        classification: id === "e-cut" ? "FULFILLED_WITH_CUT" : "FULFILLED",
        orderedQuantity: 1000,
        fulfilledQuantity: id === "e-cut" ? 700 : 1000,
        remainingQuantity: 0,
        cutQuantity: id === "e-cut" ? 300 : 0,
        reasons: [],
      },
    })),
    productionLinks: [],
    productionOrders: [],
    stockDocuments: [
      {
        id: "doc-1",
        externalId: 9001,
        idNfe: 7292,
        tipoDocumentoEstoque: "SAIDA",
        dataDocumento: DOC_AT,
        documentNumber: "DOC-1",
        totalValue: 4700,
        statusRaw: "OK",
        isCancelled: false,
        cancelledAt: null,
        cancellationReason: null,
        itemCount: 5,
      },
    ],
    stockDocumentItems: [],
    allocations: itemIds.map((id) => ({
      auditKey: `alloc-${id}`,
      runId: "run-1",
      lineType: "ITEM",
      salesOrderId: "order-pd-like",
      salesOrderItemId: id,
      stockDocumentExternalId: 9001,
      stockDocumentItemId: null,
      nfeExternalId: 7292,
      quantityUsedForOrder: id === "e-cut" ? 700 : 1000,
      orderedQuantity: 1000,
      nfeLinkedBy: "DOCUMENT",
    })),
    nfes: [emptyNfe(7292, NFE_AT)],
    validNfes: [emptyNfe(7292, NFE_AT)],
    canceledNfes: [],
    linkConflicts: [],
    meta: {
      loadedAt,
      source: "LOCAL_STAGE",
      queryMode: "BATCH",
    },
  };
}

describe("salesOrderFlowCompletedAtStability (OP-04)", () => {
  it("1) terminal com data de envio normalizada", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("ship"));
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "o-ship",
      referenceDate: EVAL_A,
      itemShippedAt: [{ salesOrderItemId: "ship", shippedAt: SHIP_AT }],
      itemDocumentAt: [{ salesOrderItemId: "ship", at: DOC_AT }],
      itemFinancials: [{ salesOrderItemId: "ship", plannedNetValue: 10 }],
    });
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.equal(order.completedAt, SHIP_AT);
    assert.equal(order.lastShippedAt, SHIP_AT);
  });

  it("2) terminal com documento de saída como proxy", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("doc"));
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "o-doc",
      referenceDate: EVAL_B,
      itemDocumentAt: [{ salesOrderItemId: "doc", at: DOC_AT }],
      itemNfeIssuedAt: [{ salesOrderItemId: "doc", at: NFE_AT }],
      itemFinancials: [{ salesOrderItemId: "doc", plannedNetValue: 10 }],
    });
    assert.equal(order.completedAt, DOC_AT);
    assert.equal(
      order.inconsistencies.some((i) => i.code === "ORDER_COMPLETED_AT_MISSING"),
      false
    );
  });

  it("3) terminal com NF-e válida como proxy permitido", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("nfe"));
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "o-nfe",
      referenceDate: EVAL_A,
      itemNfeIssuedAt: [{ salesOrderItemId: "nfe", at: NFE_AT }],
      itemFinancials: [{ salesOrderItemId: "nfe", plannedNetValue: 10 }],
    });
    assert.equal(order.completedAt, NFE_AT);
  });

  it("4) terminal sem data segura → null + ORDER_COMPLETED_AT_MISSING INFO", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("none"));
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "o-none",
      referenceDate: EVAL_A,
      itemFinancials: [{ salesOrderItemId: "none", plannedNetValue: 10 }],
    });
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.equal(order.completedAt, null);
    const miss = order.inconsistencies.find(
      (i) => i.code === "ORDER_COMPLETED_AT_MISSING"
    );
    assert.ok(miss);
    assert.equal(miss!.severity, "INFO");
  });

  it("5) pedido já terminal reutiliza completedAt persistido sem nova evidência", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("pers"));
    const persisted = "2026-06-20T12:00:00.000Z";
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "o-pers",
      referenceDate: EVAL_B,
      persistedCompletedAt: persisted,
      itemFinancials: [{ salesOrderItemId: "pers", plannedNetValue: 10 }],
    });
    assert.equal(order.completedAt, persisted);
  });

  it("6) duas avaliações em horários diferentes → mesmo estágio, completedAt e fingerprint", () => {
    const items = pdLikeItems();
    for (const item of items) {
      assert.equal(item.currentStage, "SHIPPED_COMPLETED");
      assert.ok(
        item.inconsistencies.some((i) => i.code === "NFE_SHIP_DATE_MISSING")
      );
    }

    const packA = pdLikePack(EVAL_A);
    const packB = pdLikePack(EVAL_B);
    const completionA = buildSalesOrderFlowCompletionContextFromPack(packA);
    const completionB = buildSalesOrderFlowCompletionContextFromPack(packB);

    const orderA = resolveSalesOrderFlow(items, {
      salesOrderId: "order-pd-like",
      referenceDate: EVAL_A,
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
      ...completionA,
    });
    const orderB = resolveSalesOrderFlow(items, {
      salesOrderId: "order-pd-like",
      referenceDate: EVAL_B,
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
      ...completionB,
    });

    assert.equal(orderA.currentStage, "SHIPPED_COMPLETED");
    assert.equal(orderB.currentStage, "SHIPPED_COMPLETED");
    assert.equal(orderA.completedAt, DOC_AT);
    assert.equal(orderB.completedAt, DOC_AT);
    assert.notEqual(orderA.completedAt, EVAL_A);
    assert.notEqual(orderA.completedAt, EVAL_B);

    const itemFpsA = items.map((i) => buildSalesOrderItemFlowFingerprint(i));
    const itemFpsB = items.map((i) => buildSalesOrderItemFlowFingerprint(i));
    assert.deepEqual(itemFpsA, itemFpsB);

    const fpA = buildSalesOrderFlowFingerprint(orderA, itemFpsA);
    const fpB = buildSalesOrderFlowFingerprint(orderB, itemFpsB);
    assert.equal(fpA, fpB);

    const draftA = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: orderA.salesOrderId,
      orderResult: orderA,
      itemResults: items,
      existingItems: [],
      computedAt: new Date(EVAL_A),
    });
    const planB = planSalesOrderFlowRecompute({
      draft: buildSalesOrderFlowRecomputeDraft({
        salesOrderId: orderB.salesOrderId,
        orderResult: orderB,
        itemResults: items,
        existingItems: items.map((i) => ({
          salesOrderItemId: i.salesOrderItemId,
          fingerprint: draftA.itemFingerprints.get(i.salesOrderItemId)!,
          currentStage: i.currentStage,
          stageEnteredAt: null,
        })),
        existingOrder: {
          currentStage: orderA.currentStage,
          fingerprint: draftA.orderFingerprint,
        },
        computedAt: new Date(EVAL_B),
      }),
      existingOrder: {
        currentStage: orderA.currentStage,
        fingerprint: draftA.orderFingerprint,
      },
      existingItems: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        fingerprint: draftA.itemFingerprints.get(i.salesOrderItemId)!,
        currentStage: i.currentStage,
        stageEnteredAt: null,
      })),
    });

    assert.equal(planB.action, "unchanged");
    assert.equal(planB.reason, "fingerprint_match");
    assert.equal(planB.draft.orderFingerprint, draftA.orderFingerprint);
  });

  it("7) arrays em ordens diferentes geram o mesmo fingerprint", () => {
    const items = pdLikeItems();
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "order-arr",
      itemDocumentAt: [
        { salesOrderItemId: "e-cut", at: DOC_AT },
        { salesOrderItemId: "a", at: DOC_AT },
      ],
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });
    const fpsForward = items.map((i) => buildSalesOrderItemFlowFingerprint(i));
    const fpsReverse = [...fpsForward].reverse();
    assert.equal(
      buildSalesOrderFlowFingerprint(order, fpsForward),
      buildSalesOrderFlowFingerprint(order, fpsReverse)
    );
  });

  it("8) computedAt diferente não altera fingerprint", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("c8"));
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "o-c8",
      itemDocumentAt: [{ salesOrderItemId: "c8", at: DOC_AT }],
      itemFinancials: [{ salesOrderItemId: "c8", plannedNetValue: D(10) }],
    });
    const draft1 = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: order.salesOrderId,
      orderResult: order,
      itemResults: [item],
      existingItems: [],
      computedAt: new Date(EVAL_A),
    });
    const draft2 = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: order.salesOrderId,
      orderResult: order,
      itemResults: [item],
      existingItems: [],
      computedAt: new Date(EVAL_B),
    });
    assert.equal(draft1.orderFingerprint, draft2.orderFingerprint);
    assert.notEqual(draft1.computedAt.toISOString(), draft2.computedAt.toISOString());
  });

  it("9) mudança real de quantidade altera fingerprint", () => {
    const a = resolveSalesOrderItemFlow(completedManufacturedItem("q", {
      orderedQuantity: 1000,
      fulfilledQuantity: 1000,
    }));
    const b = resolveSalesOrderItemFlow(completedManufacturedItem("q", {
      orderedQuantity: 900,
      fulfilledQuantity: 900,
      documentAllocations: [{ allocationKey: "doc-q", quantity: 900 }],
      nfeAllocations: [
        {
          nfeExternalId: 7292,
          quantity: 900,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: false,
        },
      ],
    }));
    const orderA = resolveSalesOrderFlow([a], {
      salesOrderId: "o-q",
      itemDocumentAt: [{ salesOrderItemId: "q", at: DOC_AT }],
      itemFinancials: [{ salesOrderItemId: "q", plannedNetValue: 100 }],
    });
    const orderB = resolveSalesOrderFlow([b], {
      salesOrderId: "o-q",
      itemDocumentAt: [{ salesOrderItemId: "q", at: DOC_AT }],
      itemFinancials: [{ salesOrderItemId: "q", plannedNetValue: 100 }],
    });
    assert.notEqual(
      buildSalesOrderFlowFingerprint(orderA, [buildSalesOrderItemFlowFingerprint(a)]),
      buildSalesOrderFlowFingerprint(orderB, [buildSalesOrderItemFlowFingerprint(b)])
    );
  });

  it("10) mudança real de estágio altera fingerprint", () => {
    const completed = resolveSalesOrderItemFlow(completedManufacturedItem("st"));
    const waiting = resolveSalesOrderItemFlow(
      base({
        salesOrderItemId: "st",
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
      })
    );
    assert.equal(completed.currentStage, "SHIPPED_COMPLETED");
    assert.equal(waiting.currentStage, "WAITING_PRODUCTION_ORDER");
    const orderDone = resolveSalesOrderFlow([completed], {
      salesOrderId: "o-st",
      itemDocumentAt: [{ salesOrderItemId: "st", at: DOC_AT }],
      itemFinancials: [{ salesOrderItemId: "st", plannedNetValue: 10 }],
    });
    const orderWait = resolveSalesOrderFlow([waiting], {
      salesOrderId: "o-st",
      itemFinancials: [{ salesOrderItemId: "st", plannedNetValue: 10 }],
    });
    assert.notEqual(
      buildSalesOrderFlowFingerprint(orderDone, [
        buildSalesOrderItemFlowFingerprint(completed),
      ]),
      buildSalesOrderFlowFingerprint(orderWait, [
        buildSalesOrderItemFlowFingerprint(waiting),
      ])
    );
  });

  it("11) NFE_SHIP_DATE_MISSING permanece INFO", () => {
    const item = resolveSalesOrderItemFlow(completedManufacturedItem("info"));
    const ship = item.inconsistencies.find((i) => i.code === "NFE_SHIP_DATE_MISSING");
    assert.ok(ship);
    assert.equal(ship!.severity, "INFO");
  });

  it("12) ausência de OP não reabre pedido concluído", () => {
    const items = pdLikeItems();
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "order-no-op",
      itemDocumentAt: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        at: DOC_AT,
      })),
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(order.currentBottleneck?.stage, "WAITING_PRODUCTION_ORDER");
  });

  it("13) recompute idempotente não planeja eventos duplicados", () => {
    const items = pdLikeItems();
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "order-idem",
      itemDocumentAt: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        at: DOC_AT,
      })),
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });
    const draft = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: order.salesOrderId,
      orderResult: order,
      itemResults: items,
      existingItems: [],
      computedAt: new Date(EVAL_A),
    });
    const plan = planSalesOrderFlowRecompute({
      draft: buildSalesOrderFlowRecomputeDraft({
        salesOrderId: order.salesOrderId,
        orderResult: order,
        itemResults: items,
        existingItems: items.map((i) => ({
          salesOrderItemId: i.salesOrderItemId,
          fingerprint: draft.itemFingerprints.get(i.salesOrderItemId)!,
          currentStage: i.currentStage,
          stageEnteredAt: null,
        })),
        existingOrder: {
          currentStage: order.currentStage,
          fingerprint: draft.orderFingerprint,
        },
        computedAt: new Date(EVAL_B),
      }),
      existingOrder: {
        currentStage: order.currentStage,
        fingerprint: draft.orderFingerprint,
      },
      existingItems: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        fingerprint: draft.itemFingerprints.get(i.salesOrderItemId)!,
        currentStage: i.currentStage,
        stageEnteredAt: null,
      })),
    });
    assert.equal(plan.action, "unchanged");
    assert.equal(plan.reason, "fingerprint_match");
    assert.equal(plan.draft.orderFingerprint, draft.orderFingerprint);
  });

  it("resolveSalesOrderFlowCompletedAt nunca usa horário de avaliação", () => {
    assert.equal(
      resolveSalesOrderFlowCompletedAt({
        isShippedCompleted: true,
        lastNormalizedShippedAt: null,
        lastDocumentAt: DOC_AT,
        lastNfeIssuedAt: NFE_AT,
        persistedCompletedAt: EVAL_A,
      }),
      DOC_AT
    );
    assert.equal(
      resolveSalesOrderFlowCompletedAt({
        isShippedCompleted: true,
        lastNormalizedShippedAt: null,
        lastDocumentAt: null,
        lastNfeIssuedAt: null,
        persistedCompletedAt: null,
      }),
      null
    );
    assert.equal(
      resolveSalesOrderFlowCompletedAt({
        isShippedCompleted: false,
        lastNormalizedShippedAt: SHIP_AT,
        lastDocumentAt: DOC_AT,
        lastNfeIssuedAt: NFE_AT,
        persistedCompletedAt: EVAL_A,
      }),
      null
    );
  });
});
