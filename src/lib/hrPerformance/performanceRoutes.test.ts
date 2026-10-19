import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, it } from "node:test";
import type { PerformanceAccessScope } from "./performanceAccess.js";
import { PROPOSED_BASE_QUESTIONS } from "./performanceDomain.js";
import { createMemoryPerformanceStore, HistoryIntegrityError, planPerformanceWrite } from "./performancePrisma.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import { ana, bia, bruno, openCycle, outroSetor, recem } from "./performanceTestFixtures.js";

type Actor = { userId: string; employeeId: string | null; accessScope: PerformanceAccessScope; teamIds: string[]; granted: string[]; denied?: string[] };

const HR: Actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  employeeId: null,
  accessScope: "ALL",
  teamIds: [],
  granted: [
    "admin.employees.performance:view",
    "admin.employees.performance:update",
    "admin.employees.performance:manage",
    "admin.employees.performance.calibration:manage",
    "admin.employees.performance.reports:view",
    "admin.employees.performance.invites:manage",
  ],
};
const LEADER: Actor = {
  userId: "00000000-0000-4000-8000-000000000002",
  employeeId: "bruno",
  accessScope: "DIRECT_REPORTS",
  teamIds: ["ana", "bia"],
  granted: ["admin.employees.performance:view", "admin.employees.performance:update", "admin.employees.performance.reports:view"],
};
const OTHER_LEADER: Actor = { ...LEADER, userId: "00000000-0000-4000-8000-000000000003", employeeId: "marcos", teamIds: ["otavio"] };
const VIEWER: Actor = { ...LEADER, userId: "00000000-0000-4000-8000-000000000004", employeeId: "ana", accessScope: "SELF", teamIds: [], granted: ["admin.employees.performance:view"] };

const EMPLOYEES = [ana, bia, bruno, recem, outroSetor];

function appFor(options: { enabled?: boolean; delayReadMs?: number; initial?: PerformanceDatabase; officialPublication?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  const store = createMemoryPerformanceStore(options.initial ?? emptyPerformanceDatabase());
  let reads = 0;
  const slowStore = {
    read: async () => {
      reads += 1;
      const db = await store.read();
      if (options.delayReadMs) await new Promise((resolve) => setTimeout(resolve, options.delayReadMs));
      return db;
    },
    write: store.write,
  };
  const actorOf = (req: express.Request): Actor => {
    const key = String(req.headers["x-actor"] ?? "hr");
    return key === "leader" ? LEADER : key === "other" ? OTHER_LEADER : key === "viewer" ? VIEWER : HR;
  };
  const allowed = (actor: Actor, resource: string, action: string) => {
    const key = `${resource}:${action}`;
    if (actor.denied?.includes(key)) return false;
    return actor.granted.includes(key);
  };
  registerPerformanceRoutes(app, {
    enabled: () => options.enabled !== false,
    options: {
      now: () => new Date("2026-10-16T15:00:00.000Z"),
      officialPublication: options.officialPublication ?? false,
      identityOtpEnabled: false,
      remindersEnabled: false,
      publicOrigin: "https://induscost.local",
    },
    store: slowStore,
    requireAppAuth: (_req, _res, next) => next(),
    requireResource: (resource, action = "view") => (req, res, next) => {
      if (!allowed(actorOf(req), resource, action)) return res.status(403).json({ error: "FORBIDDEN" });
      next();
    },
    can: async (req, resource, action) => allowed(actorOf(req), resource, action),
    loadScope: async (req) => {
      const actor = actorOf(req);
      return { accessScope: actor.accessScope, actorEmployeeId: actor.employeeId, teamIds: actor.teamIds };
    },
    loadEmployees: async (ids) => EMPLOYEES.filter((e) => ids.includes(e.id)),
    searchEmployees: async (q) => EMPLOYEES.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) || e.roleName.toLowerCase().includes(q.toLowerCase())),
    loadEligibilitySignals: async () => ({ absenceIds: [], roleChangeIds: [] }),
    actorUserId: async (req) => actorOf(req).userId,
    actorName: async (req) => (actorOf(req) === HR ? "Rita RH" : "Bruno Líder"),
  });
  return { app, store, reads: () => reads };
}

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { server, port: (server.address() as AddressInfo).port };
}

function client(port: number) {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!.endsWith("=") ? "" : setCookie.split(";")[0]!;
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: response.status, json, headers: response.headers, text };
  };
  return { call, cookie: () => cookie };
}

