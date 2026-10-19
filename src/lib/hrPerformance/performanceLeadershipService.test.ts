import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPerformanceScope } from "./performanceAccess.js";
import { LEADERSHIP_CODES } from "./performanceLeadership.js";
import {
  calibrateLeadership,
  createLeadershipModel,
  journeyOf,
  leadershipComparison,
  type LeadershipSnapshot,
} from "./performanceLeadershipService.js";
import {
  applyParticipants,
  calibrate,
  createCycle,
  createDraftModel,
  createFeedback,
  createPdi,
  issueReport,
  exchangeLink,
  hasSubmittedLeaderEvaluation,
  issueInvite,
  publicForm,
  publicLogout,
  publicSave,
  publicSubmit,
  publishModel,
  saveAnswers,
  submitAssignment,
  transitionCycle,
  verifyOtp,
} from "./performanceService.js";
import { emptyPerformanceDatabase, type AssignmentRecord, type PerformanceDatabase } from "./performanceState.js";
import { reportData } from "./performanceInsights.js";
import { hrScope, must, NOW, openOptions, person } from "./performanceTestFixtures.js";

const tokenOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(3));
const old = new Date("2020-01-10T12:00:00.000Z");
const P = (id: string, name: string, managerId: string | null, extra: Record<string, unknown> = {}) =>
  person(id, name, { managerId, managerName: managerId, admissionDate: old, ...extra });

// Carla (topo) → Bruno (5 liderados) e Marcos (1 liderado). Exemplo Paulo → José → Joseane = Carla → Bruno → Ana.
const people = [
  P("carla", "Carla Diretora", null, { managerSource: "TOPO" }),
  P("bruno", "Bruno Gerente", "carla"),
  P("marcos", "Marcos Supervisor", "carla"),
  ...["ana", "bia", "dani", "edu", "fred"].map((id) => P(id, `${id[0]!.toUpperCase()}${id.slice(1)} Operadora`, "bruno")),
  P("otavio", "Otávio Técnico", "marcos"),
];
const snapshot: LeadershipSnapshot = {
  carla: { directReportIds: ["bruno", "marcos"] },
  bruno: { directReportIds: ["ana", "bia", "dani", "edu", "fred"] },
  marcos: { directReportIds: ["otavio"] },
};

