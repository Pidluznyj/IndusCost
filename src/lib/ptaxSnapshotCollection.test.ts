import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBcbPtaxDayResponse } from "./materialMarketPtax.js";
import {
  parsePtaxQuoteDateIso,
  serializePtaxSnapshotForApi,
} from "./ptaxSnapshotCollection.js";
import {
  PTAX_COLLECTION_SCHEDULE,
  PTAX_SNAPSHOT_REGISTERED_JOB,
  __testOnlyHasPtaxTriggeredSlot,
  resetPtaxSnapshotSchedulerForTests,
  resolvePtaxScheduledSlotForMinute,
} from "./ptaxSnapshotJob.js";
import {
  getSaoPauloDateTimeParts,
  listRegisteredScheduledJobs,
} from "./brentCommodityJob.js";

describe("ptax snapshot collection helpers", () => {
  it("parsePtaxQuoteDateIso usa meio-dia UTC", () => {
    const d = parsePtaxQuoteDateIso("2026-07-08");
    assert.equal(d.toISOString(), "2026-07-08T12:00:00.000Z");
  });

  it("serializePtaxSnapshotForApi expõe compra e venda", () => {
    const api = serializePtaxSnapshotForApi({
      id: "1",
      quoteDate: new Date("2026-07-08T12:00:00.000Z"),
      buyRate: { toString: () => "5.41" } as never,
      sellRate: { toString: () => "5.42" } as never,
      source: "BCB PTAX",
      status: "SUCCESS",
      errorMessage: null,
      collectedAt: new Date("2026-07-08T18:00:00.000Z"),
      createdAt: new Date("2026-07-08T18:00:00.000Z"),
    });
    assert.equal(api.buyRate, 5.41);
    assert.equal(api.sellRate, 5.42);
    assert.equal(api.quoteDate, "2026-07-08");
  });

  it("parseBcbPtaxDayResponse ignora linha sem compra ou venda", () => {
    assert.equal(parseBcbPtaxDayResponse("2026-07-08", { value: [{ cotacaoVenda: 5.4 }] }), null);
    assert.equal(parseBcbPtaxDayResponse("2026-07-08", { value: [] }), null);
  });
});

describe("ptax snapshot scheduled job", () => {
  it("mantém agenda PTAX legada 09:00 / 15:30 (não migrada junto com o Brent)", () => {
    assert.equal(PTAX_SNAPSHOT_REGISTERED_JOB.id, "ptax-snapshot-collection");
    assert.equal(PTAX_SNAPSHOT_REGISTERED_JOB.schedule, "09:00, 15:30");
    assert.equal(PTAX_SNAPSHOT_REGISTERED_JOB.timezone, "America/Sao_Paulo");
    assert.deepEqual(
      PTAX_COLLECTION_SCHEDULE.map((s) => ({ slot: s.slot, hour: s.hour, minute: s.minute })),
      [
        { slot: "MORNING", hour: 9, minute: 0 },
        { slot: "AFTERNOON", hour: 15, minute: 30 },
      ]
    );
  });

  it("listRegisteredScheduledJobs inclui Brent (nova agenda) e PTAX (agenda legada)", () => {
    const jobs = listRegisteredScheduledJobs();
    assert.equal(jobs.length, 2);
    assert.deepEqual(
      jobs.map((job) => job.id),
      ["brent-commodity-collection", "ptax-snapshot-collection"]
    );
    const brent = jobs.find((j) => j.id === "brent-commodity-collection")!;
    const ptax = jobs.find((j) => j.id === "ptax-snapshot-collection")!;
    assert.equal(brent.schedule, "07:00, 11:00, 14:00, 16:00");
    assert.equal(ptax.schedule, "09:00, 15:30");
  });

  it("resolvedor PTAX próprio ignora minutos fora da agenda 09:00/15:30", () => {
    resetPtaxSnapshotSchedulerForTests();
    const partsAt10 = getSaoPauloDateTimeParts(new Date("2026-07-08T13:00:00.000Z")); // 10:00 SP
    assert.equal(resolvePtaxScheduledSlotForMinute(partsAt10), null);

    const partsAt9 = getSaoPauloDateTimeParts(new Date("2026-07-08T12:00:00.000Z")); // 09:00 SP
    assert.equal(resolvePtaxScheduledSlotForMinute(partsAt9), "MORNING");

    const partsAt1530 = getSaoPauloDateTimeParts(new Date("2026-07-08T18:30:00.000Z")); // 15:30 SP
    assert.equal(resolvePtaxScheduledSlotForMinute(partsAt1530), "AFTERNOON");

    assert.equal(__testOnlyHasPtaxTriggeredSlot("2026-07-08", "MORNING"), false);
  });
});
