/**
 * Prontidão do ciclo e dossiê: cada perfil recebe as avaliações que lhe cabem
 * (docs/avaliacao-desempenho/DOSSIE_AVALIACOES_POR_PERFIL.md) e a calibração enxerga todos os ângulos.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPerformanceScope } from "./performanceAccess.js";
import { evaluatorStats, personDossier } from "./performanceDossier.js";
import { createLeadershipModel, type LeadershipSnapshot } from "./performanceLeadershipService.js";
import { cycleReadiness, readinessBlocked, type ReadinessContext } from "./performanceReadiness.js";
import { applyParticipants, createCycle, createDraftModel, publishModel, saveAnswers, submitAssignment, transitionCycle } from "./performanceService.js";
import { emptyPerformanceDatabase, type AssignmentRecord, type PerformanceDatabase } from "./performanceState.js";
import { hrScope, must, NOW, openOptions, person } from "./performanceTestFixtures.js";

const old = new Date("2020-01-10T12:00:00.000Z");
const P = (id: string, name: string, managerId: string | null, extra: Record<string, unknown> = {}) => person(id, name, { managerId, managerName: managerId, admissionDate: old, ...extra });
// Carla (topo) → Bruno (líder) → Ana, Bia, Dani; Marcos (líder) → Otávio.
const people = [
  P("carla", "Carla Diretora", null, { managerSource: "TOPO" }),
  P("bruno", "Bruno Gerente", "carla"),
  P("marcos", "Marcos Supervisor", "carla"),
  P("ana", "Ana Operadora", "bruno"),
  P("bia", "Bia Operadora", "bruno"),
  P("dani", "Dani Operadora", "bruno"),
  P("otavio", "Otávio Técnico", "marcos"),
];
const snapshot: LeadershipSnapshot = { carla: { directReportIds: ["bruno", "marcos"] }, bruno: { directReportIds: ["ana", "bia", "dani"] }, marcos: { directReportIds: ["otavio"] } };
const ctx = (over: Partial<ReadinessContext> = {}): ReadinessContext => ({ linkedEmployeeIds: new Set(["carla", "bruno", "marcos"]), leaderSince: new Map(), names: new Map(people.map((p) => [p.id, p.name])), ...over });

function prepared(selected: string[], withLeadership = true, classification: "OFFICIAL" | "TEST" = "OFFICIAL") {
  let db: PerformanceDatabase = emptyPerformanceDatabase();
  const individual = must(createDraftModel(db, { name: "Modelo base", actorUserId: "rh", scope: hrScope }, openOptions));
  db = must(publishModel(individual.db, { modelId: individual.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
  let leadershipModelId: string | null = null;
  if (withLeadership) {
    const leadership = must(createLeadershipModel(db, { name: "Liderança 180°", actorUserId: "rh", scope: hrScope }, openOptions));
    db = must(publishModel(leadership.db, { modelId: leadership.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    leadershipModelId = leadership.value.modelId;
  }
  const cycle = must(createCycle(db, { name: "Ciclo", periodLabel: "2026-S2", modelId: individual.value.modelId, leadershipModelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification, scope: hrScope }, openOptions));
  db = must(applyParticipants(cycle.db, { cycleId: cycle.value.cycleId, employees: people.filter((p) => selected.includes(p.id)), selectedIds: selected, exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions)).db;
  db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
  return { db, cycleId: cycle.value.cycleId, cycle: db.cycles.find((c) => c.id === cycle.value.cycleId)! };
}
const codes = (issues: ReturnType<typeof cycleReadiness>) => issues.map((i) => `${i.severity}:${i.code}`).sort();

describe("prontidão do ciclo: cada perfil recebe as avaliações que lhe cabem", () => {
  it("cadeia completa, todos com usuário: pronto para abrir, só o aviso do topo", () => {
    const { db, cycle } = prepared(people.map((p) => p.id));
    const issues = cycleReadiness(db, cycle, ctx(), NOW);
    assert.deepEqual(codes(issues), ["WARN:TOP_WITHOUT_EVALUATOR"]);
    assert.equal(readinessBlocked(issues).length, 0);
    assert.deepEqual(issues[0]!.people.map((p) => p.name), ["Carla Diretora"]);
  });

  it("ciclo oficial sem 180° bloqueia; ciclo de teste só avisa", () => {
    const official = prepared(people.map((p) => p.id), false, "OFFICIAL");
    assert.ok(codes(cycleReadiness(official.db, official.cycle, ctx(), NOW)).includes("BLOCK:LEADERSHIP_MODEL_REQUIRED"));
    const test = prepared(people.map((p) => p.id), false, "TEST");
    assert.ok(codes(cycleReadiness(test.db, test.cycle, ctx(), NOW)).includes("WARN:LEADERSHIP_MODEL_REQUIRED"));
  });

  it("líder fora do ciclo bloqueia e diz quem ele lidera", () => {
    const { db, cycle } = prepared(["ana", "bia", "dani", "otavio"]);
    const issues = cycleReadiness(db, cycle, ctx(), NOW);
    const outside = issues.find((i) => i.code === "LEADER_OUTSIDE_CYCLE")!;
    assert.equal(outside.severity, "BLOCK");
    assert.deepEqual(outside.people.map((p) => p.name).sort(), ["Bruno Gerente", "Marcos Supervisor"]);
    assert.match(outside.people.find((p) => p.name === "Bruno Gerente")!.detail ?? "", /Ana Operadora/);
  });

  it("sem 180° o líder fora do ciclo só avisa: ele avalia a equipe, mas não é avaliado", () => {
    const { db, cycle } = prepared(["ana", "bia", "dani", "otavio"], false, "TEST");
    const issues = cycleReadiness(db, cycle, ctx(), NOW);
    assert.equal(issues.find((i) => i.code === "LEADER_OUTSIDE_CYCLE")!.severity, "WARN");
    assert.equal(readinessBlocked(issues).length, 0);
  });

  it("avaliador sem usuário bloqueia (a avaliação dele nunca seria respondida)", () => {
    const { db, cycle } = prepared(people.map((p) => p.id));
    const issues = cycleReadiness(db, cycle, ctx({ linkedEmployeeIds: new Set(["carla", "bruno"]) }), NOW);
    const noUser = issues.find((i) => i.code === "EVALUATOR_WITHOUT_USER")!;
    assert.equal(noUser.severity, "BLOCK");
    assert.deepEqual(noUser.people.map((p) => p.name), ["Marcos Supervisor"]);
    assert.match(noUser.people[0]!.detail ?? "", /avalia 1 pessoa/);
  });

  it("líder há menos de 90 dias avisa; troca antiga ou para outro líder não", () => {
    const { db, cycle } = prepared(people.map((p) => p.id));
    const leaderSince = new Map([
      ["ana", { since: "2026-09-20T12:00:00.000Z", managerId: "bruno", previousManagerName: "Marcos Supervisor" }],
      ["bia", { since: "2025-01-01T12:00:00.000Z", managerId: "bruno", previousManagerName: null }],
      ["dani", { since: "2026-10-01T12:00:00.000Z", managerId: "marcos", previousManagerName: null }],
    ]);
    const issues = cycleReadiness(db, cycle, ctx({ leaderSince }), NOW);
    const recent = issues.find((i) => i.code === "RECENT_LEADER_CHANGE")!;
    assert.equal(recent.severity, "WARN");
    assert.deepEqual(recent.people.map((p) => p.name), ["Ana Operadora"]);
    assert.match(recent.people[0]!.detail ?? "", /há 26 dia\(s\); antes: Marcos Supervisor/);
  });
});

describe("calibração com todos os ângulos", () => {
  const task = (db: PerformanceDatabase, kind: AssignmentRecord["kind"], employeeId: string) => {
    const participant = db.participants.find((p) => p.employeeId === employeeId)!;
    return db.assignments.find((a) => a.participantId === participant.id && a.kind === kind && a.active)!;
  };
  function answerLeader(db: PerformanceDatabase, employeeId: string, score: (i: number) => 1 | 2 | 3 | 4) {
    const a = task(db, "LEADER", employeeId);
    const scope = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: a.evaluatorEmployeeId, teamIds: [employeeId] });
    const qs = db.questions.filter((q) => q.modelId === db.cycles[0]!.modelId);
    const answers = qs.map((q, i) => ({ code: q.code, answer: { kind: "score" as const, score: score(i), evidence: score(i) === 1 || score(i) === 4 ? "Exemplo observado no posto de trabalho." : null } }));
    const saved = must(saveAnswers(db, { assignmentId: a.id, expectedVersion: a.version, answers, actorUserId: "u", scope }, openOptions));
    const current = saved.db.assignments.find((x) => x.id === a.id)!;
    return must(submitAssignment(saved.db, { assignmentId: a.id, expectedVersion: current.version, actorUserId: "u", scope, assistedConfirmation: true }, openOptions)).db;
  }
  function opened() {
    const { db: base, cycleId } = prepared(people.map((p) => p.id));
    let db = must(transitionCycle(base, { cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, leadershipSnapshot: snapshot, scope: hrScope }, openOptions)).db;
    // Bruno dá tudo 4 (leniente e sem variação); Marcos varia; Carla dá tudo 3 (central).
    for (const id of ["ana", "bia", "dani"]) db = answerLeader(db, id, () => 4);
    db = answerLeader(db, "otavio", (i) => (i % 3 === 0 ? 2 : i % 3 === 1 ? 3 : 4));
    for (const id of ["bruno", "marcos"]) db = answerLeader(db, id, () => 3);
    return { db, cycleId };
  }

  it("painel por avaliador: leniência e halo aparecem; amostra pequena não gera sinal", () => {
    const { db, cycleId } = opened();
    const stats = evaluatorStats(db, cycleId);
    const bruno = stats.find((s) => s.evaluatorEmployeeId === "bruno")!;
    assert.deepEqual([bruno.evaluated, bruno.submitted, bruno.mean], [3, 3, 4]);
    assert.ok(bruno.flags.includes("LENIENT") && bruno.flags.includes("HALO"), bruno.flags.join(","));
    const marcos = stats.find((s) => s.evaluatorEmployeeId === "marcos")!;
    assert.deepEqual(marcos.flags, [], "1 avaliação enviada: sem sinal");
    const carla = stats.find((s) => s.evaluatorEmployeeId === "carla")!;
    assert.deepEqual(carla.flags, [], "2 avaliações: abaixo do mínimo");
    assert.equal(JSON.stringify(stats).includes("Exemplo observado"), false, "painel não leva evidência");
  });

  it("dossiê reúne pessoa × líder, liderança, como avalia, histórico e PDI; sem comentário da equipe", () => {
    const { db: collected, cycleId } = opened();
    let db = must(transitionCycle(collected, { cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    const brunoP = db.participants.find((p) => p.employeeId === "bruno")!.id;
    const dossier = personDossier(db, brunoP, hrScope, null);
    assert.ok(dossier.ok);
    if (!dossier.ok) return;
    assert.equal(dossier.participant.isLeader, true);
    assert.equal(dossier.individual?.leaderStatus, "SUBMITTED", "avaliado por Carla");
    assert.ok(dossier.leadership, "comparativo de liderança presente");
    assert.equal(dossier.asEvaluator?.submitted, 3, "como avaliador: 3 liderados");
    assert.deepEqual(dossier.previousCycles, []);
    assert.equal(JSON.stringify(dossier).includes("SEGREDO"), false);
    const ana = personDossier(db, db.participants.find((p) => p.employeeId === "ana")!.id, hrScope, null);
    assert.ok(ana.ok && ana.leadership === null && ana.asEvaluator === null, "operacional: só pessoa × líder");
    const denied = personDossier(db, brunoP, buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" }), "ana");
    assert.equal(denied.ok, false);
  });
});

// ---------------------------------------------------------------------------
// Identidade dos avaliadores: o motivo de "sem acesso" é separado e a decisão continua sendo
// só a conta ativa ligada ao colaborador (a mesma régua de loadScope / Minha equipe).
// ---------------------------------------------------------------------------
import { createServer as createEvaluatorServer } from "node:http";
import type { AddressInfo as EvaluatorAddressInfo } from "node:net";
import evaluatorExpress from "express";
import { createMemoryPerformanceStore } from "./performancePrisma.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";
import type { EvaluatorIdentity, EvaluatorIdentityStatus } from "./evaluatorIdentity.js";

const identity = (entries: Array<[string, EvaluatorIdentityStatus, string | null]>) =>
  new Map<string, EvaluatorIdentity>(entries.map(([employeeId, status, personId]) => [employeeId, { employeeId, status, personId, accountId: status === "NO_ACCOUNT" ? null : `u-${employeeId}`, reason: `motivo ${status}` }]));

describe("prontidão × identidade dos avaliadores", () => {
  it("conta da mesma Pessoa sem vínculo (conta SUPER_ADMIN legada) vira pendência própria, BLOCK, com a Pessoa para regularizar", () => {
    const { db, cycle } = prepared(people.map((p) => p.id));
    const issues = cycleReadiness(db, cycle, ctx({ linkedEmployeeIds: new Set(["carla", "marcos"]), evaluatorIdentity: identity([["carla", "LINKED", "p-carla"], ["marcos", "LINKED", "p-marcos"], ["bruno", "ACCOUNT_NOT_LINKED", "p-bruno"]]) }), NOW);
    const notLinked = issues.find((i) => i.code === "EVALUATOR_ACCOUNT_NOT_LINKED")!;
    assert.equal(notLinked.severity, "BLOCK");
    assert.equal(notLinked.action, "REGULARIZE_ACCOUNT");
    assert.deepEqual(notLinked.people.map((p) => [p.name, p.personId]), [["Bruno Gerente", "p-bruno"]]);
    assert.match(notLinked.people[0]!.detail ?? "", /avalia 3 pessoa/);
    assert.ok(!issues.some((i) => i.code === "EVALUATOR_WITHOUT_USER"), "não é 'sem usuário': a conta existe");
  });

  it("cada motivo tem seu código: sem conta, conta inativa, conflito/Pessoa inativa — todos bloqueiam", () => {
    const { db, cycle } = prepared(people.map((p) => p.id));
    const issues = cycleReadiness(db, cycle, ctx({ linkedEmployeeIds: new Set(), evaluatorIdentity: identity([["carla", "NO_ACCOUNT", "p-carla"], ["bruno", "ACCOUNT_INACTIVE", "p-bruno"], ["marcos", "IDENTITY_CONFLICT", "p-marcos"]]) }), NOW);
    assert.deepEqual(
      issues.filter((i) => i.code.startsWith("EVALUATOR_")).map((i) => `${i.severity}:${i.code}:${i.action}:${i.people.map((p) => p.employeeId).join(",")}`).sort(),
      ["BLOCK:EVALUATOR_ACCOUNT_INACTIVE:REVIEW_ACCOUNT:bruno", "BLOCK:EVALUATOR_IDENTITY_CONFLICT:REVIEW_IDENTITY:marcos", "BLOCK:EVALUATOR_WITHOUT_USER:LINK_USERS:carla"]
    );
  });

  it("identidade canônica nunca libera: LINKED no mapa mas fora do conjunto ligado continua bloqueado", () => {
    const { db, cycle } = prepared(people.map((p) => p.id));
    const issues = cycleReadiness(db, cycle, ctx({ linkedEmployeeIds: new Set(["carla", "marcos"]), evaluatorIdentity: identity([["bruno", "ACCOUNT_NOT_LINKED", "p-bruno"]]) }), NOW);
    assert.equal(readinessBlocked(issues).length, 1);
  });

  it("TOP_WITHOUT_EVALUATOR é independente do acesso: o topo que também avalia gera WARN de topo e, sem conta ligada, BLOCK de acesso", () => {
    const { db, cycle } = prepared(people.map((p) => p.id), true, "TEST");
    const issues = cycleReadiness(db, cycle, ctx({ linkedEmployeeIds: new Set(["bruno", "marcos"]), evaluatorIdentity: identity([["carla", "NO_ACCOUNT", null], ["bruno", "LINKED", null], ["marcos", "LINKED", null]]) }), NOW);
    const top = issues.find((i) => i.code === "TOP_WITHOUT_EVALUATOR")!;
    assert.equal(top.severity, "WARN");
    assert.equal(top.action, "SET_EVALUATOR");
    assert.deepEqual(top.people.map((p) => p.name), ["Carla Diretora"]);
    const access = issues.find((i) => i.code === "EVALUATOR_WITHOUT_USER")!;
    assert.deepEqual(access.people.map((p) => p.name), ["Carla Diretora"]);
    // Resolver o acesso não some com o aviso de topo (e vice-versa).
    const after = cycleReadiness(db, cycle, ctx({ linkedEmployeeIds: new Set(["carla", "bruno", "marcos"]) }), NOW);
    assert.deepEqual(codes(after), ["WARN:TOP_WITHOUT_EVALUATOR"]);
    assert.equal(readinessBlocked(after).length, 0, "ciclo TEST com topo sem avaliador abre (só aviso)");
  });
});

describe("rota de prontidão usa a identidade dos avaliadores (antes e depois da regularização)", () => {
  it("GET /readiness: ACCOUNT_NOT_LINKED bloqueia; depois de ligar a conta, só o aviso do topo", async () => {
    const { db, cycleId } = prepared(people.map((p) => p.id), true, "TEST");
    let state: Map<string, EvaluatorIdentity> = identity([["carla", "LINKED", "p-carla"], ["marcos", "LINKED", "p-marcos"], ["bruno", "ACCOUNT_NOT_LINKED", "p-bruno"]]);
    const app = evaluatorExpress();
    app.use(evaluatorExpress.json());
    registerPerformanceRoutes(app, {
      enabled: () => true,
      options: { now: () => NOW, officialPublication: false, identityOtpEnabled: false, remindersEnabled: false, publicOrigin: "https://induscost.local" },
      store: createMemoryPerformanceStore(db),
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      can: async () => true,
      loadScope: async () => ({ accessScope: "ALL", actorEmployeeId: null, teamIds: [] }),
      loadEmployees: async (ids) => people.filter((e) => ids.includes(e.id)),
      actorUserId: async () => "u-rh",
      loadEvaluatorIdentities: async (ids) => new Map([...state].filter(([id]) => ids.includes(id))),
    });
    const server = createEvaluatorServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as EvaluatorAddressInfo).port;
    try {
      const get = async () => (await fetch(`http://127.0.0.1:${port}/api/hr/performance/cycles/${cycleId}/readiness`)).json() as Promise<{ issues: Array<{ code: string; severity: string }>; blocked: boolean }>;
      const before = await get();
      assert.equal(before.blocked, true);
      assert.ok(before.issues.some((i) => i.code === "EVALUATOR_ACCOUNT_NOT_LINKED"));
      state = identity([["carla", "LINKED", "p-carla"], ["marcos", "LINKED", "p-marcos"], ["bruno", "LINKED", "p-bruno"]]);
      const after = await get();
      assert.equal(after.blocked, false);
      assert.deepEqual(after.issues.map((i) => `${i.severity}:${i.code}`), ["WARN:TOP_WITHOUT_EVALUATOR"]);
    } finally {
      server.close();
    }
  });
});