describe("rotas de desempenho", () => {
  it("flag desligada esconde o módulo e o portal", async () => {
    const { app } = appFor({ enabled: false });
    const { server, port } = await listen(app);
    const api = client(port);
    try {
      assert.equal((await api.call("GET", "/api/hr/performance/feature-status")).json.enabled, false);
      assert.equal((await api.call("GET", "/api/hr/performance/me")).status, 404);
      assert.equal((await api.call("GET", "/api/hr/performance/models")).status, 404);
      assert.equal((await api.call("POST", "/api/public/performance/session", { token: "x" })).status, 404);
    } finally {
      server.close();
    }
  });

  it("capacidades refletem o guard, gestão negada sem permissão e deny vence", async () => {
    const { app } = appFor();
    const { server, port } = await listen(app);
    const api = client(port);
    try {
      const me = await api.call("GET", "/api/hr/performance/me", undefined, { "x-actor": "leader" });
      assert.deepEqual(me.json.capabilities, { view: true, evaluate: true, manage: false, calibrate: false, report: true, invites: false, conduct: false });
      assert.equal((await api.call("POST", "/api/hr/performance/models", { name: "Modelo" }, { "x-actor": "viewer" })).status, 403);
      assert.equal((await api.call("GET", "/api/hr/performance/directory?q=ana", undefined, { "x-actor": "leader" })).status, 403, "busca no cadastro é do RH");
      const hrMe = await api.call("GET", "/api/hr/performance/me");
      assert.equal(hrMe.json.capabilities.manage, true);
    } finally {
      server.close();
    }
  });

  it("percorre o ciclo inteiro pela API: modelo, pessoas, QR, portal, líder, calibração, homologação, devolutiva, PDI e documento", async () => {
    const { app, store } = appFor();
    const { server, port } = await listen(app);
    const hr = client(port);
    const leader = client(port);
    const phone = client(port);
    try {
      const model = await hr.call("POST", "/api/hr/performance/models", { name: "Modelo base" });
      assert.equal(model.status, 201);
      const modelId = model.json.modelId;
      const detail = await hr.call("GET", `/api/hr/performance/models/${modelId}`);
      assert.equal(detail.json.questions.length, 12);
      assert.deepEqual(detail.json.problems, []);
      const edit = await hr.call("PUT", `/api/hr/performance/models/${modelId}/questions/DT-01`, { competency: "Qualidade", selfText: "Eu faço meu trabalho sem precisar refazer.", leaderText: "Faz o trabalho sem precisar refazer.", hint: "" });
      assert.equal(edit.status, 200);
      const rules = await hr.call("PUT", `/api/hr/performance/models/${modelId}`, { rules: { nineBoxLowCut: 400, nineBoxHighCut: 300 } });
      assert.equal(rules.status, 400);
      assert.equal((await hr.call("POST", `/api/hr/performance/models/${modelId}/publish`)).status, 200);
      assert.equal((await hr.call("PUT", `/api/hr/performance/models/${modelId}/questions/DT-02`, { selfText: "Texto de pergunta nova", leaderText: "Texto de pergunta nova" })).json.error, "MODEL_LOCKED");

      const cycle = await hr.call("POST", "/api/hr/performance/cycles", { name: "Ciclo 2026-S2", periodLabel: "2º semestre", modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30" });
      assert.equal(cycle.status, 201);
      const cycleId = cycle.json.cycleId;
      const search = await hr.call("GET", "/api/hr/performance/directory?q=operad");
      assert.deepEqual(search.json.employees.map((e: { name: string }) => e.name).sort(), ["Ana Operadora", "Bia Operadora", "Caio Recém", "Otávio Manutenção"], "busca também pelo cargo");
      const preview = await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/participants/preview`, { employeeIds: ["ana", "recem"] });
      assert.deepEqual(preview.json.people.map((p: { eligibility: string }) => p.eligibility), ["ELIGIBLE", "NOT_ELIGIBLE"]);
      const added = await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/participants`, { employeeIds: ["ana", "bia", "recem", "otavio"] });
      assert.equal(added.json.added, 4);
      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" })).status, 200);
      const blocked = await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN" });
      assert.equal(blocked.json.error, "GOVERNANCE_BLOCKED");
      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true })).status, 200);

      const batch = await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/invites`, { onlyMissing: true });
      assert.equal(batch.status, 201);
      const anaInvite = batch.json.issued.find((i: { employeeName: string }) => i.employeeName === "Ana Operadora");
      const token = decodeURIComponent(new URL(anaInvite.url).hash.slice(3));

      const notJson = await fetch(`http://127.0.0.1:${port}/api/public/performance/session`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${token}` });
      assert.equal(notJson.status, 415, "portal só aceita JSON");
      const session = await phone.call("POST", "/api/public/performance/session", { token });
      assert.equal(session.json.ok, true);
      const cookieHeader = session.headers.get("set-cookie") ?? "";
      assert.match(cookieHeader, /HttpOnly/);
      assert.match(cookieHeader, /SameSite=Strict/);
      assert.match(cookieHeader, /Path=\/api\/public\/performance/);
      assert.equal((await phone.call("GET", "/api/public/performance/form")).json.ok, false, "QR sozinho não abre");
      assert.equal((await phone.call("POST", "/api/public/performance/verify", { otp: anaInvite.otp })).json.ok, true);
      const form = await phone.call("GET", "/api/public/performance/form");
      assert.equal(form.json.questions.length, 12);
      assert.equal(JSON.stringify(form.json).includes("bruno"), false, "portal não expõe outras pessoas");
      let version = form.json.version;
      for (const q of PROPOSED_BASE_QUESTIONS) {
        const saved = await phone.call("PUT", "/api/public/performance/answers", { expectedVersion: version, answers: [{ code: q.code, answer: { kind: "score", score: 4 } }] });
        assert.equal(saved.json.ok, true);
        version = saved.json.version;
      }
      const sent = await phone.call("POST", "/api/public/performance/submit", { expectedVersion: version, confirm: true });
      assert.equal(sent.json.ok, true);
      assert.equal((await phone.call("GET", "/api/public/performance/form")).json.ok, false, "envio encerra a sessão");

      const queue = await leader.call("GET", "/api/hr/performance/team", undefined, { "x-actor": "leader" });
      const anaTask = queue.json.items.find((i: { employeeName: string }) => i.employeeName === "Ana Operadora");
      assert.ok(anaTask);
      assert.equal((await leader.call("GET", `/api/hr/performance/assignments/${anaTask.assignmentId}`, undefined, { "x-actor": "other" })).status, 403, "IDOR negado");
      const leaderForm = await leader.call("GET", `/api/hr/performance/assignments/${anaTask.assignmentId}`, undefined, { "x-actor": "leader" });
      assert.equal(leaderForm.json.selfAnswers.length, 0);
      const answers = PROPOSED_BASE_QUESTIONS.map((q) => ({ code: q.code, answer: { kind: "score", score: 3 } }));
      const savedLeader = await leader.call("PUT", `/api/hr/performance/assignments/${anaTask.assignmentId}/answers`, { expectedVersion: leaderForm.json.assignment.version, answers }, { "x-actor": "leader" });
      assert.equal(savedLeader.status, 200);
      assert.equal((await leader.call("POST", `/api/hr/performance/assignments/${anaTask.assignmentId}/submit`, { expectedVersion: savedLeader.json.version }, { "x-actor": "leader" })).status, 200);

      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "CONSOLIDATION" })).json.error, "PENDING_ASSIGNMENTS");
      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "CONSOLIDATION", acceptPending: true })).status, 200);
      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "CALIBRATION" })).status, 200);
      const calibration = await hr.call("GET", `/api/hr/performance/cycles/${cycleId}/calibration`);
      assert.equal(calibration.json.rows.length, 3);
      assert.equal((await leader.call("GET", `/api/hr/performance/cycles/${cycleId}/calibration`, undefined, { "x-actor": "leader" })).status, 403);
      for (const row of calibration.json.rows) {
        if (row.result.technicalValidation === "PENDING_VALIDATION") {
          assert.equal((await hr.call("POST", `/api/hr/performance/participants/${row.participantId}/validation`, { decision: "VALIDATED", note: "Padrão da função conferido." })).status, 200);
        }
        const withoutLeader = row.leaderStatus !== "SUBMITTED";
        if (withoutLeader) {
          const silent = await hr.call("POST", `/api/hr/performance/participants/${row.participantId}/calibration`, { note: "Leitura do RH sem ajuste." });
          assert.equal(silent.json.error, "LEADER_EVALUATION_REQUIRED", "sem avaliação do líder não calibra em silêncio");
        }
        assert.equal((await hr.call("POST", `/api/hr/performance/participants/${row.participantId}/calibration`, { note: "Leitura do RH sem ajuste.", acceptMissingLeader: withoutLeader })).status, 200);
      }
      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "HOMOLOGATED" })).json.error, "FORBIDDEN", "homologação só pela rota de calibração");
      assert.equal((await hr.call("POST", `/api/hr/performance/cycles/${cycleId}/homologate`)).status, 200);

      const anaRow = calibration.json.rows.find((r: { employeeName: string }) => r.employeeName === "Ana Operadora");
      const fb = await leader.call("POST", `/api/hr/performance/participants/${anaRow.participantId}/feedback`, { strength: "Qualidade estável", improvement: "Avisar desvio", action: "Checklist da máquina", ownerName: "Bruno Líder", dueAt: "2027-01-15", conversationAt: "2026-12-02" }, { "x-actor": "leader" });
      assert.equal(fb.status, 201);
      const pdi = await leader.call("POST", `/api/hr/performance/feedbacks/${fb.json.feedbackId}/pdi`, { title: "Treinar o checklist", priority: true, ownerName: "Bruno Líder", dueAt: "2027-01-15", competencyCode: "DT-01" }, { "x-actor": "leader" });
      assert.equal(pdi.status, 201);
      const tracking = await leader.call("GET", "/api/hr/performance/pdis?due=all", undefined, { "x-actor": "leader" });
      assert.equal(tracking.json.items.length, 1);
      assert.equal((await leader.call("GET", "/api/hr/performance/pdis?due=all", undefined, { "x-actor": "other" })).json.items.length, 0);

      const issued = await hr.call("POST", "/api/hr/performance/reports/issue", { cycleId, kind: "individual", participantId: anaRow.participantId });
      assert.equal(issued.status, 200);
      assert.match(issued.json.issue.code, /^DCP-20261016-[0-9A-F]{6}$/);
      assert.equal(issued.json.issue.version, 1);
      assert.equal(issued.json.data.person.result.official, true);
      const csv = await hr.call("GET", `/api/hr/performance/cycles/${cycleId}/export`);
      assert.match(csv.text, /^nome,cargo,setor/);
      assert.match(csv.headers.get("content-disposition") ?? "", /attachment/);
      assert.match(csv.text, /Caio Recém,[^,]*,[^,]*,NOT_ELIGIBLE,não se aplica,/, "não elegível não vira resultado");

      const final = store.snapshot();
      assert.equal(final.audits.some((a) => a.action === "REPORT_ISSUED"), true);
      assert.equal(final.audits.some((a) => a.action === "EXPORT" && a.detail.format === "CSV"), true, "exportação auditada");
      assert.equal(JSON.stringify(final.audits).includes(token), false, "token não vai para auditoria");
    } finally {
      server.close();
    }
  });

  it("limita tentativas no portal público", async () => {
    const { app } = appFor();
    const { server, port } = await listen(app);
    const api = client(port);
    try {
      let limited = 0;
      for (let i = 0; i < 24; i += 1) {
        const r = await api.call("POST", "/api/public/performance/session", { token: `inexistente-${i}` });
        if (r.status === 429) limited += 1;
        else assert.equal(r.json.message, "Não foi possível abrir esta pesquisa.");
      }
      assert.ok(limited >= 4, "depois de 20 tentativas por minuto a origem é barrada");
    } finally {
      server.close();
    }
  });
});

