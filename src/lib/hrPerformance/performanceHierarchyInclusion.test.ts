/**
 * Inclusão por hierarquia: abrangência pela fonte única, prévia sem gravação, assinatura, deduplicação,
 * isLeader pela organização, superior preservado, permissões e auditoria — pelo serviço e pelas rotas.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import { buildOrgHierarchy } from "../orgHierarchy.js";
import { buildHierarchyPreview, previewToken, resolveInclusionScope } from "./performanceHierarchyInclusion.js";
import { createLeadershipModel } from "./performanceLeadershipService.js";
import { createMemoryPerformanceStore } from "./performancePrisma.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";
import { applyParticipants, createCycle, createDraftModel, publishModel, transitionCycle } from "./performanceService.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import { hrScope, must, NOW, openOptions, person } from "./performanceTestFixtures.js";

// Paulo (topo) → José Eduardo → Joseane; Paulo → Marcos → Otávio; Dora desligada abaixo de José.
const EMP = [
  { id: "paulo", name: "Paulo Diretor", status: "ACTIVE", departmentId: null, managerId: null },
  { id: "jose", name: "José Eduardo", status: "ACTIVE", departmentId: "d-com", managerId: null },
  { id: "joseane", name: "Joseane Correa", status: "ACTIVE", departmentId: "d-com", managerId: null },
  { id: "marcos", name: "Marcos Supervisor", status: "ACTIVE", departmentId: "d-man", managerId: null },
  { id: "otavio", name: "Otávio Técnico", status: "ACTIVE", departmentId: "d-man", managerId: null },
  { id: "dora", name: "Dora Desligada", status: "INACTIVE", departmentId: "d-com", managerId: null },
  { id: "fabi", name: "Fabi Sem Unidade", status: "ACTIVE", departmentId: null, managerId: null },
];
const hierarchy = buildOrgHierarchy({
  employees: EMP.map((e) => ({ ...e, socialName: null })),
  directorates: [{ id: "dir", name: "Diretoria", status: "ACTIVE", leaderEmployeeId: "paulo", parentDirectorateId: null }],
  departments: [
    { id: "d-com", name: "Comercial", status: "ACTIVE", directorateId: "dir", leaderEmployeeId: "jose", parentDepartmentId: null },
    { id: "d-man", name: "Manutenção", status: "ACTIVE", directorateId: "dir", leaderEmployeeId: "marcos", parentDepartmentId: null },
  ],
});
const activeIds = new Set(EMP.filter((e) => e.status === "ACTIVE").map((e) => e.id));
const old = new Date("2020-01-10T12:00:00.000Z");
/** Cadastro como `loadEmployees` do servidor devolve: superior efetivo e origem vindos da hierarquia. */
function employeeOf(id: string) {
  const e = EMP.find((x) => x.id === id)!;
  const r = hierarchy.resolve(id);
  const managerId = r.status === "RESOLVED" ? r.managerId : null;
  return person(id, e.name, {
    status: e.status,
    departmentId: e.departmentId,
    departmentName: e.departmentId === "d-com" ? "Comercial" : e.departmentId === "d-man" ? "Manutenção" : "Sem departamento",
    managerId,
    managerName: managerId ? EMP.find((x) => x.id === managerId)!.name : null,
    managerSource: r.status === "TOP" ? "TOPO" : managerId ? "ORGANOGRAMA" : "CADASTRO",
    managerNote: r.status === "RESOLVED" || r.status === "TOP" ? null : r.message,
    admissionDate: id === "joseane" ? new Date("2026-10-01T12:00:00.000Z") : old,
    terminationDate: e.status === "INACTIVE" ? old : null,
  });
}
const directReports = Object.fromEntries(EMP.map((e) => [e.id, { directReportIds: hierarchy.directReports(e.id).filter((id) => activeIds.has(id)) }]));
const ids = (list: readonly string[]) => [...list].sort();

