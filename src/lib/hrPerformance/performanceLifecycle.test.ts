import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, it } from "node:test";
import { cycleEvolution, employeeHistory } from "./performanceInsights.js";
import {
  checkCycleDeletion,
  classifyCycle,
  cycleGovernance,
  inactivateCycle,
  inactiveCycleViolation,
  planCycleDeletion,
  reactivateCycle,
} from "./performanceLifecycle.js";
import { createMemoryPerformanceStore, CycleInactiveError, fromDbRow, planPerformanceWrite } from "./performancePrisma.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";
import {
  calibrate,
  exchangeLink,
  hasSubmittedLeaderEvaluation,
  issueInvite,
  issueReport,
  leaderQueue,
  publicForm,
  transitionCycle,
  validateTechnical,
  verifyOtp,
} from "./performanceService.js";
import type { PerformanceDatabase } from "./performanceState.js";
import {
  ana,
  assignmentOf,
  bia,
  bruno,
  brunoScope,
  hrScope,
  must,
  NOW,
  openCycle,
  openOptions,
  outroSetor,
  participantOf,
  recem,
  submitLeader,
  submitSelf,
} from "./performanceTestFixtures.js";

const tokenOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(3));
const SA = { cycleId: "", reason: "Ciclo criado só para validar o fluxo.", actorUserId: "u-sa", superAdmin: true, now: NOW };