describe("concorrência e integridade", () => {
  it("duas gravações simultâneas de pessoas diferentes entram as duas; a mesma versão entra uma vez só", async () => {
    const open = openCycle();
    const { app, store } = appFor({ initial: open.db, delayReadMs: 25 });
    const { server, port } = await listen(app);
    const api = client(port);
    try {
      const anaLeader = open.db.assignments.find((a) => a.employeeId === "ana" && a.kind === "LEADER")!;
      const biaLeader = open.db.assignments.find((a) => a.employeeId === "bia" && a.kind === "LEADER")!;
      const body = (version: number, code: string) => ({ expectedVersion: version, answers: [{ code, answer: { kind: "score", score: 3 } }] });
      const [first, second] = await Promise.all([
        api.call("PUT", `/api/hr/performance/assignments/${anaLeader.id}/answers`, body(1, "DT-01"), { "x-actor": "leader" }),
        api.call("PUT", `/api/hr/performance/assignments/${biaLeader.id}/answers`, body(1, "DT-01"), { "x-actor": "leader" }),
      ]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const afterBoth = store.snapshot();
      assert.equal(afterBoth.answers.find((a) => a.assignmentId === anaLeader.id && a.questionCode === "DT-01")!.score, 3);
      assert.equal(afterBoth.answers.find((a) => a.assignmentId === biaLeader.id && a.questionCode === "DT-01")!.score, 3, "a segunda não apagou a primeira");

      const [a, b] = await Promise.all([
        api.call("PUT", `/api/hr/performance/assignments/${anaLeader.id}/answers`, body(2, "DT-02"), { "x-actor": "leader" }),
        api.call("PUT", `/api/hr/performance/assignments/${anaLeader.id}/answers`, body(2, "DT-03"), { "x-actor": "leader" }),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [200, 409], "registro alterado por terceiro devolve conflito");
      const loser = a.status === 409 ? a : b;
      assert.equal(loser.json.error, "VERSION_CONFLICT");

      const current = store.snapshot().assignments.find((x) => x.id === anaLeader.id)!;
      const all = PROPOSED_BASE_QUESTIONS.map((q) => ({ code: q.code, answer: { kind: "score", score: 3 } }));
      const saved = await api.call("PUT", `/api/hr/performance/assignments/${anaLeader.id}/answers`, { expectedVersion: current.version, answers: all }, { "x-actor": "leader" });
      const [s1, s2] = await Promise.all([
        api.call("POST", `/api/hr/performance/assignments/${anaLeader.id}/submit`, { expectedVersion: saved.json.version }, { "x-actor": "leader" }),
        api.call("POST", `/api/hr/performance/assignments/${anaLeader.id}/submit`, { expectedVersion: saved.json.version }, { "x-actor": "leader" }),
      ]);
      assert.equal(s1.status, 200);
      assert.equal(s2.status, 200, "envio duplicado é idempotente");
      const snapshot = store.snapshot();
      assert.equal(snapshot.audits.filter((x) => x.action === "ASSIGNMENT_SUBMITTED" && x.entityId === anaLeader.id).length, 1);
      const overwrite = await api.call("PUT", `/api/hr/performance/assignments/${anaLeader.id}/answers`, { expectedVersion: saved.json.version + 1, answers: all }, { "x-actor": "leader" });
      assert.equal(overwrite.json.error, "ASSIGNMENT_LOCKED", "avaliação finalizada não é sobrescrita");
    } finally {
      server.close();
    }
  });

  it("gravação que apagaria histórico é recusada", () => {
    const open = openCycle();
    const removed = structuredClone(open.db);
    removed.answers = removed.answers.slice(1);
    assert.throws(() => planPerformanceWrite(open.db, removed), HistoryIntegrityError);
    const rewritten = structuredClone(open.db);
    rewritten.audits[0]!.action = "OUTRA_COISA";
    assert.throws(() => planPerformanceWrite(open.db, rewritten), HistoryIntegrityError);
  });
});

describe("robustez", () => {
  it("erro inesperado do banco responde 500 e o processo continua atendendo", async () => {
    const app = express();
    app.use(express.json());
    let fail = true;
    registerPerformanceRoutes(app, {
      enabled: () => true,
      options: { now: () => new Date("2026-10-16T15:00:00.000Z"), officialPublication: false, identityOtpEnabled: false, remindersEnabled: false, publicOrigin: "https://induscost.local" },
      store: {
        read: async () => {
          if (fail) throw Object.assign(new Error("conexão perdida com dado sensível"), { code: "P1001" });
          return emptyPerformanceDatabase();
        },
        write: async () => undefined,
      },
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      loadScope: async () => ({ accessScope: "ALL", actorEmployeeId: null, teamIds: [] }),
      loadEmployees: async () => [],
      actorUserId: async () => null,
    });
    const { server, port } = await listen(app);
    const api = client(port);
    try {
      const broken = await api.call("GET", "/api/hr/performance/models");
      assert.equal(broken.status, 500);
      assert.equal(JSON.stringify(broken.json).includes("sensível"), false, "mensagem interna não vaza");
      fail = false;
      assert.equal((await api.call("GET", "/api/hr/performance/models")).status, 200, "servidor segue de pé");
    } finally {
      server.close();
    }
  });
});