function draftCycle(withLeadership = true) {
  let db: PerformanceDatabase = emptyPerformanceDatabase();
  const m = must(createDraftModel(db, { name: "Modelo", actorUserId: "rh", scope: hrScope }, openOptions));
  db = must(publishModel(m.db, { modelId: m.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
  let leadershipModelId: string | null = null;
  if (withLeadership) {
    const l = must(createLeadershipModel(db, { name: "180", actorUserId: "rh", scope: hrScope }, openOptions));
    db = must(publishModel(l.db, { modelId: l.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    leadershipModelId = l.value.modelId;
  }
  const c = must(createCycle(db, { name: "Ciclo", periodLabel: "2026", modelId: m.value.modelId, leadershipModelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hrScope }, openOptions));
  return { db: c.db, cycleId: c.value.cycleId };
}
const previewFor = (db: PerformanceDatabase, cycleId: string, mode: "DIRECT" | "TREE" | "REPORTS_ONLY" | "INDIVIDUAL" | "ALL", leader: string | null, employeeIds: string[] = []) => {
  const cycle = db.cycles.find((c) => c.id === cycleId)!;
  const scope = resolveInclusionScope({ mode, leaderEmployeeId: leader, employeeIds, hierarchy, activeIds });
  return buildHierarchyPreview({ db, cycle, mode, leader: leader ? { employeeId: leader, name: EMP.find((e) => e.id === leader)!.name } : null, employees: scope.map(employeeOf), directorateOf: () => "Diretoria", directReports, signals: { absenceIds: [], roleChangeIds: [] }, now: NOW });
};

describe("abrangência pela hierarquia efetiva", () => {
  it("líder + diretos; líder + árvore; só diretos; toda a organização — só ativos, sem repetição", () => {
    const scope = (mode: "DIRECT" | "TREE" | "REPORTS_ONLY" | "ALL", leader: string | null) => ids(resolveInclusionScope({ mode, leaderEmployeeId: leader, hierarchy, activeIds }));
    assert.deepEqual(scope("DIRECT", "jose"), ["jose", "joseane"], "Dora desligada fica fora");
    assert.deepEqual(scope("DIRECT", "paulo"), ["jose", "marcos", "paulo"]);
    assert.deepEqual(scope("TREE", "paulo"), ["jose", "joseane", "marcos", "otavio", "paulo"]);
    assert.deepEqual(scope("REPORTS_ONLY", "jose"), ["joseane"]);
    assert.deepEqual(scope("ALL", null), ids([...activeIds]));
    assert.deepEqual(scope("DIRECT", "joseane"), ["joseane"], "líder sem liderados: só ele");
    assert.deepEqual(scope("TREE", "fabi"), ["fabi"], "sem unidade: só ele");
  });

  it("prévia: cada pessoa com o PRÓPRIO superior, isLeader pela organização, elegibilidade real, sem gravar", () => {
    const { db, cycleId } = draftCycle();
    const before = JSON.stringify(db);
    const p = previewFor(db, cycleId, "TREE", "paulo");
    assert.equal(JSON.stringify(db), before, "prévia não grava");
    const row = (id: string) => p.rows.find((r) => r.employeeId === id)!;
    assert.equal(row("joseane").managerId, "jose", "Joseane continua com José, não com Paulo");
    assert.equal(row("jose").managerId, "paulo");
    assert.equal(row("paulo").managerId, null);
    assert.equal(row("paulo").managerSource, "TOPO");
    assert.deepEqual([row("paulo").isLeader, row("jose").isLeader, row("joseane").isLeader], [true, true, false]);
    assert.equal(row("jose").directReportCount, 1, "Dora desligada não conta");
    assert.equal(row("joseane").eligibility, "NOT_ELIGIBLE", "admissão recente usa a regra existente (menos de 90 dias)");
    assert.equal(row("joseane").reason.length > 0, true);
    assert.deepEqual([p.summary.found, p.summary.leaders, p.summary.withoutSuperior, p.summary.newParticipants], [5, 3, 0, 5]);
  });

  it("José continua líder mesmo quando Joseane não entra; só liderados avisa que o líder fica fora", () => {
    const { db, cycleId } = draftCycle();
    const only = previewFor(db, cycleId, "INDIVIDUAL", null, ["jose"]);
    assert.equal(only.rows[0]!.isLeader, true, "classificação é da organização, não do ciclo");
    const reports = previewFor(db, cycleId, "REPORTS_ONLY", "jose");
    assert.equal(reports.rows[0]!.leaderOutside, true);
    assert.equal(reports.summary.leadersOutside, 1);
  });

  it("já incluído não duplica; árvores sobrepostas (Paulo depois José) não repetem; assinatura muda com a estrutura", () => {
    const { db: base, cycleId } = draftCycle();
    const first = previewFor(base, cycleId, "TREE", "paulo");
    const db = must(applyParticipants(base, { cycleId, employees: first.rows.map((r) => employeeOf(r.employeeId)), selectedIds: first.rows.map((r) => r.employeeId), exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope, leadershipSnapshot: directReports, source: { mode: "TREE", leaderEmployeeId: "paulo", leaderName: "Paulo Diretor", requested: 5 } }, openOptions)).db;
    assert.equal(db.participants.filter((p) => p.cycleId === cycleId).length, 5);
    const jose = db.participants.find((p) => p.employeeId === "jose")!;
    assert.deepEqual([jose.isLeader, jose.directReportCount, Boolean(jose.leadershipSnapshotAt), jose.managerId, jose.managerSource], [true, 1, true, "paulo", "ORGANOGRAMA"], "snapshot gravado na inclusão");
    assert.ok(db.audits.some((a) => a.action === "PARTICIPANTS_INCLUDED_BY_HIERARCHY" && (a.detail as { mode?: string }).mode === "TREE"));
    const second = previewFor(db, cycleId, "DIRECT", "jose");
    assert.deepEqual(second.rows.map((r) => r.inclusion), ["ALREADY", "ALREADY"]);
    assert.equal(second.summary.newParticipants, 0);
    const again = must(applyParticipants(db, { cycleId, employees: second.rows.map((r) => employeeOf(r.employeeId)), selectedIds: ["jose", "joseane", "jose"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions));
    assert.deepEqual([again.value.added, again.value.duplicates], [0, 2]);
    assert.equal(again.db.participants.filter((p) => p.cycleId === cycleId).length, 5);
    // Assinatura: a mesma prévia dá o mesmo token; mudar o superior de alguém muda o token.
    assert.equal(previewToken(cycleId, "TREE", first.rows), first.token);
    const moved = first.rows.map((r) => (r.employeeId === "joseane" ? { ...r, managerId: "paulo" } : r));
    assert.notEqual(previewToken(cycleId, "TREE", moved), first.token);
  });
});

describe("rotas: prévia sem gravação, confirmação assinada, permissões e concorrência", () => {
  type Actor = { grants: string[]; superAdmin?: boolean };
  const ACTORS: Record<string, Actor> = {
    rhop: { grants: ["admin.employees.performance:view", "admin.employees.performance.cycles:manage"] },
    gestor: { grants: ["admin.employees.performance:view", "admin.employees.performance.cycles:manage", "admin.employees.performance.homologation:manage"] },
    lider: { grants: ["admin.employees.performance:view", "admin.employees.performance:update"] },
    superadmin: { grants: ["*"], superAdmin: true },
  };
  async function serve(db: PerformanceDatabase, mutableHierarchy = { current: hierarchy }) {
    const app = express();
    app.use(express.json());
    const store = createMemoryPerformanceStore(db);
    const actorOf = (req: express.Request) => ACTORS[String(req.headers["x-actor"])] ?? { grants: [] };
    registerPerformanceRoutes(app, {
      enabled: () => true,
      options: { ...openOptions, now: () => NOW },
      store,
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      can: async (req, resource, action) => actorOf(req).grants.includes("*") || actorOf(req).grants.includes(`${resource}:${action}`),
      loadScope: async () => ({ accessScope: "SELF", actorEmployeeId: null, teamIds: [] }),
      loadEmployees: async (list) => list.filter((id) => EMP.some((e) => e.id === id)).map(employeeOf),
      actorUserId: async (req) => `u-${String(req.headers["x-actor"])}`,
      isSuperAdmin: async (req) => Boolean(actorOf(req).superAdmin),
      loadLeadershipSnapshot: async (list) => Object.fromEntries(list.map((id) => [id, { directReportIds: mutableHierarchy.current.directReports(id).filter((x) => activeIds.has(x)) }])),
      loadHierarchyReader: async () => ({ hierarchy: mutableHierarchy.current, activeIds }),
      loadOrgUnits: async () => [{ id: "d-com", name: "Comercial", directorateName: "Diretoria" }],
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const call = async (actor: string, method: string, path: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-actor": actor }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json().catch(() => null)) as any };
    };
    return { server, store, call };
  }

  it("prévia não grava; confirmação grava uma vez; repetição e clique duplo não duplicam; auditoria com modo e líder", async () => {
    const { db, cycleId } = draftCycle();
    const { server, store, call } = await serve(db);
    try {
      const preview = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "DIRECT", leaderEmployeeId: "jose" });
      assert.equal(preview.status, 200, JSON.stringify(preview.json));
      assert.equal((await store.read()).participants.length, 0, "prévia não grava");
      assert.deepEqual(ids(preview.json.rows.map((r: { employeeId: string }) => r.employeeId)), ["jose", "joseane"]);
      const body = { hierarchy: { mode: "DIRECT", leaderEmployeeId: "jose", token: preview.json.token }, exceptions: {} };
      const [a, b] = await Promise.all([call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, body), call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, body)]);
      assert.deepEqual([a.status, b.status], [200, 200]);
      assert.equal(a.json.added + b.json.added, 2, "duas confirmações simultâneas: cada pessoa entra uma vez");
      const after = await store.read();
      assert.equal(after.participants.filter((p) => p.cycleId === cycleId).length, 2);
      const jose = after.participants.find((p) => p.employeeId === "jose")!;
      assert.deepEqual([jose.managerId, jose.isLeader, jose.directReportCount], ["paulo", true, 1]);
      const joseane = after.participants.find((p) => p.employeeId === "joseane")!;
      assert.deepEqual([joseane.managerId, joseane.isLeader, joseane.eligibility], ["jose", false, "NOT_ELIGIBLE"]);
      const audit = after.audits.find((x) => x.action === "PARTICIPANTS_INCLUDED_BY_HIERARCHY")!;
      assert.equal((audit.detail as { leaderName?: string }).leaderName, "José Eduardo");
      assert.equal(audit.actorUserId, "u-rhop");
      // Exceção do RH para Joseane (evidência insuficiente) exige motivo.
      const retry = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { ...body, exceptions: { joseane: "Trabalhou todo o período com a equipe." } });
      assert.equal(retry.json.added, 0, "já incluídos não entram de novo");
      assert.equal((await store.read()).participants.filter((x) => x.cycleId === cycleId).length, 2);
    } finally {
      server.close();
    }
  });

  it("prévia desatualizada (estrutura mudou) é recusada; sem prévia também; ciclo aberto recusa", async () => {
    const { db, cycleId } = draftCycle();
    const live = { current: hierarchy };
    const { server, call } = await serve(db, live);
    try {
      const preview = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "TREE", leaderEmployeeId: "paulo" });
      // Joseane passa a responder direto a Paulo: a assinatura antiga não vale mais.
      live.current = buildOrgHierarchy({
        employees: EMP.map((e) => ({ ...e, socialName: null, managerId: e.id === "joseane" ? "paulo" : null })),
        directorates: [{ id: "dir", name: "Diretoria", status: "ACTIVE", leaderEmployeeId: "paulo", parentDirectorateId: null }],
        departments: [
          { id: "d-com", name: "Comercial", status: "ACTIVE", directorateId: "dir", leaderEmployeeId: "jose", parentDepartmentId: null },
          { id: "d-man", name: "Manutenção", status: "ACTIVE", directorateId: "dir", leaderEmployeeId: "marcos", parentDepartmentId: null },
        ],
      });
      const stale = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "TREE", leaderEmployeeId: "paulo", token: preview.json.token }, exceptions: {} });
      assert.equal(stale.json?.error, "PREVIEW_STALE", JSON.stringify(stale.json));
      const noToken = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "TREE", leaderEmployeeId: "paulo" }, exceptions: {} });
      assert.equal(noToken.json?.error, "PREVIEW_REQUIRED");
      live.current = hierarchy;
      const fresh = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "DIRECT", leaderEmployeeId: "paulo" });
      await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "DIRECT", leaderEmployeeId: "paulo", token: fresh.json.token }, exceptions: {} });
      await call("superadmin", "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" });
      const opened = await call("superadmin", "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true });
      assert.equal(opened.status, 200, JSON.stringify(opened.json));
      const frozen = await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "DIRECT", leaderEmployeeId: "jose" });
      assert.equal(frozen.json?.error, "CYCLE_FROZEN");
    } finally {
      server.close();
    }
  });

  it("permissões: líder não inclui; toda a organização só com RH Gestor ou SUPER_ADMIN e com confirmação reforçada", async () => {
    const { db, cycleId } = draftCycle();
    const { server, call } = await serve(db);
    try {
      assert.equal((await call("lider", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "DIRECT", leaderEmployeeId: "jose" })).status, 403);
      assert.equal((await call("rhop", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "ALL" })).status, 403, "operacional não inclui toda a organização");
      const all = await call("gestor", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "ALL" });
      assert.equal(all.status, 200);
      assert.equal(all.json.summary.found, activeIds.size);
      const noConfirm = await call("gestor", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "ALL", token: all.json.token }, exceptions: {} });
      assert.equal(noConfirm.json?.error, "CONFIRMATION_REQUIRED");
      const ok = await call("gestor", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "ALL", token: all.json.token, confirmAll: true }, exceptions: {} });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal(ok.json.added, activeIds.size);
    } finally {
      server.close();
    }
  });

  it("180°: abertura cria autoavaliação, avaliação do líder, ascendente e de liderança sem duplicar; superior preservado", async () => {
    const { db, cycleId } = draftCycle();
    const { server, store, call } = await serve(db);
    try {
      const p = await call("gestor", "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "TREE", leaderEmployeeId: "paulo" });
      await call("gestor", "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "TREE", leaderEmployeeId: "paulo", token: p.json.token }, exceptions: { joseane: "Acompanhada no período pela equipe." } });
      await call("superadmin", "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" });
      const opened = await call("superadmin", "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true });
      assert.equal(opened.status, 200, JSON.stringify(opened.json));
      const after = await store.read();
      const by = (employeeId: string, kind: string) => after.assignments.filter((a) => a.active && a.kind === kind && after.participants.find((x) => x.id === a.participantId)!.employeeId === employeeId);
      assert.equal(by("joseane", "SELF").length, 1);
      assert.equal(by("joseane", "LEADER").length, 1);
      assert.equal(by("joseane", "LEADER")[0]!.evaluatorEmployeeId, "jose", "avaliador individual é José, não Paulo");
      assert.equal(by("joseane", "LEADERSHIP_UPWARD").length, 1, "Joseane avalia José");
      assert.equal(by("jose", "LEADERSHIP_SELF").length, 1);
      assert.equal(by("jose", "LEADERSHIP_SUPERIOR")[0]!.evaluatorEmployeeId, "paulo", "superior de José é Paulo");
      assert.equal(by("paulo", "LEADERSHIP_SUPERIOR").length, 0, "topo: ninguém avalia");
      assert.equal(by("paulo", "LEADER").length, 0);
      assert.equal(after.participants.filter((x) => x.cycleId === cycleId).length, 5, "Dora desligada fora; ninguém repetido");
    } finally {
      server.close();
    }
  });
});
