/**
 * SYNC-02 — Contrato de ciclo de vida Nomus.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  areNomusSourceSyncScopesCompatible,
  buildAccountsPayableDueDateScope,
  buildAccountsReceivableDueDateScope,
  buildNomusSourceLifecycleDefaults,
  buildSalesOrderIssueDateScope,
  canMarkRecordMissingInRun,
  canReconcileAbsencesFromRun,
  parseNomusSourcePresenceStatus,
  parseNomusSourceSyncEntityType,
  parseNomusSourceSyncRunStatus,
} from "./nomusSourceLifecycleContract.js";
import {
  isNomusAbsenceReconciliationEnabledForEntity,
  isNomusAccountsPayableAbsenceReconciliationEnabled,
  isNomusAccountsReceivableAbsenceReconciliationEnabled,
  isNomusSalesOrderAbsenceReconciliationEnabled,
  NOMUS_SOURCE_RECONCILE_AP_ENV,
  NOMUS_SOURCE_RECONCILE_AR_ENV,
  NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV,
} from "./nomusSourceReconciliationFlags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

describe("nomusSourceLifecycleContract — defaults e parse", () => {
  it("1. registro novo inicia como PRESENT", () => {
    const defaults = buildNomusSourceLifecycleDefaults();
    assert.equal(defaults.sourcePresenceStatus, "PRESENT");
    assert.equal(defaults.presentInLastPayload, true);
    assert.equal(defaults.missingConsecutiveRuns, 0);
    assert.equal(defaults.missingSince, null);
    assert.equal(defaults.sourceRemovedAt, null);
  });

  it("2. registro existente inicializado como PRESENT (contrato de defaults)", () => {
    // Migration aplica DEFAULT PRESENT + presentInLastPayload=true.
    const defaults = buildNomusSourceLifecycleDefaults();
    assert.deepEqual(defaults, {
      sourcePresenceStatus: "PRESENT",
      presentInLastPayload: true,
      missingConsecutiveRuns: 0,
      missingSince: null,
      sourceRemovedAt: null,
    });
  });

  it("4. status desconhecido é rejeitado", () => {
    assert.throws(() => parseNomusSourcePresenceStatus("ABSENT"), /inválido/);
    assert.throws(() => parseNomusSourceSyncRunStatus("DONE"), /inválido/);
    assert.throws(() => parseNomusSourceSyncEntityType("NFE"), /inválido/);
    assert.equal(parseNomusSourcePresenceStatus("MISSING_CANDIDATE"), "MISSING_CANDIDATE");
    assert.equal(parseNomusSourceSyncRunStatus("INCONCLUSIVE"), "INCONCLUSIVE");
  });
});

describe("nomusSourceLifecycleContract — completude e escopo", () => {
  const orderScope = buildSalesOrderIssueDateScope({
    from: "2026-07-01",
    to: "2026-07-31",
    strategy: "recent-window",
  });
  const arScope = buildAccountsReceivableDueDateScope({
    from: "01/01/2020",
    to: "31/12/2030",
    onlyPending: false,
    strategy: "full_refresh_upsert",
  });

  it("5. payload incompleto não pode confirmar ausência", () => {
    assert.equal(
      canReconcileAbsencesFromRun({
        status: "SUCCESS",
        payloadComplete: false,
      }),
      false
    );
    assert.equal(
      canReconcileAbsencesFromRun({
        status: "INCONCLUSIVE",
        payloadComplete: true,
      }),
      false
    );
    assert.equal(
      canReconcileAbsencesFromRun({
        status: "FAILED",
        payloadComplete: true,
      }),
      false
    );
    assert.equal(
      canReconcileAbsencesFromRun({
        status: "SUCCESS",
        payloadComplete: true,
      }),
      true
    );
  });

  it("6. escopos diferentes não podem ser comparados", () => {
    assert.equal(areNomusSourceSyncScopesCompatible(orderScope, arScope), false);
    assert.equal(
      areNomusSourceSyncScopesCompatible(
        orderScope,
        buildSalesOrderIssueDateScope({
          from: "2026-06-01",
          to: "2026-07-31",
          strategy: "recent-window",
        })
      ),
      false
    );
    assert.equal(
      areNomusSourceSyncScopesCompatible(
        arScope,
        buildAccountsReceivableDueDateScope({
          from: "01/01/2020",
          to: "31/12/2030",
          onlyPending: true,
          strategy: "full_refresh_upsert",
        })
      ),
      false
    );
    assert.equal(
      areNomusSourceSyncScopesCompatible(
        arScope,
        buildAccountsReceivableDueDateScope({
          from: "01/01/2020",
          to: "31/12/2030",
          onlyPending: false,
          strategy: "other",
        })
      ),
      true
    );
  });

  it("canMarkRecordMissingInRun exige flag + SUCCESS + complete + mesmo escopo", () => {
    const run = {
      status: "SUCCESS" as const,
      payloadComplete: true,
      entityType: "SALES_ORDER" as const,
      scope: orderScope,
    };
    assert.equal(
      canMarkRecordMissingInRun({
        run,
        recordEntityType: "SALES_ORDER",
        recordScope: orderScope,
        reconciliationEnabled: false,
      }),
      false
    );
    assert.equal(
      canMarkRecordMissingInRun({
        run,
        recordEntityType: "SALES_ORDER",
        recordScope: orderScope,
        reconciliationEnabled: true,
      }),
      true
    );
    assert.equal(
      canMarkRecordMissingInRun({
        run: { ...run, payloadComplete: false },
        recordEntityType: "SALES_ORDER",
        recordScope: orderScope,
        reconciliationEnabled: true,
      }),
      false
    );
    assert.equal(
      canMarkRecordMissingInRun({
        run,
        recordEntityType: "ACCOUNTS_RECEIVABLE",
        recordScope: orderScope,
        reconciliationEnabled: true,
      }),
      false
    );
  });
});

describe("nomusSourceReconciliationFlags — kill switches", () => {
  it("7. flags independentes e fail-closed", () => {
    const empty = {};
    assert.equal(isNomusSalesOrderAbsenceReconciliationEnabled(empty), false);
    assert.equal(isNomusAccountsReceivableAbsenceReconciliationEnabled(empty), false);
    assert.equal(isNomusAccountsPayableAbsenceReconciliationEnabled(empty), false);

    const onlyOrders = {
      [NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV]: "true",
    };
    assert.equal(isNomusSalesOrderAbsenceReconciliationEnabled(onlyOrders), true);
    assert.equal(isNomusAccountsReceivableAbsenceReconciliationEnabled(onlyOrders), false);
    assert.equal(
      isNomusAbsenceReconciliationEnabledForEntity("SALES_ORDER", onlyOrders),
      true
    );
    assert.equal(
      isNomusAbsenceReconciliationEnabledForEntity("ACCOUNTS_PAYABLE", onlyOrders),
      false
    );

    const arAp = {
      [NOMUS_SOURCE_RECONCILE_AR_ENV]: "1",
      [NOMUS_SOURCE_RECONCILE_AP_ENV]: "yes",
      [NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENV]: "maybe",
    };
    assert.equal(isNomusAccountsReceivableAbsenceReconciliationEnabled(arAp), true);
    assert.equal(isNomusAccountsPayableAbsenceReconciliationEnabled(arAp), true);
    assert.equal(isNomusSalesOrderAbsenceReconciliationEnabled(arAp), false);
  });
});

describe("nomusSourceLifecycleContract — schema / migration", () => {
  it("3/8/9. migration aditiva, três modelos, sem delete físico", () => {
    const migration = readFileSync(
      join(
        repoRoot,
        "prisma/migrations/20260803120000_nomus_source_lifecycle_contract/migration.sql"
      ),
      "utf8"
    );
    assert.match(migration, /NomusSourceSyncRun/);
    assert.match(migration, /ALTER TABLE "SalesOrder"/);
    assert.match(migration, /ALTER TABLE "NomusAccountsReceivable"/);
    assert.match(migration, /ALTER TABLE "NomusAccountsPayable"/);
    assert.match(migration, /DEFAULT 'PRESENT'/);
    assert.match(migration, /presentInLastPayload/);
    assert.match(migration, /payloadHash/);
    assert.doesNotMatch(migration, /\bDELETE FROM\b/i);
    assert.doesNotMatch(migration, /\bDROP TABLE "(SalesOrder|NomusAccounts)/i);

    const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
    assert.match(schema, /enum NomusSourcePresenceStatus/);
    assert.match(schema, /model NomusSourceSyncRun/);
    assert.match(schema, /sourcePresenceStatus\s+NomusSourcePresenceStatus/);
    // CR/CP já tinham payloadHash — exatamente uma declaração de campo no model.
    const arBlock = schema.slice(
      schema.indexOf("model NomusAccountsReceivable"),
      schema.indexOf("model NomusAccountsPayable")
    );
    assert.equal((arBlock.match(/^\s*payloadHash\s+String\s*$/gm) ?? []).length, 1);
  });

  it("10. rollback lógico documentado", () => {
    const doc = readFileSync(
      join(repoRoot, "docs/nomus/nomus-source-lifecycle-contract.md"),
      "utf8"
    );
    assert.match(doc, /Rollback lógico/i);
    assert.match(doc, /DROP TABLE IF EXISTS "NomusSourceSyncRun"/);
  });

  it("helpers de escopo CP usam eixo de vencimento", () => {
    const scope = buildAccountsPayableDueDateScope({
      from: "01/01/2020",
      to: "31/12/2030",
      onlyPending: false,
      strategy: "full_refresh_upsert",
    });
    assert.equal(scope.kind, "accounts_payable_due_date_window");
  });
});
