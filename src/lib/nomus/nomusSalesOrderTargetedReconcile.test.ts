/**
 * HOTFIX-02 — Testes do escopo TARGETED_LOOKUP do reconcile histórico de Pedidos.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessReconcileApplyGate,
  parseNomusSourceReconcileCli,
} from "./nomusSourceReconcileCli.js";
import {
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  type SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";
import {
  assessTargetedSalesOrderLookupCompleteness,
  buildSalesOrderTargetedLookupScope,
  hasSalesOrderReconcileTarget,
  resolveSalesOrderReconcileTargetIdentity,
  salesOrderOrderCodesMatchExactly,
} from "./nomusSalesOrderTargetedReconcile.js";

const executedAt = new Date("2026-07-17T18:00:00.000Z");

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

function targetedComplete(status: "found" | "not_found" = "not_found") {
  return assessTargetedSalesOrderLookupCompleteness({ lookupStatus: status });
}

describe("HOTFIX-02 sales order targeted reconcile", () => {
  it("1. externalId direcionado usa TARGETED_LOOKUP", () => {
    const cli = parseNomusSourceReconcileCli(
      ["preview", "--externalId=2737", "--from=2026-07-01", "--to=2026-07-31"],
      "sales-orders"
    );
    assert.equal(hasSalesOrderReconcileTarget(cli), true);
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: null,
    });
    assert.equal(scope.kind, "sales_order_targeted_lookup");
    assert.equal(scope.strategy, "targeted-lookup");
    assert.equal(scope.extras?.strategy, "TARGETED_LOOKUP");
  });

  it("2. orderCode direcionado usa TARGETED_LOOKUP", () => {
    const cli = parseNomusSourceReconcileCli(
      ["preview", '--orderCode=PD 02739', "--from=2026-07-01", "--to=2026-07-31"],
      "sales-orders"
    );
    assert.equal(hasSalesOrderReconcileTarget(cli), true);
    assert.equal(cli.orderCode, "PD 02739");
  });

  it("3. externalId e orderCode do mesmo pedido são aceitos", () => {
    const resolved = resolveSalesOrderReconcileTargetIdentity({
      externalId: 2737,
      orderCode: "PD02739",
      locals: [
        local({
          localId: "l1",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
    });
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.externalId, 2737);
      assert.equal(resolved.orderCodeKey, "PD:2739");
    }
  });

  it("4. externalId e orderCode divergentes geram erro", () => {
    const resolved = resolveSalesOrderReconcileTargetIdentity({
      externalId: 2737,
      orderCode: "PD 02740",
      locals: [
        local({
          localId: "l1",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
        local({
          localId: "l2",
          externalSalesOrderId: 2740,
          orderCode: "PD 02740",
        }),
      ],
    });
    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.equal(resolved.code, "TARGET_IDENTITY_DIVERGENCE");
    }
  });

  it("5-6. target local 1 e Nomus 0 não carrega outros pedidos como CREATE", () => {
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: "PD 02739",
    });
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("not_found"),
      reconciliationEnabled: false,
      evaluateAbsencesInPreview: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      directedLookups: [{ externalSalesOrderId: 2737, found: false }],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(plan.counters.creates, 0);
    assert.equal(plan.counters.updates, 0);
    assert.equal(plan.absencesEvaluated, true);
    assert.equal(plan.counters.missingConfirmed, 1);
    assert.equal(plan.missingConfirmed[0]?.externalId, "2737");
    assert.ok(
      !plan.creates.some((c) => c.reason === "NOT_FOUND_LOCALLY" && c.externalId !== "2737")
    );
  });

  it("7. target local 0 e Nomus 1 gera somente um CREATE planejado", () => {
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 9999,
      orderCode: null,
    });
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("found"),
      reconciliationEnabled: true,
      evaluateAbsencesInPreview: true,
      foundPedidos: [{ externalSalesOrderId: 9999, payloadHash: "h-new" }],
      localRecords: [],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(plan.counters.creates, 1);
    assert.equal(plan.creates[0]?.externalId, "9999");
    assert.equal(plan.counters.missingCandidates, 0);
  });

  it("8. target local 1 e Nomus 1 gera UPDATE ou UNCHANGED", () => {
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: "PD 02739",
    });
    const unchanged = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("found"),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 2737, payloadHash: "hash-a" }],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
          payloadHash: "hash-a",
        }),
      ],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(unchanged.counters.unchanged, 1);
    assert.equal(unchanged.counters.creates, 0);

    const updated = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("found"),
      reconciliationEnabled: true,
      foundPedidos: [{ externalSalesOrderId: 2737, payloadHash: "hash-b" }],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
          payloadHash: "hash-a",
        }),
      ],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(updated.counters.updates, 1);
  });

  it("9. target local 1 e Nomus 0 gera candidato/confirmado conforme contrato", () => {
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: "PD 02739",
    });
    const confirmed = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("not_found"),
      reconciliationEnabled: true,
      evaluateAbsencesInPreview: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      directedLookups: [{ externalSalesOrderId: 2737, found: false }],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(confirmed.counters.missingConfirmed, 1);
  });

  it("10. preview calcula ausência com flag desligada", () => {
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: "PD 02739",
    });
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("not_found"),
      reconciliationEnabled: false,
      evaluateAbsencesInPreview: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      directedLookups: [{ externalSalesOrderId: 2737, found: false }],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(plan.absencesEvaluated, true);
    assert.ok(plan.counters.missingConfirmed + plan.counters.missingCandidates >= 1);
  });

  it("11. flag desligada continua bloqueando apply", () => {
    const gate = assessReconcileApplyGate({
      mode: "preview",
      completeness: { payloadComplete: true, runStatus: "SUCCESS" },
      reconciliationEnabled: false,
    });
    assert.equal(gate.applyAllowed, false);
    assert.equal(gate.applyBlockedReason, "RECONCILE_FLAG_DISABLED");

    const applyGate = assessReconcileApplyGate({
      mode: "apply",
      completeness: { payloadComplete: true, runStatus: "SUCCESS" },
      reconciliationEnabled: false,
    });
    assert.equal(applyGate.applyAllowed, false);
    assert.equal(applyGate.applyBlockedReason, "RECONCILE_FLAG_DISABLED");
  });

  it("12. payload inconclusivo não gera ausência", () => {
    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: "PD 02739",
    });
    const completeness = assessTargetedSalesOrderLookupCompleteness({
      lookupStatus: "inconclusive",
      reason: "timeout",
    });
    assert.equal(completeness.payloadComplete, false);
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness,
      reconciliationEnabled: true,
      evaluateAbsencesInPreview: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      executedAt,
      mode: "preview",
      runStatus: "INCONCLUSIVE",
    });
    assert.equal(plan.absencesEvaluated, false);
    assert.equal(plan.counters.missingCandidates, 0);
    assert.equal(plan.counters.missingConfirmed, 0);
  });

  it("13. correspondência parcial de código é proibida", () => {
    assert.equal(
      salesOrderOrderCodesMatchExactly("PD 027", "PD 02739"),
      false
    );
    assert.equal(
      salesOrderOrderCodesMatchExactly("PD 02739", "PD-02739"),
      true
    );
    assert.equal(
      salesOrderOrderCodesMatchExactly("PD02739", "PD 02739"),
      true
    );
  });

  it("14. PD 02739 não corresponde a externalId 2739", () => {
    const resolved = resolveSalesOrderReconcileTargetIdentity({
      externalId: 2739,
      orderCode: "PD 02739",
      locals: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
    });
    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.equal(resolved.code, "TARGET_IDENTITY_DIVERGENCE");
    }
  });

  it("15-16. preview não escreve e physicalDeletes permanece zero", () => {
    const gate = assessReconcileApplyGate({
      mode: "preview",
      completeness: { payloadComplete: true, runStatus: "SUCCESS" },
      reconciliationEnabled: true,
    });
    assert.equal(gate.applyAllowed, false);
    assert.equal(gate.applyBlockedReason, "PREVIEW_NO_WRITE");

    const scope = buildSalesOrderTargetedLookupScope({
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
      externalId: 2737,
      orderCode: "PD 02739",
    });
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "targeted-lookup",
      scope,
      completeness: targetedComplete("not_found"),
      reconciliationEnabled: false,
      evaluateAbsencesInPreview: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      directedLookups: [{ externalSalesOrderId: 2737, found: false }],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(plan.missingConfirmed[0]?.lifecyclePatch, null);
  });

  it("17. full reconciliation sem alvo continua funcionando", () => {
    assert.equal(
      hasSalesOrderReconcileTarget({ externalId: null, orderCode: null }),
      false
    );
    const scope = buildSalesOrderSyncReconciliationScope({
      strategy: "full-reconciliation",
      fromIso: "2026-07-01",
      toIso: "2026-07-31",
    });
    assert.equal(scope.kind, "sales_orders_issue_date_window");
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "full-reconciliation",
      scope,
      completeness: {
        payloadComplete: true,
        status: "COMPLETE",
        strategy: "full-reconciliation",
        reasons: ["FULL_RECONCILIATION_COMPLETE"],
        startPage: 1,
        stoppedBecauseEmpty: false,
        stoppedBecauseNoNext: true,
        stoppedBecauseMaxPages: false,
        http429Count: 0,
        errors: [],
      },
      reconciliationEnabled: true,
      foundPedidos: [
        { externalSalesOrderId: 1, payloadHash: "hash-a" },
        { externalSalesOrderId: 2, payloadHash: "h2" },
      ],
      localRecords: [
        local({ localId: "l1", externalSalesOrderId: 1, payloadHash: "hash-a" }),
      ],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(plan.counters.creates, 1);
    assert.equal(plan.counters.unchanged, 1);
    assert.equal(plan.creates[0]?.externalId, "2");
  });

  it("18. recent-window não é alterada", () => {
    const scope = buildSalesOrderSyncReconciliationScope({
      strategy: "recent-window",
      fromIso: "2025-12-17",
      toIso: "2026-07-17",
    });
    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: "recent-window",
      scope,
      completeness: {
        payloadComplete: false,
        status: "RECENT_WINDOW",
        strategy: "recent-window",
        reasons: ["RECENT_WINDOW_NEVER_MARKS_ABSENT"],
        startPage: 1,
        stoppedBecauseEmpty: true,
        stoppedBecauseNoNext: false,
        stoppedBecauseMaxPages: false,
        http429Count: 0,
        errors: [],
      },
      reconciliationEnabled: true,
      evaluateAbsencesInPreview: true,
      foundPedidos: [],
      localRecords: [
        local({
          localId: "pilot",
          externalSalesOrderId: 2737,
          orderCode: "PD 02739",
        }),
      ],
      executedAt,
      mode: "preview",
      runStatus: "SUCCESS",
    });
    assert.equal(plan.absencesEvaluated, false);
    assert.ok(plan.reasons.includes("RECENT_WINDOW_NEVER_MARKS_ABSENT"));
  });
});
