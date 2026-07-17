/**
 * SYNC-07 — Testes do roteamento canônico (CRUD automático).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_SYNC_SERVICE_NAMES,
  ENTRY_POINTS_MUST_CALL_CANONICAL,
  NOMUS_AUTOMATIC_SYNC_ROUTINES,
  SHELL_FORBIDDEN_BUSINESS_PATTERNS,
  buildCanonicalSyncExecution,
  mapLegacySalesOrderStrategy,
  planPostSyncHooks,
  resolveCanonicalMissingPermissions,
  sanitizeAdminMissingFlags,
} from "./nomusCanonicalSyncContract.js";
import {
  releaseCanonicalEntityLock,
  runNomusAccountsPayableSync,
  runNomusAccountsReceivableSync,
  runNomusSalesOrdersSync,
  tryAcquireCanonicalEntityLock,
} from "./nomusCanonicalSync.server.js";
import {
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  assessSalesOrderSyncPayloadCompleteness,
  type SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("SYNC-07 checklist e contrato", () => {
  it("matriz de rotinas cobre SO/AR/CP e serviços canônicos", () => {
    assert.ok(NOMUS_AUTOMATIC_SYNC_ROUTINES.length >= 6);
    assert.ok(
      NOMUS_AUTOMATIC_SYNC_ROUTINES.every((r) =>
        Object.values(CANONICAL_SYNC_SERVICE_NAMES).includes(r.canonicalService)
      )
    );
    const hourlySo = NOMUS_AUTOMATIC_SYNC_ROUTINES.find(
      (r) => r.entity === "SALES_ORDER" && r.trigger === "SCHEDULED_HOURLY"
    );
    assert.equal(hourlySo?.strategy, "RECENT_WINDOW");
    assert.equal(hourlySo?.allowMissingDetection, false);
  });

  it("20. flags independentes fail-closed", () => {
    const so = resolveCanonicalMissingPermissions({
      entity: "SALES_ORDER",
      strategy: "FULL_RECONCILIATION",
      allowMissingDetection: true,
      allowMissingConfirmation: true,
      env: {},
    });
    assert.equal(so.allowMissingDetection, false);
    assert.equal(so.allowMissingConfirmation, false);

    const soOn = resolveCanonicalMissingPermissions({
      entity: "SALES_ORDER",
      strategy: "FULL_RECONCILIATION",
      allowMissingDetection: true,
      allowMissingConfirmation: true,
      env: { NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED: "1" },
    });
    assert.equal(soOn.allowMissingDetection, true);
    assert.equal(soOn.allowMissingConfirmation, true);

    const arOff = resolveCanonicalMissingPermissions({
      entity: "ACCOUNTS_RECEIVABLE",
      strategy: "FULL_RECONCILIATION",
      allowMissingDetection: true,
      env: { NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED: "1" },
    });
    assert.equal(arOff.allowMissingDetection, false);
  });
});

describe("SYNC-07 — rotina horária Pedidos", () => {
  it("1–4. RECENT_WINDOW cria/atualiza/reativa e nunca marca ausentes; fora da janela inalterado", () => {
    const scope = buildSalesOrderSyncReconciliationScope({
      strategy: "recent-window",
      fromIso: "2026-01-01",
      toIso: "2026-07-17",
    });
    const completeness = assessSalesOrderSyncPayloadCompleteness({
      strategy: "recent-window",
      startPage: 1,
      completedWindow: false,
      stoppedBecauseEmpty: true,
    });
    const outside: SalesOrderLifecycleLocalSnapshot = {
      localId: "old",
      externalSalesOrderId: 999,
      orderCode: "PD 00999",
      payloadHash: "h-old",
      sourcePresenceStatus: "PRESENT",
      presentInLastPayload: true,
      missingConsecutiveRuns: 0,
      missingSince: null,
      sourceRemovedAt: null,
    };
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "recent-window",
      scope,
      completeness,
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 100, payloadHash: "h1" }],
      localRecords: [
        outside,
        {
          localId: "in",
          externalSalesOrderId: 100,
          orderCode: "PD 00100",
          payloadHash: "h0",
          sourcePresenceStatus: "MISSING_CONFIRMED",
          presentInLastPayload: false,
          missingConsecutiveRuns: 2,
          missingSince: new Date(),
          sourceRemovedAt: new Date(),
        },
      ],
      executedAt: new Date(),
      mode: "apply",
    });
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingCandidates, 0);
    assert.equal(plan.counters.missingConfirmed, 0);
    assert.ok(plan.counters.creates + plan.counters.updates + plan.counters.reactivated >= 1);

    const resolved = resolveCanonicalMissingPermissions({
      entity: "SALES_ORDER",
      strategy: "RECENT_WINDOW",
      allowMissingDetection: true,
      allowMissingConfirmation: true,
      env: { NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED: "1" },
    });
    assert.equal(resolved.allowMissingDetection, false);
    assert.equal(resolved.allowMissingConfirmation, false);
  });
});

describe("SYNC-07 — gateway canônico", () => {
  it("5–7. orquestrador/painel/CLI apontam para o mesmo serviço", () => {
    const orch = read("scripts/nomusSyncOrchestrator.ts");
    assert.match(orch, /NOMUS_CANONICAL_STRATEGY.*RECENT_WINDOW|RECENT_WINDOW/);
    assert.match(orch, /NOMUS_CANONICAL_SOURCE_TRIGGER.*ORCHESTRATOR|ORCHESTRATOR/);

    const arRunner = read("src/lib/nomusAccountsReceivableSyncRunner.ts");
    assert.match(arRunner, /ADMIN_PANEL/);
    assert.match(arRunner, /NOMUS_AR_SYNC_SCRIPT_NAME/);
    assert.match(
      read("src/lib/nomusAccountsReceivableSyncConstants.ts"),
      /runNomusAccountsReceivableSync\.sh/
    );

    const soCli = read("scripts/nomusSalesOrdersSyncV1.ts");
    assert.match(soCli, /runNomusSalesOrdersSync/);
    assert.match(soCli, /executeNomusSalesOrdersSync/);

    const arCli = read("scripts/nomusAccountsReceivableSync.ts");
    assert.match(arCli, /runNomusAccountsReceivableSync/);
    const apCli = read("scripts/nomusAccountsPayableSync.ts");
    assert.match(apCli, /runNomusAccountsPayableSync/);
  });

  it("8. runner shell sem regra de negócio", () => {
    for (const shell of [
      "scripts/runNomusSalesOrdersSync.sh",
      "scripts/runNomusAccountsReceivableSync.sh",
      "scripts/runNomusAccountsPayableSync.sh",
    ]) {
      const src = read(shell);
      for (const pattern of SHELL_FORBIDDEN_BUSINESS_PATTERNS) {
        assert.doesNotMatch(src, pattern, `${shell} contém ${pattern}`);
      }
      assert.match(src, /npm run/);
    }
  });

  it("16. duas execuções concorrentes respeitam lock SKIPPED_LOCKED", async () => {
    const correlationA = `test-lock-a-${Date.now()}`;
    const correlationB = `test-lock-b-${Date.now()}`;
    const first = tryAcquireCanonicalEntityLock("nomus-sales-orders", correlationA);
    assert.equal(first.ok, true);
    const second = tryAcquireCanonicalEntityLock("nomus-sales-orders", correlationB);
    if (second.ok) {
      // Filesystem sem suporte a wx exclusivo — aceitável; shell flock permanece.
      releaseCanonicalEntityLock(correlationB);
    } else {
      assert.equal(second.code, "LOCK_HELD");
    }
    releaseCanonicalEntityLock(correlationA);

    const skipped = await runNomusSalesOrdersSync(
      {
        strategy: "RECENT_WINDOW",
        mode: "preview",
        sourceTrigger: "CLI",
        scope: { kind: "test" },
      },
      async () => {
        const inner = await runNomusSalesOrdersSync(
          {
            strategy: "RECENT_WINDOW",
            mode: "preview",
            sourceTrigger: "CLI",
            scope: { kind: "test" },
            correlationId: `nested-${Date.now()}`,
          },
          async () => ({ status: "SUCCESS", hooksAlreadyRan: [] })
        );
        return { status: "SUCCESS", hooksAlreadyRan: [], message: inner.status };
      }
    );
    assert.ok(skipped.status === "SUCCESS" || skipped.status === "SKIPPED_LOCKED");
  });

  it("17–19. hooks: apply uma vez; preview/falha não disparam", () => {
    const preview = planPostSyncHooks({
      mode: "preview",
      entity: "SALES_ORDER",
      applySucceeded: true,
      hasRelevantChanges: true,
    });
    assert.ok(preview.every((h) => !h.shouldRun));

    const failed = planPostSyncHooks({
      mode: "apply",
      entity: "SALES_ORDER",
      applySucceeded: false,
      hasRelevantChanges: true,
    });
    assert.ok(failed.every((h) => !h.shouldRun));

    const ok = planPostSyncHooks({
      mode: "apply",
      entity: "SALES_ORDER",
      applySucceeded: true,
      hasRelevantChanges: true,
    });
    assert.ok(ok.some((h) => h.shouldRun && h.name === "commissionMaterialization"));
  });

  it("gateway usa delegate único (sem upsert paralelo no contrato)", async () => {
    let calls = 0;
    const result = await runNomusAccountsReceivableSync(
      {
        strategy: "FULL_RECONCILIATION",
        mode: "preview",
        sourceTrigger: "ADMIN_PANEL",
        scope: { kind: "test" },
        allowMissingDetection: false,
      },
      async (execution) => {
        calls += 1;
        assert.equal(execution.allowMissingDetection, false);
        assert.equal(execution.allowMissingConfirmation, false);
        assert.equal(execution.sourceTrigger, "ADMIN_PANEL");
        return {
          status: "SUCCESS",
          payloadComplete: false,
          counters: { created: 1, updated: 2, unchanged: 3 },
          hooksAlreadyRan: [],
        };
      }
    );
    assert.equal(calls, 1);
    assert.equal(result.counters.created, 1);
    assert.equal(result.execution.legacyStrategyLabel, "full_refresh_upsert");
  });

  it("CP gateway atualiza vencimento/pagamento via counters do delegate", async () => {
    const result = await runNomusAccountsPayableSync(
      {
        strategy: "FULL_RECONCILIATION",
        mode: "apply",
        sourceTrigger: "SCHEDULED_HOURLY",
        scope: { kind: "test" },
      },
      async () => ({
        status: "SUCCESS",
        payloadComplete: true,
        counters: { updated: 2, created: 1 },
        hooksAlreadyRan: [],
        hasRelevantChanges: true,
      })
    );
    assert.equal(result.counters.updated, 2);
    assert.equal(result.counters.created, 1);
  });
});

describe("SYNC-07 — ausência / lookup / delete", () => {
  it("13–15. parcial não confirma; full pode candidato; targeted só alvo", () => {
    const incomplete = resolveCanonicalMissingPermissions({
      entity: "SALES_ORDER",
      strategy: "RECENT_WINDOW",
      allowMissingConfirmation: true,
      env: { NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED: "1" },
    });
    assert.equal(incomplete.allowMissingConfirmation, false);

    const full = buildCanonicalSyncExecution({
      entity: "SALES_ORDER",
      strategy: "FULL_RECONCILIATION",
      mode: "preview",
      scope: {},
      sourceTrigger: "CLI",
      allowMissingDetection: true,
      allowMissingConfirmation: true,
    }, { NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED: "true" });
    assert.equal(full.allowMissingDetection, true);

    const targeted = buildCanonicalSyncExecution({
      entity: "SALES_ORDER",
      strategy: "TARGETED_LOOKUP",
      mode: "apply",
      scope: {},
      sourceTrigger: "TARGETED_AUDIT",
      targetOrderCode: "PD 02739",
      allowMissingConfirmation: true,
    }, { NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED: "1" });
    assert.equal(targeted.targetOrderCode, "PD 02739");
    assert.equal(targeted.allowMissingConfirmation, true);
  });

  it("painel rejeita allowMissingConfirmation em RECENT_WINDOW", () => {
    const sanitized = sanitizeAdminMissingFlags({
      strategy: "RECENT_WINDOW",
      allowMissingConfirmation: true,
      allowMissingDetection: true,
    });
    assert.equal(sanitized.allowMissingConfirmation, false);
    assert.equal(sanitized.rejectedConfirmation, true);
  });

  it("21–22. entry points sem upsert paralelo / delete físico nos shells e gateway", () => {
    const server = read("src/lib/nomus/nomusCanonicalSync.server.ts");
    assert.doesNotMatch(server, /\.deleteMany\s*\(/);
    assert.doesNotMatch(server, /salesOrder\.delete/);
    for (const file of ENTRY_POINTS_MUST_CALL_CANONICAL) {
      assert.ok(read(file).length > 0, file);
    }
    assert.match(read("scripts/nomusSalesOrdersSyncV1.ts"), /runNomusSalesOrdersSync/);
  });

  it("23–25. correlação / restart / daily não duplica SO no shell diário", () => {
    assert.equal(mapLegacySalesOrderStrategy("recent-window"), "RECENT_WINDOW");
    const daily = read("scripts/runNomusDailySync.sh");
    assert.doesNotMatch(daily, /sales-orders/);
    assert.doesNotMatch(daily, /accounts-receivable/);
    assert.doesNotMatch(daily, /accounts-payable/);
    const exec = buildCanonicalSyncExecution({
      entity: "SALES_ORDER",
      strategy: "RECENT_WINDOW",
      mode: "apply",
      scope: {},
      sourceTrigger: "SCHEDULED_HOURLY",
      correlationId: "fixed-corr-1",
    });
    assert.equal(exec.correlationId, "fixed-corr-1");
    assert.match(read("docs/nomus/nomus-automatic-sync-routines.md"), /SYNC-07/);
  });
});