function openLeadershipCycle() {
  let db: PerformanceDatabase = emptyPerformanceDatabase();
  const individual = must(createDraftModel(db, { name: "Modelo base", actorUserId: "rh", scope: hrScope }, openOptions));
  db = must(publishModel(individual.db, { modelId: individual.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
  const leadership = must(createLeadershipModel(db, { name: "Liderança 180°", actorUserId: "rh", scope: hrScope }, openOptions));
  db = must(publishModel(leadership.db, { modelId: leadership.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
  const cycle = must(
    createCycle(
      db,
      { name: "Ciclo 180", periodLabel: "2026-S2", modelId: individual.value.modelId, leadershipModelId: leadership.value.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hrScope },
      openOptions
    )
  );
  db = must(applyParticipants(cycle.db, { cycleId: cycle.value.cycleId, employees: people, selectedIds: people.map((p) => p.id), exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions)).db;
  db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
  const noSnapshot = transitionCycle(db, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions);
  assert.equal(noSnapshot.ok === false && noSnapshot.code, "LEADERSHIP_SNAPSHOT_REQUIRED");
  db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, leadershipSnapshot: snapshot, scope: hrScope }, openOptions)).db;
  return { db, cycleId: cycle.value.cycleId };
}

const task = (db: PerformanceDatabase, kind: AssignmentRecord["kind"], participantEmployee: string) => {
  const participant = db.participants.find((p) => p.employeeId === participantEmployee)!;
  return db.assignments.find((a) => a.participantId === participant.id && a.kind === kind && a.active) ?? null;
};
const pid = (db: PerformanceDatabase, employeeId: string) => db.participants.find((p) => p.employeeId === employeeId)!.id;
const COMMENT = "Explicou as prioridades da semana para toda a equipe na reunião.";

/** Responde e envia uma tarefa de liderança como a própria pessoa avaliadora. */
function answerLeadership(db: PerformanceDatabase, assignment: AssignmentRecord, score: 1 | 2 | 3 | 4, comment = COMMENT): PerformanceDatabase {
  const scope = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: assignment.evaluatorEmployeeId, teamIds: [assignment.employeeId] });
  const answers = LEADERSHIP_CODES.map((code) => ({ code, answer: { kind: "score" as const, score, evidence: score === 1 || score === 4 ? comment : null } }));
  const saved = must(saveAnswers(db, { assignmentId: assignment.id, expectedVersion: assignment.version, answers, actorUserId: `u-${assignment.evaluatorEmployeeId}`, scope }, openOptions));
  const current = saved.db.assignments.find((a) => a.id === assignment.id)!;
  return must(submitAssignment(saved.db, { assignmentId: assignment.id, expectedVersion: current.version, actorUserId: `u-${assignment.evaluatorEmployeeId}`, scope, assistedConfirmation: true }, openOptions)).db;
}

describe("180°: quem é líder e quais tarefas nascem", () => {
  it("líder é quem tem liderado direto ativo; cargo não entra", () => {
    const { db } = openLeadershipCycle();
    const leaders = db.participants.filter((p) => p.isLeader).map((p) => p.employeeId).sort();
    assert.deepEqual(leaders, ["bruno", "carla", "marcos"]);
    assert.equal(db.participants.find((p) => p.employeeId === "bruno")!.directReportCount, 5);
  });

  it("cada liderado avalia só o superior direto; o indireto não recebe avaliação dele", () => {
    const { db } = openLeadershipCycle();
    const upward = db.assignments.filter((a) => a.kind === "LEADERSHIP_UPWARD");
    assert.equal(upward.length, 8, "5 de Bruno + 1 de Marcos + Bruno e Marcos avaliando Carla");
    const fromAna = upward.filter((a) => a.evaluatorEmployeeId === "ana");
    assert.deepEqual(fromAna.map((a) => a.employeeId), ["bruno"], "Ana avalia Bruno, não Carla");
    assert.equal(upward.filter((a) => a.employeeId === "carla").length, 2);
    assert.equal(task(db, "LEADERSHIP_UPWARD", "carla"), null, "topo não avalia superior inexistente");
  });

  it("autoavaliação de liderança para os líderes; avaliação do superior para quem tem superior", () => {
    const { db } = openLeadershipCycle();
    assert.deepEqual(db.assignments.filter((a) => a.kind === "LEADERSHIP_SELF").map((a) => a.employeeId).sort(), ["bruno", "carla", "marcos"]);
    const superior = db.assignments.filter((a) => a.kind === "LEADERSHIP_SUPERIOR");
    assert.deepEqual(superior.map((a) => `${a.evaluatorEmployeeId}→${a.employeeId}`).sort(), ["carla→bruno", "carla→marcos"]);
    assert.ok(db.assignments.filter((a) => a.kind.startsWith("LEADERSHIP")).every((a) => a.modelId), "mesmo modelo de liderança nas três perspectivas");
    assert.equal(new Set(db.assignments.filter((a) => a.kind.startsWith("LEADERSHIP")).map((a) => a.modelId)).size, 1);
  });

  it("jornada: sem liderados = 2 etapas; líder com superior = 3; líder no topo = 2", () => {
    const { db } = openLeadershipCycle();
    const kinds = (id: string) => journeyOf(db, pid(db, id)).map((a) => a.kind);
    assert.deepEqual(kinds("ana"), ["SELF", "LEADERSHIP_UPWARD"]);
    assert.deepEqual(kinds("bruno"), ["SELF", "LEADERSHIP_UPWARD", "LEADERSHIP_SELF"]);
    assert.deepEqual(kinds("carla"), ["SELF", "LEADERSHIP_SELF"]);
  });
});

describe("180°: jornada no celular", () => {
  function portal(db: PerformanceDatabase, employeeId: string) {
    const self = task(db, "SELF", employeeId)!;
    const invite = must(issueInvite(db, { assignmentId: self.id, actorUserId: "rh", scope: hrScope }, openOptions));
    const exchanged = must(exchangeLink(invite.db, { token: tokenOf(invite.value.url) }, openOptions));
    const verified = must(verifyOtp(exchanged.db, { sessionToken: exchanged.value.sessionToken, otp: invite.value.otp }, openOptions));
    return { db: verified.db, token: verified.value.sessionToken };
  }
  function answerCurrent(db: PerformanceDatabase, token: string, score: 1 | 2 | 3 | 4, comment: string | null) {
    const form = must(publicForm(db, { sessionToken: token }, openOptions)).value;
    const answers = form.questions.map((q) => ({ code: q.code, answer: { kind: "score" as const, score, evidence: comment } }));
    return publicSave(db, { sessionToken: token, expectedVersion: form.version, answers, step: form.step.kind }, openOptions);
  }

  it("autoavaliação → avaliação do líder na mesma sessão; nota extrema exige comentário real; conclusão só no fim", () => {
    const { db: opened } = openLeadershipCycle();
    let { db, token } = portal(opened, "ana");
    let form = must(publicForm(db, { sessionToken: token }, openOptions)).value;
    assert.equal(form.step.kind, "SELF");
    assert.deepEqual([form.step.index, form.step.total], [1, 2]);
    db = must(answerCurrent(db, token, 3, null)).db;
    const sent = must(publicSubmit(db, { sessionToken: token, expectedVersion: must(publicForm(db, { sessionToken: token }, openOptions)).value.version, confirm: true, step: "SELF" }, openOptions));
    assert.deepEqual([sent.value.done, sent.value.next], [false, "LEADERSHIP_UPWARD"], "não mostra conclusão total ainda");
    db = sent.db;
    form = must(publicForm(db, { sessionToken: token }, openOptions)).value;
    assert.equal(form.step.kind, "LEADERSHIP_UPWARD");
    assert.match(form.step.intro, /Sua autoavaliação foi enviada com sucesso/);
    assert.equal(form.step.subjectFirstName, "Bruno");
    assert.equal(form.questions.length, 8);
    assert.match(form.questions[0]!.text, /^Meu líder /);
    const stale = publicSave(db, { sessionToken: token, expectedVersion: form.version, answers: [], step: "SELF" }, openOptions);
    assert.equal(stale.ok === false && stale.code, "STEP_CHANGED", "etapa já enviada não volta");
    assert.equal(answerCurrent(db, token, 4, null).ok, false, "nota 4 sem comentário");
    assert.equal(answerCurrent(db, token, 1, "aaaaaaaaaaaaaaaaaaaa").ok, false, "comentário artificial");
    db = must(answerCurrent(db, token, 4, COMMENT)).db;
    const done = must(publicSubmit(db, { sessionToken: token, expectedVersion: must(publicForm(db, { sessionToken: token }, openOptions)).value.version, confirm: true, step: "LEADERSHIP_UPWARD" }, openOptions));
    assert.equal(done.value.done, true);
    assert.equal(publicForm(done.db, { sessionToken: token }, openOptions).ok, false, "sessão encerrada no fim da jornada");
    assert.equal(publicSubmit(done.db, { sessionToken: token, expectedVersion: 1, confirm: true }, openOptions).ok, false, "envio duplicado recusado");
  });

  it("fechar depois da 1ª etapa: autoavaliação fica enviada e a próxima sessão retoma a etapa pendente", () => {
    const { db: opened } = openLeadershipCycle();
    let { db, token } = portal(opened, "bruno");
    db = must(answerCurrent(db, token, 3, null)).db;
    db = must(publicSubmit(db, { sessionToken: token, expectedVersion: must(publicForm(db, { sessionToken: token }, openOptions)).value.version, confirm: true, step: "SELF" }, openOptions)).db;
    db = must(publicLogout(db, { sessionToken: token }, openOptions)).db;
    assert.equal(task(db, "SELF", "bruno")!.status, "SUBMITTED");
    const again = portal(db, "bruno");
    const form = must(publicForm(again.db, { sessionToken: again.token }, openOptions)).value;
    assert.equal(form.step.kind, "LEADERSHIP_UPWARD");
    assert.deepEqual([form.step.index, form.step.total], [2, 3]);
  });
});

describe("180°: consolidação protegida e calibração", () => {
  function collected() {
    const opened = openLeadershipCycle();
    let db = opened.db;
    for (const id of ["ana", "bia", "dani", "edu", "fred"]) db = answerLeadership(db, task(db, "LEADERSHIP_UPWARD", id)!, id === "ana" ? 4 : 3, `Comentário confidencial de ${id} sobre a liderança.`);
    db = answerLeadership(db, task(db, "LEADERSHIP_UPWARD", "otavio")!, 2);
    db = answerLeadership(db, task(db, "LEADERSHIP_SELF", "bruno")!, 4);
    db = answerLeadership(db, task(db, "LEADERSHIP_SUPERIOR", "bruno")!, 3);
    db = answerLeadership(db, task(db, "LEADERSHIP_SUPERIOR", "marcos")!, 2);
    return { db, cycleId: opened.cycleId };
  }
  const carla = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "carla", teamIds: ["bruno", "marcos"] });

  it("durante a coleta nada da equipe aparece; depois, só a média com 5 ou mais e sem comentário", () => {
    const { db, cycleId } = collected();
    const during = leadershipComparison(db, pid(db, "bruno"), carla, "carla");
    assert.ok(during.ok);
    if (!during.ok) return;
    assert.equal(during.coverage.teamRespondents, null);
    assert.ok(during.rows.every((r) => r.team === null));
    const closed = must(transitionCycle(db, { cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    const view = leadershipComparison(closed, pid(closed, "bruno"), carla, "carla");
    assert.ok(view.ok);
    if (!view.ok) return;
    assert.equal(view.coverage.teamRespondents, 5);
    assert.equal(view.rows[0]!.team, 3.2);
    assert.equal(JSON.stringify(view).includes("Comentário confidencial"), false, "nenhum comentário da equipe sai");
    const small = leadershipComparison(closed, pid(closed, "marcos"), carla, "carla");
    assert.ok(small.ok);
    if (!small.ok) return;
    assert.equal(small.team.disclosed, false);
    assert.equal(small.team.message, "Amostra insuficiente para divulgação");
    assert.ok(small.rows.every((r) => r.team === null), "equipe de 1 não divulga média");
  });

  it("o próprio líder e quem não é o superior não abrem a calibração", () => {
    const { db } = collected();
    const asBruno = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "bruno", teamIds: ["ana"] });
    assert.equal(leadershipComparison(db, pid(db, "bruno"), asBruno, "bruno").ok, false);
    const asAna = buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" });
    assert.equal(leadershipComparison(db, pid(db, "bruno"), asAna, "ana").ok, false);
  });

  it("calibra com nota inteira e justificativa; fonte faltante só como exceção; homologação exige todos e congela", () => {
    const { db: base, cycleId } = collected();
    let db = must(transitionCycle(base, { cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    const scores = Object.fromEntries(LEADERSHIP_CODES.map((c) => [c, 3]));
    const brunoId = pid(db, "bruno");
    const input = { participantId: brunoId, scores, justifications: {}, generalNote: "Perspectivas convergentes e evidências consistentes.", actorUserId: "u-carla", actorEmployeeId: "carla", scope: carla };
    assert.equal(calibrateLeadership(db, { ...input, scores: { ...scores, "LD-01": 2.5 } }, openOptions).ok === false, true, "nota inteira");
    const extreme = calibrateLeadership(db, { ...input, scores: { ...scores, "LD-02": 4 } }, openOptions);
    assert.equal(extreme.ok === false && extreme.code, "JUSTIFICATION_REQUIRED");
    db = must(calibrateLeadership(db, input, openOptions)).db;
    const marcosId = pid(db, "marcos");
    const marcos = { ...input, participantId: marcosId, justifications: Object.fromEntries(LEADERSHIP_CODES.map((c) => [c, "Equipe pequena: decisão baseada no acompanhamento direto."])) };
    const noSelf = calibrateLeadership(db, marcos, openOptions);
    assert.equal(noSelf.ok === false && noSelf.code, "LEADERSHIP_SOURCES_REQUIRED");
    db = must(calibrateLeadership(db, { ...marcos, exceptionReason: "Autoavaliação de liderança não enviada no prazo, por afastamento." }, openOptions)).db;
    assert.equal(db.leadershipResults.find((r) => r.participantId === marcosId && r.active)!.status, "EXCEPTION");

    db = must(transitionCycle(db, { cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    for (const p of db.participants.filter((x) => x.eligibility === "ELIGIBLE")) {
      db = must(calibrate(db, { participantId: p.id, note: "Leitura do RH sem ajuste.", actorUserId: "rh", actorEmployeeId: null, acceptMissingLeader: !hasSubmittedLeaderEvaluation(db, p.id), scope: hrScope }, openOptions)).db;
    }
    const early = transitionCycle(db, { cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions);
    assert.equal(early.ok === false && early.code, "LEADERSHIP_CALIBRATION_REQUIRED", "Carla ainda sem calibração de liderança");
    const carlaId = pid(db, "carla");
    db = must(calibrateLeadership(db, { ...marcos, participantId: carlaId, actorEmployeeId: null, scope: hrScope, exceptionReason: "Topo da estrutura: sem superior; calibrada pelo RH." }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions)).db;
    assert.ok(db.leadershipResults.filter((r) => r.active).every((r) => r.official));
    assert.equal(calibrateLeadership(db, input, openOptions).ok, false, "homologado não muda");
    assert.equal(db.results.some((r) => r.quadrant.includes("Lideran")), false, "liderança fora da Nine-Box");

    // Documento de liderança: superior ou RH; nunca o próprio líder nem um liderado.
    const report = (scope: typeof carla, kind: "lideranca" = "lideranca") =>
      issueReport(db, { cycleId, kind, participantId: brunoId, actorUserId: "u", actorName: "X", scope, randomSuffix: "abc123" }, openOptions);
    assert.equal(report(carla).ok, true);
    assert.equal(report(buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "bruno", teamIds: ["ana"] })).ok, false);
    assert.equal(report(buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" })).ok, false);
    const data = reportData(db, { cycleId, kind: "lideranca", participantId: brunoId }, hrScope, NOW)!;
    assert.equal(data.leadership?.result?.version, 1);
    assert.equal(JSON.stringify(data).includes("Comentário confidencial"), false);

    // PDI de liderança: competência LD só para quem é líder no ciclo.
    const feedback = (participantId: string) =>
      must(createFeedback(db, { participantId, strength: "Organiza bem a semana.", improvement: "Dar retorno mais cedo.", action: "Reunião quinzenal de retorno.", ownerName: "Carla", dueAt: "2027-01-30", conversationAt: "2026-12-01", actorUserId: "rh", scope: hrScope }, openOptions));
    const fb = feedback(brunoId);
    const pdi = createPdi(fb.db, { feedbackId: fb.value.feedbackId, title: "Rodada de retorno à equipe", competencyCode: "LD-06", priority: true, justification: null, ownerName: "Bruno", dueAt: "2027-02-28", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(pdi.ok, true, "PDI de liderança para o líder");
    const anaFb = feedback(pid(db, "ana"));
    const anaPdi = createPdi(anaFb.db, { feedbackId: anaFb.value.feedbackId, title: "Liderar reunião", competencyCode: "LD-06", priority: true, justification: null, ownerName: "Ana", dueAt: "2027-02-28", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(anaPdi.ok, false, "quem não é líder não recebe competência de liderança");
  });
});

describe("180°: confidencialidade nas rotas", () => {
  it("nenhuma rota administrativa devolve resposta individual ou comentário da equipe, nem ao RH", async () => {
    const { createServer } = await import("node:http");
    const express = (await import("express")).default;
    const { createMemoryPerformanceStore } = await import("./performancePrisma.js");
    const { registerPerformanceRoutes } = await import("./performanceRoutes.js");
    const opened = openLeadershipCycle();
    let db = opened.db;
    for (const id of ["ana", "bia", "dani", "edu", "fred"]) db = answerLeadership(db, task(db, "LEADERSHIP_UPWARD", id)!, 4, `SEGREDO-${id} explicou prioridades com clareza à equipe.`);
    db = answerLeadership(db, task(db, "LEADERSHIP_SUPERIOR", "bruno")!, 3);
    db = must(transitionCycle(db, { cycleId: opened.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    const store = createMemoryPerformanceStore(db);
    const app = express();
    app.use(express.json());
    const actors: Record<string, { accessScope: "ALL" | "DIRECT_REPORTS"; employeeId: string | null; calibrate: boolean }> = {
      hr: { accessScope: "ALL", employeeId: null, calibrate: true },
      rhsem: { accessScope: "ALL", employeeId: null, calibrate: false },
      carla: { accessScope: "DIRECT_REPORTS", employeeId: "carla", calibrate: false },
      bruno: { accessScope: "DIRECT_REPORTS", employeeId: "bruno", calibrate: false },
    };
    const actorOf = (req: { headers: Record<string, unknown> }) => actors[String(req.headers["x-actor"] ?? "hr")]!;
    registerPerformanceRoutes(app, {
      enabled: () => true,
      options: { now: () => NOW, officialPublication: true, identityOtpEnabled: false, remindersEnabled: false, publicOrigin: "https://induscost.local" },
      store,
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      can: async (req, resource) => (resource.endsWith(".calibration") ? actorOf(req as never).calibrate : true),
      loadScope: async (req) => ({ accessScope: actorOf(req as never).accessScope, actorEmployeeId: actorOf(req as never).employeeId, teamIds: [] }),
      loadEmployees: async () => [],
      actorUserId: async () => "u-1",
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    const get = async (path: string, actor = "hr") => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "x-actor": actor } });
      return { status: res.status, text: await res.text() };
    };
    try {
      const upward = task(db, "LEADERSHIP_UPWARD", "ana")!;
      for (const actor of ["hr", "bruno", "carla"]) {
        assert.equal((await get(`/api/hr/performance/assignments/${upward.id}`, actor)).status, 403, `avaliação individual da equipe fechada para ${actor}`);
      }
      const brunoP = pid(db, "bruno");
      const paths = [
        `/api/hr/performance/cycles/${opened.cycleId}/workspace`,
        `/api/hr/performance/cycles/${opened.cycleId}/dashboard`,
        `/api/hr/performance/cycles/${opened.cycleId}/calibration`,
        `/api/hr/performance/cycles/${opened.cycleId}/leadership`,
        `/api/hr/performance/participants/${brunoP}/leadership`,
        `/api/hr/performance/cycles/${opened.cycleId}/export`,
        `/api/hr/performance/team`,
        `/api/hr/performance/evolution?includeNonOfficial=1`,
        `/api/hr/performance/employees/bruno/history?includeNonOfficial=1`,
      ];
      for (const path of paths) {
        for (const actor of ["hr", "carla", "bruno"]) {
          const res = await get(path, actor);
          assert.equal(res.text.includes("SEGREDO"), false, `${path} como ${actor} vazou comentário`);
        }
      }
      const view = await get(`/api/hr/performance/participants/${brunoP}/leadership`, "carla");
      assert.equal(view.status, 200);
      assert.equal(JSON.parse(view.text).coverage.teamRespondents, 5);
      assert.equal((await get(`/api/hr/performance/participants/${brunoP}/leadership`, "rhsem")).status, 403, "RH sem permissão de calibração");
      assert.equal((await get(`/api/hr/performance/participants/${brunoP}/leadership`, "bruno")).status, 403, "o líder não calibra a si");
    } finally {
      server.close();
    }
  });
});
