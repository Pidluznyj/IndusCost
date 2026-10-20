/**
 * Permissões específicas de RH: RH Operacional × RH Gestor × líder × colaborador × sem permissão ×
 * SUPER_ADMIN. Cada endpoint é chamado direto (sem tela) e o corpo é varrido atrás de conteúdo
 * confidencial: comentário da equipe sobre o líder, evidência do líder, notas e posição.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import { buildPerformanceScope } from "./performanceAccess.js";
import { PERFORMANCE_LEGACY_KEYS, PERFORMANCE_RESOURCE_KEYS as K } from "./performanceAccessKeys.js";
import { PERMISSION_CATALOG } from "../permissionCatalog.js";
import { PERMISSION_CONTRACT_RESOURCES } from "../security/permissionContract/resources.js";
import { LEADERSHIP_CODES } from "./performanceLeadership.js";
import { createLeadershipModel, type LeadershipSnapshot } from "./performanceLeadershipService.js";
import { canSeeResultOf, NO_CAPS, resolvePerformanceCaps, STRICT_PERFORMANCE_RESOURCES } from "./performancePermissions.js";
import { createMemoryPerformanceStore } from "./performancePrisma.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";
import { applyParticipants, createCycle, createDraftModel, publishModel, saveAnswers, submitAssignment, transitionCycle } from "./performanceService.js";
import { emptyPerformanceDatabase, type AssignmentRecord, type PerformanceDatabase } from "./performanceState.js";
import { hrScope, must, NOW, openOptions, person } from "./performanceTestFixtures.js";
import { trackingBoard } from "./performanceTracking.js";

const old = new Date("2020-01-10T12:00:00.000Z");
const P = (id: string, name: string, managerId: string | null, extra: Record<string, unknown> = {}) => person(id, name, { managerId, managerName: managerId, admissionDate: old, ...extra });
const people = [
  P("carla", "Carla Diretora", null, { managerSource: "TOPO" }),
  P("bruno", "Bruno Gerente", "carla"),
  ...["ana", "bia", "dani", "edu", "fred"].map((id) => P(id, `${id[0]!.toUpperCase()}${id.slice(1)} Operadora`, "bruno")),
];
const snapshot: LeadershipSnapshot = { carla: { directReportIds: ["bruno"] }, bruno: { directReportIds: ["ana", "bia", "dani", "edu", "fred"] } };
const UPWARD_SECRET = "SEGREDO-EQUIPE";
const LEADER_SECRET = "SEGREDO-LIDER";

const task = (db: PerformanceDatabase, kind: AssignmentRecord["kind"], employeeId: string) => {
  const participant = db.participants.find((p) => p.employeeId === employeeId)!;
  return db.assignments.find((a) => a.participantId === participant.id && a.kind === kind && a.active)!;
};

function answerAs(db: PerformanceDatabase, assignment: AssignmentRecord, codes: string[], score: (i: number) => 1 | 2 | 3 | 4, evidence: (i: number) => string | null) {
  const scope = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: assignment.evaluatorEmployeeId, teamIds: [assignment.employeeId] });
  const answers = codes.map((code, i) => ({ code, answer: { kind: "score" as const, score: score(i), evidence: evidence(i) } }));
  const saved = must(saveAnswers(db, { assignmentId: assignment.id, expectedVersion: assignment.version, answers, actorUserId: "u", scope }, openOptions));
  const current = saved.db.assignments.find((a) => a.id === assignment.id)!;
  return must(submitAssignment(saved.db, { assignmentId: assignment.id, expectedVersion: current.version, actorUserId: "u", scope, assistedConfirmation: true }, openOptions)).db;
}

/** Ciclo 180° com avaliação do líder (evidência), avaliação da equipe (comentário) e resultados calculados. */
function cycleInCalibration(stage: "OPEN" | "CALIBRATION" = "CALIBRATION") {
  let db: PerformanceDatabase = emptyPerformanceDatabase();
  const individual = must(createDraftModel(db, { name: "Modelo base", actorUserId: "rh", scope: hrScope }, openOptions));
  db = must(publishModel(individual.db, { modelId: individual.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
  const leadership = must(createLeadershipModel(db, { name: "Liderança 180°", actorUserId: "rh", scope: hrScope }, openOptions));
  db = must(publishModel(leadership.db, { modelId: leadership.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
  const cycle = must(
    createCycle(
      db,
      { name: "Ciclo RH", periodLabel: "2026-S2", modelId: individual.value.modelId, leadershipModelId: leadership.value.modelId, selfDueAt: "2026-10-01", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hrScope },
      openOptions
    )
  );
  const cycleId = cycle.value.cycleId;
  db = must(applyParticipants(cycle.db, { cycleId, employees: people, selectedIds: people.map((p) => p.id), exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions)).db;
  db = must(transitionCycle(db, { cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
  db = must(transitionCycle(db, { cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, leadershipSnapshot: snapshot, scope: hrScope }, openOptions)).db;
  const codes = db.questions.filter((q) => q.modelId === individual.value.modelId).map((q) => q.code);
  db = answerAs(db, task(db, "LEADER", "ana"), codes, (i) => (i === 0 ? 4 : 3), (i) => (i === 0 ? `${LEADER_SECRET}: organizou a troca de turno sem perda.` : null));
  for (const id of ["ana", "bia", "dani", "edu", "fred"]) {
    db = answerAs(db, task(db, "LEADERSHIP_UPWARD", id), [...LEADERSHIP_CODES], () => 4, () => `${UPWARD_SECRET}-${id}: explicou prioridades da semana.`);
  }
  if (stage === "CALIBRATION") {
    db = must(transitionCycle(db, { cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
  }
  return { db, cycleId };
}

// ---------------------------------------------------------------- perfis (mesmas chaves dos perfis de sistema)
type Persona = { grants: string[]; accessScope: "ALL" | "DIRECT_REPORTS" | "SELF"; employeeId: string | null; teamIds: string[]; superAdmin?: boolean };
const OPERATIONAL = [`${K.module}:view`, `${K.tracking}:view`, `${K.tracking}:export`, `${K.cycles}:manage`, `${K.invites}:manage`, `${K.calibration}:view`];
const MANAGER = [...OPERATIONAL, `${K.models}:manage`, `${K.results}:view`, `${K.reports}:view`, `${K.calibration}:manage`, `${K.homologation}:manage`];
const PERSONAS: Record<string, Persona> = {
  // RH sem `employees.edit` e sem vínculo de colaborador: o alcance vem só das permissões do Desempenho.
  rhop: { grants: OPERATIONAL, accessScope: "SELF", employeeId: null, teamIds: [] },
  rhgestor: { grants: MANAGER, accessScope: "SELF", employeeId: null, teamIds: [] },
  lider: { grants: [`${K.module}:view`, `${K.module}:update`, `${K.reports}:view`], accessScope: "DIRECT_REPORTS", employeeId: "bruno", teamIds: ["ana", "bia", "dani", "edu", "fred"] },
  colaborador: { grants: [`${K.module}:view`], accessScope: "SELF", employeeId: "ana", teamIds: [] },
  semacesso: { grants: [], accessScope: "SELF", employeeId: null, teamIds: [] },
  superadmin: { grants: ["*"], accessScope: "ALL", employeeId: null, teamIds: [], superAdmin: true },
};

async function serve(db: PerformanceDatabase) {
  const app = express();
  app.use(express.json());
  const store = createMemoryPerformanceStore(db);
  const personaOf = (req: express.Request) => PERSONAS[String(req.headers["x-actor"])] ?? PERSONAS.semacesso!;
  registerPerformanceRoutes(app, {
    enabled: () => true,
    options: { ...openOptions, now: () => NOW },
    store,
    requireAppAuth: (_req, _res, next) => next(),
    requireResource: () => (_req, _res, next) => next(),
    can: async (req, resource, action) => {
      const persona = personaOf(req);
      return persona.grants.includes("*") || persona.grants.includes(`${resource}:${action}`);
    },
    loadScope: async (req) => {
      const persona = personaOf(req);
      return { accessScope: persona.accessScope, actorEmployeeId: persona.employeeId, teamIds: persona.teamIds };
    },
    loadEmployees: async (ids) => people.filter((p) => ids.includes(p.id)),
    searchEmployees: async () => people,
    actorUserId: async (req) => `u-${String(req.headers["x-actor"])}`,
    isSuperAdmin: async (req) => Boolean(personaOf(req).superAdmin),
    loadOrgUnits: async () => [{ id: "dep-prod", name: "Produção", directorateName: "Diretoria Industrial" }],
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const call = async (actor: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-actor": actor }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* CSV */
    }
    return { status: res.status, text, json };
  };
  return { server, store, call, app };
}

const ACTORS = ["rhop", "rhgestor", "lider", "colaborador", "semacesso", "superadmin"] as const;
type Actor = (typeof ACTORS)[number];
const allowedBy = (allowed: Actor[]) => Object.fromEntries(ACTORS.map((a) => [a, allowed.includes(a)])) as Record<Actor, boolean>;

describe("capacidades do Desempenho sobre o RBAC", () => {
  it("todas as chaves existem no catálogo oficial (sem mecanismo paralelo) e as sensíveis são estritas", () => {
    const resources = new Map(PERMISSION_CONTRACT_RESOURCES.map((r) => [r.resourceKey, r]));
    for (const key of Object.values(K)) assert.ok(resources.has(key), key);
    const catalog = new Set(PERMISSION_CATALOG.map((e) => e.key));
    for (const key of Object.values(PERFORMANCE_LEGACY_KEYS)) assert.ok(catalog.has(key), key);
    assert.deepEqual(resources.get(K.tracking)!.actions.map((a) => a.action).sort(), ["export", "view"]);
    assert.deepEqual(resources.get(K.calibration)!.actions.map((a) => a.action).sort(), ["manage", "view"]);
    assert.deepEqual([...STRICT_PERFORMANCE_RESOURCES].sort(), [K.calibration, K.conduct, K.homologation, K.results].sort(), "editor de RH não ganha resultado, calibração, homologação nem ocorrência por atalho");
  });

  const capsFor = (grants: string[], employeesOrgWide = false) =>
    resolvePerformanceCaps({ can: async (r, a) => grants.includes(`${r}:${a}`), employeesOrgWide, superAdmin: false });

  it("RH Operacional: alcance de toda a organização sem resultado, calibração, homologação nem ocorrência", async () => {
    const caps = await capsFor(OPERATIONAL);
    assert.equal(caps.orgWide, true);
    assert.deepEqual([caps.track, caps.trackExport, caps.cycles, caps.invites, caps.calibrationView], [true, true, true, true, true]);
    assert.deepEqual([caps.results, caps.calibrate, caps.homologate, caps.conduct, caps.models], [false, false, false, false, false]);
  });

  it("RH Gestor: resultado, calibrar e homologar são concessões separadas", async () => {
    const onlyResults = await capsFor([`${K.module}:view`, `${K.results}:view`]);
    assert.deepEqual([onlyResults.results, onlyResults.calibrate, onlyResults.homologate], [true, false, false]);
    const onlyHomologate = await capsFor([`${K.module}:view`, `${K.homologation}:manage`]);
    assert.deepEqual([onlyHomologate.results, onlyHomologate.calibrate, onlyHomologate.homologate], [false, false, true]);
  });

  it("perfil anterior com `employees.performance.manage` continua preparando ciclos e modelos, sem ganhar resultado", async () => {
    const caps = await capsFor([`${K.module}:view`, `${K.module}:manage`]);
    assert.deepEqual([caps.cycles, caps.models, caps.track, caps.results], [true, true, true, false]);
  });

  it("sem permissão nenhuma: nada; editor de RH (escopo da ficha) tem alcance mas não resultado", async () => {
    assert.deepEqual(await capsFor([]), NO_CAPS);
    const hrEditor = await capsFor([`${K.module}:view`], true);
    assert.equal(hrEditor.orgWide, true);
    assert.equal(hrEditor.results, false);
  });

  it("resultado: quem consulta resultados vê todos; alcance operacional só a própria equipe", async () => {
    const op = await capsFor(OPERATIONAL);
    const ctx = { orgWide: true, actorEmployeeId: "bruno", teamIds: new Set(["ana"]) };
    assert.equal(canSeeResultOf(op, ctx, { employeeId: "ana", managerId: "bruno" }), true, "liderado do próprio RH-líder");
    assert.equal(canSeeResultOf(op, ctx, { employeeId: "bia", managerId: "carla" }), false);
    assert.equal(canSeeResultOf(op, ctx, { employeeId: "bruno", managerId: "carla" }), false, "nem o próprio resultado por este caminho");
    const gestor = await capsFor(MANAGER);
    assert.equal(canSeeResultOf(gestor, { ...ctx, actorEmployeeId: null }, { employeeId: "bia", managerId: "carla" }), true);
  });
});

describe("central de acompanhamento: só metadados", () => {
  it("situação, responsável e prazo de cada obrigação, sem nenhuma nota nem comentário", () => {
    const { db, cycleId } = cycleInCalibration("OPEN");
    const board = trackingBoard(db, cycleId, {}, NOW)!;
    const text = JSON.stringify(board);
    for (const forbidden of [UPWARD_SECRET, LEADER_SECRET, '"score"', '"evidence"', '"quadrant"', '"nineX"', '"cultureBand"', '"technicalSum"', '"calibratedIndex"']) {
      assert.equal(text.includes(forbidden), false, `não pode conter ${forbidden}`);
    }
    const ana = board.rows.find((r) => r.employeeId === "ana")!;
    const status = (row: typeof ana, key: string) => row.obligations.find((o) => o.key === key)!.status;
    assert.equal(status(ana, "leader"), "SUBMITTED");
    assert.equal(status(ana, "upward"), "SUBMITTED");
    assert.equal(ana.obligations.find((o) => o.key === "leader")!.responsible, "bruno");
    assert.equal(status(ana, "self"), "OVERDUE", "prazo da autoavaliação (01/10) já passou");
    assert.match(ana.obligations.find((o) => o.key === "self")!.reason ?? "", /Prazo vencido em 01\/10\/2026 · Convite não emitido/);
    assert.equal(status(ana, "leadershipSelf"), "NOT_APPLICABLE", "Ana não é líder");
    const bruno = board.rows.find((r) => r.employeeId === "bruno")!;
    assert.equal(status(bruno, "leadershipSelf"), "OVERDUE", "etapa do portal vence com a autoavaliação");
    assert.equal(status(bruno, "superior"), "PENDING");
    assert.equal(bruno.obligations.find((o) => o.key === "superior")!.responsible, "Carla Diretora");
    const carla = board.rows.find((r) => r.employeeId === "carla")!;
    assert.equal(status(carla, "leader"), "NOT_APPLICABLE");
    assert.equal(board.indicators.eligible, 7);
    assert.equal(board.indicators.invitesDelivered, null, "sem confirmação confiável de entrega");
    assert.equal(board.indicators.overdueObligations > 0, true);
  });

  it("filtros por setor, líder, modalidade e situação não mudam o conteúdo, só o recorte", () => {
    const { db, cycleId } = cycleInCalibration("OPEN");
    const byLeader = trackingBoard(db, cycleId, { manager: "bruno" }, NOW)!;
    assert.deepEqual(byLeader.rows.map((r) => r.employeeId).sort(), ["ana", "bia", "dani", "edu", "fred"]);
    const leadership = trackingBoard(db, cycleId, { modality: "LIDERANCA", status: "PENDING" }, NOW)!;
    assert.ok(leadership.rows.some((r) => r.employeeId === "bruno"));
    assert.equal(JSON.stringify(leadership).includes(UPWARD_SECRET), false);
  });
});

describe("autorização por endpoint (independente da tela)", () => {
  it("matriz de acesso dos seis perfis", async () => {
    const { db, cycleId } = cycleInCalibration();
    const { server, call } = await serve(db);
    const anaP = db.participants.find((p) => p.employeeId === "ana")!.id;
    const brunoP = db.participants.find((p) => p.employeeId === "bruno")!.id;
    const leaderTask = task(db, "LEADER", "ana");
    const upwardTask = task(db, "LEADERSHIP_UPWARD", "ana");
    const selfTask = task(db, "SELF", "ana");
    try {
      const cases: { name: string; method: string; path: string; body?: unknown; allowed: Record<Actor, boolean> }[] = [
        { name: "central", method: "GET", path: `/api/hr/performance/cycles/${cycleId}/tracking`, allowed: allowedBy(["rhop", "rhgestor", "superadmin"]) },
        { name: "CSV operacional", method: "GET", path: `/api/hr/performance/cycles/${cycleId}/tracking/export`, allowed: allowedBy(["rhop", "rhgestor", "superadmin"]) },
        { name: "criar ciclo", method: "POST", path: "/api/hr/performance/cycles", body: { name: "X" }, allowed: allowedBy(["rhop", "rhgestor", "superadmin"]) },
        { name: "criar modelo", method: "POST", path: "/api/hr/performance/models", body: { name: "Modelo novo" }, allowed: allowedBy(["rhgestor", "superadmin"]) },
        { name: "convites em lote", method: "POST", path: `/api/hr/performance/cycles/${cycleId}/invites`, body: {}, allowed: allowedBy(["rhop", "rhgestor", "superadmin"]) },
        { name: "revogar convite", method: "POST", path: `/api/hr/performance/assignments/${selfTask.id}/invites/revoke`, body: { reason: "Convite extraviado no setor" }, allowed: allowedBy(["rhop", "rhgestor", "superadmin"]) },
        { name: "acompanhar calibração", method: "GET", path: `/api/hr/performance/cycles/${cycleId}/calibration`, allowed: allowedBy(["rhop", "rhgestor", "superadmin"]) },
        { name: "calibrar", method: "POST", path: `/api/hr/performance/participants/${anaP}/calibration`, body: { note: "Leitura do RH sem ajuste." }, allowed: allowedBy(["rhgestor", "superadmin"]) },
        { name: "homologar", method: "POST", path: `/api/hr/performance/cycles/${cycleId}/homologate`, allowed: allowedBy(["rhgestor", "superadmin"]) },
        { name: "versões do resultado", method: "GET", path: `/api/hr/performance/participants/${anaP}/results`, allowed: allowedBy(["rhgestor", "superadmin"]) },
        { name: "CSV com notas", method: "GET", path: `/api/hr/performance/cycles/${cycleId}/export`, allowed: allowedBy(["rhgestor", "superadmin"]) },
        { name: "comparativo de liderança", method: "GET", path: `/api/hr/performance/participants/${brunoP}/leadership`, allowed: allowedBy(["rhgestor", "superadmin"]) },
        { name: "lista de liderança", method: "GET", path: `/api/hr/performance/cycles/${cycleId}/leadership`, allowed: allowedBy(["rhop", "rhgestor", "lider", "superadmin"]) },
        { name: "ocorrência restrita", method: "POST", path: "/api/hr/performance/conducts", body: { employeeId: "ana", summary: "Teste de acesso" }, allowed: allowedBy(["superadmin"]) },
        { name: "formulário do líder (avaliador ou resultado)", method: "GET", path: `/api/hr/performance/assignments/${leaderTask.id}`, allowed: allowedBy(["rhgestor", "lider", "superadmin"]) },
        { name: "mesa do ciclo", method: "GET", path: `/api/hr/performance/cycles/${cycleId}/workspace`, allowed: allowedBy(["rhop", "rhgestor", "lider", "colaborador", "superadmin"]) },
      ];
      for (const c of cases) {
        for (const actor of ACTORS) {
          const res = await call(actor, c.method, c.path, c.body);
          const denied = res.status === 403 && res.json?.error === "FORBIDDEN";
          assert.equal(!denied, c.allowed[actor], `${c.name} como ${actor}: ${res.status} ${res.text.slice(0, 160)}`);
        }
      }
      // Avaliação da equipe sobre o líder: ninguém abre individualmente, nem o SUPER_ADMIN.
      for (const actor of ACTORS) assert.equal((await call(actor, "GET", `/api/hr/performance/assignments/${upwardTask.id}`)).status, 403, `ascendente como ${actor}`);
      // Ciclo de vida segue só SUPER_ADMIN.
      assert.equal((await call("rhgestor", "POST", `/api/hr/performance/cycles/${cycleId}/inactivate`, { reason: "Teste de inativação." })).status, 403);
    } finally {
      server.close();
    }
  });

  it("RH Operacional sabe quem concluiu, mas nenhuma rota lhe devolve nota, posição, evidência ou comentário", async () => {
    const { db, cycleId } = cycleInCalibration();
    const { server, call } = await serve(db);
    try {
      const paths = [
        `/api/hr/performance/cycles/${cycleId}/tracking`,
        `/api/hr/performance/cycles/${cycleId}/tracking/export`,
        `/api/hr/performance/cycles/${cycleId}/workspace`,
        `/api/hr/performance/cycles/${cycleId}/dashboard`,
        `/api/hr/performance/cycles/${cycleId}/calibration`,
        `/api/hr/performance/cycles/${cycleId}/leadership`,
        `/api/hr/performance/cycles`,
        `/api/hr/performance/evolution`,
        `/api/hr/performance/employees/ana/history`,
        `/api/hr/performance/pdis`,
      ];
      for (const path of paths) {
        const res = await call("rhop", "GET", path);
        for (const forbidden of [UPWARD_SECRET, LEADER_SECRET, '"technicalSum"', '"nineX"', '"cultureBand"', '"evidence"', "Topo Alto", "Médio", '"calibratedIndex":3', '"calibratedIndex":4']) {
          assert.equal(res.text.includes(forbidden), false, `${path} (${res.status}) devolveu ${forbidden}`);
        }
      }
      const tracking = (await call("rhop", "GET", `/api/hr/performance/cycles/${cycleId}/tracking`)).json;
      const ana = tracking.rows.find((r: { employeeId: string }) => r.employeeId === "ana");
      assert.equal(ana.obligations.find((o: { key: string }) => o.key === "leader").status, "SUBMITTED", "sabe que o líder concluiu");
      const ws = (await call("rhop", "GET", `/api/hr/performance/cycles/${cycleId}/workspace`)).json;
      assert.equal(ws.redacted, true);
      assert.ok(ws.people.filter((p: { result: unknown }) => p.result).every((p: { result: { hidden?: boolean } }) => p.result.hidden === true));
      const board = (await call("rhop", "GET", `/api/hr/performance/cycles/${cycleId}/dashboard`)).json;
      assert.deepEqual(board.cells, [], "Nine-Box nominal fechada");
      // RH Gestor, com a permissão de resultados, vê a posição e a evidência do líder — nunca a equipe.
      const gestor = await call("rhgestor", "GET", `/api/hr/performance/cycles/${cycleId}/calibration`);
      assert.equal(gestor.text.includes(LEADER_SECRET), true);
      assert.equal(gestor.text.includes(UPWARD_SECRET), false);
      for (const actor of ACTORS) {
        for (const path of paths) assert.equal((await call(actor, "GET", path)).text.includes(UPWARD_SECRET), false, `${path} como ${actor}`);
      }
    } finally {
      server.close();
    }
  });

  it("ninguém responde em nome do líder: nem RH Gestor nem SUPER_ADMIN; o próprio avaliador passa", async () => {
    const { db } = cycleInCalibration("OPEN");
    const { server, call } = await serve(db);
    const bia = task(db, "LEADER", "bia");
    const body = { expectedVersion: bia.version, answers: [{ code: db.questions[0]!.code, answer: { kind: "score", score: 3 } }] };
    try {
      for (const actor of ["rhgestor", "superadmin"]) {
        const res = await call(actor, "PUT", `/api/hr/performance/assignments/${bia.id}/answers`, body);
        assert.equal(res.status, 403, `${actor}: ${res.text}`);
      }
      const own = await call("lider", "PUT", `/api/hr/performance/assignments/${bia.id}/answers`, body);
      assert.equal(own.status, 200, own.text);
    } finally {
      server.close();
    }
  });

  it("reemitir e revogar convite ficam na auditoria; CSV operacional também", async () => {
    const { db, cycleId } = cycleInCalibration("OPEN");
    const { server, store, call } = await serve(db);
    const self = task(db, "SELF", "bia");
    try {
      assert.equal((await call("rhop", "POST", `/api/hr/performance/assignments/${self.id}/invites`)).status, 201);
      assert.equal((await call("rhop", "POST", `/api/hr/performance/assignments/${self.id}/invites/revoke`, { reason: "Convite exposto no mural." })).status, 200);
      const csv = await call("rhop", "GET", `/api/hr/performance/cycles/${cycleId}/tracking/export`);
      assert.equal(csv.status, 200);
      assert.match(csv.text, /obrigacao,situacao,responsavel,prazo,motivo/);
      assert.equal(csv.text.includes(LEADER_SECRET) || csv.text.includes(UPWARD_SECRET), false);
      const audits = (await store.read()).audits;
      const by = (action: string) => audits.filter((a) => a.action === action && a.actorUserId === "u-rhop");
      assert.equal(by("INVITE_ISSUED").length, 1, "reemissão auditada com o autor");
      assert.equal(by("INVITE_REVOKED").length, 1, "revogação auditada com o autor");
      assert.equal((by("EXPORT")[0]?.detail as { format?: string } | undefined)?.format, "CSV_OPERACIONAL", "CSV operacional auditado");
    } finally {
      server.close();
    }
  });
});

describe("todas as rotas administrativas, uma a uma (sem tela)", () => {
  type Route = { method: string; path: string };
  const routesOf = (app: express.Express): Route[] =>
    ((app as unknown as { _router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } })._router.stack ?? [])
      .filter((layer) => layer.route && layer.route.path.startsWith("/api/hr/performance"))
      .flatMap((layer) => Object.keys(layer.route!.methods).map((method) => ({ method: method.toUpperCase(), path: layer.route!.path })));

  it("sem permissão: 403 em todas, menos situação da feature e /me (que responde tudo falso)", async () => {
    const { db } = cycleInCalibration();
    const { server, call, app } = await serve(db);
    try {
      const routes = routesOf(app);
      assert.ok(routes.length >= 60, `${routes.length} rotas encontradas`);
      for (const r of routes) {
        const res = await call("semacesso", r.method, r.path.replace(/:[a-zA-Z]+/g, "00000000-0000-4000-8000-000000000000"), r.method === "GET" ? undefined : {});
        if (r.path === "/api/hr/performance/feature-status") continue;
        if (r.path === "/api/hr/performance/me") {
          assert.equal(Object.entries(res.json.capabilities).some(([, v]) => v === true), false, "nenhuma capacidade");
          continue;
        }
        assert.equal(res.status, 403, `${r.method} ${r.path} → ${res.status}`);
      }
    } finally {
      server.close();
    }
  });

  it("RH Operacional: nenhuma leitura devolve conteúdo de avaliação; mutações de resultado são recusadas", async () => {
    const { db, cycleId } = cycleInCalibration();
    const { server, call, app } = await serve(db);
    const ana = db.participants.find((p) => p.employeeId === "ana")!;
    const ids: Record<string, string> = {
      cycles: cycleId,
      participants: ana.id,
      assignments: task(db, "LEADER", "ana").id,
      employees: "ana",
      models: db.models[0]!.id,
    };
    const fill = (path: string) => path.replace(/\/([a-z]+)\/:id/g, (_m, kind: string) => `/${kind}/${ids[kind] ?? "00000000-0000-4000-8000-000000000000"}`).replace(/:[a-zA-Z]+/g, "LD-01");
    try {
      const routes = routesOf(app);
      for (const r of routes.filter((x) => x.method === "GET")) {
        const res = await call("rhop", "GET", fill(r.path));
        for (const forbidden of [UPWARD_SECRET, LEADER_SECRET, '"technicalSum"', '"nineX"', '"cultureBand"', '"evidence"']) {
          assert.equal(res.text.includes(forbidden), false, `GET ${r.path} (${res.status}) devolveu ${forbidden}`);
        }
      }
      const resultWrites = routes.filter(
        (r) => r.method !== "GET" && /(calibration|validation|homologate|feedback|pdi|conducts|\/return|\/answers|\/submit|models)/.test(r.path) && !/cycles\/:id\/leadership$/.test(r.path)
      );
      assert.ok(resultWrites.length >= 15, `${resultWrites.length} mutações de conteúdo`);
      for (const r of resultWrites) {
        const res = await call("rhop", r.method, fill(r.path), {});
        assert.equal(res.status === 403 || res.json?.error === "FORBIDDEN", true, `${r.method} ${r.path} → ${res.status} ${res.text.slice(0, 120)}`);
      }
    } finally {
      server.close();
    }
  });
});
