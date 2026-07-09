import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBcbPtaxDayResponse } from "./materialMarketPtax.js";
import {
  parsePtaxQuoteDateIso,
  serializePtaxSnapshotForApi,
} from "./ptaxSnapshotCollection.js";
import {
  PTAX_SNAPSHOT_REGISTERED_JOB,
  __testOnlyHasPtaxTriggeredSlot,
  resetPtaxSnapshotSchedulerForTests,
} from "./ptaxSnapshotJob.js";
import {
  getSaoPauloDateTimeParts,
  listRegisteredScheduledJobs,
  resolveScheduledSlotForMinute,
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
  it("registra job PTAX com agenda 09:00 e 15:30", () => {
    assert.equal(PTAX_SNAPSHOT_REGISTERED_JOB.id, "ptax-snapshot-collection");
    assert.equal(PTAX_SNAPSHOT_REGISTERED_JOB.schedule, "09:00, 15:30");
  });

  it("listRegisteredScheduledJobs inclui Brent e PTAX", () => {
    const jobs = listRegisteredScheduledJobs();
    assert.equal(jobs.length, 2);
    assert.deepEqual(
      jobs.map((job) => job.id),
      ["brent-commodity-collection", "ptax-snapshot-collection"]
    );
  });

  it("scheduler PTAX ignora minutos fora da agenda", () => {
    resetPtaxSnapshotSchedulerForTests();
    const parts = getSaoPauloDateTimeParts(new Date("2026-07-08T13:00:00.000Z"));
    assert.equal(resolveScheduledSlotForMinute(parts), null);
    assert.equal(__testOnlyHasPtaxTriggeredSlot("2026-07-08", "MORNING"), false);
  });
});
