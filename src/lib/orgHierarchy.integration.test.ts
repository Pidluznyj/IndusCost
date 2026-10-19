/**
 * Hierarquia efetiva contra PostgreSQL de verdade. Só roda com ORG_HIERARCHY_PG_TEST_URL (ou
 * PERFORMANCE_PG_TEST_URL) apontando para um banco LOCAL e descartável, já migrado. Cria e apaga
 * apenas registros com prefixo [TESTE-ORG]. Nunca aponte para homologação ou produção.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { loadHrOrgChart } from "./hrOrgChart.server.js";
import { assignableManager, loadOrgHierarchy } from "./orgHierarchy.server.js";
import { loadDescendantEmployeeIds, loadDirectReportIds } from "./peopleProfileHierarchy.server.js";
import { buildPerformanceScope } from "./hrPerformance/performanceAccess.js";
import { emptyPerformanceDatabase } from "./hrPerformance/performanceState.js";
import { applyParticipants, createCycle, createDraftModel, publishModel, transitionCycle } from "./hrPerformance/performanceService.js";

const url = process.env.ORG_HIERARCHY_PG_TEST_URL ?? process.env.PERFORMANCE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const skip = !url ? "ORG_HIERARCHY_PG_TEST_URL não definida" : !isLocal ? "URL não é local: recusado" : false;
const P = "[TESTE-ORG]";

describe("hierarquia efetiva em PostgreSQL local", { skip }, () => {
  let prisma: PrismaClient;
  const id = { role: randomUUID(), carla: randomUUID(), paulo: randomUUID(), jose: randomUUID(), joseane: randomUUID(), conselho: randomUUID(), presidencia: randomUUID(), adm: randomUUID(), comercial: randomUUID() };

  async function cleanup() {
    await prisma.employee.updateMany({ where: { name: { startsWith: P } }, data: { departmentId: null, managerId: null } });
    await prisma.hrDepartment.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.hrDirectorate.updateMany({ where: { name: { startsWith: P } }, data: { parentDirectorateId: null } });
    await prisma.hrDirectorate.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.employee.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.role.deleteMany({ where: { name: `${P} Cargo` } });
  }

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await prisma.role.create({ data: { id: id.role, name: `${P} Cargo`, baseSalary: 0 } });
    const base = { roleId: id.role, department: "Teste", costCenter: "CC", classification: "MOI", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2020-01-01") };
    // Líderes têm managerId nulo, como o cadastro grava hoje.
    for (const key of ["carla", "paulo", "jose"] as const) {
      await prisma.employee.create({ data: { ...base, id: id[key], name: `${P} ${key}` } });
    }
    await prisma.hrDirectorate.create({ data: { id: id.conselho, name: `${P} Conselho`, leaderEmployeeId: id.carla } });
    await prisma.hrDirectorate.create({ data: { id: id.presidencia, name: `${P} Presidência`, leaderEmployeeId: id.paulo, parentDirectorateId: id.conselho } });
    await prisma.hrDirectorate.create({ data: { id: id.adm, name: `${P} Diretoria Administrativa`, leaderEmployeeId: id.paulo, parentDirectorateId: id.presidencia } });
    await prisma.hrDepartment.create({ data: { id: id.comercial, name: `${P} Comercial`, directorateId: id.adm, leaderEmployeeId: id.jose } });
    await prisma.employee.create({ data: { ...base, id: id.joseane, name: `${P} joseane`, departmentId: id.comercial, managerId: id.jose } });
  });

  after(async () => {
    if (prisma) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("resolve José → Paulo, Joseane → José, Paulo → Carla e Carla no topo", async () => {
    const h = await loadOrgHierarchy(prisma);
    assert.equal(h.resolve(id.jose).managerId, id.paulo);
    assert.equal(h.resolve(id.jose).source, "DIRECTORATE_LEADER");
    assert.equal(h.resolve(id.joseane).managerId, id.jose);
    assert.equal(h.resolve(id.paulo).managerId, id.carla);
    assert.equal(h.resolve(id.carla).status, "TOP");
  });

  it("equipe direta e descendentes usam a hierarquia efetiva (líder com managerId nulo entra)", async () => {
    assert.deepEqual(await loadDirectReportIds(prisma, id.paulo), [id.jose]);
    assert.deepEqual((await loadDescendantEmployeeIds(prisma, id.paulo)).sort(), [id.jose, id.joseane].sort());
    assert.ok((await loadDescendantEmployeeIds(prisma, id.carla)).includes(id.joseane));
  });

  it("organograma mostra a quem cada líder responde", async () => {
    const chart = await loadHrOrgChart(prisma);
    const find = (nodes: typeof chart.directorates, name: string): (typeof chart.directorates)[number] | null => {
      for (const n of nodes) {
        if (n.name === name) return n;
        const child = find(n.childDirectorates, name);
        if (child) return child;
      }
      return null;
    };
    const adm = find(chart.directorates, `${P} Diretoria Administrativa`)!;
    assert.equal(adm.departments[0].leader?.reportsTo?.name, `${P} paulo`);
    assert.equal(find(chart.directorates, `${P} Conselho`)!.leader?.reportsTo?.pending, false);
  });

  it("desempenho: a tarefa do líder de José vai para o colaborador Paulo", async () => {
    const h = await loadOrgHierarchy(prisma);
    const m = assignableManager(h.resolve(id.jose));
    const hr = buildPerformanceScope({ accessScope: "ALL", actorEmployeeId: null });
    const options = { now: () => new Date("2026-10-16T15:00:00.000Z"), officialPublication: true, identityOtpEnabled: false, remindersEnabled: false, publicOrigin: "http://localhost:3000" };
    const must = <T,>(r: { ok: true; db: ReturnType<typeof emptyPerformanceDatabase>; value: T } | { ok: false; message: string }) => {
      if (r.ok === false) throw new Error(r.message);
      return r;
    };
    const model = must(createDraftModel(emptyPerformanceDatabase(), { name: "Modelo", actorUserId: "rh", scope: hr }, options));
    let db = must(publishModel(model.db, { modelId: model.value.modelId, actorUserId: "rh", scope: hr }, options)).db;
    const cycle = must(createCycle(db, { name: "Ciclo", periodLabel: "S2", modelId: model.value.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hr }, options));
    const jose = {
      id: id.jose, name: "José", status: "ACTIVE", roleId: id.role, roleName: "Gerente", departmentId: null, departmentName: "Comercial",
      managerId: m.managerId, managerName: m.managerName, managerSource: m.fromOrgChart ? ("ORGANOGRAMA" as const) : ("CADASTRO" as const), managerNote: m.note,
      admissionDate: new Date("2020-01-01"), terminationDate: null, registration: null,
    };
    db = must(applyParticipants(cycle.db, { cycleId: cycle.value.cycleId, employees: [jose], selectedIds: [id.jose], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hr }, options)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hr }, options)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hr }, options)).db;
    const leaderTask = db.assignments.find((a) => a.kind === "LEADER" && a.employeeId === id.jose)!;
    assert.equal(leaderTask.evaluatorEmployeeId, id.paulo);
    assert.equal(db.participants[0].managerSource, "ORGANOGRAMA");
  });
});
