import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY,
  assessPurchaseOrderFetchCompleteness,
  buildPurchaseOrderPresenceEvents,
  buildPurchaseOrderRunScope,
  buildPurchaseOrderSourceReconciliationPlan,
  describePurchaseOrderPresence,
  purchaseOrderConfirmationLimit,
  resolvePurchaseOrderReconciliationPolicy,
  type PurchaseOrderFetchMeta,
  type PurchaseOrderLifecycleLocal,
} from "./nomusPurchaseOrderSourceReconciliation.js";

const T0 = new Date("2026-10-23T06:37:00.000Z");
const T1 = new Date("2026-10-24T06:37:00.000Z");

function meta(overrides: Partial<PurchaseOrderFetchMeta> = {}): PurchaseOrderFetchMeta {
  return {
    strategy: "FULL_RECONCILIATION",
    requestedWindow: null,
    startPage: 1,
    pagesRead: 3,
    recordsRead: 120,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: true,
    stoppedBecauseMaxPages: false,
    fetchFailed: false,
    fetchError: null,
    http429Count: 0,
    mapErrorsIdentified: 0,
    unidentifiedRecords: 0,
    duplicateRecords: 0,
    returnedOutsideWindow: 0,
    ...overrides,
  };
}

function local(externalId: number, overrides: Partial<PurchaseOrderLifecycleLocal> = {}): PurchaseOrderLifecycleLocal {
  return {
    localId: `po-${externalId}`,
    externalId,
    orderNumber: `PC${String(externalId - 1).padStart(5, "0")}`,
    payloadHash: `h${externalId}`,
    issuedAt: new Date("2026-10-01T12:00:00.000Z"),
    sourcePresenceStatus: "PRESENT",
    presentInLastPayload: true,
    missingConsecutiveRuns: 0,
    missingSince: null,
    sourceRemovedAt: null,
    firstSeenAt: new Date("2026-10-01T12:00:00.000Z"),
    lastSeenAt: new Date("2026-10-22T10:00:00.000Z"),
    lastSyncRunId: "run-old",
    ...overrides,
  };
}

const fullScope = buildPurchaseOrderRunScope({ strategy: "FULL_RECONCILIATION", window: null });

function plan(args: {
  locals: PurchaseOrderLifecycleLocal[];
  found: number[];
  runId?: string;
  executedAt?: Date;
  strategy?: "RECENT_WINDOW" | "FULL_RECONCILIATION" | "TARGETED_LOOKUP";
  detection?: boolean;
  confirmation?: boolean;
  completeness?: ReturnType<typeof assessPurchaseOrderFetchCompleteness>;
  directed?: Array<{ externalId: number; found: boolean }>;
  scope?: ReturnType<typeof buildPurchaseOrderRunScope>;
  mode?: "preview" | "apply";
  policy?: typeof DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY;
}) {
  return buildPurchaseOrderSourceReconciliationPlan({
    strategy: args.strategy ?? "FULL_RECONCILIATION",
    scope: args.scope ?? fullScope,
    completeness: args.completeness ?? assessPurchaseOrderFetchCompleteness(meta()),
    absenceDetectionAllowed: args.detection ?? true,
    absenceConfirmationAllowed: args.confirmation ?? true,
    found: args.found.map((externalId) => ({ externalId, payloadHash: `h${externalId}` })),
    locals: args.locals,
    directedLookups: args.directed,
    executedAt: args.executedAt ?? T0,
    runId: args.runId ?? "run-1",
    mode: args.mode ?? "apply",
    policy: args.policy,
  });
}

