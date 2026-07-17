import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOMUS_LIFECYCLE_ONLY_FIELDS,
  NOMUS_OFFICIAL_BUSINESS_FIELD_GROUPS,
  chunkLifecycleBackfillItems,
  lifecycleBackfillPreviewWrites,
  parseLifecycleBackfillResumeCursor,
  parseNomusLifecycleBackfillCli,
  planNomusLifecycleBackfill,
  planNomusLifecycleBackfillRow,
  serializeLifecycleBackfillResumeCursor,
  type NomusLifecycleBackfillLocalRow,
} from "./nomusLifecycleBackfill.js";
import {
  assertEntityIndependenceGuard,
  assertLifecyclePatchOnly,
  assessReconcileApplyGate,
  buildNomusSourceReconcilePreviewReport,
  collectLifecyclePatchesFromPlan,
  officialVsLifecycleFieldGuide,
  parseNomusSourceReconcileCli,
  planReconcileApplyBatches,
  reconcilePreviewWrites,
  serializeReconcileResumeCursor,
  parseReconcileResumeCursor,
} from "./nomusSourceReconcileCli.js";
import {
  assertNoPhysicalDeletes,
  planNomusSourceReconciliation,
  type NomusSourceLocalRecord,
} from "./nomusSourceReconciliationEngine.js";
import {
  ACCOUNTS_RECEIVABLE_PILOT,
} from "./nomusAccountsReceivableSourceReconciliation.js";
import { SALES_ORDER_PILOT_ABSENCE } from "./nomusSalesOrderSourceReconciliation.js";
import {
  NOMUS_LIFECYCLE_BACKFILL_LOCK_DEFAULT,
  NOMUS_LIFECYCLE_BACKFILL_LOCK_ENV,
} from "./nomusLifecycleBackfill.server.js";
import {
  NOMUS_SALES_ORDER_RECONCILE_LOCK_DEFAULT,
} from "./nomusSalesOrderSourceReconciliation.server.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function row(
  overrides: Partial<NomusLifecycleBackfillLocalRow> = {}
): NomusLifecycleBackfillLocalRow {
  return {
    id: "loc-1",
    entityType: "SALES_ORDER",
    externalKey: "2737",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

const testScope = {
  kind: "sales_orders_issue_date_window",
  from: "2026-07-01",
  to: "2026-07-31",
  strategy: "full-reconciliation",
} as const;

const apTestScope = {
  kind: "accounts_payable_due_date_window",
  from: "2020-01-01",
  to: "2030-12-31",
  onlyPending: false,
  strategy: "full_refresh_upsert",
} as const;

function local(
  overrides: Partial<NomusSourceLocalRecord> = {}
): NomusSourceLocalRecord {
  return {
    localId: "l1",
    externalId: "1",
    entityType: "SALES_ORDER",
    payloadHash: "h1",
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    scope: { ...testScope },
    ...overrides,
  };
}

describe("SYNC-08 lifecycle backfill + reconcile CLI", () => {
  it("checklist: campos oficiais vs lifecycle", () => {
    assert.ok(NOMUS_OFFICIAL_BUSINESS_FIELD_GROUPS.SALES_ORDER.includes("orderCode"));
    assert.ok(NOMUS_LIFECYCLE_ONLY_FIELDS.includes("sourcePresenceStatus"));
    assert.ok(NOMUS_LIFECYCLE_ONLY_FIELDS.includes("missingConsecutiveRuns"));
    const guide = officialVsLifecycleFieldGuide("accounts-receivable");
    assert.ok(guide.official.includes("balanceReceivable"));
    assert.ok(guide.lifecycleOnly.includes("firstSeenAt"));
  });

  it("1. backfill sem ausência", () => {
    const plan = planNomusLifecycleBackfill([
      row({ sourcePresenceStatus: null, presentInLastPayload: null }),
      row({
        id: "m1",
        sourcePresenceStatus: "MISSING_CONFIRMED",
        missingConsecutiveRuns: 2,
      }),
    ]);
    assert.equal(plan.absencesDeclared, 0);
    assert.equal(plan.toWrite.every((i) => i.after?.sourcePresenceStatus === "PRESENT"), true);
    assert.equal(
      plan.items.find((i) => i.localId === "m1")?.action,
      "SKIP_PRESERVE_ABSENCE"
    );
  });

  it("2. preview não escreve", () => {
    assert.equal(lifecycleBackfillPreviewWrites(), false);
    assert.equal(reconcilePreviewWrites(), false);
    const cli = parseNomusLifecycleBackfillCli(["preview", "--entity=all"]);
    assert.equal(cli.mode, "preview");
  });

  it("3. apply somente lifecycle", () => {
    assertLifecyclePatchOnly({
      sourcePresenceStatus: "PRESENT",
      presentInLastPayload: true,
      lastSeenAt: new Date().toISOString(),
      missingSince: null,
      missingConsecutiveRuns: 0,
      sourceRemovedAt: null,
      lastSyncRunId: null,
      payloadHash: "abc",
    });
    assert.throws(() => assertLifecyclePatchOnly({ balanceReceivable: 10 }), /não-lifecycle/);
  });

  it("4. candidato", () => {
    const plan = planNomusSourceReconciliation({
      entityType: "SALES_ORDER",
      scope: { ...testScope },
      run: {
        id: "r1",
        status: "SUCCESS",
        payloadComplete: true,
        entityType: "SALES_ORDER",
        scope: { ...testScope },
      },
      found: [],
      localRecords: [local({ externalId: "99" })],
      executedAt: new Date("2026-07-17T00:00:00.000Z"),
      reconciliationEnabled: true,
      mode: "apply",
    });
    assert.equal(plan.missingCandidates.length, 1);
    assert.equal(plan.missingCandidates[0]?.lifecyclePatch?.sourcePresenceStatus, "MISSING_CANDIDATE");
  });

  it("5. confirmação", () => {
    const plan = planNomusSourceReconciliation({
      entityType: "SALES_ORDER",
      scope: { ...testScope },
      run: {
        id: "r2",
        status: "SUCCESS",
        payloadComplete: true,
        entityType: "SALES_ORDER",
        scope: { ...testScope },
      },
      found: [],
      localRecords: [
        local({
          externalId: "99",
          sourcePresenceStatus: "MISSING_CANDIDATE",
          missingConsecutiveRuns: 1,
          presentInLastPayload: false,
        }),
      ],
      directedLookups: [{ externalId: "99", found: false }],
      executedAt: new Date("2026-07-17T00:00:00.000Z"),
      reconciliationEnabled: true,
      mode: "apply",
      confirmation: { consecutiveCompleteMissesToConfirm: 2, confirmViaDirectedLookup: true },
    });
    assert.equal(plan.missingConfirmed.length, 1);
  });

  it("6. reativação", () => {
    const plan = planNomusSourceReconciliation({
      entityType: "SALES_ORDER",
      scope: { ...testScope },
      run: {
        id: "r3",
        status: "SUCCESS",
        payloadComplete: true,
        entityType: "SALES_ORDER",
        scope: { ...testScope },
      },
      found: [{ externalId: "99", payloadHash: "h1" }],
      localRecords: [
        local({
          externalId: "99",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          presentInLastPayload: false,
          missingConsecutiveRuns: 2,
        }),
      ],
      executedAt: new Date("2026-07-17T00:00:00.000Z"),
      reconciliationEnabled: true,
      mode: "apply",
    });
    assert.equal(plan.reactivated.length, 1);
    assert.equal(plan.reactivated[0]?.lifecyclePatch?.sourcePresenceStatus, "PRESENT");
  });

  it("7. lote", () => {
    const chunks = chunkLifecycleBackfillItems([1, 2, 3, 4, 5], 2);
    assert.deepEqual(chunks, [[1, 2], [3, 4], [5]]);
    const batches = planReconcileApplyBatches(["a", "b", "c"], 2, 1);
    assert.equal(batches.startBatchIndex, 1);
    assert.deepEqual(batches.batches, [["c"]]);
  });

  it("8. retomada", () => {
    const raw = serializeLifecycleBackfillResumeCursor({
      version: 1,
      entity: "all",
      nextOffset: 40,
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    assert.equal(parseLifecycleBackfillResumeCursor(raw)?.nextOffset, 40);
    const r2 = serializeReconcileResumeCursor({
      version: 1,
      entity: "sales-orders",
      nextBatchIndex: 3,
      applied: 30,
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    assert.equal(parseReconcileResumeCursor(r2)?.nextBatchIndex, 3);
  });

  it("9. lock reutilizável", () => {
    assert.match(NOMUS_LIFECYCLE_BACKFILL_LOCK_DEFAULT, /lifecycle-backfill/);
    assert.equal(NOMUS_LIFECYCLE_BACKFILL_LOCK_ENV, "NOMUS_LIFECYCLE_BACKFILL_LOCK_FILE");
    assert.match(NOMUS_SALES_ORDER_RECONCILE_LOCK_DEFAULT, /sales-orders-reconcile/);
    const server = read("src/lib/nomus/nomusSourceReconcile.server.ts");
    assert.match(server, /acquireSalesOrderReconcileLock/);
    assert.match(server, /acquireAccountsReceivableReconcileLock/);
    assert.match(server, /acquireAccountsPayableReconcileLock/);
  });

  it("10. payload incompleto interrompe apply", () => {
    const byStatus = assessReconcileApplyGate({
      mode: "apply",
      completeness: { payloadComplete: false, runStatus: "INCONCLUSIVE" },
      reconciliationEnabled: true,
    });
    assert.equal(byStatus.applyAllowed, false);
    assert.ok(
      byStatus.applyBlockedReason === "PAYLOAD_INCOMPLETE" ||
        byStatus.applyBlockedReason === "RUN_INCONCLUSIVE"
    );
    const byPayload = assessReconcileApplyGate({
      mode: "apply",
      completeness: { payloadComplete: false, runStatus: "SUCCESS" },
      reconciliationEnabled: true,
    });
    assert.equal(byPayload.applyAllowed, false);
    assert.equal(byPayload.applyBlockedReason, "PAYLOAD_INCOMPLETE");
  });

  it("11. entidades independentes", () => {
    assert.throws(
      () =>
        assertEntityIndependenceGuard({
          decidingEntity: "sales-orders",
          targetEntity: "accounts-receivable",
        }),
      /Independência/
    );
    assert.equal(ACCOUNTS_RECEIVABLE_PILOT.externalId, 17748);
    assert.equal(SALES_ORDER_PILOT_ABSENCE.orderCode, "PD 02739");
    assert.notEqual(
      String(ACCOUNTS_RECEIVABLE_PILOT.externalId),
      String(SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId)
    );
  });

  it("12. idempotência", () => {
    const first = planNomusLifecycleBackfillRow(
      row({
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-02T00:00:00.000Z",
      })
    );
    assert.equal(first.action, "SKIP_ALREADY_OK");
    const second = planNomusLifecycleBackfillRow(
      row({
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-02T00:00:00.000Z",
      })
    );
    assert.deepEqual(first.action, second.action);
    assert.equal(second.needsWrite, false);
  });

  it("13. nenhum delete físico", () => {
    const plan = planNomusSourceReconciliation({
      entityType: "ACCOUNTS_PAYABLE",
      scope: { ...apTestScope },
      run: {
        id: "r",
        status: "SUCCESS",
        payloadComplete: true,
        entityType: "ACCOUNTS_PAYABLE",
        scope: { ...apTestScope },
      },
      found: [],
      localRecords: [
        local({
          entityType: "ACCOUNTS_PAYABLE",
          externalId: "55",
          scope: { ...apTestScope },
        }),
      ],
      executedAt: new Date(),
      reconciliationEnabled: true,
      mode: "apply",
    });
    assertNoPhysicalDeletes(plan);
    const report = buildNomusSourceReconcilePreviewReport({
      mode: "preview",
      entity: "accounts-payable",
      plan,
      completeness: { payloadComplete: true, runStatus: "SUCCESS" },
      scope: plan.scope,
      localUniverseCount: 1,
      nomusUniverseCount: 0,
      reconciliationEnabled: true,
    });
    assert.equal(report.physicalDeletes, 0);
    assert.equal(report.writes, false);
    const patches = collectLifecyclePatchesFromPlan(plan);
    assert.ok(patches.length >= 1);
  });

  it("CLI flags: externalId, orderCode, batch, confirm, explain, json/csv", () => {
    const so = parseNomusSourceReconcileCli(
      [
        "preview",
        "--orderCode=PD 02739",
        "--from=2026-07-01",
        "--to=2026-07-31",
        "--batch-size=50",
        "--confirm-candidates",
        "--explain",
        "--csv",
      ],
      "sales-orders"
    );
    assert.equal(so.orderCode, "PD 02739");
    assert.equal(so.batchSize, 50);
    assert.equal(so.confirmCandidates, true);
    assert.equal(so.csv, true);

    const ar = parseNomusSourceReconcileCli(
      ["apply", "--externalId=17748", "--json"],
      "accounts-receivable"
    );
    assert.equal(ar.externalId, 17748);
    assert.equal(ar.mode, "apply");
    assert.throws(
      () =>
        parseNomusSourceReconcileCli(
          ["preview", "--orderCode=X"],
          "accounts-receivable"
        ),
      /orderCode/
    );
  });

  it("scripts e package.json registram comandos", () => {
    const pkg = read("package.json");
    assert.match(pkg, /backfill:nomus:lifecycle:preview/);
    assert.match(pkg, /reconcile:nomus:sales-orders/);
    assert.match(pkg, /reconcile:nomus:accounts-receivable/);
    assert.match(pkg, /reconcile:nomus:accounts-payable/);
    assert.match(pkg, /test:nomus:source-reconcile-cli/);
    assert.ok(read("scripts/nomusLifecycleBackfill.ts").length > 0);
    assert.ok(read("scripts/nomusSalesOrdersSourceReconcile.ts").length > 0);
    assert.ok(read("docs/nomus/nomus-source-reconciliation-runbook.md").length > 0);
  });
});
