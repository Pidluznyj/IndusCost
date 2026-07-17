/**
 * SYNC-10 — Testes consolidados do release candidate (E2E lógico, sem apply real).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ABSENCE_KILL_SWITCHES,
  CRUD_MATRIX_FINAL,
  DOCUMENTED_DELETE_EXCEPTIONS,
  MIGRATION_PATH,
  OPS_EXCLUDE_FLAGS,
  PERFORMANCE_RC_CHECKS,
  PREVIEW_COMMANDS,
  RUNBOOK_PRODUCTION_STEP_MARKERS,
  SYNC_10_CHECKLIST,
  SYNC_10_DELETE_AUDIT_FILES,
  SYNC_10_RELEASE_CANDIDATE,
  assertSync10ChecklistComplete,
  auditSourceForPhysicalDeletes,
} from "./nomusCrudReconciliationReleaseCandidate.js";
import {
  assertNoPhysicalDeletes,
  applyNomusSourceReconciliationPlanLocally,
} from "./nomusSourceReconciliationEngine.js";
import {
  isNomusSalesOrderAbsenceReconciliationEnabled,
  isNomusAccountsReceivableAbsenceReconciliationEnabled,
  isNomusAccountsPayableAbsenceReconciliationEnabled,
} from "./nomusSourceReconciliationFlags.js";
import {
  isNomusSourceOperationallyPresent,
  isNomusOpsExcludeMissingSalesOrdersEnabled,
} from "./nomusSourcePresencePolicy.js";
import {
  SALES_ORDER_PILOT_ABSENCE,
  assessSalesOrderSyncPayloadCompleteness,
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  isSalesOrderPilotAbsence,
  type SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";
import {
  ACCOUNTS_RECEIVABLE_PILOT,
  assessAccountsReceivableSyncPayloadCompleteness,
  buildAccountsReceivableSourceReconciliationPlan,
  buildAccountsReceivableSyncReconciliationScope,
  type AccountsReceivableLifecycleLocalSnapshot,
} from "./nomusAccountsReceivableSourceReconciliation.js";
import {
  assertAccountsPayableOperationalAxisIsDueDate,
  assessAccountsPayableSyncPayloadCompleteness,
  buildAccountsPayableSourceReconciliationPlan,
  buildAccountsPayableSyncReconciliationScope,
  type AccountsPayableLifecycleLocalSnapshot,
} from "./nomusAccountsPayableSourceReconciliation.js";
import { parseNomusSourceReconcileCli } from "./nomusSourceReconcileCli.js";
import { canMarkRecordMissingInRun } from "./nomusSourceLifecycleContract.js";

const ROOT = process.cwd();
const executedAt = new Date("2026-07-17T20:00:00.000Z");
const dueDate = new Date("2026-08-01T00:00:00.000Z");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const soFullScope = buildSalesOrderSyncReconciliationScope({
  strategy: "full-reconciliation",
  from: "2020-01-01",
  to: "2030-12-31",
});

const arScope = buildAccountsReceivableSyncReconciliationScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: false,
  syncStrategy: "full_refresh_upsert",
});

const apScope = buildAccountsPayableSyncReconciliationScope({
  from: "01/01/2020",
  to: "31/12/2030",
  onlyPending: false,
  syncStrategy: "full_refresh_upsert",
});

function soLocal(
  overrides: Partial<SalesOrderLifecycleLocalSnapshot> &
    Pick<SalesOrderLifecycleLocalSnapshot, "localId" | "externalSalesOrderId">
): SalesOrderLifecycleLocalSnapshot {
  return {
    payloadHash: "h1",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    orderCode: null,
    ...overrides,
  };
}

function arLocal(
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

function apLocal(
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

function soComplete() {
  return assessSalesOrderSyncPayloadCompleteness({
    strategy: "full-reconciliation",
    startPage: 1,
    completedWindow: true,
    stoppedBecauseEmpty: true,
  });
}

function arComplete() {
  return assessAccountsReceivableSyncPayloadCompleteness({
    syncStrategy: "full_refresh_upsert",
    startPage: 1,
    maxPages: 200,
    pagesRead: 3,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: true,
    stoppedBecauseMaxPages: false,
    onlyPending: false,
    http429Count: 0,
  });
}

function apComplete() {
  return assessAccountsPayableSyncPayloadCompleteness({
    syncStrategy: "full_refresh_upsert",
    startPage: 1,
    maxPages: 200,
    pagesRead: 3,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: true,
    stoppedBecauseMaxPages: false,
    onlyPending: false,
    http429Count: 0,
  });
}

describe("SYNC-10 release candidate — checklist e matriz", () => {
  it("checklist obrigatório", () => {
    assert.equal(SYNC_10_RELEASE_CANDIDATE.noRealApplyInRcValidation, true);
    assert.equal(SYNC_10_RELEASE_CANDIDATE.noProductionAccess, true);
    assert.equal(SYNC_10_CHECKLIST.length, 5);
    assertSync10ChecklistComplete();
    assert.equal(CRUD_MATRIX_FINAL.length, 3);
  });

  it("flags fail-closed e independentes", () => {
    assert.equal(isNomusSalesOrderAbsenceReconciliationEnabled({}), false);
    assert.equal(isNomusAccountsReceivableAbsenceReconciliationEnabled({}), false);
    assert.equal(isNomusAccountsPayableAbsenceReconciliationEnabled({}), false);
    assert.equal(isNomusOpsExcludeMissingSalesOrdersEnabled({}), false);
    for (const flag of ABSENCE_KILL_SWITCHES) {
      assert.match(read("src/lib/nomus/nomusSourceReconciliationFlags.ts"), new RegExp(flag));
    }
    for (const flag of OPS_EXCLUDE_FLAGS) {
      assert.match(read("src/lib/nomus/nomusSourcePresencePolicy.ts"), new RegExp(flag));
    }
  });
});

describe("SYNC-10 — Pedidos E2E lógico", () => {
  it("novo / alterado / ausente / reativado / PD 02739", () => {
    const created = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: soComplete(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h1" }],
      localRecords: [],
      executedAt,
      mode: "preview",
    });
    assert.equal(created.counters.creates, 1);

    const updated = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: soComplete(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h2" }],
      localRecords: [soLocal({ localId: "l1", externalSalesOrderId: 100, payloadHash: "h1" })],
      executedAt,
      mode: "preview",
    });
    assert.equal(updated.counters.updates, 1);

    const missing = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: soComplete(),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [soLocal({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(missing.counters.missingCandidates, 1);
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CANDIDATE"), true);
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CONFIRMED"), false);

    assert.ok(
      isSalesOrderPilotAbsence({
        orderCode: SALES_ORDER_PILOT_ABSENCE.orderCode,
        externalSalesOrderId: SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId,
      })
    );

    const reactivated = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: soComplete(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 2737, payloadHash: "h-new" }],
      localRecords: [
        soLocal({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
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
    assert.equal(reactivated.counters.reactivated, 1);
    assert.equal(
      reactivated.reactivated[0]?.lifecyclePatch?.sourcePresenceStatus,
      "PRESENT"
    );
    const after = applyNomusSourceReconciliationPlanLocally(
      [
        {
          localId: "pilot",
          externalId: "2737",
          entityType: "SALES_ORDER",
          payloadHash: "h-old",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          presentInLastPayload: false,
          firstSeenAt: executedAt,
          lastSeenAt: executedAt,
          missingSince: executedAt,
          missingConsecutiveRuns: 2,
          sourceRemovedAt: executedAt,
          lastSyncRunId: null,
          scope: soFullScope,
        },
      ],
      reactivated,
      new Map([["2737", { externalId: "2737", payloadHash: "h-new" }]])
    );
    assert.equal(after.length, 1);
    assert.equal(after[0]?.sourcePresenceStatus, "PRESENT");
    assertNoPhysicalDeletes(reactivated);
  });
});

describe("SYNC-10 — CR E2E lógico", () => {
  it("novo / saldo / pagamento / ausência / reativação / independência do Pedido", () => {
    const created = buildAccountsReceivableSourceReconciliationPlan({
      completeness: arComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 10, payloadHash: "h1" }],
      localRecords: [],
      executedAt,
      mode: "preview",
    });
    assert.equal(created.counters.creates, 1);

    const balance = buildAccountsReceivableSourceReconciliationPlan({
      completeness: arComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 10, payloadHash: "h-balance" }],
      localRecords: [arLocal({ localId: "a1", externalId: 10, payloadHash: "h1", balanceReceivable: 1000 })],
      executedAt,
      mode: "preview",
    });
    assert.equal(balance.counters.updates, 1);

    const paidLocal = arLocal({
      localId: "paid",
      externalId: 11,
      payloadHash: "paid-hash",
      balanceReceivable: 0,
      amountReceived: 500,
      settlementDate: executedAt,
    });
    const paidPlan = buildAccountsReceivableSourceReconciliationPlan({
      completeness: arComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 11, payloadHash: "paid-hash" }],
      localRecords: [paidLocal],
      executedAt,
      mode: "preview",
    });
    assert.equal(paidPlan.counters.unchanged, 1);

    const missing = buildAccountsReceivableSourceReconciliationPlan({
      completeness: arComplete(),
      reconciliationEnabled: true,
      found: [],
      localRecords: [arLocal({ localId: "a1", externalId: 10 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(missing.counters.missingCandidates, 1);

    const reactivated = buildAccountsReceivableSourceReconciliationPlan({
      completeness: arComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: ACCOUNTS_RECEIVABLE_PILOT.externalId, payloadHash: "h-new" }],
      localRecords: [
        arLocal({
          localId: "pilot",
          externalId: ACCOUNTS_RECEIVABLE_PILOT.externalId,
          payloadHash: "h-old",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          presentInLastPayload: false,
          missingConsecutiveRuns: 2,
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(reactivated.counters.reactivated, 1);

    assert.notEqual(
      String(ACCOUNTS_RECEIVABLE_PILOT.externalId),
      String(SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId)
    );
    assertNoPhysicalDeletes(missing);
  });
});

describe("SYNC-10 — CP E2E lógico", () => {
  it("novo / vencimento / pagamento / ausência / reativação / dueDate", () => {
    assertAccountsPayableOperationalAxisIsDueDate({ dueDate });

    const created = buildAccountsPayableSourceReconciliationPlan({
      completeness: apComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 20, payloadHash: "h1" }],
      localRecords: [],
      executedAt,
      mode: "preview",
    });
    assert.equal(created.counters.creates, 1);

    const dueChanged = buildAccountsPayableSourceReconciliationPlan({
      completeness: apComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 20, payloadHash: "h-due" }],
      localRecords: [
        apLocal({ localId: "p1", externalId: 20, payloadHash: "h1", dueDateIso: "2026-08-01" }),
      ],
      executedAt,
      mode: "preview",
    });
    assert.equal(dueChanged.counters.updates, 1);

    const paid = buildAccountsPayableSourceReconciliationPlan({
      completeness: apComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 21, payloadHash: "paid" }],
      localRecords: [
        apLocal({
          localId: "paid",
          externalId: 21,
          payloadHash: "paid",
          balancePayable: 0,
          amountPaid: 900,
          settlementDate: executedAt,
        }),
      ],
      executedAt,
      mode: "preview",
    });
    assert.equal(paid.counters.unchanged, 1);

    const missing = buildAccountsPayableSourceReconciliationPlan({
      completeness: apComplete(),
      reconciliationEnabled: true,
      found: [],
      localRecords: [apLocal({ localId: "p1", externalId: 20 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(missing.counters.missingCandidates, 1);
    assert.equal(missing.missingCandidates[0]?.lifecyclePatch?.sourcePresenceStatus, "MISSING_CANDIDATE");

    const reactivated = buildAccountsPayableSourceReconciliationPlan({
      completeness: apComplete(),
      reconciliationEnabled: true,
      found: [{ externalId: 20, payloadHash: "back" }],
      localRecords: [
        apLocal({
          localId: "p1",
          externalId: 20,
          payloadHash: "old",
          sourcePresenceStatus: "MISSING_CANDIDATE",
          dueDateIso: "2026-08-01",
        }),
      ],
      executedAt,
      mode: "apply",
    });
    assert.equal(reactivated.counters.reactivated, 1);
    assert.equal(apLocal({ localId: "p1", externalId: 20 }).dueDateIso, "2026-08-01");
    assertNoPhysicalDeletes(reactivated);
  });
});

describe("SYNC-10 — falhas e proteções", () => {
  it("payload incompleto / 429 / max pages / timeout-like / lock / retomada / idempotência", () => {
    assert.equal(
      canMarkRecordMissingInRun({
        status: "SUCCESS",
        payloadComplete: false,
      }),
      false
    );

    const incompleteSo = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: assessSalesOrderSyncPayloadCompleteness({
        strategy: "full-reconciliation",
        startPage: 1,
        completedWindow: true,
        stoppedBecauseEmpty: false,
      }),
      reconciliationEnabled: true,
      foundPedidos: [],
      localRecords: [soLocal({ localId: "l1", externalSalesOrderId: 100 })],
      executedAt,
      mode: "apply",
    });
    assert.equal(incompleteSo.counters.missingCandidates, 0);

    const ar429 = assessAccountsReceivableSyncPayloadCompleteness({
      syncStrategy: "full_refresh_upsert",
      startPage: 1,
      maxPages: 200,
      pagesRead: 2,
      stoppedBecauseEmpty: false,
      stoppedBecauseNoNext: false,
      stoppedBecauseMaxPages: false,
      onlyPending: false,
      http429Count: 3,
      fatalHttpStatus: 429,
    });
    assert.equal(ar429.payloadComplete, false);

    const maxPages = assessAccountsPayableSyncPayloadCompleteness({
      syncStrategy: "full_refresh_upsert",
      startPage: 1,
      maxPages: 200,
      pagesRead: 200,
      stoppedBecauseEmpty: false,
      stoppedBecauseNoNext: false,
      stoppedBecauseMaxPages: true,
      onlyPending: false,
    });
    assert.equal(maxPages.payloadComplete, false);

    const timeoutLike = assessSalesOrderSyncPayloadCompleteness({
      strategy: "full-reconciliation",
      startPage: 1,
      completedWindow: false,
      stoppedBecauseEmpty: false,
      transportError: "ETIMEDOUT",
    });
    assert.equal(timeoutLike.payloadComplete, false);

    const cli = parseNomusSourceReconcileCli(
      ["preview", "--batch-size=50", "--resume-cursor=batch:2"],
      "sales-orders"
    );
    assert.equal(cli.mode, "preview");
    assert.equal(cli.batchSize, 50);
    assert.equal(cli.resumeCursor, "batch:2");

    const lockSrc = read("src/lib/nomus/nomusSourceReconcile.server.ts");
    assert.match(lockSrc, /lockBlocked|acquire.*Lock|Lock/);

    const a = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: soComplete(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 1, payloadHash: "x" }],
      localRecords: [soLocal({ localId: "l", externalSalesOrderId: 1, payloadHash: "x" })],
      executedAt,
      mode: "preview",
    });
    const b = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope: soFullScope,
      completeness: soComplete(),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 1, payloadHash: "x" }],
      localRecords: [soLocal({ localId: "l", externalSalesOrderId: 1, payloadHash: "x" })],
      executedAt,
      mode: "preview",
    });
    assert.equal(a.counters.unchanged, b.counters.unchanged);
  });
});

describe("SYNC-10 — auditoria de delete", () => {
  it("nova funcionalidade não executa delete/deleteMany/cascade destrutivo", () => {
    assert.ok(DOCUMENTED_DELETE_EXCEPTIONS.length >= 1);
    for (const file of SYNC_10_DELETE_AUDIT_FILES) {
      const src = read(file);
      const hits = auditSourceForPhysicalDeletes(src);
      assert.deepEqual(hits, [], `${file} contém padrão de delete físico: ${hits.join(", ")}`);
      assert.doesNotMatch(src, /salesOrder\.delete/i);
      assert.doesNotMatch(src, /nomusAccountsReceivable\.delete/i);
      assert.doesNotMatch(src, /nomusAccountsPayable\.delete/i);
    }
    const migration = read(MIGRATION_PATH);
    assert.match(migration, /ON DELETE SET NULL/);
    assert.doesNotMatch(migration, /ON DELETE CASCADE/);
  });
});

describe("SYNC-10 — performance / runbook / comandos", () => {
  it("performance checks e índices na migration", () => {
    assert.ok(PERFORMANCE_RC_CHECKS.every((c) => c.ok));
    const migration = read(MIGRATION_PATH);
    assert.match(migration, /SalesOrder_sourcePresenceStatus_idx/);
    assert.match(migration, /NomusAccountsReceivable_sourcePresenceStatus_idx/);
    assert.match(migration, /NomusAccountsPayable_sourcePresenceStatus_idx/);
    assert.match(migration, /NomusSourceSyncRun_entityType_status_startedAt_idx/);
    const server = read("src/lib/nomus/nomusSourceReconcile.server.ts");
    assert.match(server, /batchSize/);
    assert.match(server, /resume/);
  });

  it("runbook tem sequência de 21 passos + rollback", () => {
    const runbook = read("docs/nomus/nomus-source-reconciliation-runbook.md");
    for (const marker of RUNBOOK_PRODUCTION_STEP_MARKERS) {
      assert.match(
        runbook,
        new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        `runbook falta passo: ${marker}`
      );
    }
    assert.match(runbook, /desligar flags/i);
    assert.match(runbook, /último recurso/i);
    assert.match(runbook, /SYNC-10/);
  });

  it("preview commands e package.json", () => {
    const pkg = read("package.json");
    assert.match(pkg, /backfill:nomus:lifecycle:preview/);
    assert.match(pkg, /reconcile:nomus:sales-orders/);
    assert.match(pkg, /reconcile:nomus:accounts-receivable/);
    assert.match(pkg, /reconcile:nomus:accounts-payable/);
    assert.match(pkg, /test:nomus:source-rc/);
    assert.ok(PREVIEW_COMMANDS.salesOrdersPilot.includes("PD 02739"));
    assert.ok(PREVIEW_COMMANDS.accountsReceivablePilot.includes("17748"));
    assert.ok(read("docs/nomus/nomus-crud-reconciliation-release-candidate.md").length > 0);
  });
});
