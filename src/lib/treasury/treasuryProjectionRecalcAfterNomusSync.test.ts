/**
 * Integração sync AR/AP → fila de recálculo (regras + enqueue + wiring).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { planPostSyncHooks } from "../nomus/nomusCanonicalSyncContract.js";
import {
  buildTreasuryProjectionRecalcAfterNomusSyncPayload,
  mergeTreasuryProjectionRecalcAffectedPeriod,
  mergeTreasuryProjectionRecalcAfterNomusSyncPayload,
  resolveTreasuryCompanyCodeForNomusSync,
  shouldEnqueueTreasuryProjectionRecalcAfterNomusSync,
} from "./domain/treasuryProjectionRecalcAfterNomusSync.js";
import {
  createEmptyTreasuryProjectionRecalcJobMemoryStore,
  createMemoryTreasuryProjectionRecalcJobRepository,
} from "./repositories/treasuryProjectionRecalcJobRepository.memory.js";
import { runTreasuryProjectionRecalcAfterNomusSync } from "./services/treasuryProjectionRecalcAfterNomusSync.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

describe("treasuryProjectionRecalcAfterNomusSync — decisão", () => {
  it("não emite em preview, falha, incompleto ou sem mudanças", () => {
    assert.equal(
      shouldEnqueueTreasuryProjectionRecalcAfterNomusSync({
        mode: "preview",
        exitCode: 0,
        payloadComplete: true,
        officialRunSucceeded: true,
        created: 1,
        updated: 0,
      }).enqueue,
      false
    );
    assert.equal(
      shouldEnqueueTreasuryProjectionRecalcAfterNomusSync({
        mode: "apply",
        exitCode: 1,
        payloadComplete: true,
        officialRunSucceeded: true,
        created: 1,
        updated: 0,
      }).reason,
      "sync_exit_failed"
    );
    assert.equal(
      shouldEnqueueTreasuryProjectionRecalcAfterNomusSync({
        mode: "apply",
        exitCode: 0,
        payloadComplete: false,
        officialRunSucceeded: false,
        created: 5,
        updated: 2,
      }).reason,
      "payload_incomplete_preserves_checkpoint"
    );
    assert.equal(
      shouldEnqueueTreasuryProjectionRecalcAfterNomusSync({
        mode: "apply",
        exitCode: 0,
        payloadComplete: true,
        officialRunSucceeded: true,
        created: 0,
        updated: 0,
        lifecycleApplied: 0,
      }).reason,
      "no_relevant_changes"
    );
  });

  it("emite somente após run oficial SUCCESS com mudanças", () => {
    const ok = shouldEnqueueTreasuryProjectionRecalcAfterNomusSync({
      mode: "apply",
      exitCode: 0,
      payloadComplete: true,
      officialRunSucceeded: true,
      created: 0,
      updated: 1,
    });
    assert.equal(ok.enqueue, true);
    assert.equal(ok.reason, "official_sync_succeeded_with_changes");
  });

  it("registra e une período mínimo afetado", () => {
    const payload = buildTreasuryProjectionRecalcAfterNomusSyncPayload({
      source: "accounts-receivable",
      eventType: "AR_SYNC",
      sourceSyncRunId: "run-1",
      coveredFrom: new Date("2026-01-01T00:00:00.000Z"),
      coveredTo: new Date("2026-01-31T23:59:59.999Z"),
      created: 2,
      updated: 3,
      now: new Date("2026-07-27T15:00:00.000Z"),
    });
    assert.equal(payload.affectedPeriodFrom, "2026-01-01");
    assert.equal(payload.affectedPeriodTo, "2026-01-31");

    const mergedPeriod = mergeTreasuryProjectionRecalcAffectedPeriod(
      { affectedPeriodFrom: "2026-01-10", affectedPeriodTo: "2026-02-10" },
      { affectedPeriodFrom: "2026-01-01", affectedPeriodTo: "2026-01-20" }
    );
    assert.deepEqual(mergedPeriod, {
      affectedPeriodFrom: "2026-01-01",
      affectedPeriodTo: "2026-02-10",
    });

    const merged = mergeTreasuryProjectionRecalcAfterNomusSyncPayload(payload, {
      ...payload,
      sourceSyncRunId: "run-2",
      sourceSyncRunIds: ["run-2"],
      affectedPeriodFrom: "2025-12-01",
      affectedPeriodTo: "2026-02-15",
      created: 1,
      updated: 0,
    });
    assert.equal(merged.affectedPeriodFrom, "2025-12-01");
    assert.equal(merged.affectedPeriodTo, "2026-02-15");
    assert.deepEqual(merged.sourceSyncRunIds, ["run-1", "run-2"]);
    assert.equal(merged.created, 3);
  });

  it("resolve companyCode com default LAZARIOS", () => {
    assert.equal(
      resolveTreasuryCompanyCodeForNomusSync({}),
      "LAZARIOS"
    );
    assert.equal(
      resolveTreasuryCompanyCodeForNomusSync({ TREASURY_COMPANY_CODE: "acme" }),
      "ACME"
    );
  });
});

describe("treasuryProjectionRecalcAfterNomusSync — enqueue integração", () => {
  it("enfileira AR_SYNC nos 3 cenários e deduplica segundo evento", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const now = new Date("2026-07-27T12:00:00.000Z");

    const first = await runTreasuryProjectionRecalcAfterNomusSync(
      {
        source: "accounts-receivable",
        eventType: "AR_SYNC",
        mode: "apply",
        exitCode: 0,
        payloadComplete: true,
        officialRunSucceeded: true,
        sourceSyncRunId: "ar-run-1",
        coveredFrom: new Date("2026-03-01T00:00:00.000Z"),
        coveredTo: new Date("2026-03-15T23:59:59.999Z"),
        created: 1,
        updated: 0,
        companyCode: "LAZARIOS",
        requestId: "corr-1",
      },
      { repository, now: () => now }
    );
    assert.equal(first.decision.enqueue, true);
    assert.equal(first.jobs.length, 3);
    assert.equal(store.jobs.length, 3);

    const second = await runTreasuryProjectionRecalcAfterNomusSync(
      {
        source: "accounts-receivable",
        eventType: "AR_SYNC",
        mode: "apply",
        exitCode: 0,
        payloadComplete: true,
        officialRunSucceeded: true,
        sourceSyncRunId: "ar-run-2",
        coveredFrom: new Date("2026-02-01T00:00:00.000Z"),
        coveredTo: new Date("2026-03-20T23:59:59.999Z"),
        created: 0,
        updated: 2,
        companyCode: "LAZARIOS",
      },
      { repository, now: () => new Date("2026-07-27T12:01:00.000Z") }
    );
    assert.ok(second.jobs.every((j) => j.deduplicated));
    assert.equal(store.jobs.length, 3);
    const payload = second.jobs[0]!.job
      .payloadJson as { affectedPeriodFrom: string; affectedPeriodTo: string };
    assert.equal(payload.affectedPeriodFrom, "2026-02-01");
    assert.equal(payload.affectedPeriodTo, "2026-03-20");
  });

  it("não enfileira AP quando sync parcial (INCONCLUSIVE)", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const result = await runTreasuryProjectionRecalcAfterNomusSync(
      {
        source: "accounts-payable",
        eventType: "AP_SYNC",
        mode: "apply",
        exitCode: 0,
        payloadComplete: false,
        officialRunSucceeded: false,
        sourceSyncRunId: "ap-run-partial",
        coveredFrom: new Date("2026-04-01T00:00:00.000Z"),
        coveredTo: new Date("2026-04-30T23:59:59.999Z"),
        created: 10,
        updated: 5,
        companyCode: "LAZARIOS",
      },
      { repository }
    );
    assert.equal(result.decision.enqueue, false);
    assert.equal(store.jobs.length, 0);
  });

  it("enfileira AP_SYNC após SUCCESS com lifecycle", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const result = await runTreasuryProjectionRecalcAfterNomusSync(
      {
        source: "accounts-payable",
        eventType: "AP_SYNC",
        mode: "apply",
        exitCode: 0,
        payloadComplete: true,
        officialRunSucceeded: true,
        sourceSyncRunId: "ap-run-1",
        coveredFrom: new Date("2026-05-01T00:00:00.000Z"),
        coveredTo: new Date("2026-05-31T23:59:59.999Z"),
        created: 0,
        updated: 0,
        lifecycleApplied: 2,
        companyCode: "LAZARIOS",
      },
      { repository }
    );
    assert.equal(result.decision.enqueue, true);
    assert.equal(result.jobs[0]?.job.eventType, "AP_SYNC");
  });
});

describe("treasuryProjectionRecalcAfterNomusSync — wiring", () => {
  it("contrato canônico planeja hook AR/AP e não em preview", () => {
    const ar = planPostSyncHooks({
      mode: "apply",
      entity: "ACCOUNTS_RECEIVABLE",
      applySucceeded: true,
      hasRelevantChanges: true,
    });
    assert.ok(
      ar.some((h) => h.shouldRun && h.name === "treasuryProjectionRecalc")
    );
    const ap = planPostSyncHooks({
      mode: "apply",
      entity: "ACCOUNTS_PAYABLE",
      applySucceeded: true,
      hasRelevantChanges: true,
    });
    assert.ok(
      ap.some((h) => h.shouldRun && h.name === "treasuryProjectionRecalc")
    );
    const preview = planPostSyncHooks({
      mode: "preview",
      entity: "ACCOUNTS_PAYABLE",
      applySucceeded: true,
      hasRelevantChanges: true,
    });
    assert.ok(
      preview.every(
        (h) => !(h.name === "treasuryProjectionRecalc" && h.shouldRun)
      )
    );
  });

  it("scripts AR/AP chamam hook após sync oficial sem novo cron", () => {
    const ar = readFileSync(
      join(repoRoot, "scripts/nomusAccountsReceivableSync.ts"),
      "utf8"
    );
    const ap = readFileSync(
      join(repoRoot, "scripts/nomusAccountsPayableSync.ts"),
      "utf8"
    );
    assert.match(ar, /runTreasuryProjectionRecalcAfterNomusSync/);
    assert.match(ar, /eventType:\s*"AR_SYNC"/);
    assert.match(ar, /finishAccountsReceivableSourceSyncRun/);
    assert.match(ar, /sync oficial preservado/);
    assert.match(ap, /runTreasuryProjectionRecalcAfterNomusSync/);
    assert.match(ap, /eventType:\s*"AP_SYNC"/);
    assert.match(ap, /finishAccountsPayableSourceSyncRun/);
    assert.doesNotMatch(ar, /cron\.schedule|node-cron|BullMQ|Kafka|RabbitMQ/i);
    assert.doesNotMatch(ap, /cron\.schedule|node-cron|BullMQ|Kafka|RabbitMQ/i);
  });
});
