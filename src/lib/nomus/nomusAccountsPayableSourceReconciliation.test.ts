/**
 * SYNC-06 — Reconciliação de lifecycle nas Contas a Pagar.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAccountsPayableOperationalDueDate } from "../financeAccountsPayableOperational.js";
import {
  assertNoPhysicalDeletes,
  applyNomusSourceReconciliationPlanLocally,
} from "./nomusSourceReconciliationEngine.js";
import {
  assertAbsencePatchPreservesFinancialHistory,
  assertAccountsPayableOperationalAxisIsDueDate,
  assessAccountsPayableSyncPayloadCompleteness,
  buildAccountsPayableSourceReconciliationPlan,
  buildAccountsPayableSyncReconciliationScope,
  buildPresentAccountsPayableLifecycleWriteData,
  isOpenAccountsPayableTitle,
  parseNomusFinancialOnlyPending,
  planDirectedAccountsPayableAbsenceConfirmation,
  selectLocalsForAccountsPayableAbsenceUniverse,
  summarizeAccountsPayableReconciliationPreview,
  type AccountsPayableLifecycleLocalSnapshot,
} from "./nomusAccountsPayableSourceReconciliation.js";

const executedAt = new Date("2026-07-17T20:00:00.000Z");
const dueDate = new Date("2026-08-01T00:00:00.000Z");

const allScope = buildAccountsPayableSyncReconciliationScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: false,
  syncStrategy: "full_refresh_upsert",
});

const openScope = buildAccountsPayableSyncReconciliationScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: true,
  syncStrategy: "full_refresh_upsert",
});

function local(
  overrides: Partial<AccountsPayableLifecycleLocalSnapshot> &
    Pick<AccountsPayableLifecycleLocalSnapshot, "localId" | "externalId">
): AccountsPayableLifecycleLocalSnapshot {
  return {
    payloadHash: "hash-a",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    balancePayable: 1000,
    amountPaid: 0,
    settlementDate: null,
    status: true,
    dueDateIso: dueDate.toISOString().slice(0, 10),
    ...overrides,
  };
}

function completeMeta(onlyPending = false) {
  return assessAccountsPayableSyncPayloadCompleteness({
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

describe("nomusAccountsPayableSourceReconciliation — escopo", () => {
  it("checklist: endpoint cobre abertos/pagos quando apenasPendentes=false", () => {
    assert.equal(parseNomusFinancialOnlyPending({ NOMUS_FINANCIAL_ONLY_PENDING: "false" }), false);
    const c = completeMeta(false);
    assert.equal(c.authoritativeScope, "DUE_DATE_WINDOW_ALL_TITLES");
    assert.ok(c.reasons.includes("PAID_TITLES_INCLUDED_IN_PAYLOAD_WHEN_PRESENT"));
  });

  it("checklist: apenasPendentes=true → OPEN_PAYABLES_SCOPE", () => {
    const c = completeMeta(true);
    assert.equal(c.authoritativeScope, "OPEN_PAYABLES_SCOPE");
  });

  it("full_refresh label sozinho não prova completude", () => {
    const c = assessAccountsPayableSyncPayloadCompleteness({
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

describe("nomusAccountsPayableSourceReconciliation — CRUD lifecycle", () => {
  it("1. CP novo → CREATE", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
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
    assert.equal(plan.creates[0]?.entityType, "ACCOUNTS_PAYABLE");
  });

  it("2. alteração de vencimento → UPDATE", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
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

  it("3. alteração de valor → UPDATE", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "val-new" }],
      localRecords: [local({ localId: "a", externalId: 10, payloadHash: "val-old" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.updates, 1);
  });

  it("4. pagamento parcial — lifecycle não apaga amountPaid", () => {
    const write = buildPresentAccountsPayableLifecycleWriteData({
      payloadHash: "partial",
      executedAt,
      runId: "r1",
      isCreate: false,
    });
    assert.equal(write.amountPaid, undefined);
    assert.equal(write.sourcePresenceStatus, "PRESENT");
  });

  it("5. pagamento integral — título liquidado fora do open scope", () => {
    assert.equal(
      isOpenAccountsPayableTitle({
        balancePayable: 0,
        settlementDate: executedAt,
      }),
      false
    );
  });

  it("6. cancelamento — UPDATE sem delete", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 10, payloadHash: "cancel" }],
      localRecords: [local({ localId: "a", externalId: 10, payloadHash: "open" })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.updates, 1);
    assert.equal(plan.counters.deletes, 0);
  });

  it("7. ausência candidata", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: [local({ localId: "a", externalId: 55, balancePayable: 800 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.missingCandidates, 1);
  });

  it("8. ausência confirmada (direcionada)", () => {
    const item = planDirectedAccountsPayableAbsenceConfirmation({
      local: local({
        localId: "a",
        externalId: 55,
        sourcePresenceStatus: "MISSING_CANDIDATE",
        missingConsecutiveRuns: 1,
        amountPaid: 100,
      }),
      scope: allScope,
      directedFound: false,
      executedAt,
      mode: "apply",
    });
    assert.equal(item?.action, "MISSING_CONFIRMED");
    assertAbsencePatchPreservesFinancialHistory(item!.lifecyclePatch!);
  });

  it("9. reativação", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [{ externalId: 55, payloadHash: "back" }],
      localRecords: [
        local({
          localId: "a",
          externalId: 55,
          payloadHash: "old",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          missingConsecutiveRuns: 2,
          amountPaid: 50,
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.reactivated, 1);
  });

  it("10. payload incompleto — sem ausência", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: assessAccountsPayableSyncPayloadCompleteness({
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

  it("11. data de vencimento preservada como eixo operacional", () => {
    const op = getAccountsPayableOperationalDueDate({
      dueDate,
      scheduleDate: new Date("2026-09-01T00:00:00.000Z"),
      balancePayable: 100,
    });
    assert.equal(op?.toISOString(), dueDate.toISOString());
    assert.doesNotThrow(() =>
      assertAccountsPayableOperationalAxisIsDueDate({
        dueDate,
        paymentDate: new Date("2026-07-01T00:00:00.000Z"),
        competenceDate: new Date("2026-06-01T00:00:00.000Z"),
        operationalDueDate: op,
      })
    );
  });

  it("12. histórico pago preservado em OPEN_PAYABLES_SCOPE", () => {
    const paid = local({
      localId: "paid",
      externalId: 99,
      balancePayable: 0,
      amountPaid: 5000,
      settlementDate: executedAt,
    });
    const open = local({ localId: "open", externalId: 1, balancePayable: 100 });
    const { preservedHistoricalPaid } = selectLocalsForAccountsPayableAbsenceUniverse({
      locals: [paid, open],
      onlyPending: true,
    });
    assert.equal(preservedHistoricalPaid.length, 1);

    const plan = buildAccountsPayableSourceReconciliationPlan({
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
        (i) => i.reason === "PAID_HISTORICAL_OUTSIDE_OPEN_PAYABLES_SCOPE"
      )
    );
  });

  it("13. Fluxo de Caixa / operacional não usa competência no lugar do vencimento", () => {
    const competence = new Date("2026-01-15T00:00:00.000Z");
    const op = getAccountsPayableOperationalDueDate({
      dueDate,
      scheduleDate: null,
      balancePayable: 10,
    });
    assert.notEqual(op?.toISOString(), competence.toISOString());
    assert.equal(op?.toISOString(), dueDate.toISOString());
    assert.ok(
      buildAccountsPayableSyncReconciliationScope({
        from: "01/01/2020",
        to: "31/12/2030",
        onlyPending: false,
        syncStrategy: "full_refresh_upsert",
      }).kind.includes("due_date")
    );
  });

  it("14. centro de custo / documento preservados no patch de ausência", () => {
    const item = planDirectedAccountsPayableAbsenceConfirmation({
      local: local({ localId: "a", externalId: 1, amountPaid: 999 }),
      scope: allScope,
      directedFound: false,
      executedAt,
      mode: "apply",
    });
    assertAbsencePatchPreservesFinancialHistory(item!.lifecyclePatch!);
  });

  it("15. idempotência", () => {
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
    const a = buildAccountsPayableSourceReconciliationPlan(args);
    const b = buildAccountsPayableSourceReconciliationPlan(args);
    assert.deepEqual(a.counters, b.counters);

    const engineLocals = locals.map((l) => ({
      localId: l.localId,
      externalId: String(l.externalId),
      entityType: "ACCOUNTS_PAYABLE" as const,
      payloadHash: l.payloadHash,
      sourcePresenceStatus: l.sourcePresenceStatus,
      presentInLastPayload: l.presentInLastPayload,
      missingConsecutiveRuns: l.missingConsecutiveRuns,
      missingSince: l.missingSince,
      sourceRemovedAt: l.sourceRemovedAt,
      scope: allScope,
    }));
    const after = applyNomusSourceReconciliationPlanLocally(
      engineLocals,
      a,
      found.map((f) => ({ externalId: String(f.externalId), payloadHash: f.payloadHash }))
    );
    const again = buildAccountsPayableSourceReconciliationPlan({
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

  it("16. nenhum delete físico + independência de outras entidades", () => {
    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope: allScope,
      completeness: completeMeta(),
      reconciliationEnabled: true,
      foundRows: [],
      localRecords: [local({ localId: "a", externalId: 55 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(plan.counters.deletes, 0);
    assertNoPhysicalDeletes(plan);
    assert.ok(plan.reasons.includes("OTHER_ENTITY_ABSENCE_DOES_NOT_IMPLY_AP_ABSENCE"));

    const summary = summarizeAccountsPayableReconciliationPreview(
      plan,
      completeMeta(),
      allScope,
      new Map([["55", local({ localId: "a", externalId: 55, balancePayable: 200, amountPaid: 50 })]])
    );
    assert.equal(summary.totalOpenAffected, 200);
    assert.equal(summary.totalPaidHistoricalProtected, 50);
  });
});
