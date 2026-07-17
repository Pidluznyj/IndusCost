import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  calculateDaysInCurrentStage,
  withDaysInCurrentStage,
} from "./salesOrderFlowDaysInStage.js";
import {
  appendSalesOrderFlowEvent,
  type SalesOrderFlowRepositoryDb,
} from "./salesOrderFlowRepository.server.js";
import {
  buildSalesOrderFlowEventDetails,
  buildSalesOrderFlowEventDedupeKey,
  buildSalesOrderItemFlowTimelineEvents,
  resolveSalesOrderFlowOccurredAt,
  resolveSalesOrderFlowStageEnteredAt,
  type SalesOrderFlowTimelineItemState,
} from "./salesOrderFlowTimeline.js";

const ORDER_ID = "ord-timeline";
const ITEM_ID = "item-timeline";

function itemState(
  partial: Partial<SalesOrderFlowTimelineItemState> &
    Pick<SalesOrderFlowTimelineItemState, "currentStage" | "fingerprint">
): SalesOrderFlowTimelineItemState {
  return {
    salesOrderItemId: ITEM_ID,
    fulfillmentClassification: "NOT_FULFILLED",
    cutQuantity: new Prisma.Decimal(0),
    canceledQuantity: new Prisma.Decimal(0),
    inconsistencyCodes: [],
    ...partial,
  };
}

