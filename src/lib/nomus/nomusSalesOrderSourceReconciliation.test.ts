/**
 * SYNC-04 — Reconciliação de lifecycle nos Pedidos de Venda.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoPhysicalDeletes,
  applyNomusSourceReconciliationPlanLocally,
} from "./nomusSourceReconciliationEngine.js";
import {
  assessSalesOrderSyncPayloadCompleteness,
  buildPresentLifecycleWriteData,
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  isSalesOrderPilotAbsence,
  planDirectedSalesOrderAbsenceConfirmation,
  SALES_ORDER_PILOT_ABSENCE,
  stableNomusSalesOrderPayloadHash,
  summarizeSalesOrderReconciliationPreview,
  type SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";

const executedAt = new Date("2026-07-17T18:00:00.000Z");

const fullScope = buildSalesOrderSyncReconciliationScope({
  strategy: "full-reconciliation",
  fromIso: "2026-07-01",
  toIso: "2026-07-31",
});

const recentScope = buildSalesOrderSyncReconciliationScope({
  strategy: "recent-window",
  fromIso: "2025-12-17",
  toIso: "2026-07-17",
});

function local(
  overrides: Partial<SalesOrderLifecycleLocalSnapshot> &
    Pick<SalesOrderLifecycleLocalSnapshot, "localId" | "externalSalesOrderId">
): SalesOrderLifecycleLocalSnapshot {
  return {
    orderCode: `PD ${String(overrides.externalSalesOrderId).padStart(5, "0")}`,
    payloadHash: "hash-a",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    firstSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-07-10T00:00:00.000Z"),
    ...overrides,
  };
}

function completeFullMeta() {
  return assessSalesOrderSyncPayloadCompleteness({
    strategy: "full-reconciliation",
    startPage: 1,
    completedWindow: false,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: true,
    http429Count: 0,
  });
}

describe("nomusSalesOrderSourceReconciliation — completude", () => {
  it("1. recent-window nunca marca ausência (não é universo completo)", () => {
    const c = assessSalesOrderSyncPayloadCompleteness({
      strategy: "recent-window",
      startPage: 1,
      completedWindow: false,
      stoppedBecauseEmpty: true,
      stoppedBecauseNoNext: false,
    });
    assert.equal(c.payloadComplete, false);
    assert.equal(c.status, "RECENT_WINDOW");
    assert.ok(c.reasons.includes("RECENT_WINDOW_NEVER_MARKS_ABSENT"));
  });

  it("2. full-reconciliation prova completude só com drain + startPage=1", () => {
    const ok = completeFullMeta();
    assert.equal(ok.payloadComplete, true);
    assert.equal(ok.status, "COMPLETE");

    const cursorBlock = assessSalesOrderSyncPayloadCompleteness({
      strategy: "full-reconciliation",
      startPage: 21,
      completedWindow: true,
      stoppedBecauseEmpty: false,
    });
    assert.equal(cursorBlock.payloadComplete, false);
    assert.ok(cursorBlock.reasons.includes("START_PAGE_NOT_ONE_INCOMPLETE_SNAPSHOT"));
  });
});

describe("nomusSalesOrderSourceReconciliation — CRUD lifecycle", () => {
  it("1. pedido novo → CREATE", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h1" }],
      localRecords: [],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.creates, 1);
    assert.equal(plan.creates[0]?.lifecyclePatch?.sourcePresenceStatus, "PRESENT");
  });

  it("2. alteração de cabeçalho (hash) → UPDATE", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h2" }],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100, payloadHash: "h1" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.updates, 1);
  });

  it("3. alteração de item refletida no hash estável", () => {
    const a = stableNomusSalesOrderPayloadHash({
      id: 1,
      itensPedido: [{ id: 1, quantidade: 1 }],
    });
    const b = stableNomusSalesOrderPayloadHash({
      id: 1,
      itensPedido: [{ id: 1, quantidade: 2 }],
    });
    assert.notEqual(a, b);
  });

  it("4. pedido inalterado → UNCHANGED", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "recent-window",
      scope: recentScope,
      completeness: assessSalesOrderSyncPayloadCompleteness({
        strategy: "recent-window",
        startPage: 1,
        completedWindow: false,
        stoppedBecauseEmpty: true,
      }),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h1" }],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100, payloadHash: "h1" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.unchanged, 1);
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("5. recent-window não marca ausência", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "recent-window",
      scope: recentScope,
      completeness: assessSalesOrderSyncPayloadCompleteness({
        strategy: "recent-window",
        startPage: 1,
        completedWindow: false,
        stoppedBecauseEmpty: true,
      }),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingCandidates, 0);
    assert.equal(plan.counters.missingConfirmed, 0);
  });

  it("6. full completa cria candidato", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.missingCandidates, 1);
    assert.equal(plan.missingCandidates[0]?.lifecyclePatch?.missingConsecutiveRuns, 1);
  });

  it("7. consulta direcionada confirma sem alterar outros", () => {
    const only = planDirectedSalesOrderAbsenceConfirmation({
      local: local({
        localId: "pilot",
        externalSalesOrderId: 2737,
        orderCode: "PD 02739",
        sourcePresenceStatus: "MISSING_CANDIDATE",
        missingConsecutiveRuns: 1,
      }),
      scope: fullScope,
      directedFound: false,
      executedAt,
      mode: "apply",
    });
    assert.equal(only?.action, "MISSING_CONFIRMED");
    assert.equal(only?.externalId, "2737");

    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h" }],
      localRecords: [
        local({ localId: "l1", externalSalesOrderId: 100, payloadHash: "h" }),
        local({ localId: "pilot", externalSalesOrderId: 2737, orderCode: "PD 02739" }),
      ],
      directedLookups: [{ externalSalesOrderId: 2737, found: false }],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.unchanged, 1);
    assert.equal(plan.counters.missingConfirmed, 1);
    assert.equal(plan.missingConfirmed[0]?.externalId, "2737");
    assert.equal(plan.missingConfirmed[0]?.reason, "DIRECTED_LOOKUP_NOT_FOUND");
  });

  it("8. PD 02739 no preview", () => {
    assert.ok(
      isSalesOrderPilotAbsence({
        orderCode: "PD 02739",
        externalSalesOrderId: 2737,
      })
    );
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId,
          orderCode: SALES_ORDER_PILOT_ABSENCE.orderCode,
        }),
      ],
      directedLookups: [
        { externalSalesOrderId: SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId, found: false },
      ],
      executedAt,
      mode: "preview",
    });
    const summary = summarizeSalesOrderReconciliationPreview(
      plan,
      completeFullMeta(),
      new Map([["2737", "PD 02739"]])
    );
    assert.equal(summary.missingConfirmed.length, 1);
    assert.equal(summary.missingConfirmed[0]?.orderCode, "PD 02739");
    assert.equal(summary.missingConfirmed[0]?.externalId, "2737");
  });

  it("9. pedido reaparece → REACTIVATE", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 2737, payloadHash: "h-new" }],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          payloadHash: "h-old",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          presentInLastPayload: false,
          missingConsecutiveRuns: 2,
          missingSince: executedAt,
          sourceRemovedAt: executedAt,
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.reactivated, 1);
    assert.equal(plan.reactivated[0]?.lifecyclePatch?.sourcePresenceStatus, "PRESENT");
    assert.equal(plan.reactivated[0]?.lifecyclePatch?.missingSince, null);
  });

  it("10. payload parcial → sem ausência", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: assessSalesOrderSyncPayloadCompleteness({
        strategy: "full-reconciliation",
        startPage: 1,
        completedWindow: true,
        stoppedBecauseEmpty: false,
      }),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("11. erro HTTP → FAILED / sem confirmação", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: assessSalesOrderSyncPayloadCompleteness({
        strategy: "full-reconciliation",
        startPage: 1,
        completedWindow: false,
        stoppedBecauseEmpty: false,
        fetchFailed: true,
        errors: ["http 500"],
      }),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      runStatus: "FAILED",
      mode: "apply",
    });
    assert.equal(plan.counters.missingConfirmed, 0);
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("12. 429 não recuperado → sem ausência", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: assessSalesOrderSyncPayloadCompleteness({
        strategy: "full-reconciliation",
        startPage: 1,
        completedWindow: false,
        stoppedBecauseEmpty: false,
        fetchFailed: true,
        http429Count: 3,
        errors: ["429"],
      }),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [local({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      runStatus: "INCONCLUSIVE",
      mode: "apply",
    });
    assert.equal(plan.absencesEvaluated, false);
  });

  it("13. item removido no Nomus — política oficial via hash/stale (não delete físico)", () => {
    // Syncer marca stale; motor de lifecycle não deleta SalesOrder nem itens.
    const write = buildPresentLifecycleWriteData({
      payloadHash: "h",
      executedAt,
      runId: "run-1",
      isCreate: false,
    });
    assert.equal(write.sourcePresenceStatus, "PRESENT");
    assert.ok(!("delete" in write));
  });

  it("14. campos internos preservados no write de presença", () => {
    const write = buildPresentLifecycleWriteData({
      payloadHash: "abc",
      executedAt,
      runId: null,
      isCreate: false,
    });
    assert.equal(write.payloadHash, "abc");
    assert.equal(write.totalCost, undefined);
    assert.equal(write.responsible, undefined);
    assert.equal(write.externalSellerId, undefined);
  });

  it("15. hooks: reativação classificada separadamente (mesmos hooks de update no syncer)", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 1, payloadHash: "h" }],
      localRecords: [
        local({
          localId: "l1",
          externalSalesOrderId: 1,
          payloadHash: "h",
          sourcePresenceStatus: "MISSING_CANDIDATE",
          missingConsecutiveRuns: 1,
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.reactivated, 1);
    assert.equal(plan.counters.updates, 0);
    // Syncer inclui localId em affectedSalesOrderIds uma vez — ver integração.
    assert.equal(plan.reactivated.length, 1);
  });

  it("16. idempotência", () => {
    const found = [{ externalSalesOrderId: 100, payloadHash: "h1" }];
    const locals = [local({ localId: "l1", externalSalesOrderId: 100, payloadHash: "h1" })];
    const args = {
      strategy: "full-reconciliation" as const,
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: found,
      localRecords: locals,
      executedAt,
      mode: "apply" as const,
    };
    const a = buildSalesOrderSourceReconciliationPlan(args);
    const b = buildSalesOrderSourceReconciliationPlan(args);
    assert.deepEqual(a.counters, b.counters);

    const engineLocals = locals.map((l) => ({
      localId: l.localId,
      externalId: String(l.externalSalesOrderId),
      entityType: "SALES_ORDER" as const,
      payloadHash: l.payloadHash,
      sourcePresenceStatus: l.sourcePresenceStatus,
      presentInLastPayload: l.presentInLastPayload,
      missingConsecutiveRuns: l.missingConsecutiveRuns,
      missingSince: l.missingSince,
      sourceRemovedAt: l.sourceRemovedAt,
      scope: fullScope,
    }));
    const after = applyNomusSourceReconciliationPlanLocally(
      engineLocals,
      a,
      found.map((f) => ({
        externalId: String(f.externalSalesOrderId),
        payloadHash: f.payloadHash,
      }))
    );
    const again = buildSalesOrderSourceReconciliationPlan({
      ...args,
      localRecords: after.map((r) => ({
        localId: r.localId,
        externalSalesOrderId: Number(r.externalId),
        orderCode: "PD 00100",
        payloadHash: r.payloadHash ?? null,
        sourcePresenceStatus: r.sourcePresenceStatus,
        presentInLastPayload: r.presentInLastPayload,
        missingConsecutiveRuns: r.missingConsecutiveRuns,
        missingSince: r.missingSince,
        sourceRemovedAt: r.sourceRemovedAt,
      })),
    });
    assert.equal(again.counters.unchanged, 1);
    assert.equal(again.counters.creates, 0);
  });

  it("17. nenhum delete físico", () => {
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: fullScope,
      completeness: completeFullMeta(),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.deletes, 0);
    assertNoPhysicalDeletes(plan);
  });
});
