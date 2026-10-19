/**
 * Integração com PostgreSQL de verdade. Só roda com PERFORMANCE_PG_TEST_URL apontando para
 * um banco LOCAL e descartável (127.0.0.1/localhost), já migrado. Sem a variável, o teste é
 * pulado. Nunca aponte para homologação ou produção: o teste apaga e recria dados fictícios
 * apenas nas tabelas HrPerformance* e nas pessoas fictícias que ele mesmo cria.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import express from "express";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PROPOSED_BASE_QUESTIONS } from "./performanceDomain.js";
import { createPrismaPerformanceStore, loadPerformanceDatabase } from "./performancePrisma.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";

const url = process.env.PERFORMANCE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const skip = !url ? "PERFORMANCE_PG_TEST_URL não definida" : !isLocal ? "URL não é local: recusado" : false;

const PERFORMANCE_TABLES = [
  "HrPerformanceReportIssue",
  "HrPerformanceReminder",
  "HrPerformanceAuditEvent",
  "HrPerformanceConductCase",
  "HrPerformancePdiCheckin",
  "HrPerformancePdi",
  "HrPerformanceFeedback",
  "HrPerformanceResult",
  "HrPerformanceSession",
  "HrPerformanceInvite",
  "HrPerformanceAnswer",
  "HrPerformanceAssignment",
  "HrPerformanceParticipant",
  "HrPerformanceCycle",
  "HrPerformanceQuestion",
  "HrPerformanceModel",
  "HrPerformanceGraphLock",
];

describe("persistência Prisma em PostgreSQL local", { skip }, () => {
  let prisma: PrismaClient;
  const ids = { role: randomUUID(), ana: randomUUID(), bia: randomUUID(), caio: randomUUID(), bruno: randomUUID() };
  const HR_USER = randomUUID();
  const LEADER_USER = randomUUID();
  let port = 0;
  let server: ReturnType<typeof createServer>;

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    for (const table of PERFORMANCE_TABLES) await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    await prisma.employee.deleteMany({ where: { name: { startsWith: "[TESTE-PERF]" } } });
    await prisma.role.deleteMany({ where: { name: "[TESTE-PERF] Operador" } });
    await prisma.role.create({ data: { id: ids.role, name: "[TESTE-PERF] Operador", baseSalary: 0 } });
    const base = { roleId: ids.role, department: "Produção", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE" };
    await prisma.employee.create({ data: { ...base, id: ids.bruno, name: "[TESTE-PERF] Bruno Líder", admissionDate: new Date("2020-01-01") } });
    for (const [key, name, admission] of [["ana", "Ana", "2023-01-01"], ["bia", "Bia", "2023-01-01"], ["caio", "Caio", "2026-09-20"]] as const) {
      await prisma.employee.create({ data: { ...base, id: ids[key], name: `[TESTE-PERF] ${name}`, admissionDate: new Date(admission), managerId: ids.bruno, managerName: "[TESTE-PERF] Bruno Líder" } });
    }
    await prisma.hrAbsence.create({ data: { employeeId: ids.bia, type: "MEDICAL", startDate: new Date("2026-08-01"), endDate: new Date("2026-09-30"), status: "COMPLETED" } });

    const app = express();
    app.use(express.json());
    const actorOf = (req: express.Request) => (req.headers["x-actor"] === "leader" ? "leader" : "hr");
    registerPerformanceRoutes(app, {
      enabled: () => true,
      options: { now: () => new Date("2026-10-16T15:00:00.000Z"), officialPublication: false, identityOtpEnabled: false, remindersEnabled: false, publicOrigin: "http://localhost:3000" },
      store: createPrismaPerformanceStore(prisma),
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      loadScope: async (req) =>
        actorOf(req) === "leader"
          ? { accessScope: "DIRECT_REPORTS", actorEmployeeId: ids.bruno, teamIds: [ids.ana, ids.bia, ids.caio] }
          : { accessScope: "ALL", actorEmployeeId: null, teamIds: [] },
      loadEmployees: async (list) => {
        const rows = await prisma.employee.findMany({ where: { id: { in: list } }, include: { Role: true } });
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          roleId: row.roleId,
          roleName: row.Role.name,
          departmentId: row.departmentId,
          departmentName: row.department,
          managerId: row.managerId,
          managerName: row.managerName,
          admissionDate: row.admissionDate,
          terminationDate: row.terminationDate,
          registration: null,
        }));
      },
      loadEligibilitySignals: async (list, since) => {
        const absences = await prisma.hrAbsence.findMany({ where: { employeeId: { in: list }, OR: [{ endDate: null }, { endDate: { gte: since } }] } });
        return { absenceIds: absences.map((a) => a.employeeId), roleChangeIds: [] };
      },
      actorUserId: async (req) => (actorOf(req) === "leader" ? LEADER_USER : HR_USER),
      actorName: async () => "RH de teste",
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server?.close();
    await prisma?.$disconnect();
  });

  const call = async (method: string, path: string, body?: unknown, actor = "hr") => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-actor": actor }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: (await response.json().catch(() => null)) as any };
  };

  it("grava o ciclo completo, preserva histórico e mantém integridade referencial", async () => {
    const model = await call("POST", "/api/hr/performance/models", { name: "Modelo PG" });
    assert.equal(model.status, 201);
    assert.equal((await call("POST", `/api/hr/performance/models/${model.json.modelId}/publish`)).status, 200);
    const cycle = await call("POST", "/api/hr/performance/cycles", { name: "Ciclo PG", periodLabel: "2026-S2", modelId: model.json.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30" });
    const cycleId = cycle.json.cycleId;
    const added = await call("POST", `/api/hr/performance/cycles/${cycleId}/participants`, { employeeIds: [ids.ana, ids.bia, ids.caio] });
    assert.equal(added.json.eligible, 1);
    assert.equal(added.json.insufficient, 1, "afastamento real do cadastro vira evidência insuficiente");
    assert.equal(added.json.notEligible, 1);
    const biaRow = await prisma.hrPerformanceParticipant.findFirst({ where: { employeeId: ids.bia } });
    assert.equal((await call("POST", `/api/hr/performance/participants/${biaRow!.id}/eligibility`, { reason: "Afastamento curto, já observada no semestre." })).status, 200);
    assert.equal((await call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" })).status, 200);
    assert.equal((await call("POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true })).status, 200);
    const tasks = await prisma.hrPerformanceAssignment.findMany({ where: { cycleId } });
    assert.equal(tasks.length, 4, "auto + líder para Ana e Bia");

    const team = await call("GET", "/api/hr/performance/team", undefined, "leader");
    const [first, second] = team.json.items;
    const all = PROPOSED_BASE_QUESTIONS.map((q) => ({ code: q.code, answer: { kind: "score", score: 3 } }));
    const [r1, r2] = await Promise.all([
      call("PUT", `/api/hr/performance/assignments/${first.assignmentId}/answers`, { expectedVersion: 1, answers: all }, "leader"),
      call("PUT", `/api/hr/performance/assignments/${second.assignmentId}/answers`, { expectedVersion: 1, answers: all }, "leader"),
    ]);
    assert.equal(r1.status, 200, JSON.stringify(r1.json));
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    const saved = await prisma.hrPerformanceAnswer.count({ where: { assignmentId: { in: [first.assignmentId, second.assignmentId] }, kind: "score" } });
    assert.equal(saved, 24, "as duas gravações simultâneas ficaram");

    const [c1, c2] = await Promise.all([
      call("PUT", `/api/hr/performance/assignments/${first.assignmentId}/answers`, { expectedVersion: 2, answers: [{ code: "DT-01", answer: { kind: "score", score: 2 } }] }, "leader"),
      call("PUT", `/api/hr/performance/assignments/${first.assignmentId}/answers`, { expectedVersion: 2, answers: [{ code: "DT-01", answer: { kind: "score", score: 4, evidence: "Entregou o lote sem retrabalho." } }] }, "leader"),
    ]);
    assert.deepEqual([c1.status, c2.status].sort(), [200, 409], "mesmo registro: um vence, o outro recebe conflito");

    const before = await loadPerformanceDatabase(prisma);
    const auditsBefore = before.audits.length;
    const versionNow = before.assignments.find((a) => a.id === first.assignmentId)!.version;
    assert.equal((await call("POST", `/api/hr/performance/assignments/${first.assignmentId}/submit`, { expectedVersion: versionNow }, "leader")).status, 200);
    const results = await prisma.hrPerformanceResult.findMany();
    assert.equal(results.length, 1);
    assert.ok(results[0]!.ruleSnapshot, "regras gravadas com o resultado");
    const afterSubmit = await loadPerformanceDatabase(prisma);
    assert.ok(afterSubmit.audits.length > auditsBefore, "auditoria só cresce");
    for (const a of before.audits) assert.ok(afterSubmit.audits.some((b) => b.id === a.id), "nenhum evento some");
    assert.ok(afterSubmit.graphRevision > before.graphRevision);

    const orphanAnswers = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "HrPerformanceAnswer" a LEFT JOIN "HrPerformanceAssignment" t ON t.id = a."assignmentId" WHERE t.id IS NULL`
    );
    assert.equal(Number(orphanAnswers[0]!.n), 0);
    const activeDup = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM (SELECT "participantId", kind FROM "HrPerformanceAssignment" WHERE active GROUP BY 1, 2 HAVING COUNT(*) > 1) d`
    );
    assert.equal(Number(activeDup[0]!.n), 0, "uma tarefa ativa por pessoa e tipo");

    const anaParticipant = await prisma.hrPerformanceParticipant.findFirst({ where: { employeeId: ids.ana } });
    const reassigned = await call("POST", `/api/hr/performance/participants/${anaParticipant!.id}/leader`, { managerId: ids.bruno, reason: "Teste de troca preservando a anterior." });
    assert.ok(reassigned.status === 200 || reassigned.json.error === "SAME_LEADER");
    const issued = await call("POST", "/api/hr/performance/reports/issue", { cycleId, kind: "consolidado" });
    assert.equal(issued.status, 200);
    const report = await prisma.hrPerformanceReportIssue.findUnique({ where: { code: issued.json.issue.code } });
    assert.equal(report?.kind, "consolidado");
  });
});
