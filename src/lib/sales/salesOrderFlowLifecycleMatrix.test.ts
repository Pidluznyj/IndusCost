/**
 * OP-76 — Matriz completa do motor do Kanban (35 cenários + invariantes).
 *
 * Reutiliza motores puros OP-50/51/54/55. Sem Prisma/I/O.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  SALES_ORDER_FLOW_STAGE_PRIORITY,
  SALES_ORDER_FLOW_STAGES,
  pickSalesOrderFlowStageFromItemStages,
} from "./salesOrderFlowCatalog.js";
import {
  buildLifecycleMatrixCases,
  itemInput,
  MATRIX_ORDER_ID,
  MATRIX_REF,
  orderCtx,
  type LifecycleMatrixCase,
} from "./salesOrderFlowLifecycleMatrix.fixtures.js";
import { resolveSalesOrderItemFlow } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
  SALES_ORDER_FLOW_COMPUTATION_VERSION,
} from "./salesOrderFlowFingerprint.js";
import {
  buildSalesOrderFlowRecomputeDraft,
  planSalesOrderFlowRecompute,
} from "./salesOrderFlowRecompute.js";
import {
  buildSalesOrderFlowEventDedupeKey,
  buildSalesOrderItemFlowTimelineEvents,
  itemStateFromFlowResult,
} from "./salesOrderFlowTimeline.js";

/** Invariantes de negócio transversais (state-machine.md). */
function assertBusinessInvariants(c: LifecycleMatrixCase) {
  const label = `#${c.id} ${c.title}`;
  const { item, order } = c;

  assert.ok(
    (SALES_ORDER_FLOW_STAGES as readonly string[]).includes(item.currentStage),
    `${label}: estágio do item no catálogo`
  );

  // Progressos capped em 100%.
  for (const [name, value] of Object.entries(item.progress)) {
    if (value == null) continue;
    assert.ok(value instanceof Prisma.Decimal, `${label}: progress.${name} Decimal`);
    assert.ok(value.lte(100), `${label}: progress.${name} ≤ 100`);
    assert.ok(value.gte(0), `${label}: progress.${name} ≥ 0`);
  }

  // INCONSISTENT nunca é coluna.
  assert.notEqual(item.currentStage, "INCONSISTENT");

  // Cancelado / inactive não vota (isActiveForKanban false).
  if (item.currentStage === "CANCELED") {
    assert.equal(item.isActiveForKanban, false, `${label}: CANCELED fora da votação`);
  }

  // UNKNOWN nunca SHIPPED_COMPLETED.
  if (item.fulfillment.classification === "UNKNOWN") {
    assert.notEqual(
      item.currentStage,
      "SHIPPED_COMPLETED",
      `${label}: UNKNOWN não conclui envio`
    );
  }

  if (order) {
    assert.ok(
      (SALES_ORDER_FLOW_STAGES as readonly string[]).includes(order.currentStage),
      `${label}: estágio do pedido no catálogo`
    );
    assert.notEqual(order.currentStage, "INCONSISTENT");

    // Coluna = primeira obrigação entre ativos (quando há bottleneck).
    if (order.currentBottleneck) {
      const bottleneckPriority =
        SALES_ORDER_FLOW_STAGE_PRIORITY[order.currentBottleneck.stage];
      const orderPriority = SALES_ORDER_FLOW_STAGE_PRIORITY[order.currentStage];
      assert.equal(
        bottleneckPriority,
        orderPriority,
        `${label}: bottleneck alinhado à coluna`
      );
    }

    if (order.currentStage === "CANCELED") {
      assert.equal(order.isInActiveOperationalColumn, false);
    }
  }
}

function assertCaseExpectations(c: LifecycleMatrixCase) {
  const label = `#${c.id} ${c.title}`;
  assert.equal(c.item.currentStage, c.expectedItemStage, `${label}: item stage`);
  if (c.expectedOrderStage != null) {
    assert.ok(c.order, `${label}: order esperado`);
    assert.equal(
      c.order!.currentStage,
      c.expectedOrderStage,
      `${label}: order stage`
    );
  }
  if (c.expectedCodes) {
    const codes = new Set([
      ...c.item.inconsistencies.map((i) => i.code),
      ...(c.order?.inconsistencies.map((i) => i.code) ?? []),
    ]);
    for (const code of c.expectedCodes) {
      assert.ok(codes.has(code), `${label}: código ${code}`);
    }
  }
  c.extraAssert?.({ item: c.item, order: c.order });
}