describe("salesOrderFlowTimeline (OP-55)", () => {
  it("avanço gera STAGE_CHANGED; retorno gera STAGE_RETURNED com novo dedupeKey", () => {
    const observedAt = new Date("2026-07-17T15:00:00.000Z");
    const advance = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({
        currentStage: "WAITING_OUTPUT_DOCUMENT",
        fingerprint: "fp-a",
      }),
      next: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp-b",
      }),
      observedAt,
    });
    assert.ok(advance.some((e) => e.eventType === "STAGE_CHANGED"));
    assert.ok(!advance.some((e) => e.eventType === "STAGE_RETURNED"));

    const returned = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp-b",
      }),
      next: itemState({
        currentStage: "WAITING_OUTPUT_DOCUMENT",
        fingerprint: "fp-c",
      }),
      observedAt,
    });
    const ret = returned.find((e) => e.eventType === "STAGE_RETURNED");
    assert.ok(ret);
    assert.equal(ret!.fromStage, "WAITING_NFE");
    assert.equal(ret!.toStage, "WAITING_OUTPUT_DOCUMENT");

    // Retorno à mesma etapa depois cria outro evento (fingerprint diferente).
    const advanceAgain = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({
        currentStage: "WAITING_OUTPUT_DOCUMENT",
        fingerprint: "fp-c",
      }),
      next: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp-d",
      }),
      observedAt,
    });
    const secondAdvance = advanceAgain.find((e) => e.eventType === "STAGE_CHANGED");
    assert.ok(secondAdvance);
    assert.notEqual(
      secondAdvance!.dedupeKey,
      advance.find((e) => e.eventType === "STAGE_CHANGED")!.dedupeKey
    );
  });

  it("conclusão, corte, cancelamento e inconsistência crítica/resolução", () => {
    const observedAt = new Date("2026-07-17T15:00:00.000Z");

    const completed = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({ currentStage: "WAITING_NFE", fingerprint: "fp1" }),
      next: itemState({
        currentStage: "SHIPPED_COMPLETED",
        fingerprint: "fp2",
        fulfillmentClassification: "FULFILLED",
      }),
      observedAt,
    });
    assert.ok(completed.some((e) => e.eventType === "STAGE_COMPLETED"));

    const cut = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({ currentStage: "WAITING_NFE", fingerprint: "fp3" }),
      next: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp4",
        fulfillmentClassification: "FULFILLED_WITH_CUT",
        cutQuantity: new Prisma.Decimal(2),
      }),
      observedAt,
    });
    assert.ok(cut.some((e) => e.eventType === "CUT_DETECTED"));

    const canceled = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({ currentStage: "WAITING_NFE", fingerprint: "fp5" }),
      next: itemState({
        currentStage: "CANCELED",
        fingerprint: "fp6",
        fulfillmentClassification: "CANCELED",
      }),
      observedAt,
    });
    assert.ok(canceled.some((e) => e.eventType === "CANCELED"));

    const critical = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp7",
        inconsistencyCodes: [],
      }),
      next: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp8",
        inconsistencyCodes: ["DUPLICATE_TRUTH_RISK"],
      }),
      observedAt,
    });
    assert.ok(critical.some((e) => e.eventType === "INCONSISTENCY_CRITICAL"));

    const resolved = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp8",
        inconsistencyCodes: ["DUPLICATE_TRUTH_RISK"],
      }),
      next: itemState({
        currentStage: "WAITING_NFE",
        fingerprint: "fp9",
        inconsistencyCodes: [],
      }),
      observedAt,
    });
    assert.ok(resolved.some((e) => e.eventType === "INCONSISTENCY_RESOLVED"));
  });

  it("criação inicial emite SNAPSHOT_CREATED", () => {
    const events = buildSalesOrderItemFlowTimelineEvents({
      salesOrderId: ORDER_ID,
      previous: null,
      next: itemState({
        currentStage: "WAITING_OUTPUT_DOCUMENT",
        fingerprint: "fp0",
      }),
      observedAt: new Date("2026-07-17T15:00:00.000Z"),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "SNAPSHOT_CREATED");
  });

  it("stageEnteredAt só muda com currentStage; evidência histórica em occurredAt", () => {
    const observedAt = new Date("2026-07-17T15:00:00.000Z");
    const evidenceAt = new Date("2026-07-01T10:00:00.000Z");
    const previousEntered = new Date("2026-06-20T00:00:00.000Z");

    const sameStage = resolveSalesOrderFlowStageEnteredAt({
      previousStage: "WAITING_NFE",
      nextStage: "WAITING_NFE",
      previousStageEnteredAt: previousEntered,
      occurredAt: evidenceAt,
      observedAt,
    });
    assert.equal(sameStage.toISOString(), previousEntered.toISOString());

    const occurredAt = resolveSalesOrderFlowOccurredAt({
      observedAt,
      evidenceAt,
    });
    assert.equal(occurredAt.toISOString(), evidenceAt.toISOString());

    const changed = resolveSalesOrderFlowStageEnteredAt({
      previousStage: "WAITING_OUTPUT_DOCUMENT",
      nextStage: "WAITING_NFE",
      previousStageEnteredAt: previousEntered,
      occurredAt,
      observedAt,
    });
    assert.equal(changed.toISOString(), evidenceAt.toISOString());

    const days = calculateDaysInCurrentStage(changed, observedAt);
    assert.equal(days, 16);
  });

  it("detailsJson não inclui campos sensíveis", () => {
    const details = buildSalesOrderFlowEventDetails({
      scope: "ITEM",
      fingerprint: "fp",
      direction: "ADVANCE",
      codes: ["DUPLICATE_TRUTH_RISK"],
    });
    const json = JSON.stringify(details);
    assert.doesNotMatch(json, /rawJson|internalNote|password|token/i);
    assert.match(json, /fingerprint/);
  });

  it("colisão de dedupeKey: segundo append é duplicate", async () => {
    const store = new Map<string, { id: string }>();
    const db = {
      salesOrderFlowEvent: {
        findUnique: async (args: { where: { dedupeKey: string } }) =>
          store.get(args.where.dedupeKey) ?? null,
        create: async (args: { data: { dedupeKey: string }; select?: { id: boolean } }) => {
          if (store.has(args.data.dedupeKey)) {
            throw new Error("Unique constraint");
          }
          const id = `e-${store.size + 1}`;
          store.set(args.data.dedupeKey, { id });
          return { id };
        },
      },
    } as unknown as SalesOrderFlowRepositoryDb;

    const dedupeKey = buildSalesOrderFlowEventDedupeKey({
      scope: "item",
      scopeId: ITEM_ID,
      eventType: "STAGE_CHANGED",
      fromStage: "A",
      toStage: "B",
      uniqueness: "fp-x",
    });

    const first = await appendSalesOrderFlowEvent(db, {
      salesOrderId: ORDER_ID,
      salesOrderItemId: ITEM_ID,
      eventType: "STAGE_CHANGED",
      fromStage: "A",
      toStage: "B",
      dedupeKey,
      detailsJson: { scope: "ITEM" },
      occurredAt: new Date("2026-07-01T00:00:00.000Z"),
      observedAt: new Date("2026-07-17T15:00:00.000Z"),
    });
    const second = await appendSalesOrderFlowEvent(db, {
      salesOrderId: ORDER_ID,
      salesOrderItemId: ITEM_ID,
      eventType: "STAGE_CHANGED",
      fromStage: "A",
      toStage: "B",
      dedupeKey,
      detailsJson: { scope: "ITEM" },
      occurredAt: new Date("2026-07-02T00:00:00.000Z"),
      observedAt: new Date("2026-07-17T16:00:00.000Z"),
    });

    assert.equal(first.action, "created");
    assert.equal(second.action, "duplicate");
    assert.equal(second.id, first.id);
    assert.equal(store.size, 1);
  });
});

describe("salesOrderFlowDaysInStage (OP-55)", () => {
  it("calcula em leitura sem regravar", () => {
    assert.equal(
      calculateDaysInCurrentStage(
        "2026-07-10T00:00:00.000Z",
        "2026-07-17T12:00:00.000Z"
      ),
      7
    );
    assert.equal(calculateDaysInCurrentStage(null), null);

    const enriched = withDaysInCurrentStage(
      {
        currentStage: "WAITING_NFE",
        stageEnteredAt: "2026-07-15T00:00:00.000Z",
      },
      "2026-07-17T00:00:00.000Z"
    );
    assert.equal(enriched.daysInCurrentStage, 2);
    assert.equal(enriched.currentStage, "WAITING_NFE");
  });
});
