/**
 * SYNC-05 — Reconciliação de lifecycle nas Contas a Receber.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoPhysicalDeletes,
  applyNomusSourceReconciliationPlanLocally,
} from "./nomusSourceReconciliationEngine.js";
import {
  ACCOUNTS_RECEIVABLE_PILOT,
  assertAbsencePatchPreservesFinancialHistory,
  assessAccountsReceivableSyncPayloadCompleteness,
  buildAccountsReceivableSourceReconciliationPlan,
  buildAccountsReceivableSyncReconciliationScope,
  buildPresentAccountsReceivableLifecycleWriteData,
  isAccountsReceivablePilot,
  isOpenAccountsReceivableTitle,
  parseNomusFinancialOnlyPending,
  planDirectedAccountsReceivableAbsenceConfirmation,
  selectLocalsForAccountsReceivableAbsenceUniverse,
  summarizeAccountsReceivableReconciliationPreview,
  type AccountsReceivableLifecycleLocalSnapshot,
} from "./nomusAccountsReceivableSourceReconciliation.js";

const executedAt = new Date("2026-07-17T20:00:00.000Z");

const allScope = buildAccountsReceivableSyncReconciliationScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: false,
  syncStrategy: "full_refresh_upsert",
});

const openScope = buildAccountsReceivableSyncReconciliationScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: true,
  syncStrategy: "full_refresh_upsert",
});

function local(
  overrides: Partial<AccountsReceivableLifecycleLocalSnapshot> &
    Pick<AccountsReceivableLifecycleLocalSnapshot, "localId" | "externalId">
): AccountsReceivableLifecycleLocalSnapshot {
  return {
    payloadHash: "hash-a",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    balanceReceivable: 1000,
    amountReceived: 0,
    settlementDate: null,
    status: true,
    ...overrides,
  };
}

function completeMeta(onlyPending = false) {
  return assessAccountsReceivableSyncPayloadCompleteness({
    syncStrategy: "full_refresh_upsert",
    startPage: 1,
    maxPages: 200,
    pagesRead: 3,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: true,
    stoppedBecauseMaxPages: false,
    onlyPending,
    http429Count: 0,
  });
}

describe("nomusAccountsReceivableSourceReconciliation — escopo", () => {
  it("checklist: apenasPendentes=false não é open-only", () => {
    assert.equal(parseNomusFinancialOnlyPending({ NOMUS_FINANCIAL_ONLY_PENDING: "false" }), false);
    const c = completeMeta(false);
    assert.equal(c.authoritativeScope, "DUE_DATE_WINDOW_ALL_TITLES");
    assert.ok(c.reasons.includes("PAID_TITLES_INCLUDED_IN_PAYLOAD_WHEN_PRESENT"));
  });

  it("checklist: apenasPendentes=true → OPEN_RECEIVABLES_SCOPE", () => {
    const c = completeMeta(true);
    assert.equal(c.authoritativeScope, "OPEN_RECEIVABLES_SCOPE");
    assert.ok(c.reasons.includes("OPEN_RECEIVABLES_SCOPE"));
  });

  it("full_refresh label sozinho não prova completude", () => {
    const c = assessAccountsReceivableSyncPayloadCompleteness({
      syncStrategy: "full_refresh_upsert",
      startPage: 1,
      maxPages: 200,
      pagesRead: 200,
      stoppedBecauseEmpty: false,
      stoppedBecauseNoNext: false,
      stoppedBecauseMaxPages: true,
      onlyPending: false,
    });
    assert.equal(c.payloadComplete, false);
    assert.ok(c.reasons.includes("ABSENCE_CONFIRMATION_BLOCKED"));
  });
});

describe("nomusAccountsReceivableSourceReconciliation — CRUD lifecycle", () => {
  it("1. CR novo → CREATE", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "h1" }],
      localRecords: [],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.creates, 1);
    assert.equal(plan.creates[0]?.lifecyclePatch?.sourcePresenceStatus, "PRESENT");
  });

  it("2. saldo alterado → UPDATE", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "h-saldo" }],
      localRecords: [local({ localId: "a", externalId: 10, payloadHash: "h-old" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.updates, 1);
  });

  it("3. pagamento parcial — hash muda (UPDATE); amountReceived preservável no registro", () => {
    const write = buildPresentAccountsReceivableLifecycleWriteData({
      payloadHash: "partial-pay",
      executedAt,
      runId: "r1",
      isCreate: false,
    });
    assert.equal(write.amountReceived, undefined);
    assert.equal(write.sourcePresenceStatus, "PRESENT");
  });

  it("4. pagamento integral — título liquidado não é open", () => {
    assert.equal(
      isOpenAccountsReceivableTitle({
        balanceReceivable: 0,
        settlementDate: executedAt,
      }),
      false
    );
  });

  it("5. vencimento alterado → UPDATE via hash", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "due-new" }],
      localRecords: [local({ localId: "a", externalId: 10, payloadHash: "due-old" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.updates, 1);
  });

  it("6. CR cancelado (status false) — UPDATE, sem delete", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "cancel" }],
      localRecords: [
        local({ localId: "a", externalId: 10, payloadHash: "open", status: true }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.updates, 1);
    assert.equal(plan.counters.deletes, 0);
  });

  it("7. CR ausente candidato", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: [local({ localId: "a", externalId: 17748, balanceReceivable: 500 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.missingCandidates, 1);
    assert.equal(plan.missingCandidates[0]?.externalId, "17748");
  });

  it("8. confirmação direcionada", () => {
    const item = planDirectedAccountsReceivableAbsenceConfirmation({
      local: local({
        localId: "a",
        externalId: 17748,
        sourcePresenceStatus: "MISSING_CANDIDATE",
        missingConsecutiveRuns: 1,
        amountReceived: 200,
        balanceReceivable: 300,
      }),
      scope: allScope,
      directedFound: false,
      executedAt,
      mode: "apply",
    });
    assert.equal(item?.action, "MISSING_CONFIRMED");
    assertAbsencePatchPreservesFinancialHistory(item!.lifecyclePatch!);
  });

  it("9. CR reaparece → REACTIVATE", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 17748, payloadHash: "back" }],
      localRecords: [
        local({
          localId: "a",
          externalId: 17748,
          payloadHash: "old",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          missingConsecutiveRuns: 2,
          amountReceived: 150,
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.reactivated, 1);
    assert.equal(plan.reactivated[0]?.lifecyclePatch?.missingSince, null);
  });

  it("10. ausência de Pedido não altera CR (independência)", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 17748, payloadHash: "h" }],
      localRecords: [local({ localId: "a", externalId: 17748, payloadHash: "h" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.unchanged, 1);
    assert.ok(plan.reasons.includes("SALES_ORDER_ABSENCE_DOES_NOT_IMPLY_AR_ABSENCE"));
    assert.ok(isAccountsReceivablePilot(ACCOUNTS_RECEIVABLE_PILOT.externalId));
    // Plano AR não contém entityType SALES_ORDER.
    assert.ok(
      ![...plan.creates, ...plan.updates, ...plan.unchanged].some(
        (i) => i.entityType !== "ACCOUNTS_RECEIVABLE"
      )
    );
  });

  it("11. payload somente aberto não remove histórico pago", () => {
    const paid = local({
      localId: "paid",
      externalId: 99,
      balanceReceivable: 0,
      amountReceived: 5000,
      settlementDate: executedAt,
    });
    const open = local({ localId: "open", externalId: 1, balanceReceivable: 100 });
    const { inUniverse, preservedHistoricalPaid } =
      selectLocalsForAccountsReceivableAbsenceUniverse({
        locals: [paid, open],
        onlyPending: true,
      });
    assert.equal(inUniverse.length, 1);
    assert.equal(preservedHistoricalPaid.length, 1);

    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: openScope,
      completeness: completeMeta(true),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 1, payloadHash: "h" }],
      localRecords: [paid, open],
      executedAt,
      mode: "apply",
    });
    assert.ok(
      plan.ignoredOutsideScope.some(
        (i) => i.reason === "PAID_HISTORICAL_OUTSIDE_OPEN_RECEIVABLES_SCOPE"
      )
    );
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("12. payload incompleto — sem ausência", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: assessAccountsReceivableSyncPayloadCompleteness({
        syncStrategy: "full_refresh_upsert",
        startPage: 1,
        maxPages: 200,
        pagesRead: 200,
        stoppedBecauseEmpty: false,
        stoppedBecauseNoNext: false,
        stoppedBecauseMaxPages: true,
        onlyPending: false,
      }),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: [local({ localId: "a", externalId: 10 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("13. 429 não recuperado", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: assessAccountsReceivableSyncPayloadCompleteness({
        syncStrategy: "full_refresh_upsert",
        startPage: 1,
        maxPages: 200,
        pagesRead: 1,
        stoppedBecauseEmpty: false,
        stoppedBecauseNoNext: false,
        stoppedBecauseMaxPages: false,
        onlyPending: false,
        fetchFailed: true,
        http429Count: 2,
        errors: ["429"],
      }),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: [local({ localId: "a", externalId: 10 })],
      executedAt,
      runStatus: "INCONCLUSIVE",
      mode: "apply",
    });
    assert.equal(plan.absencesEvaluated, false);
  });

  it("14. duplicidade por externalId — um local no plano", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "h" }],
      localRecords: [
        local({ localId: "a", externalId: 10, payloadHash: "h" }),
        local({ localId: "b", externalId: 10, payloadHash: "h" }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.unchanged, 1);
  });

  it("15. comissão paga preservada — patch de ausência sem campos financeiros", () => {
    const item = planDirectedAccountsReceivableAbsenceConfirmation({
      local: local({ localId: "a", externalId: 1, amountReceived: 999 }),
      scope: allScope,
      directedFound: false,
      executedAt,
      mode: "apply",
    });
    assertAbsencePatchPreservesFinancialHistory(item!.lifecyclePatch!);
  });

  it("16. valor recebido protegido no preview de ausência", () => {
    const locals = [
      local({
        localId: "a",
        externalId: 17748,
        balanceReceivable: 400,
        amountReceived: 600,
      }),
    ];
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: locals,
      executedAt,
      mode: "preview",
    });
    const summary = summarizeAccountsReceivableReconciliationPreview(
      plan,
      completeMeta(),
      allScope,
      new Map([["17748", locals[0]!]])
    );
    assert.equal(summary.totalOpenAffected, 400);
    assert.equal(summary.totalReceivedHistoricalProtected, 600);
    assert.equal(summary.missingCandidates[0]?.externalId, "17748");
  });

  it("17. idempotência", () => {
    const found = [{ externalId: 10, payloadHash: "h1" }];
    const locals = [local({ localId: "a", externalId: 10, payloadHash: "h1" })];
    const args = {
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: found,
      localRecords: locals,
      executedAt,
      mode: "apply" as const,
    };
    const a = buildAccountsReceivableSourceReconciliationPlan(args);
    const b = buildAccountsReceivableSourceReconciliationPlan(args);
    assert.deepEqual(a.counters, b.counters);

    const engineLocals = locals.map((l) =>
      ({
        localId: l.localId,
        externalId: String(l.externalId),
        entityType: "ACCOUNTS_RECEIVABLE" as const,
        payloadHash: l.payloadHash,
        sourcePresenceStatus: l.sourcePresenceStatus,
        presentInLastPayload: l.presentInLastPayload,
        missingConsecutiveRuns: l.missingConsecutiveRuns,
        missingSince: l.missingSince,
        sourceRemovedAt: l.sourceRemovedAt,
        scope: allScope,
      })
    );
    const after = applyNomusSourceReconciliationPlanLocally(
      engineLocals,
      a,
      found.map((f) => ({ externalId: String(f.externalId), payloadHash: f.payloadHash }))
    );
    const again = buildAccountsReceivableSourceReconciliationPlan({
      ...args,
      localRecords: after.map((r) => ({
        localId: r.localId,
        externalId: Number(r.externalId),
        payloadHash: r.payloadHash ?? null,
        sourcePresenceStatus: r.sourcePresenceStatus,
        presentInLastPayload: r.presentInLastPayload,
        missingConsecutiveRuns: r.missingConsecutiveRuns,
        missingSince: r.missingSince,
        sourceRemovedAt: r.sourceRemovedAt,
      })),
    });
    assert.equal(again.counters.unchanged, 1);
  });

  it("18. nenhum delete físico", () => {
    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: [local({ localId: "a", externalId: 17748 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.deletes, 0);
    assertNoPhysicalDeletes(plan);
  });
});
