/**
 * Fila persistente de recálculo — worker, retry e deduplicação (memory).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_PROJECTION_RECALC_EVENT_TYPES,
  TREASURY_PROJECTION_RECALC_JOB_STATUSES,
} from "./contracts/treasuryEnums.js";
import {
  buildTreasuryProjectionRecalcDeduplicationKey,
  computeTreasuryProjectionRecalcBackoffMs,
  computeTreasuryProjectionRecalcAvailableAt,
} from "./domain/treasuryProjectionRecalcQueue.js";
import {
  createEmptyTreasuryProjectionRecalcJobMemoryStore,
  createMemoryTreasuryProjectionRecalcJobRepository,
} from "./repositories/treasuryProjectionRecalcJobRepository.memory.js";
import {
  enqueueTreasuryProjectionRecalc,
  enqueueTreasuryProjectionRecalcForDefaultScenarios,
  mapTreasuryProjectionRecalcReasonToEventType,
  runTreasuryProjectionRecalcWorker,
} from "./services/treasuryProjectionRecalcQueueService.server.js";

describe("treasuryProjectionRecalcQueue", () => {
  it("contrato cobre todos os eventos e status da fila", () => {
    assert.deepEqual([...TREASURY_PROJECTION_RECALC_EVENT_TYPES], [
      "AR_SYNC",
      "AP_SYNC",
      "SETTLEMENT",
      "CANCELLATION",
      "EXPECTATION",
      "PROMISE",
      "PROGRAMMING",
      "LEDGER_ENTRY",
      "TRANSFER",
      "BALANCE",
      "RECONCILIATION",
      "REVERSAL",
      "CLOSING",
      "REOPENING",
    ]);
    assert.deepEqual([...TREASURY_PROJECTION_RECALC_JOB_STATUSES], [
      "PENDING",
      "LOCKED",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "DEAD",
    ]);
  });

  it("deduplicationKey é estável e company-wide usa subject *", () => {
    assert.equal(
      buildTreasuryProjectionRecalcDeduplicationKey({
        companyCode: "acme",
        scenario: "PROBABLE",
        eventType: "AR_SYNC",
        subjectId: "ignored",
      }),
      "ACME|PROBABLE|AR_SYNC|*"
    );
    assert.equal(
      buildTreasuryProjectionRecalcDeduplicationKey({
        companyCode: "ACME",
        scenario: "CONFIRMED",
        eventType: "EXPECTATION",
        subjectId: " title-1 ",
      }),
      "ACME|CONFIRMED|EXPECTATION|title-1"
    );
  });

  it("mapeia motivos de domínio para eventType", () => {
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("receivable_expectation_updated"),
      "EXPECTATION"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("receivable_promise_created"),
      "PROMISE"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("payable_payment_programmed"),
      "PROGRAMMING"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("ar_sync_completed"),
      "AR_SYNC"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("ap_sync_completed"),
      "AP_SYNC"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("settlement_baixa"),
      "SETTLEMENT"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("transfer_created"),
      "TRANSFER"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("balance_snapshot"),
      "BALANCE"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("reconciliation_matched"),
      "RECONCILIATION"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("ledger_entry_posted"),
      "LEDGER_ENTRY"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("reversal_applied"),
      "REVERSAL"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("daily_closing"),
      "CLOSING"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("daily_reopening"),
      "REOPENING"
    );
    assert.equal(
      mapTreasuryProjectionRecalcReasonToEventType("title_cancellation"),
      "CANCELLATION"
    );
  });

  it("deduplica eventos equivalentes enquanto ativos", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const now = new Date("2026-07-27T12:00:00.000Z");

    const first = await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "EXPECTATION",
        subjectId: "t1",
        requestId: "r1",
        payload: { n: 1 },
      },
      { repository, now: () => now }
    );
    assert.equal(first.deduplicated, false);
    assert.equal(first.job.status, "PENDING");
    assert.equal(store.jobs.length, 1);

    const second = await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "EXPECTATION",
        subjectId: "t1",
        requestId: "r2",
        payload: { n: 2 },
      },
      { repository, now: () => new Date("2026-07-27T12:00:05.000Z") }
    );
    assert.equal(second.deduplicated, true);
    assert.equal(second.job.id, first.job.id);
    assert.equal(store.jobs.length, 1);
    assert.equal(second.job.requestId, "r2");
    assert.equal(
      (second.job.payloadJson as { n: number; lastEventType: string }).n,
      2
    );

    const otherSubject = await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "EXPECTATION",
        subjectId: "t2",
      },
      { repository, now: () => now }
    );
    assert.equal(otherSubject.deduplicated, false);
    assert.equal(store.jobs.length, 2);
  });

  it("fan-out de cenários padrão cria 3 jobs distintos", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const results = await enqueueTreasuryProjectionRecalcForDefaultScenarios(
      {
        companyCode: "ACME",
        eventType: "AR_SYNC",
      },
      { repository, now: () => new Date("2026-07-27T12:00:00.000Z") }
    );
    assert.equal(results.length, 3);
    assert.equal(store.jobs.length, 3);
    assert.deepEqual(
      results.map((r) => r.job.scenario).sort(),
      ["CONFIRMED", "CONTRACTUAL", "PROBABLE"]
    );
  });

  it("worker conclui com SUCCEEDED, lock e completedAt", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const t0 = new Date("2026-07-27T12:00:00.000Z");
    await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "BALANCE",
        subjectId: "acc-1",
      },
      { repository, now: () => t0 }
    );

    let handled = 0;
    const result = await runTreasuryProjectionRecalcWorker({
      repository,
      workerId: "worker-a",
      now: () => new Date("2026-07-27T12:00:01.000Z"),
      handler: async (job) => {
        handled += 1;
        assert.equal(job.status, "PROCESSING");
        assert.equal(job.attempts, 1);
        assert.equal(job.lockedBy, "worker-a");
        assert.ok(job.lockToken);
      },
    });

    assert.equal(handled, 1);
    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(result.jobs[0]?.status, "SUCCEEDED");
    assert.ok(result.jobs[0]?.completedAt);
    assert.equal(result.jobs[0]?.lockedBy, null);
    assert.equal(result.jobs[0]?.lockToken, null);
  });

  it("retry agenda availableAt com backoff e preserva erro", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const t0 = new Date("2026-07-27T12:00:00.000Z");
    await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "TRANSFER",
        subjectId: "tg-1",
        maxAttempts: 3,
      },
      { repository, now: () => t0 }
    );

    const failAt = new Date("2026-07-27T12:00:01.000Z");
    const result = await runTreasuryProjectionRecalcWorker({
      repository,
      workerId: "worker-b",
      now: () => failAt,
      handler: async () => {
        const err = new Error("falha transitória");
        (err as Error & { code: string }).code = "TRANSIENT";
        throw err;
      },
    });

    assert.equal(result.retried, 1);
    assert.equal(result.dead, 0);
    const job = result.jobs[0]!;
    assert.equal(job.status, "PENDING");
    assert.equal(job.attempts, 1);
    assert.equal(job.lastErrorCode, "TRANSIENT");
    assert.match(job.lastErrorMessage ?? "", /falha transitória/);
    assert.equal(
      job.availableAt.getTime(),
      computeTreasuryProjectionRecalcAvailableAt(failAt, 1).getTime()
    );
    assert.equal(computeTreasuryProjectionRecalcBackoffMs(1), 5_000);

    // Ainda não disponível → worker não pega
    const early = await runTreasuryProjectionRecalcWorker({
      repository,
      workerId: "worker-b",
      now: () => new Date(failAt.getTime() + 1_000),
      handler: async () => {
        throw new Error("não deveria rodar");
      },
    });
    assert.equal(early.processed, 0);

    // Após backoff → segunda tentativa
    const retryAt = new Date(failAt.getTime() + 5_000);
    const second = await runTreasuryProjectionRecalcWorker({
      repository,
      workerId: "worker-b",
      now: () => retryAt,
      handler: async () => {
        throw new Error("ainda falha");
      },
    });
    assert.equal(second.retried, 1);
    assert.equal(second.jobs[0]?.attempts, 2);
    assert.equal(
      second.jobs[0]?.availableAt.getTime(),
      computeTreasuryProjectionRecalcAvailableAt(retryAt, 2).getTime()
    );
  });

  it("esgota tentativas e marca DEAD com erro e completedAt", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    let clock = new Date("2026-07-27T12:00:00.000Z");
    await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "CONTRACTUAL",
        eventType: "RECONCILIATION",
        subjectId: "rec-1",
        maxAttempts: 2,
      },
      { repository, now: () => clock }
    );

    for (let i = 0; i < 2; i += 1) {
      const result = await runTreasuryProjectionRecalcWorker({
        repository,
        workerId: "worker-dead",
        now: () => clock,
        handler: async () => {
          throw new Error("permanente");
        },
      });
      if (i === 0) {
        assert.equal(result.retried, 1);
        clock = new Date(result.jobs[0]!.availableAt.getTime());
      } else {
        assert.equal(result.dead, 1);
        assert.equal(result.jobs[0]?.status, "DEAD");
        assert.equal(result.jobs[0]?.attempts, 2);
        assert.ok(result.jobs[0]?.completedAt);
        assert.match(result.jobs[0]?.lastErrorMessage ?? "", /permanente/);
      }
    }
  });

  it("não reclama job SUCCEEDED e permite novo enqueue após conclusão", async () => {
    const store = createEmptyTreasuryProjectionRecalcJobMemoryStore();
    const repository = createMemoryTreasuryProjectionRecalcJobRepository(store);
    const t0 = new Date("2026-07-27T12:00:00.000Z");
    const first = await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "PROMISE",
        subjectId: "t9",
      },
      { repository, now: () => t0 }
    );
    await runTreasuryProjectionRecalcWorker({
      repository,
      workerId: "w",
      now: () => t0,
      handler: async () => undefined,
    });
    assert.equal(store.jobs[0]?.status, "SUCCEEDED");

    const again = await enqueueTreasuryProjectionRecalc(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        eventType: "PROMISE",
        subjectId: "t9",
      },
      { repository, now: () => new Date("2026-07-27T12:05:00.000Z") }
    );
    assert.equal(again.deduplicated, false);
    assert.notEqual(again.job.id, first.job.id);
    assert.equal(store.jobs.length, 2);
  });
});
