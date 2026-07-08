import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBrentDedupKey, serializeBrentSnapshotForApi } from "./brentCommodityCollection.js";
import {
  BRENT_COMMODITY_REGISTERED_JOB,
  __testOnlyHasTriggeredSlot,
  __testOnlyRememberTriggeredSlot,
  getSaoPauloDateTimeParts,
  resetBrentCommoditySchedulerForTests,
  resolveBrentCollectionSlot,
  resolveScheduledSlotForMinute,
  runBrentCommodityScheduledCollection,
} from "./brentCommodityJob.js";

describe("brent commodity scheduled collection", () => {
  it("registra job com agenda 09:00 e 15:30 America/Sao_Paulo", () => {
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.id, "brent-commodity-collection");
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.schedule, "09:00, 15:30");
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.timezone, "America/Sao_Paulo");
  });

  it("monta chave de deduplicação por data e slot", () => {
    assert.equal(buildBrentDedupKey({ quoteDate: "2026-07-08", slot: "MORNING" }), "BRENT:2026-07-08:MORNING");
  });

  it("resolve slot operacional do dia", () => {
    assert.equal(resolveBrentCollectionSlot({ hour: 10, minute: 0 }), "MORNING");
    assert.equal(resolveBrentCollectionSlot({ hour: 16, minute: 0 }), "AFTERNOON");
  });

  it("scheduler ignora minutos fora da agenda", async () => {
    resetBrentCommoditySchedulerForTests();
    const parts = getSaoPauloDateTimeParts(new Date("2026-07-08T13:00:00.000Z"));
    assert.equal(resolveScheduledSlotForMinute(parts), null);
    await runBrentCommodityScheduledCollection(new Date("2026-07-08T13:00:00.000Z"));
    __testOnlyRememberTriggeredSlot("2026-07-08", "MORNING");
    assert.equal(__testOnlyHasTriggeredSlot("2026-07-08", "MORNING"), true);
  });

  it("serializa snapshot com slot e trigger", () => {
    const api = serializeBrentSnapshotForApi({
      id: "1",
      commodityType: "BRENT",
      priceUSD: { toString: () => "80" } as never,
      quoteDate: new Date("2026-07-08T12:00:00.000Z"),
      scheduledSlot: "MORNING",
      collectedAt: new Date("2026-07-08T12:00:00.000Z"),
      source: "yahoo-finance",
      status: "SUCCESS",
      errorMessage: null,
      variationFromPrevious: null,
      trigger: "MANUAL",
    });
    assert.equal(api.scheduledSlot, "MORNING");
    assert.equal(api.trigger, "MANUAL");
  });
});