describe("salesOrderFlowLifecycleMatrix (OP-76)", () => {
  const cases = buildLifecycleMatrixCases();

  it("matriz contém os 30 cenários de estágio/evidência (#1–#30)", () => {
    assert.equal(cases.length, 30);
    assert.deepEqual(
      cases.map((c) => c.id),
      Array.from({ length: 30 }, (_, i) => i + 1)
    );
  });

  for (const c of cases) {
    it(`#${c.id} ${c.title}`, () => {
      assertCaseExpectations(c);
      assertBusinessInvariants(c);
    });
  }

  it("#31 Recomputação idempotente", () => {
    const item = resolveSalesOrderItemFlow(
      itemInput({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      })
    );
    const order = resolveSalesOrderFlow([item], orderCtx());
    const draft1 = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: MATRIX_ORDER_ID,
      itemResults: [item],
      orderResult: order,
      existingItems: [],
      computedAt: new Date(MATRIX_REF),
    });
    const plan1 = planSalesOrderFlowRecompute({
      draft: draft1,
      existingOrder: null,
      existingItems: [],
    });
    assert.equal(plan1.action, "persist");
    assert.equal(plan1.reason, "first_run");

    const draft2 = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: MATRIX_ORDER_ID,
      itemResults: [item],
      orderResult: order,
      existingItems: [...draft1.itemFingerprints.entries()].map(
        ([salesOrderItemId, fingerprint]) => ({
          salesOrderItemId,
          currentStage: item.currentStage,
          fingerprint,
          stageEnteredAt: new Date(MATRIX_REF),
        })
      ),
      existingOrder: {
        currentStage: order.currentStage,
        fingerprint: draft1.orderFingerprint,
      },
      computedAt: new Date(MATRIX_REF),
    });
    const plan2 = planSalesOrderFlowRecompute({
      draft: draft2,
      existingOrder: {
        currentStage: order.currentStage,
        fingerprint: draft1.orderFingerprint,
      },
      existingItems: [...draft1.itemFingerprints.entries()].map(
        ([salesOrderItemId, fingerprint]) => ({
          salesOrderItemId,
          currentStage: item.currentStage,
          fingerprint,
          stageEnteredAt: new Date(MATRIX_REF),
        })
      ),
    });
    assert.equal(plan2.action, "unchanged");
    assert.equal(plan2.reason, "fingerprint_match");
  });

  it("#32 Mudança de computationVersion", () => {
    const item = resolveSalesOrderItemFlow(
      itemInput({
        status: 1,
        statusNormalized: "PENDING",
      })
    );
    const order = resolveSalesOrderFlow([item], orderCtx());
    const v1 = SALES_ORDER_FLOW_COMPUTATION_VERSION;
    const v2 = "sales-order-flow/v2-test";

    const fpItemV1 = buildSalesOrderItemFlowFingerprint(item, v1);
    const fpItemV2 = buildSalesOrderItemFlowFingerprint(item, v2);
    assert.notEqual(fpItemV1, fpItemV2);

    const draftV1 = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: MATRIX_ORDER_ID,
      itemResults: [item],
      orderResult: order,
      existingItems: [],
      computationVersion: v1,
      computedAt: new Date(MATRIX_REF),
    });
    const draftV2 = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: MATRIX_ORDER_ID,
      itemResults: [item],
      orderResult: order,
      existingItems: [],
      computationVersion: v2,
      computedAt: new Date(MATRIX_REF),
    });
    assert.notEqual(draftV1.orderFingerprint, draftV2.orderFingerprint);

    const plan = planSalesOrderFlowRecompute({
      draft: draftV2,
      existingOrder: {
        currentStage: order.currentStage,
        fingerprint: draftV1.orderFingerprint,
      },
      existingItems: [...draftV1.itemFingerprints.entries()].map(
        ([salesOrderItemId, fingerprint]) => ({
          salesOrderItemId,
          currentStage: item.currentStage,
          fingerprint,
          stageEnteredAt: new Date(MATRIX_REF),
        })
      ),
    });
    assert.equal(plan.action, "persist");
    assert.equal(plan.reason, "fingerprint_changed");
  });

  it("#33 Fingerprint igual", () => {
    const item = resolveSalesOrderItemFlow(
      itemInput({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      })
    );
    const order = resolveSalesOrderFlow([item], orderCtx());
    const a = buildSalesOrderItemFlowFingerprint(item);
    const b = buildSalesOrderItemFlowFingerprint(item);
    assert.equal(a, b);
    const itemFps = [a];
    const oa = buildSalesOrderFlowFingerprint(order, itemFps);
    const ob = buildSalesOrderFlowFingerprint(order, itemFps);
    assert.equal(oa, ob);
  });

  it("#34 Fingerprint alterado", () => {
    const before = resolveSalesOrderItemFlow(
      itemInput({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      })
    );
    const after = resolveSalesOrderItemFlow(
      itemInput({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      })
    );
    assert.notEqual(before.currentStage, after.currentStage);
    const fpBefore = buildSalesOrderItemFlowFingerprint(before);
    const fpAfter = buildSalesOrderItemFlowFingerprint(after);
    assert.notEqual(fpBefore, fpAfter);

    const orderBefore = resolveSalesOrderFlow([before], orderCtx());
    const orderAfter = resolveSalesOrderFlow([after], orderCtx());
    const draftBefore = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: MATRIX_ORDER_ID,
      itemResults: [before],
      orderResult: orderBefore,
      existingItems: [],
      computedAt: new Date(MATRIX_REF),
    });
    const draftAfter = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: MATRIX_ORDER_ID,
      itemResults: [after],
      orderResult: orderAfter,
      existingItems: [...draftBefore.itemFingerprints.entries()].map(
        ([salesOrderItemId, fingerprint]) => ({
          salesOrderItemId,
          currentStage: before.currentStage,
          fingerprint,
          stageEnteredAt: new Date(MATRIX_REF),
        })
      ),
      existingOrder: {
        currentStage: orderBefore.currentStage,
        fingerprint: draftBefore.orderFingerprint,
      },
      computedAt: new Date(MATRIX_REF),
    });
    const plan = planSalesOrderFlowRecompute({
      draft: draftAfter,
      existingOrder: {
        currentStage: orderBefore.currentStage,
        fingerprint: draftBefore.orderFingerprint,
      },
      existingItems: [...draftBefore.itemFingerprints.entries()].map(
        ([salesOrderItemId, fingerprint]) => ({
          salesOrderItemId,
          currentStage: before.currentStage,
          fingerprint,
          stageEnteredAt: new Date(MATRIX_REF),
        })
      ),
    });
    assert.equal(plan.reason, "fingerprint_changed");
    assert.equal(plan.action, "persist");
  });

  it("#35 Evento sem duplicidade", () => {
    const item = resolveSalesOrderItemFlow(
      itemInput({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      })
    );
    const next = resolveSalesOrderItemFlow(
      itemInput({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      })
    );
    const observedAt = new Date(MATRIX_REF);
    const fpPrev = buildSalesOrderItemFlowFingerprint(item);
    const fpNext = buildSalesOrderItemFlowFingerprint(next);
    const prevState = itemStateFromFlowResult(item, fpPrev);
    const nextState = itemStateFromFlowResult(next, fpNext);

    const events = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: MATRIX_ORDER_ID,
      previous: prevState,
      next: nextState,
      observedAt,
    });
    assert.ok(events.length > 0);
    const keys = events.map((e) => e.dedupeKey);
    assert.equal(new Set(keys).size, keys.length, "dedupeKeys únicos no lote");

    const again = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: MATRIX_ORDER_ID,
      previous: prevState,
      next: nextState,
      observedAt,
    });
    assert.deepEqual(
      again.map((e) => e.dedupeKey),
      keys,
      "mesmo estado → mesmos dedupeKeys (append idempotente)"
    );

    const stageChanged = events.find((e) => e.eventType === "STAGE_CHANGED");
    assert.ok(stageChanged);
    const synthetic = buildSalesOrderFlowEventDedupeKey({
      scope: "item",
      scopeId: item.salesOrderItemId,
      eventType: "STAGE_CHANGED",
      fromStage: item.currentStage,
      toStage: next.currentStage,
      uniqueness: fpNext,
    });
    assert.equal(stageChanged!.dedupeKey, synthetic);
  });

  it("invariante: votação usa min(priority) só entre itens ativos", () => {
    const canceled = resolveSalesOrderItemFlow(
      itemInput({
        salesOrderItemId: "c",
        status: 6,
        statusNormalized: "CANCELED",
        nomusIsCanceled: true,
        orderedQuantity: 1,
      })
    );
    const waitingNf = resolveSalesOrderItemFlow(
      itemInput({
        salesOrderItemId: "w",
        orderedQuantity: 2,
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d", quantity: 2 }],
      })
    );
    assert.equal(canceled.isActiveForKanban, false);
    assert.equal(waitingNf.isActiveForKanban, true);
    const picked = pickSalesOrderFlowStageFromItemStages([
      canceled.currentStage,
      waitingNf.currentStage,
    ]);
    // pick puro inclui CANCELED se passado — o motor do pedido filtra ativos.
    const order = resolveSalesOrderFlow([canceled, waitingNf], orderCtx());
    assert.equal(order.currentStage, "WAITING_NFE");
    assert.equal(order.activeItems, 1);
    assert.equal(
      SALES_ORDER_FLOW_STAGE_PRIORITY[order.currentStage],
      SALES_ORDER_FLOW_STAGE_PRIORITY.WAITING_NFE
    );
    void picked;
  });

  it("cobertura: todos os 35 números da OP-76 estão exercitados", () => {
    const covered = new Set([
      ...cases.map((c) => c.id),
      31,
      32,
      33,
      34,
      35,
    ]);
    assert.deepEqual(
      [...covered].sort((a, b) => a - b),
      Array.from({ length: 35 }, (_, i) => i + 1)
    );
  });
});
