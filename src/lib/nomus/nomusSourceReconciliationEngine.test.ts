/**
 * SYNC-03 — Motor de reconciliação de presença Nomus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAccountsPayableDueDateScope,
  buildAccountsReceivableDueDateScope,
  buildSalesOrderIssueDateScope,
  type NomusSourceSyncRunSnapshot,
} from "./nomusSourceLifecycleContract.js";
import {
  applyNomusSourceReconciliationPlanLocally,
  assertNoPhysicalDeletes,
  planNomusSourceReconciliation,
  type NomusSourceFoundRecord,
  type NomusSourceLocalRecord,
  type NomusSourceReconciliationInput,
} from "./nomusSourceReconciliationEngine.js";

const executedAt = new Date("2026-07-17T15:00:00.000Z");

const orderScope = buildSalesOrderIssueDateScope({
  from: "2026-07-01",
  to: "2026-07-31",
  strategy: "recent-window",
});

const orderFullScope = buildSalesOrderIssueDateScope({
  from: "2020-01-01",
  to: "2030-12-31",
  strategy: "full-reconciliation",
});

const arScope = buildAccountsReceivableDueDateScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: false,
  strategy: "full-reconciliation",
});

const apScope = buildAccountsPayableDueDateScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: false,
  strategy: "full-reconciliation",
});

function successRun(
  overrides: Partial<NomusSourceSyncRunSnapshot> & { id?: string } = {}
): NomusSourceSyncRunSnapshot & { id?: string } {
  return {
    id: "run-1",
    status: "SUCCESS",
    payloadComplete: true,
    entityType: "SALES_ORDER",
    scope: orderScope,
    ...overrides,
  };
}

function localOrder(
  overrides: Partial<NomusSourceLocalRecord> &
    Pick<NomusSourceLocalRecord, "localId" | "externalId">
): NomusSourceLocalRecord {
  return {
    entityType: "SALES_ORDER",
    payloadHash: "hash-a",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    scope: orderScope,
    firstSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-07-10T00:00:00.000Z"),
    lastSyncRunId: "run-0",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<NomusSourceReconciliationInput> = {}
): NomusSourceReconciliationInput {
  return {
    entityType: "SALES_ORDER",
    scope: orderScope,
    run: successRun(),
    found: [],
    localRecords: [],
    reconciliationEnabled: true,
    executedAt,
    mode: "apply",
    confirmation: {
      consecutiveCompleteMissesToConfirm: 2,
      confirmViaDirectedLookup: true,
    },
    ...overrides,
  };
}

describe("nomusSourceReconciliationEngine — create/update/unchanged", () => {
  it("1. create — inexistente localmente", () => {
    const found: NomusSourceFoundRecord[] = [
      { externalId: "100", payloadHash: "h1" },
    ];
    const plan = planNomusSourceReconciliation(baseInput({ found }));
    assert.equal(plan.counters.creates, 1);
    assert.equal(plan.creates[0]?.action, "CREATE");
    assert.equal(plan.creates[0]?.nextPresenceStatus, "PRESENT");
    assert.equal(plan.creates[0]?.lifecyclePatch?.presentInLastPayload, true);
    assert.equal(plan.creates[0]?.lifecyclePatch?.missingConsecutiveRuns, 0);
    assert.equal(plan.creates[0]?.lifecyclePatch?.missingSince, null);
    assertNoPhysicalDeletes(plan);
  });

  it("2. update — payload alterado", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [{ externalId: "100", payloadHash: "h2" }],
        localRecords: [localOrder({ localId: "l1", externalId: "100", payloadHash: "h1" })],
      })
    );
    assert.equal(plan.counters.updates, 1);
    assert.equal(plan.updates[0]?.reason, "PAYLOAD_HASH_CHANGED");
    assert.equal(plan.updates[0]?.lifecyclePatch?.sourcePresenceStatus, "PRESENT");
  });

  it("3. unchanged — payload igual", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [{ externalId: "100", payloadHash: "h1" }],
        localRecords: [localOrder({ localId: "l1", externalId: "100", payloadHash: "h1" })],
      })
    );
    assert.equal(plan.counters.unchanged, 1);
    assert.equal(plan.unchanged[0]?.action, "UNCHANGED");
    assert.equal(plan.unchanged[0]?.lifecyclePatch?.lastSyncRunId, "run-1");
    assert.equal(plan.unchanged[0]?.lifecyclePatch?.lastSeenAt?.toString(), executedAt.toString());
  });
});

describe("nomusSourceReconciliationEngine — ausência", () => {
  it("4. primeira ausência → MISSING_CANDIDATE", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [],
        localRecords: [localOrder({ localId: "l1", externalId: "100" })],
      })
    );
    assert.equal(plan.absencesEvaluated, true);
    assert.equal(plan.counters.missingCandidates, 1);
    assert.equal(plan.missingCandidates[0]?.lifecyclePatch?.missingConsecutiveRuns, 1);
    assert.equal(
      plan.missingCandidates[0]?.lifecyclePatch?.missingSince?.toString(),
      executedAt.toString()
    );
    assert.equal(plan.missingCandidates[0]?.lifecyclePatch?.presentInLastPayload, false);
    assert.equal(plan.missingCandidates[0]?.lifecyclePatch?.sourceRemovedAt, null);
  });

  it("5. segunda ausência consecutiva → MISSING_CONFIRMED", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [],
        localRecords: [
          localOrder({
            localId: "l1",
            externalId: "100",
            sourcePresenceStatus: "MISSING_CANDIDATE",
            presentInLastPayload: false,
            missingConsecutiveRuns: 1,
            missingSince: new Date("2026-07-16T15:00:00.000Z"),
          }),
        ],
      })
    );
    assert.equal(plan.counters.missingConfirmed, 1);
    assert.equal(plan.missingConfirmed[0]?.reason, "CONSECUTIVE_COMPLETE_MISSES");
    assert.equal(plan.missingConfirmed[0]?.lifecyclePatch?.missingConsecutiveRuns, 2);
    assert.ok(plan.missingConfirmed[0]?.lifecyclePatch?.sourceRemovedAt);
  });

  it("6. confirmação direcionada (not-found)", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [],
        localRecords: [localOrder({ localId: "l1", externalId: "100" })],
        directedLookups: [{ externalId: "100", found: false }],
      })
    );
    assert.equal(plan.counters.missingConfirmed, 1);
    assert.equal(plan.missingConfirmed[0]?.reason, "DIRECTED_LOOKUP_NOT_FOUND");
    assert.equal(plan.counters.missingCandidates, 0);
  });
});

describe("nomusSourceReconciliationEngine — reativação", () => {
  it("7. reativação de MISSING_CANDIDATE e MISSING_CONFIRMED", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [
          { externalId: "10", payloadHash: "h1" },
          { externalId: "20", payloadHash: "h-new" },
        ],
        localRecords: [
          localOrder({
            localId: "l1",
            externalId: "10",
            payloadHash: "h1",
            sourcePresenceStatus: "MISSING_CANDIDATE",
            presentInLastPayload: false,
            missingConsecutiveRuns: 1,
            missingSince: executedAt,
          }),
          localOrder({
            localId: "l2",
            externalId: "20",
            payloadHash: "h-old",
            sourcePresenceStatus: "MISSING_CONFIRMED",
            presentInLastPayload: false,
            missingConsecutiveRuns: 2,
            missingSince: executedAt,
            sourceRemovedAt: executedAt,
          }),
        ],
      })
    );
    assert.equal(plan.counters.reactivated, 2);
    assert.equal(plan.counters.updates, 0);
    for (const item of plan.reactivated) {
      assert.equal(item.action, "REACTIVATE");
      assert.equal(item.nextPresenceStatus, "PRESENT");
      assert.equal(item.lifecyclePatch?.missingSince, null);
      assert.equal(item.lifecyclePatch?.sourceRemovedAt, null);
      assert.equal(item.lifecyclePatch?.missingConsecutiveRuns, 0);
      assert.equal(item.lifecyclePatch?.presentInLastPayload, true);
    }
    assert.equal(plan.reactivated[1]?.payloadChanged, true);
  });
});

describe("nomusSourceReconciliationEngine — proteções", () => {
  it("8. payload incompleto — não altera presença / INCONCLUSIVE", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        run: successRun({ payloadComplete: false }),
        found: [{ externalId: "100", payloadHash: "h1" }],
        localRecords: [
          localOrder({ localId: "l1", externalId: "100", payloadHash: "h1" }),
          localOrder({ localId: "l2", externalId: "200", payloadHash: "h2" }),
        ],
      })
    );
    assert.equal(plan.absencesEvaluated, false);
    assert.ok(plan.reasons.includes("PAYLOAD_INCOMPLETE_ABSENCE_SKIPPED"));
    assert.equal(plan.counters.missingCandidates, 0);
    assert.equal(plan.counters.missingConfirmed, 0);
    assert.equal(plan.counters.inconclusive, 1);
    assert.equal(plan.inconclusive[0]?.externalId, "200");
    assert.equal(plan.inconclusive[0]?.nextPresenceStatus, "PRESENT");
    // Registro retornado ainda pode ser classificado (universo parcial ≠ ausência).
    assert.equal(plan.counters.unchanged, 1);
  });

  it("9. erro HTTP (FAILED) — não confirma ausência", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        run: successRun({ status: "FAILED", payloadComplete: false }),
        found: [],
        localRecords: [localOrder({ localId: "l1", externalId: "100" })],
      })
    );
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingCandidates, 0);
    assert.equal(plan.counters.missingConfirmed, 0);
    assert.equal(plan.inconclusive[0]?.reason, "RUN_FAILED_PRESENCE_UNCHANGED");
  });

  it("10. 429 não recuperado (INCONCLUSIVE) — não confirma ausência", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        run: successRun({ status: "INCONCLUSIVE", payloadComplete: false }),
        found: [],
        localRecords: [localOrder({ localId: "l1", externalId: "100" })],
      })
    );
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingConfirmed, 0);
    assert.equal(
      plan.inconclusive[0]?.reason,
      "RUN_INCONCLUSIVE_PRESENCE_UNCHANGED"
    );
  });

  it("11. registro fora do escopo — ignoredOutsideScope", () => {
    const otherScope = buildSalesOrderIssueDateScope({
      from: "2025-01-01",
      to: "2025-01-31",
      strategy: "recent-window",
    });
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [],
        localRecords: [
          localOrder({
            localId: "l1",
            externalId: "100",
            scope: otherScope,
          }),
        ],
      })
    );
    assert.equal(plan.counters.ignoredOutsideScope, 1);
    assert.equal(plan.ignoredOutsideScope[0]?.reason, "RECORD_OUTSIDE_RUN_SCOPE");
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("12. execução recent-window — ausência só no escopo compatível", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        scope: orderScope,
        run: successRun({
          scope: orderScope,
          entityType: "SALES_ORDER",
        }),
        found: [{ externalId: "1", payloadHash: "h" }],
        localRecords: [
          localOrder({ localId: "in", externalId: "2", scope: orderScope }),
          localOrder({
            localId: "out",
            externalId: "3",
            scope: orderFullScope,
          }),
        ],
      })
    );
    assert.equal(plan.counters.missingCandidates, 1);
    assert.equal(plan.missingCandidates[0]?.externalId, "2");
    assert.ok(
      plan.ignoredOutsideScope.some(
        (i) => i.externalId === "3" && i.reason === "RECORD_OUTSIDE_RUN_SCOPE"
      )
    );
  });

  it("13. execução full-reconciliation — escopo amplo avalia ausência", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        scope: orderFullScope,
        run: successRun({
          scope: orderFullScope,
          entityType: "SALES_ORDER",
        }),
        found: [],
        localRecords: [
          localOrder({
            localId: "l1",
            externalId: "100",
            scope: orderFullScope,
          }),
        ],
      })
    );
    assert.equal(plan.absencesEvaluated, true);
    assert.equal(plan.counters.missingCandidates, 1);
  });

  it("14. duas entidades com mesmo externalId — independentes", () => {
    const orderPlan = planNomusSourceReconciliation(
      baseInput({
        found: [{ externalId: "999", payloadHash: "order-h" }],
        localRecords: [
          localOrder({
            localId: "so",
            externalId: "999",
            payloadHash: "order-h",
          }),
          {
            localId: "ar",
            externalId: "999",
            entityType: "ACCOUNTS_RECEIVABLE",
            payloadHash: "ar-h",
            sourcePresenceStatus: "PRESENT",
            presentInLastPayload: true,
            missingConsecutiveRuns: 0,
            missingSince: null,
            sourceRemovedAt: null,
            scope: arScope,
          },
        ],
      })
    );
    assert.equal(orderPlan.counters.unchanged, 1);
    assert.ok(
      orderPlan.ignoredOutsideScope.some(
        (i) =>
          i.externalId === "999" &&
          i.entityType === "ACCOUNTS_RECEIVABLE" &&
          i.reason === "DIFFERENT_ENTITY_TYPE"
      )
    );

    const arPlan = planNomusSourceReconciliation({
      entityType: "ACCOUNTS_RECEIVABLE",
      scope: arScope,
      run: {
        id: "run-ar",
        status: "SUCCESS",
        payloadComplete: true,
        entityType: "ACCOUNTS_RECEIVABLE",
        scope: arScope,
      },
      found: [],
      localRecords: [
        {
          localId: "ar",
          externalId: "999",
          entityType: "ACCOUNTS_RECEIVABLE",
          payloadHash: "ar-h",
          sourcePresenceStatus: "PRESENT",
          presentInLastPayload: true,
          missingConsecutiveRuns: 0,
          missingSince: null,
          sourceRemovedAt: null,
          scope: arScope,
        },
      ],
      reconciliationEnabled: true,
      executedAt,
      mode: "apply",
    });
    assert.equal(arPlan.counters.missingCandidates, 1);
    assert.equal(arPlan.missingCandidates[0]?.entityType, "ACCOUNTS_RECEIVABLE");
  });

  it("15. independência Pedido / CR / CP — sem inferência cruzada", () => {
    // Pedido ausente não gera ausência de CR/CP no mesmo plano.
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [],
        localRecords: [
          localOrder({ localId: "so", externalId: "1" }),
          {
            localId: "ar",
            externalId: "1",
            entityType: "ACCOUNTS_RECEIVABLE",
            payloadHash: "x",
            sourcePresenceStatus: "PRESENT",
            presentInLastPayload: true,
            missingConsecutiveRuns: 0,
            missingSince: null,
            sourceRemovedAt: null,
            scope: arScope,
          },
          {
            localId: "ap",
            externalId: "1",
            entityType: "ACCOUNTS_PAYABLE",
            payloadHash: "y",
            sourcePresenceStatus: "PRESENT",
            presentInLastPayload: true,
            missingConsecutiveRuns: 0,
            missingSince: null,
            sourceRemovedAt: null,
            scope: apScope,
          },
        ],
      })
    );
    assert.equal(plan.counters.missingCandidates, 1);
    assert.equal(plan.missingCandidates[0]?.entityType, "SALES_ORDER");
    assert.equal(
      plan.ignoredOutsideScope.filter((i) => i.reason === "DIFFERENT_ENTITY_TYPE")
        .length,
      2
    );
  });

  it("16. idempotência — mesmo input e reexecução após apply", () => {
    const found = [{ externalId: "100", payloadHash: "h1" }];
    const locals = [localOrder({ localId: "l1", externalId: "100", payloadHash: "h1" })];
    const input = baseInput({ found, localRecords: locals });
    const a = planNomusSourceReconciliation(input);
    const b = planNomusSourceReconciliation(input);
    assert.deepEqual(a.counters, b.counters);
    assert.equal(a.unchanged[0]?.externalId, b.unchanged[0]?.externalId);

    const after = applyNomusSourceReconciliationPlanLocally(locals, a, found);
    const again = planNomusSourceReconciliation(
      baseInput({ found, localRecords: after })
    );
    assert.equal(again.counters.creates, 0);
    assert.equal(again.counters.updates, 0);
    assert.equal(again.counters.unchanged, 1);
    assert.equal(again.counters.missingCandidates, 0);
  });

  it("17. nenhum delete físico no plano", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        found: [{ externalId: "1", payloadHash: "h" }],
        localRecords: [
          localOrder({ localId: "l1", externalId: "1", payloadHash: "old" }),
          localOrder({ localId: "l2", externalId: "2" }),
        ],
      })
    );
    assert.equal(plan.counters.deletes, 0);
    assertNoPhysicalDeletes(plan);
    assert.equal(plan.mode, "apply");
  });

  it("preview vs apply — patches só em apply", () => {
    const preview = planNomusSourceReconciliation(
      baseInput({
        mode: "preview",
        found: [{ externalId: "1", payloadHash: "h" }],
        localRecords: [],
      })
    );
    const apply = planNomusSourceReconciliation(
      baseInput({
        mode: "apply",
        found: [{ externalId: "1", payloadHash: "h" }],
        localRecords: [],
      })
    );
    assert.equal(preview.mode, "preview");
    assert.equal(preview.creates[0]?.lifecyclePatch, null);
    assert.ok(apply.creates[0]?.lifecyclePatch);
  });

  it("flag desabilitada — não avalia ausência", () => {
    const plan = planNomusSourceReconciliation(
      baseInput({
        reconciliationEnabled: false,
        found: [],
        localRecords: [localOrder({ localId: "l1", externalId: "100" })],
      })
    );
    assert.equal(plan.absencesEvaluated, false);
    assert.ok(plan.reasons.includes("ENTITY_RECONCILE_FLAG_DISABLED"));
    assert.equal(plan.counters.missingCandidates, 0);
  });
});