describe("completude da varredura de Pedidos de Compra", () => {
  it("1. página 1 → fim sem erro = SUCCESS + payload completo", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta());
    assert.equal(c.runStatus, "SUCCESS");
    assert.equal(c.payloadComplete, true);
  });

  it("2. falha HTTP (5xx/timeout/rede) = FAILED, nunca completo", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ fetchFailed: true, fetchError: "Falha HTTP 503", stoppedBecauseNoNext: false }));
    assert.equal(c.runStatus, "FAILED");
    assert.equal(c.payloadComplete, false);
  });

  it("3. 429 não recuperado = FAILED com motivo próprio", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ fetchFailed: true, http429Count: 11, stoppedBecauseNoNext: false }));
    assert.equal(c.runStatus, "FAILED");
    assert.ok(c.reasons.includes("HTTP_429_UNRECOVERED"));
  });

  it("4. limite de páginas atingido = INCONCLUSIVE (parcial não é sucesso)", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ stoppedBecauseNoNext: false, stoppedBecauseMaxPages: true }));
    assert.equal(c.runStatus, "INCONCLUSIVE");
    assert.equal(c.payloadComplete, false);
  });

  it("5. início fora da página 1 = INCONCLUSIVE", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ startPage: 3 }));
    assert.equal(c.payloadComplete, false);
    assert.ok(c.reasons.includes("START_PAGE_NOT_ONE_INCOMPLETE_SNAPSHOT"));
  });

  it("6. registro sem ID oficial compromete o universo", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ unidentifiedRecords: 1 }));
    assert.equal(c.runStatus, "INCONCLUSIVE");
    assert.equal(c.payloadComplete, false);
  });

  it("7. janela com filtro de datas ignorado = execução ok, mas não prova o universo", () => {
    const c = assessPurchaseOrderFetchCompleteness(
      meta({ requestedWindow: { from: new Date("2026-09-08"), to: T0 }, returnedOutsideWindow: 40, dateFilterValidated: true })
    );
    assert.equal(c.runStatus, "SUCCESS");
    assert.equal(c.payloadComplete, false);
    assert.equal(c.dateFilter, "IGNORED_OR_AMBIGUOUS");
  });

  it("8. janela consistente sem semântica validada não autoriza ausência", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ requestedWindow: { from: new Date("2026-09-08"), to: T0 } }));
    assert.equal(c.payloadComplete, false);
    assert.ok(c.reasons.includes("DATE_FILTER_SEMANTICS_NOT_VALIDATED"));
    const validated = assessPurchaseOrderFetchCompleteness(
      meta({ requestedWindow: { from: new Date("2026-09-08"), to: T0 }, dateFilterValidated: true })
    );
    assert.equal(validated.payloadComplete, true);
  });
});

describe("ciclo de vida PRESENT → MISSING_CANDIDATE → MISSING_CONFIRMED", () => {
  it("9. 1ª varredura completa sem o pedido = candidata (não cancela, não confirma)", () => {
    const r = plan({ locals: [local(638), local(639)], found: [639] });
    assert.equal(r.plan.missingCandidates.length, 1);
    assert.equal(r.plan.missingConfirmed.length, 0);
    const item = r.plan.missingCandidates[0]!;
    assert.equal(item.externalId, "638");
    assert.equal(item.lifecyclePatch?.sourcePresenceStatus, "MISSING_CANDIDATE");
    assert.equal(item.lifecyclePatch?.missingConsecutiveRuns, 1);
    assert.equal(r.plan.counters.deletes, 0);
  });

  it("10. 2ª varredura completa, em execução distinta e após o intervalo = confirmada", () => {
    const r = plan({
      locals: [local(638, { sourcePresenceStatus: "MISSING_CANDIDATE", presentInLastPayload: false, missingConsecutiveRuns: 1, missingSince: T0, lastSyncRunId: "run-1" })],
      found: [],
      runId: "run-2",
      executedAt: T1,
    });
    assert.equal(r.plan.missingConfirmed.length, 1);
    assert.equal(r.plan.missingConfirmed[0]!.lifecyclePatch?.sourcePresenceStatus, "MISSING_CONFIRMED");
    assert.ok(r.plan.missingConfirmed[0]!.lifecyclePatch?.sourceRemovedAt);
  });

  it("11. reprocessar o MESMO run não conta ausência duas vezes (idempotência)", () => {
    const r = plan({
      locals: [local(638, { sourcePresenceStatus: "MISSING_CANDIDATE", missingConsecutiveRuns: 1, missingSince: T0, lastSyncRunId: "run-1" })],
      found: [],
      runId: "run-1",
      executedAt: T1,
    });
    assert.equal(r.plan.missingConfirmed.length, 0);
    assert.equal(r.plan.missingCandidates.length, 0);
    assert.equal(r.guards.sameRunSkipped, 1);
  });

  it("12. confirmação antes do intervalo mínimo fica como candidata, sem incrementar", () => {
    const soon = new Date(T0.getTime() + 2 * 3_600_000);
    const r = plan({
      locals: [local(638, { sourcePresenceStatus: "MISSING_CANDIDATE", missingConsecutiveRuns: 1, missingSince: T0, lastSyncRunId: "run-1" })],
      found: [],
      runId: "run-2",
      executedAt: soon,
    });
    assert.equal(r.plan.missingConfirmed.length, 0);
    assert.equal(r.guards.heldByInterval, 1);
    assert.equal(r.plan.missingCandidates[0]!.lifecyclePatch?.missingConsecutiveRuns, 1);
  });

  it("13. confirmação desligada mantém candidata", () => {
    const r = plan({
      locals: [local(638, { sourcePresenceStatus: "MISSING_CANDIDATE", missingConsecutiveRuns: 1, missingSince: T0 })],
      found: [],
      runId: "run-2",
      executedAt: T1,
      confirmation: false,
    });
    assert.equal(r.plan.missingConfirmed.length, 0);
    assert.equal(r.guards.heldByConfirmationDisabled, 1);
  });

  it("14. reaparecimento reativa (PRESENT) e preserva histórico", () => {
    const r = plan({
      locals: [local(638, { sourcePresenceStatus: "MISSING_CONFIRMED", presentInLastPayload: false, missingConsecutiveRuns: 2, missingSince: T0, sourceRemovedAt: T0 })],
      found: [638],
      runId: "run-3",
      executedAt: T1,
    });
    assert.equal(r.plan.reactivated.length, 1);
    const patch = r.plan.reactivated[0]!.lifecyclePatch!;
    assert.equal(patch.sourcePresenceStatus, "PRESENT");
    assert.equal(patch.missingConsecutiveRuns, 0);
    assert.equal(patch.sourceRemovedAt, null);
  });

  it("15. confirmado que segue ausente permanece confirmado e fora das guardas", () => {
    const r = plan({
      locals: [local(638, { sourcePresenceStatus: "MISSING_CONFIRMED", missingConsecutiveRuns: 2, missingSince: T0, sourceRemovedAt: T0, lastSyncRunId: "run-2" })],
      found: [],
      runId: "run-3",
      executedAt: new Date(T1.getTime() + 3_600_000),
      policy: { ...DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY, maxConfirmationsPerRun: 1 },
    });
    assert.equal(r.plan.missingConfirmed.length, 1);
    assert.equal(r.guards.alreadyConfirmed, 1);
    assert.equal(r.guards.massGuardTriggered, false);
    assert.equal(buildPurchaseOrderPresenceEvents(r.plan, new Map([["po-638", local(638, { sourcePresenceStatus: "MISSING_CONFIRMED" })]])).length, 0);
  });
});

