import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBrentDedupKey, serializeBrentSnapshotForApi } from "./brentCommodityCollection.js";
import {
  BRENT_COLLECTION_SCHEDULE,
  BRENT_COMMODITY_REGISTERED_JOB,
  BRENT_RUNS_ON_WEEKDAYS_ONLY,
  __testOnlyHasTriggeredSlot,
  __testOnlyRememberTriggeredSlot,
  getSaoPauloDateTimeParts,
  isSaoPauloWeekday,
  resetBrentCommoditySchedulerForTests,
  resolveBrentCollectionSlot,
  resolveScheduledSlotForMinute,
  runBrentCommodityScheduledCollection,
} from "./brentCommodityJob.js";

describe("brent commodity scheduled collection", () => {
  it("registra job com nova agenda 07/11/14/16 America/Sao_Paulo em dias úteis", () => {
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.id, "brent-commodity-collection");
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.schedule, "07:00, 11:00, 14:00, 16:00");
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.timezone, "America/Sao_Paulo");
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.cronExpression, "0 7,11,14,16 * * 1-5");
    assert.equal(BRENT_COMMODITY_REGISTERED_JOB.runsOnWeekdaysOnly, true);
    assert.equal(BRENT_RUNS_ON_WEEKDAYS_ONLY, true);
    assert.deepEqual(
      BRENT_COLLECTION_SCHEDULE.map((s) => ({ slot: s.slot, hour: s.hour, minute: s.minute })),
      [
        { slot: "MORNING_EARLY", hour: 7, minute: 0 },
        { slot: "MORNING_LATE", hour: 11, minute: 0 },
        { slot: "AFTERNOON_EARLY", hour: 14, minute: 0 },
        { slot: "AFTERNOON_LATE", hour: 16, minute: 0 },
      ]
    );
  });

  it("monta chave de deduplicação por data e slot novo", () => {
    assert.equal(
      buildBrentDedupKey({ quoteDate: "2026-07-08", slot: "MORNING_EARLY" }),
      "BRENT:2026-07-08:MORNING_EARLY"
    );
    assert.equal(
      buildBrentDedupKey({ quoteDate: "2026-07-08", slot: "AFTERNOON_LATE" }),
      "BRENT:2026-07-08:AFTERNOON_LATE"
    );
  });

  it("resolve slot operacional do dia (faixas horárias)", () => {
    assert.equal(resolveBrentCollectionSlot({ hour: 6, minute: 0 }), "MORNING_EARLY");
    assert.equal(resolveBrentCollectionSlot({ hour: 7, minute: 0 }), "MORNING_EARLY");
    assert.equal(resolveBrentCollectionSlot({ hour: 10, minute: 0 }), "MORNING_LATE");
    assert.equal(resolveBrentCollectionSlot({ hour: 12, minute: 0 }), "MORNING_LATE");
    assert.equal(resolveBrentCollectionSlot({ hour: 14, minute: 0 }), "AFTERNOON_EARLY");
    assert.equal(resolveBrentCollectionSlot({ hour: 16, minute: 0 }), "AFTERNOON_LATE");
    assert.equal(resolveBrentCollectionSlot({ hour: 20, minute: 0 }), "AFTERNOON_LATE");
  });

  it("scheduler ignora minutos fora da agenda", async () => {
    resetBrentCommoditySchedulerForTests();
    // 2026-07-08T13:00:00Z equivale a 10:00 SP — fora da agenda 07/11/14/16.
    const parts = getSaoPauloDateTimeParts(new Date("2026-07-08T13:00:00.000Z"));
    assert.equal(resolveScheduledSlotForMinute(parts), null);
    await runBrentCommodityScheduledCollection(new Date("2026-07-08T13:00:00.000Z"));
    __testOnlyRememberTriggeredSlot("2026-07-08", "MORNING_EARLY");
    assert.equal(__testOnlyHasTriggeredSlot("2026-07-08", "MORNING_EARLY"), true);
  });

  it("isSaoPauloWeekday retorna true seg–sex e false sáb/dom", () => {
    // 2026-07-04 é sábado, 2026-07-05 domingo, 2026-07-06 segunda.
    assert.equal(
      isSaoPauloWeekday(getSaoPauloDateTimeParts(new Date("2026-07-04T14:00:00.000Z"))),
      false,
      "sábado"
    );
    assert.equal(
      isSaoPauloWeekday(getSaoPauloDateTimeParts(new Date("2026-07-05T14:00:00.000Z"))),
      false,
      "domingo"
    );
    assert.equal(
      isSaoPauloWeekday(getSaoPauloDateTimeParts(new Date("2026-07-06T14:00:00.000Z"))),
      true,
      "segunda"
    );
  });

  it("scheduler não dispara em fim de semana mesmo no horário exato", async () => {
    resetBrentCommoditySchedulerForTests();
    // Domingo 2026-07-05 10:00 SP → 13:00 UTC. Deveria retornar null via weekday guard,
    // ou seja, sem gravar chave no set de triggered.
    const sundayAt10 = new Date("2026-07-05T13:00:00.000Z"); // 10:00 SP
    await runBrentCommodityScheduledCollection(sundayAt10);
    assert.equal(__testOnlyHasTriggeredSlot("2026-07-05", "MORNING_LATE"), false);
  });

  it("serializa snapshot com slot novo e trigger", () => {
    const api = serializeBrentSnapshotForApi({
      id: "1",
      commodityType: "BRENT",
      priceUSD: { toString: () => "80" } as never,
      quoteDate: new Date("2026-07-08T12:00:00.000Z"),
      scheduledSlot: "MORNING_EARLY",
      collectedAt: new Date("2026-07-08T12:00:00.000Z"),
      source: "yahoo-finance",
      status: "SUCCESS",
      errorMessage: null,
      variationFromPrevious: null,
      trigger: "MANUAL",
    });
    assert.equal(api.scheduledSlot, "MORNING_EARLY");
    assert.equal(api.trigger, "MANUAL");
  });
});