/** Ciclo aberto → respostas → calibração → homologação. `classification` antes da homologação. */
function homologated(classification: "OFFICIAL" | "TEST") {
  const open = openCycle();
  let db = open.db;
  if (classification === "TEST") db = must(classifyCycle(db, { ...SA, cycleId: open.cycleId, classification: "TEST" })).db;
  db = submitSelf(db, "ana", 4);
  db = submitLeader(db, "ana", 3);
  db = submitSelf(db, "bia", 3);
  db = submitLeader(db, "bia", 3);
  for (const to of ["CONSOLIDATION", "CALIBRATION"] as const) {
    db = must(transitionCycle(db, { cycleId: open.cycleId, to, actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
  }
  for (const id of ["ana", "bia", "semlider", "otavio"]) {
    const pid = participantOf(db, id).id;
    const r = db.results.find((x) => x.participantId === pid && x.active)!;
    if (r.technicalValidation === "PENDING_VALIDATION") db = must(validateTechnical(db, { participantId: pid, decision: "VALIDATED", note: "Padrão da função conferido.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    db = must(calibrate(db, { participantId: pid, note: "Leitura do RH sem ajuste.", actorUserId: "rh", actorEmployeeId: null, acceptMissingLeader: !hasSubmittedLeaderEvaluation(db, pid), scope: hrScope }, openOptions)).db;
  }
  db = must(transitionCycle(db, { cycleId: open.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions)).db;
  return { db, cycleId: open.cycleId };
}

describe("classificação e predicado oficial", () => {
  it("ciclo oficial homologado com publicação oficial entra; teste homologado nunca entra (6)", () => {
    const official = homologated("OFFICIAL");
    const cycle = official.db.cycles.find((c) => c.id === official.cycleId)!;
    assert.equal(cycleGovernance(official.db, cycle).officialEligible, true);
    const test = homologated("TEST");
    const testCycle = test.db.cycles.find((c) => c.id === test.cycleId)!;
    const gov = cycleGovernance(test.db, testCycle);
    assert.equal(gov.officialEligible, false);
    assert.match(gov.reasons.join(" "), /teste/);
    assert.equal(cycleEvolution(test.db, hrScope, NOW).length, 0, "evolução padrão sem teste");
    assert.equal(cycleEvolution(test.db, hrScope, NOW, true).length, 1, "filtro de auditoria recupera, rotulado");
    const history = employeeHistory(test.db, "ana", hrScope, true);
    assert.equal(history.ok && history.cycles.length, 0, "histórico da ficha sem ciclo de teste");
  });

  it("oficial com publicação oficial não vira teste; teste não vira oficial", () => {
    const official = homologated("OFFICIAL");
    const blocked = classifyCycle(official.db, { ...SA, cycleId: official.cycleId, classification: "TEST" });
    assert.equal(blocked.ok === false && blocked.code, "OFFICIALLY_PUBLISHED");
    const test = homologated("TEST");
    const back = classifyCycle(test.db, { ...SA, cycleId: test.cycleId, classification: "OFFICIAL" });
    assert.equal(back.ok === false && back.code, "TEST_IS_FINAL");
  });

  it("ciclo antigo sem colunas novas vira OFFICIAL e ACTIVE na leitura (13)", () => {
    const row = fromDbRow("cycles", { id: "c", name: "Antigo", status: "HOMOLOGATED", createdAt: new Date() });
    assert.equal(row.classification, "OFFICIAL");
    assert.equal(row.activation, "ACTIVE");
  });
});

describe("inativação", () => {
  it("SUPER_ADMIN inativa ciclo de teste; convites e sessões deixam de funcionar (1, 4)", () => {
    const open = openCycle();
    let db = must(classifyCycle(open.db, { ...SA, cycleId: open.cycleId, classification: "TEST" })).db;
    const invite = must(issueInvite(db, { assignmentId: assignmentOf(db, "ana", "SELF").id, actorUserId: "rh", scope: hrScope }, openOptions));
    db = invite.db;
    const exchanged = must(exchangeLink(db, { token: tokenOf(invite.value.url) }, openOptions));
    const verified = must(verifyOtp(exchanged.db, { sessionToken: exchanged.value.sessionToken, otp: invite.value.otp }, openOptions));
    db = verified.db;
    assert.equal(publicForm(db, { sessionToken: verified.value.sessionToken }, openOptions).ok, true);
    const notAdmin = inactivateCycle(db, { ...SA, cycleId: open.cycleId, superAdmin: false });
    assert.equal(notAdmin.ok === false && notAdmin.code, "FORBIDDEN", "só o SUPER_ADMIN (8)");
    const off = must(inactivateCycle(db, { ...SA, cycleId: open.cycleId }));
    assert.ok(off.value.revokedInvites >= 1);
    assert.ok(off.value.revokedSessions >= 1);
    db = off.db;
    assert.equal(publicForm(db, { sessionToken: verified.value.sessionToken }, openOptions).ok, false, "sessão aberta para de funcionar");
    assert.equal(exchangeLink(db, { token: tokenOf(invite.value.url) }, openOptions).ok, false, "QR para de funcionar");
    const audit = db.audits.find((a) => a.action === "CYCLE_INACTIVATED")!;
    assert.equal(audit.actorUserId, "u-sa");
    assert.equal(audit.detail.reason, SA.reason);
  });

  it("ciclo inativo some das tarefas e dos indicadores, mas continua consultável (2, 3, 5)", () => {
    const official = homologated("OFFICIAL");
    const open = openCycle();
    assert.ok(leaderQueue(open.db, brunoScope, "bruno").length > 0);
    const offOpen = must(inactivateCycle(open.db, { ...SA, cycleId: open.cycleId })).db;
    assert.equal(leaderQueue(offOpen, brunoScope, "bruno").length, 0, "tarefas fora da visão operacional");
    const off = must(inactivateCycle(official.db, { ...SA, cycleId: official.cycleId })).db;
    const cycle = off.cycles.find((c) => c.id === official.cycleId)!;
    assert.equal(cycleGovernance(off, cycle).officialEligible, false);
    assert.equal(cycleEvolution(off, hrScope, NOW).length, 0);
    const history = employeeHistory(off, "ana", hrScope, true);
    assert.equal(history.ok && history.cycles.length, 0);
    const audit = employeeHistory(off, "ana", hrScope, true, true);
    assert.equal(audit.ok && audit.cycles.length, 1, "consulta de auditoria continua");
    assert.equal(off.results.length, official.db.results.length, "nada apagado");
  });

  it("qualquer gravação operacional em ciclo inativo é recusada na camada de gravação", () => {
    const open = openCycle();
    const off = must(inactivateCycle(open.db, { ...SA, cycleId: open.cycleId })).db;
    const attempt = submitSelf(off, "ana", 3);
    assert.ok(inactiveCycleViolation(off, attempt), "resposta em ciclo inativo detectada");
    assert.throws(() => planPerformanceWrite(off, attempt), CycleInactiveError);
    const report = issueReport(off, { cycleId: open.cycleId, kind: "consolidado", participantId: null, actorUserId: "rh", actorName: "RH", scope: hrScope, randomSuffix: "abcdef" }, openOptions);
    if (report.ok) assert.throws(() => planPerformanceWrite(off, report.db), CycleInactiveError, "documento novo de ciclo inativo recusado (14)");
  });

  it("reativar exige motivo, não restaura sessões e pede reemissão de convites (7)", () => {
    const open = openCycle();
    const invite = must(issueInvite(open.db, { assignmentId: assignmentOf(open.db, "ana", "SELF").id, actorUserId: "rh", scope: hrScope }, openOptions));
    const exchanged = must(exchangeLink(invite.db, { token: tokenOf(invite.value.url) }, openOptions));
    const verified = must(verifyOtp(exchanged.db, { sessionToken: exchanged.value.sessionToken, otp: invite.value.otp }, openOptions));
    const off = must(inactivateCycle(verified.db, { ...SA, cycleId: open.cycleId })).db;
    const short = reactivateCycle(off, { ...SA, cycleId: open.cycleId, reason: "curto" });
    assert.equal(short.ok === false && short.code, "NOTE_REQUIRED");
    const on = must(reactivateCycle(off, { ...SA, cycleId: open.cycleId, reason: "Inativado por engano pelo RH." }));
    assert.equal(on.value.invitesNeedReissue, true);
    assert.equal(publicForm(on.db, { sessionToken: verified.value.sessionToken }, openOptions).ok, false, "sessão revogada continua revogada");
    assert.equal(exchangeLink(on.db, { token: tokenOf(invite.value.url) }, openOptions).ok, false, "convite revogado continua revogado");
  });
});

describe("exclusão de ciclo de teste", () => {
  function inactiveTest() {
    const test = homologated("TEST");
    return { ...test, db: must(inactivateCycle(test.db, { ...SA, cycleId: test.cycleId })).db };
  }

  it("SUPER_ADMIN não exclui ciclo oficial; sem SUPER_ADMIN nada é excluído (8, 9)", () => {
    const official = homologated("OFFICIAL");
    const off = must(inactivateCycle(official.db, { ...SA, cycleId: official.cycleId })).db;
    const name = off.cycles.find((c) => c.id === official.cycleId)!.name;
    const denied = planCycleDeletion(off, { ...SA, cycleId: official.cycleId, confirmation: name });
    assert.equal(denied.ok === false && denied.code, "DELETE_BLOCKED");
    const test = inactiveTest();
    const notAdmin = planCycleDeletion(test.db, { ...SA, cycleId: test.cycleId, superAdmin: false, confirmation: "Ciclo 2026-S2" });
    assert.equal(notAdmin.ok === false && notAdmin.code, "FORBIDDEN");
  });

  it("exige ciclo inativo, nome digitado e motivo", () => {
    const test = homologated("TEST");
    const active = checkCycleDeletion(test.db, test.cycleId)!;
    assert.equal(active.deletable, false);
    assert.match(active.blockers.join(" "), /Inative/);
    const off = inactiveTest();
    const wrong = planCycleDeletion(off.db, { ...SA, cycleId: off.cycleId, confirmation: "outro nome" });
    assert.equal(wrong.ok === false && wrong.code, "CONFIRMATION_MISMATCH");
  });

  it("documento emitido bloqueia a exclusão; a alternativa é manter inativo (11)", () => {
    const test = homologated("TEST");
    const issued = must(issueReport(test.db, { cycleId: test.cycleId, kind: "consolidado", participantId: null, actorUserId: "rh", actorName: "RH", scope: hrScope, randomSuffix: "a1b2c3" }, openOptions));
    const off = must(inactivateCycle(issued.db, { ...SA, cycleId: test.cycleId })).db;
    const check = checkCycleDeletion(off, test.cycleId)!;
    assert.equal(check.deletable, false);
    assert.match(check.blockers.join(" "), /documento/);
  });

  it("exclusão transacional apaga só o ciclo de teste e a auditoria permanece (10, 12)", async () => {
    const test = inactiveTest();
    const other = openCycle();
    // Junta outro ciclo oficial no mesmo banco para provar que ele não é tocado.
    const merged: PerformanceDatabase = structuredClone(test.db);
    for (const key of ["cycles", "participants", "assignments", "answers", "results"] as const) {
      (merged[key] as unknown[]).push(...(other.db[key] as unknown[]).filter((row) => !(merged[key] as { id: string }[]).some((m) => m.id === (row as { id: string }).id)));
    }
    const store = createMemoryPerformanceStore(merged);
    const before = store.snapshot();
    const plan = planCycleDeletion(before, { ...SA, cycleId: test.cycleId, confirmation: "Ciclo 2026-S2" });
    assert.equal(plan.ok, true);
    if (!("plan" in plan)) return;
    const deleted = await store.deleteTestCycle!(plan.plan, before.graphRevision);
    assert.ok(deleted.answers > 0 && deleted.results > 0 && deleted.cycles === 1);
    const after = store.snapshot();
    assert.equal(after.cycles.some((c) => c.id === test.cycleId), false);
    assert.equal(after.participants.some((p) => p.cycleId === test.cycleId), false);
    assert.equal(after.cycles.some((c) => c.id === other.cycleId), true, "outro ciclo intacto");
    const auditBefore = before.audits.filter((a) => a.entityId === test.cycleId).length;
    assert.equal(after.audits.filter((a) => a.entityId === test.cycleId).length, auditBefore + 1, "auditoria preservada + exclusão");
    const deletion = after.audits.find((a) => a.action === "CYCLE_DELETED")!;
    assert.equal(deletion.detail.name, "Ciclo 2026-S2");
    assert.equal(deletion.detail.reason, SA.reason);
    // Revisão antiga: conflito, nada apagado de novo.
    await assert.rejects(() => store.deleteTestCycle!(plan.plan, before.graphRevision));
  });
});

describe("rotas: permissões, exportação e relatórios", () => {
  async function serve(initial: PerformanceDatabase) {
    const app = express();
    app.use(express.json());
    const store = createMemoryPerformanceStore(initial);
    const isSuper = (req: express.Request) => req.headers["x-actor"] === "super";
    registerPerformanceRoutes(app, {
      enabled: () => true,
      options: { now: () => NOW, officialPublication: true, identityOtpEnabled: false, remindersEnabled: false, publicOrigin: "https://induscost.local" },
      store,
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      can: async () => true,
      loadScope: async () => ({ accessScope: "ALL", actorEmployeeId: null, teamIds: [] }),
      loadEmployees: async (ids) => [ana, bia, bruno, recem, outroSetor].filter((e) => ids.includes(e.id)),
      actorUserId: async (req) => (isSuper(req) ? "u-sa" : "u-rh"),
      isSuperAdmin: async (req) => isSuper(req),
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const call = async (method: string, path: string, body?: unknown, actor = "hr") => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-actor": actor }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { text };
      }
      return { status: res.status, json, text };
    };
    return { server, store, call };
  }

  it("RH sem SUPER_ADMIN não inativa nem exclui; SUPER_ADMIN inativa, exporta bloqueado e exclui teste (8, 14)", async () => {
    const test = homologated("TEST");
    const { server, store, call } = await serve(test.db);
    try {
      const reason = "Ciclo de validação do fluxo.";
      assert.equal((await call("POST", `/api/hr/performance/cycles/${test.cycleId}/inactivate`, { reason })).status, 403);
      assert.equal((await call("DELETE", `/api/hr/performance/cycles/${test.cycleId}`, { reason, confirmation: "Ciclo 2026-S2" })).status, 403);
      const csv = await call("GET", `/api/hr/performance/cycles/${test.cycleId}/export`);
      assert.match(csv.text, /TESTE - NAO OFICIAL/, "exportação de ciclo de teste vem rotulada");
      assert.equal((await call("POST", `/api/hr/performance/cycles/${test.cycleId}/inactivate`, { reason }, "super")).status, 200);
      assert.equal((await call("GET", `/api/hr/performance/cycles/${test.cycleId}/export`)).json.error, "CYCLE_INACTIVE");
      const report = await call("POST", "/api/hr/performance/reports/issue", { kind: "consolidado", cycleId: test.cycleId });
      assert.equal(report.json.error, "CYCLE_INACTIVE", "documento novo de ciclo inativo recusado");
      const pid = participantOf(store.snapshot(), "ana").id;
      assert.equal((await call("POST", `/api/hr/performance/participants/${pid}/calibration`, { note: "Tentativa depois de inativar." })).status, 409);
      assert.equal((await call("GET", `/api/hr/performance/cycles/${test.cycleId}/workspace`)).status, 200, "consultável");
      const info = await call("GET", `/api/hr/performance/cycles/${test.cycleId}/lifecycle`, undefined, "super");
      assert.equal((info.json.deletion as { deletable: boolean }).deletable, true);
      const wrong = await call("DELETE", `/api/hr/performance/cycles/${test.cycleId}`, { reason, confirmation: "Outro" }, "super");
      assert.equal(wrong.json.error, "CONFIRMATION_MISMATCH");
      assert.equal(wrong.status, 400);
      const done = await call("DELETE", `/api/hr/performance/cycles/${test.cycleId}`, { reason, confirmation: "Ciclo 2026-S2" }, "super");
      assert.equal(done.status, 200);
      assert.equal(store.snapshot().cycles.length, 0);
      assert.ok(store.snapshot().audits.some((a) => a.action === "CYCLE_DELETED" && a.entityId === test.cycleId));
    } finally {
      server.close();
    }
  });

  it("tentativa bloqueada de excluir ciclo oficial fica registrada (9)", async () => {
    const official = homologated("OFFICIAL");
    const { server, store, call } = await serve(official.db);
    try {
      await call("POST", `/api/hr/performance/cycles/${official.cycleId}/inactivate`, { reason: "Encerrado por decisão do RH." }, "super");
      const res = await call("DELETE", `/api/hr/performance/cycles/${official.cycleId}`, { reason: "Tentativa de excluir oficial.", confirmation: "Ciclo 2026-S2" }, "super");
      assert.equal(res.json.error, "DELETE_BLOCKED");
      assert.equal(store.snapshot().cycles.length, 1);
      assert.ok(store.snapshot().audits.some((a) => a.action === "CYCLE_DELETE_BLOCKED"));
    } finally {
      server.close();
    }
  });
});