describe("proteções", () => {
  it("16. varredura FAILED/INCONCLUSIVE não marca ausência (presença intocada)", () => {
    for (const completeness of [
      assessPurchaseOrderFetchCompleteness(meta({ fetchFailed: true, stoppedBecauseNoNext: false })),
      assessPurchaseOrderFetchCompleteness(meta({ stoppedBecauseNoNext: false, stoppedBecauseMaxPages: true })),
    ]) {
      const r = plan({ locals: [local(638)], found: [], completeness });
      assert.equal(r.plan.missingCandidates.length, 0);
      assert.equal(r.plan.missingConfirmed.length, 0);
      assert.equal(r.plan.inconclusive.length, 1);
      assert.equal(r.plan.inconclusive[0]!.lifecyclePatch, null);
    }
  });

  it("17. incremental (RECENT_WINDOW) nunca avalia ausência", () => {
    const r = plan({ locals: [local(638)], found: [], strategy: "RECENT_WINDOW" });
    assert.equal(r.plan.absencesEvaluated, false);
    assert.equal(r.plan.missingCandidates.length, 0);
  });

  it("18. reconciliação desligada não avalia ausência e gera alerta", () => {
    const r = plan({ locals: [local(638)], found: [], detection: false });
    assert.equal(r.plan.missingCandidates.length, 0);
    assert.ok(r.alerts.some((a) => a.code === "ABSENCE_EVALUATION_SKIPPED"));
  });

  it("19. guarda de volume: confirmações em massa viram candidatas + alerta crítico", () => {
    const locals = Array.from({ length: 40 }, (_, i) =>
      local(1000 + i, { sourcePresenceStatus: "MISSING_CANDIDATE", missingConsecutiveRuns: 1, missingSince: T0 })
    );
    const r = plan({ locals, found: [], runId: "run-2", executedAt: T1 });
    assert.equal(r.plan.missingConfirmed.length, 0);
    assert.equal(r.guards.massGuardTriggered, true);
    assert.ok(r.alerts.some((a) => a.code === "MASS_ABSENCE_GUARD_TRIGGERED" && a.severity === "critical"));
    assert.equal(r.plan.missingCandidates.length, 40);
  });

  it("20. limite proporcional ao universo (mínimo 1)", () => {
    const policy = { ...DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY, maxConfirmationsPerRun: 100, maxConfirmationsRatio: 0.05 };
    assert.equal(purchaseOrderConfirmationLimit(policy, 600), 30);
    assert.equal(purchaseOrderConfirmationLimit(policy, 3), 1);
  });

  it("21. consulta por ID que encontra o pedido protege contra ausência", () => {
    const r = plan({ locals: [local(638)], found: [], directed: [{ externalId: 638, found: true }] });
    assert.equal(r.plan.missingCandidates.length, 0);
    assert.equal(r.plan.inconclusive[0]?.reason, "DIRECTED_LOOKUP_FOUND_PRESENCE_UNCHANGED");
  });

  it("22. consulta por ID não encontrado (semântica validada) confirma sem esperar o intervalo", () => {
    const r = plan({ locals: [local(638)], found: [], directed: [{ externalId: 638, found: false }] });
    assert.equal(r.plan.missingConfirmed.length, 1);
    assert.equal(r.plan.missingConfirmed[0]!.reason, "DIRECTED_LOOKUP_NOT_FOUND");
  });

  it("23. janela: pedido fora da janela nunca vira ausente", () => {
    const scope = buildPurchaseOrderRunScope({
      strategy: "FULL_RECONCILIATION",
      window: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-23T00:00:00Z") },
    });
    const old = local(10, { issuedAt: new Date("2025-01-10T12:00:00Z") });
    const r = plan({
      locals: [old, local(638)],
      found: [],
      scope,
      completeness: assessPurchaseOrderFetchCompleteness(
        meta({ requestedWindow: { from: new Date("2026-10-01"), to: new Date("2026-10-23") }, dateFilterValidated: true })
      ),
    });
    assert.deepEqual(r.plan.missingCandidates.map((i) => i.externalId), ["638"]);
    assert.equal(r.guards.outsideScope, 1);
  });

  it("24. preview não produz patch nem evento", () => {
    const r = plan({ locals: [local(638)], found: [], mode: "preview" });
    assert.equal(r.plan.missingCandidates.length, 1);
    assert.equal(r.plan.missingCandidates[0]!.lifecyclePatch, null);
    assert.equal(buildPurchaseOrderPresenceEvents(r.plan, new Map([["po-638", local(638)]])).length, 0);
  });

  it("25. eventos só em transições de status", () => {
    const l = local(638);
    const r = plan({ locals: [l], found: [] });
    const events = buildPurchaseOrderPresenceEvents(r.plan, new Map([[l.localId, l]]));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "MISSING_CANDIDATE");
    assert.equal(events[0]!.fromStatus, "PRESENT");
  });

  it("26. política lida do ambiente com limites", () => {
    const p = resolvePurchaseOrderReconciliationPolicy({ NOMUS_PO_CONFIRM_MIN_HOURS_BETWEEN_MISSES: "6", NOMUS_PO_MAX_CONFIRMATIONS_RATIO: "9" });
    assert.equal(p.minHoursBetweenMisses, 6);
    assert.equal(p.maxConfirmationsRatio, DEFAULT_PURCHASE_ORDER_RECONCILIATION_POLICY.maxConfirmationsRatio);
  });
});

describe("respostas anômalas da API", () => {
  it("26a. página HTTP 200 sem lista reconhecível = INCONCLUSIVE (não é fim da paginação)", () => {
    const c = assessPurchaseOrderFetchCompleteness(meta({ stoppedBecauseNoNext: false, malformedPages: 1 }));
    assert.equal(c.runStatus, "INCONCLUSIVE");
    assert.equal(c.payloadComplete, false);
    assert.ok(c.reasons.includes("MALFORMED_PAYLOAD_INCOMPLETE_SNAPSHOT"));
  });

  it("26b. muitas ausências NOVAS numa varredura não gravam nada (nem candidata) + alerta crítico", () => {
    const locals = Array.from({ length: 40 }, (_, i) => local(2000 + i));
    const r = plan({ locals, found: [] });
    assert.equal(r.plan.missingCandidates.length, 0);
    assert.equal(r.guards.candidatesBlocked, 40);
    assert.ok(r.plan.inconclusive.every((i) => i.lifecyclePatch === null && i.reason === "MASS_ABSENCE_CANDIDATES_BLOCKED"));
    assert.ok(r.alerts.some((a) => a.code === "MASS_ABSENCE_CANDIDATES_BLOCKED" && a.severity === "critical"));
  });

  it("26c. ausências novas dentro do limite seguem normalmente", () => {
    const present = Array.from({ length: 60 }, (_, i) => local(3000 + i));
    const r = plan({ locals: present, found: present.slice(2).map((l) => l.externalId) });
    assert.equal(r.plan.missingCandidates.length, 2);
    assert.equal(r.guards.candidatesBlocked, 0);
  });
});

describe("rótulos", () => {
  it("27. ausência ≠ cancelamento ≠ exclusão comprovada", () => {
    assert.equal(describePurchaseOrderPresence({ sourcePresenceStatus: "MISSING_CONFIRMED", stage: "APPROVED" }).label, "Ausente no Nomus — confirmado");
    assert.equal(describePurchaseOrderPresence({ sourcePresenceStatus: "MISSING_CANDIDATE" }).label, "Ausente no Nomus — em verificação");
    assert.equal(describePurchaseOrderPresence({ sourcePresenceStatus: "PRESENT", stage: "CANCELED" }).label, "Cancelado no Nomus");
    for (const status of ["PRESENT", "MISSING_CANDIDATE", "MISSING_CONFIRMED"]) {
      assert.doesNotMatch(describePurchaseOrderPresence({ sourcePresenceStatus: status }).label, /Excluído/);
    }
  });
});
