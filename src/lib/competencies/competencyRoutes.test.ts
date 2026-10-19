import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { COMPETENCY_CAPABILITY_GRANTS, COMPETENCY_ENDPOINTS, COMPETENCY_RESOURCE_KEYS } from "./competencyAccess";
import {
  createFakeDb,
  requestJson,
  seedDepartment,
  seedEmployee,
  startCompetencyTestApp,
  type CompetencyTestApp,
  type FakeDb,
} from "./competencyTestSupport";

const SOME_ID = "11111111-1111-4111-8111-111111111111";

function samplePath(path: string): string {
  return path.replace(/:[a-zA-Z]+/g, SOME_ID);
}

async function seedScenario(app: CompetencyTestApp) {
  const db = app.db;
  const usinagem = seedDepartment(db, "Usinagem");
  const ana = seedEmployee(db, "Ana Ribeiro");
  const eduardo = seedEmployee(db, "Eduardo Lima");
  const marcos = seedEmployee(db, "Marcos Teixeira");
  seedEmployee(db, "Inativo", { status: "INACTIVE" });
  const mk = async (name: string, category: string, requiresRecycling = false) =>
    (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name, category, requiresRecycling })).json.id as string;
  const desenho = await mk("Leitura de desenho técnico", "TECHNICAL");
  const cnc = await mk("Programação CNC", "TECHNICAL");
  const nr12 = await mk("NR-12 Segurança em máquinas", "SAFETY", true);
  const pos = await requestJson(app, "POST", "/api/hr/competencies/positions", {
    name: "Torno CNC 01",
    departmentId: usinagem,
    shiftPattern: "TWO_SHIFTS",
    requirements: [
      { competencyId: desenho, minLevel: 3 },
      { competencyId: cnc, minLevel: 3 },
      { competencyId: nr12, minLevel: 3 },
      { competencyId: SOME_ID.replace("1111-4", "2222-4"), minLevel: 0 },
    ],
  });
  assert.equal(pos.status, 201, JSON.stringify(pos.json));
  const team = await requestJson(app, "PUT", `/api/hr/competencies/positions/${pos.json.id}/team`, { employeeIds: [ana, eduardo] });
  assert.equal(team.status, 200, JSON.stringify(team.json));
  return { ana, eduardo, marcos, desenho, cnc, nr12, positionId: pos.json.id as string, usinagem };
}

describe("competencyRoutes — guardas", () => {
  let app: CompetencyTestApp;
  before(async () => {
    app = await startCompetencyTestApp({ granted: [] });
  });
  after(() => app.close());

  it("cada endpoint declara o recurso/ação da sua capacidade", () => {
    for (const ep of COMPETENCY_ENDPOINTS) {
      const g = COMPETENCY_CAPABILITY_GRANTS[ep.capability];
      assert.ok(
        app.guardCalls.some((c) => c.resource === g.resourceKey && c.action === g.action),
        `${ep.method} ${ep.path} → ${g.resourceKey}:${g.action}`,
      );
    }
    const resources = new Set(app.guardCalls.map((c) => c.resource));
    assert.deepEqual([...resources].sort(), Object.values(COMPETENCY_RESOURCE_KEYS).sort());
  });

  it("sem permissão → 403 em todos os endpoints, sem tocar o banco", async () => {
    for (const ep of COMPETENCY_ENDPOINTS) {
      const res = await requestJson(app, ep.method, samplePath(ep.path), ep.method === "GET" || ep.method === "DELETE" ? undefined : {});
      assert.equal(res.status, 403, `${ep.method} ${ep.path}`);
    }
    assert.equal(app.db.touched.size, 0);
  });

  it("sem sessão → 401", async () => {
    const anon = await startCompetencyTestApp({ authenticated: false });
    try {
      const res = await requestJson(anon, "GET", "/api/hr/competencies/overview");
      assert.equal(res.status, 401);
    } finally {
      await anon.close();
    }
  });

  it("ver o módulo não permite registrar avaliação nem editar a matriz", async () => {
    const viewer = await startCompetencyTestApp({ granted: [`${COMPETENCY_RESOURCE_KEYS.module}:view`] });
    try {
      assert.equal((await requestJson(viewer, "GET", "/api/hr/competencies/overview")).status, 200);
      assert.equal((await requestJson(viewer, "GET", "/api/hr/competencies/departments")).status, 200);
      assert.equal((await requestJson(viewer, "PUT", samplePath("/api/hr/competencies/departments/:id/competencies"), { competencyIds: [] })).status, 403);
      assert.equal((await requestJson(viewer, "POST", "/api/hr/competencies/assessments", {})).status, 403);
      assert.equal((await requestJson(viewer, "PUT", samplePath("/api/hr/competencies/levels/:a/:b"), { level: 2 })).status, 403);
      assert.equal((await requestJson(viewer, "GET", "/api/hr/competencies/trainings")).status, 403);
    } finally {
      await viewer.close();
    }
  });
});

describe("competencyRoutes — catálogo e postos", () => {
  let app: CompetencyTestApp;
  before(async () => {
    app = await startCompetencyTestApp();
  });
  after(() => app.close());

  it("competência: nome obrigatório, categoria válida e nome único entre ativas", async () => {
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: " ", category: "TECHNICAL" })).json.error, "INVALID_NAME");
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "X", category: "OUTRA" })).json.error, "INVALID_CATEGORY");
    const ok = await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Metrologia", category: "QUALITY" });
    assert.equal(ok.status, 201);
    const dup = await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "metrologia", category: "QUALITY" });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, "DUPLICATE_NAME");
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/catalog/${ok.json.id}`)).status, 204);
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Metrologia", category: "QUALITY" })).status, 201);
    const list = await requestJson(app, "GET", "/api/hr/competencies/catalog");
    assert.equal(list.json.competencies.length, 1);
  });

  it("posto exige nome e pelo menos 1 requisito", async () => {
    const r1 = await requestJson(app, "POST", "/api/hr/competencies/positions", { name: "", shiftPattern: "ONE_SHIFT", requirements: [] });
    assert.equal(r1.json.error, "INVALID_NAME");
    const r2 = await requestJson(app, "POST", "/api/hr/competencies/positions", {
      name: "Montagem",
      shiftPattern: "ONE_SHIFT",
      requirements: [{ competencyId: SOME_ID, minLevel: 0 }],
    });
    assert.equal(r2.json.error, "REQUIREMENTS_REQUIRED");
    const r3 = await requestJson(app, "POST", "/api/hr/competencies/positions", {
      name: "Montagem",
      shiftPattern: "ONE_SHIFT",
      requirements: [{ competencyId: SOME_ID, minLevel: 2 }],
    });
    assert.equal(r3.json.error, "INVALID_REQUIREMENTS");
  });

  it("alocação: um posto ativo por colaborador, com histórico", async () => {
    const s = await seedScenario(app);
    const other = await requestJson(app, "POST", "/api/hr/competencies/positions", {
      name: "Inspeção",
      shiftPattern: "ONE_SHIFT",
      requirements: [{ competencyId: s.desenho, minLevel: 2 }],
    });
    await requestJson(app, "PUT", `/api/hr/competencies/positions/${other.json.id}/team`, { employeeIds: [s.ana] });
    const assignments = app.db.tables.hrEmployeeWorkPosition.filter((a) => a.employeeId === s.ana);
    assert.equal(assignments.length, 2);
    assert.equal(assignments.filter((a) => a.endedAt == null).length, 1);
    const positions = (await requestJson(app, "GET", "/api/hr/competencies/positions")).json.positions;
    const torno = positions.find((p: any) => p.name === "Torno CNC 01");
    assert.deepEqual(torno.team.map((t: any) => t.employeeName), ["Eduardo Lima"]);
    assert.equal(torno.departmentName, "Usinagem");
    assert.equal(torno.requirements.length, 3, "nível 0 = não exigido");
    const bad = await requestJson(app, "PUT", `/api/hr/competencies/positions/${other.json.id}/team`, {
      employeeIds: [app.db.tables.employee.find((e) => e.status === "INACTIVE")!.id],
    });
    assert.equal(bad.json.error, "INVALID_EMPLOYEES");
  });
});

describe("competencyRoutes — avaliação atualiza matriz, KPIs e lacunas", () => {
  let app: CompetencyTestApp;
  let s: Awaited<ReturnType<typeof seedScenario>>;
  before(async () => {
    app = await startCompetencyTestApp();
    s = await seedScenario(app);
  });
  after(() => app.close());

  it("Visão geral inicial: tudo como lacuna", async () => {
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.equal(ov.asOf, "2026-10-15");
    assert.deepEqual([ov.coverage.met, ov.coverage.total], [0, 6]);
    assert.equal(ov.openGaps, 6);
    assert.equal(ov.readyEmployees, 0);
    assert.equal(ov.allocatedEmployees, 2);
    assert.equal(ov.topGaps[0].gap, 3);
  });

  it("agendar avaliação pendente aparece no contador", async () => {
    const res = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: s.ana,
      evaluatorEmployeeId: s.marcos,
      assessmentDate: "2026-10-21",
      status: "PENDING",
    });
    assert.equal(res.status, 201);
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.equal(ov.pendingAssessments, 1);
  });

  it("conclusão exige ao menos uma competência", async () => {
    const res = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: s.ana,
      evaluatorEmployeeId: s.marcos,
      assessmentDate: "2026-10-15",
      items: [],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "ITEMS_REQUIRED");
    const noEval = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: s.ana,
      assessmentDate: "2026-10-15",
      items: [{ competencyId: s.desenho, level: 3 }],
    });
    assert.equal(noEval.json.error, "EVALUATOR_REQUIRED");
  });

  it("salvar avaliação grava média, níveis, histórico e substitui a pendente", async () => {
    const res = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: s.ana,
      evaluatorEmployeeId: s.marcos,
      assessmentDate: "2026-10-15",
      notes: "Boa evolução",
      items: [
        { competencyId: s.desenho, level: 3 },
        { competencyId: s.cnc, level: 3 },
        { competencyId: s.nr12, level: 2 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.ok(res.json.replacedPendingId);
    const list = (await requestJson(app, "GET", "/api/hr/competencies/assessments")).json.assessments;
    assert.equal(list.length, 1, "a pendente virou a concluída");
    assert.equal(list[0].status, "COMPLETED");
    assert.equal(list[0].averageLabel, "2,7");
    assert.equal(list[0].evaluatorName, "Marcos Teixeira");
    assert.equal(list[0].positionName, "Torno CNC 01");
    assert.equal(app.db.tables.hrEmployeeCompetencyLevelHistory.length, 3);

    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.deepEqual([ov.coverage.met, ov.coverage.total, ov.openGaps], [2, 6, 4]);
    assert.equal(ov.pendingAssessments, 0);
    const matrix = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    const anaRow = matrix.rows.find((r: any) => r.employeeId === s.ana);
    const nr12Cell = anaRow.cells.find((c: any) => c.competencyId === s.nr12);
    assert.deepEqual([nr12Cell.level, nr12Cell.requiredLevel, nr12Cell.belowMinimum], [2, 3, true]);
  });

  it("avaliação concluída é imutável", async () => {
    const id = app.db.tables.hrCompetencyAssessment[0].id;
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/assessments/${id}`)).status, 409);
    const put = await requestJson(app, "PUT", `/api/hr/competencies/assessments/${id}`, {
      employeeId: s.ana,
      assessmentDate: "2026-10-16",
      status: "PENDING",
    });
    assert.equal(put.json.error, "ASSESSMENT_LOCKED");
  });

  it("colaborador sem posto pode ser avaliado e entra na matriz", async () => {
    const res = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: s.marcos,
      evaluatorEmployeeId: s.ana,
      assessmentDate: "2026-10-15",
      items: [{ competencyId: s.desenho, level: 3 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const matrix = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    const row = matrix.rows.find((r: { employeeId: string }) => r.employeeId === s.marcos);
    assert.equal(row.positionId, null);
    const cell = row.cells.find((c: { competencyId: string }) => c.competencyId === s.desenho);
    assert.equal(cell.level, 3);
    assert.equal(cell.requiredLevel, null);
    assert.equal(cell.belowMinimum, false);
  });

  it("nível manual na matriz grava histórico só quando muda", async () => {
    const before = app.db.tables.hrEmployeeCompetencyLevelHistory.length;
    const path = `/api/hr/competencies/levels/${s.ana}/${s.nr12}`;
    const r1 = await requestJson(app, "PUT", path, { level: 3 });
    assert.deepEqual([r1.status, r1.json.previousLevel], [200, 2]);
    await requestJson(app, "PUT", path, { level: 3 });
    assert.equal(app.db.tables.hrEmployeeCompetencyLevelHistory.length, before + 1);
    assert.equal((await requestJson(app, "PUT", path, { level: 5 })).json.error, "INVALID_LEVEL");
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.equal(ov.readyEmployees, 1, "Ana passa a atender 100% do posto");
  });
});

describe("competencyRoutes — ficha do colaborador (aba Competências)", () => {
  let app: CompetencyTestApp;
  let s: Awaited<ReturnType<typeof seedScenario>>;
  before(async () => {
    app = await startCompetencyTestApp();
    s = await seedScenario(app);
    await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: s.ana,
      evaluatorEmployeeId: s.marcos,
      assessmentDate: "2026-10-15",
      items: [
        { competencyId: s.desenho, level: 3 },
        { competencyId: s.cnc, level: 2 },
        { competencyId: s.nr12, level: 3 },
      ],
    });
    await requestJson(app, "POST", "/api/hr/competencies/trainings", {
      title: "CNC",
      competencyId: s.cnc,
      modality: "ON_THE_JOB",
      workloadHours: 40,
      startDate: "2026-10-20",
      validityMonths: 0,
      participantIds: [s.ana, s.eduardo],
    });
  });
  after(() => app.close());

  it("perfil sai da mesma engine e das mesmas tabelas do módulo", async () => {
    const r = await requestJson(app, "GET", `/api/hr/competencies/employees/${s.ana}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.position.name, "Torno CNC 01");
    assert.deepEqual([r.json.coverage.met, r.json.coverage.total, r.json.ready, r.json.writable], [2, 3, false, true]);
    const cnc = r.json.requirements.find((q: any) => q.competencyId === s.cnc);
    assert.deepEqual([cnc.currentLevel, cnc.requiredLevel, cnc.met, cnc.gap], [2, 3, false, 1]);
    assert.equal(r.json.history.length, 3);
    // Mesmos números da matriz do módulo (fonte única).
    const matrix = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    const row = matrix.rows.find((x: any) => x.employeeId === s.ana);
    for (const q of r.json.requirements) {
      assert.equal(row.cells.find((c: any) => c.competencyId === q.competencyId).level, q.currentLevel);
    }
    // Nada novo é gravado ao abrir a ficha.
    const writes = app.db.writes.length;
    await requestJson(app, "GET", `/api/hr/competencies/employees/${s.ana}`);
    assert.equal(app.db.writes.length, writes);
  });

  it("colaborador sem posto: sem requisitos, com níveis registrados", async () => {
    await requestJson(app, "PUT", `/api/hr/competencies/levels/${s.marcos}/${s.desenho}`, { level: 4 });
    const r = await requestJson(app, "GET", `/api/hr/competencies/employees/${s.marcos}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.position, null);
    assert.deepEqual(r.json.requirements, []);
    assert.deepEqual(r.json.otherLevels.map((o: any) => [o.competencyName, o.currentLevel]), [["Leitura de desenho técnico", 4]]);
  });

  it("listas do módulo filtradas por colaborador", async () => {
    const av = await requestJson(app, "GET", `/api/hr/competencies/assessments?employeeId=${s.ana}`);
    assert.deepEqual(av.json.assessments.map((a: any) => a.employeeId), [s.ana]);
    const tr = await requestJson(app, "GET", `/api/hr/competencies/trainings?employeeId=${s.eduardo}`);
    assert.deepEqual(tr.json.trainings.map((t: any) => t.title), ["CNC"]);
    assert.equal((await requestJson(app, "GET", "/api/hr/competencies/assessments?employeeId=xx")).status, 400);
    assert.equal((await requestJson(app, "GET", "/api/hr/competencies/employees/nao-uuid")).status, 400);
    assert.equal((await requestJson(app, "GET", `/api/hr/competencies/employees/${SOME_ID}`)).status, 404);
  });
});

describe("competencyRoutes — treinamentos e reciclagem", () => {
  let app: CompetencyTestApp;
  let s: Awaited<ReturnType<typeof seedScenario>>;
  before(async () => {
    app = await startCompetencyTestApp({ now: new Date("2026-10-15T15:00:00.000Z") });
    s = await seedScenario(app);
  });
  after(() => app.close());

  it("exige título e pelo menos 1 participante; nasce Agendado", async () => {
    const base = { title: "NR-12 — reciclagem", competencyId: s.nr12, modality: "IN_PERSON", workloadHours: 8, startDate: "2024-09-01", validityMonths: 24 };
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/trainings", { ...base, participantIds: [] })).json.error, "PARTICIPANTS_REQUIRED");
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/trainings", { ...base, title: "", participantIds: [s.ana] })).json.error, "INVALID_TITLE");
    const ok = await requestJson(app, "POST", "/api/hr/competencies/trainings", { ...base, participantIds: [s.ana] });
    assert.equal(ok.status, 201);
    const list = (await requestJson(app, "GET", "/api/hr/competencies/trainings")).json.trainings;
    assert.equal(list[0].status, "SCHEDULED");
    assert.equal(list[0].participants[0].employeeName, "Ana Ribeiro");
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.equal(ov.openTrainings, 1);
  });

  it("treinamento concluído vencido derruba o nível efetivo para 1", async () => {
    await requestJson(app, "PUT", `/api/hr/competencies/levels/${s.ana}/${s.nr12}`, { level: 3 });
    const id = app.db.tables.hrTraining[0].id;
    const done = await requestJson(app, "PATCH", `/api/hr/competencies/trainings/${id}/status`, { status: "COMPLETED", completedOn: "2024-09-01" });
    assert.equal(done.status, 200);
    assert.ok(app.db.tables.hrTrainingParticipant[0].completedAt);
    const matrix = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    const cell = matrix.rows.find((r: any) => r.employeeId === s.ana).cells.find((c: any) => c.competencyId === s.nr12);
    assert.deepEqual([cell.storedLevel, cell.level, cell.recycling, cell.recyclingExpiresOn], [3, 1, "EXPIRED", "2026-09-01"]);
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/trainings/${id}`)).json.error, "TRAINING_LOCKED");
  });
});

describe("competencyRoutes — departamentos e competências", () => {
  let app: CompetencyTestApp;
  before(async () => {
    app = await startCompetencyTestApp();
  });
  after(() => app.close());

  it("associa a mesma competência a dois departamentos sem nível mínimo e sem mexer no colaborador", async () => {
    const injecao = seedDepartment(app.db, "Injeção");
    const qualidade = seedDepartment(app.db, "Qualidade");
    const ana = seedEmployee(app.db, "Ana Dept", { departmentId: injecao });
    const desenho = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Desenho", category: "TECHNICAL" })).json.id as string;
    const nr = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "NR-12 Dept", category: "SAFETY" })).json.id as string;

    const first = await requestJson(app, "PUT", `/api/hr/competencies/departments/${injecao}/competencies`, { competencyIds: [desenho, nr] });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const again = await requestJson(app, "PUT", `/api/hr/competencies/departments/${injecao}/competencies`, { competencyIds: [nr, desenho] });
    assert.equal(again.status, 200);
    assert.equal(app.db.tables.hrDepartmentCompetency.filter((r) => r.departmentId === injecao).length, 2);
    const second = await requestJson(app, "PUT", `/api/hr/competencies/departments/${qualidade}/competencies`, { competencyIds: [desenho] });
    assert.equal(second.status, 200);
    const board = second.json.departments as { id: string; competencyIds: string[]; employees: { id: string }[] }[];
    assert.deepEqual(board.find((d) => d.id === injecao)?.competencyIds.sort(), [desenho, nr].sort());
    assert.deepEqual(board.find((d) => d.id === qualidade)?.competencyIds, [desenho]);
    assert.equal(app.db.tables.employee.find((e) => e.id === ana)?.departmentId, injecao);

    const off = await requestJson(app, "PUT", `/api/hr/competencies/departments/${injecao}/competencies`, { competencyIds: [desenho] });
    assert.equal(off.status, 200);
    assert.equal(app.db.tables.hrDepartmentCompetency.filter((r) => r.departmentId === injecao && r.competencyId === nr).length, 0);

    const inactiveId = seedDepartment(app.db, "Arquivado");
    const inactive = app.db.tables.hrDepartment.find((d) => d.id === inactiveId)!;
    inactive.status = "INACTIVE";
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/departments/${inactiveId}/competencies`, { competencyIds: [desenho] })).status, 404);
  });

  it("avalia sem posto, preserva histórico na troca de departamento e não cria lacuna artificial", async () => {
    const injecao = seedDepartment(app.db, "Montagem");
    const qualidade = seedDepartment(app.db, "Testagem");
    const person = seedEmployee(app.db, "Sem Posto", { departmentId: injecao });
    const evaluator = seedEmployee(app.db, "Avaliador Dept");
    const home = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Montagem básica", category: "TECHNICAL" })).json.id as string;
    const other = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Teste elétrico", category: "QUALITY" })).json.id as string;
    await requestJson(app, "PUT", `/api/hr/competencies/departments/${injecao}/competencies`, { competencyIds: [home] });
    await requestJson(app, "PUT", `/api/hr/competencies/departments/${qualidade}/competencies`, { competencyIds: [other] });

    const saved = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: person,
      evaluatorEmployeeId: evaluator,
      assessmentDate: "2026-10-15",
      items: [
        { competencyId: home, level: 2 },
        { competencyId: other, level: 4 },
      ],
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));
    const historyBefore = app.db.tables.hrEmployeeCompetencyLevelHistory.filter((h) => h.employeeId === person).length;
    assert.equal(historyBefore, 2);

    const employee = app.db.tables.employee.find((e) => e.id === person)!;
    employee.departmentId = qualidade;
    const profile = await requestJson(app, "GET", `/api/hr/competencies/employees/${person}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.json.department.id, qualidade);
    assert.equal(profile.json.position, null);
    assert.equal(profile.json.history.length, historyBefore);
    const matrix = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    const row = matrix.rows.find((r: { employeeId: string }) => r.employeeId === person);
    assert.equal(row.departmentId, qualidade);
    assert.deepEqual(row.linkedCompetencyIds, [other]);
    const homeCell = row.cells.find((c: { competencyId: string; level: number; belowMinimum: boolean }) => c.competencyId === home);
    assert.equal(homeCell.level, 2);
    assert.equal(homeCell.belowMinimum, false);
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.ok(ov.development.evaluatedEmployees >= 1);
    assert.ok(ov.development.polyvalentEmployees >= 1);
    assert.ok(ov.development.multipliers >= 1);
  });

  it("associar competência ao departamento não amplia o que o líder enxerga", async () => {
    const dep = seedDepartment(app.db, "Ferramentaria");
    const leader = seedEmployee(app.db, "Líder Ferramentaria");
    const mine = seedEmployee(app.db, "Liderado", { managerId: leader, departmentId: dep });
    const other = seedEmployee(app.db, "Outra equipe", { departmentId: dep });
    const comp = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Ajuste de molde", category: "TECHNICAL" })).json.id as string;
    app.setScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: leader });
    const before = await requestJson(app, "GET", "/api/hr/competencies/departments");
    assert.equal(before.status, 200);
    const people = (before.json.departments as { id: string; employees: { id: string }[] }[]).find((d) => d.id === dep)?.employees ?? [];
    assert.deepEqual(people.map((e) => e.id), [mine]);
    const linked = await requestJson(app, "PUT", `/api/hr/competencies/departments/${dep}/competencies`, { competencyIds: [comp] });
    assert.equal(linked.status, 200);
    const afterPeople = (linked.json.departments as { id: string; employees: { id: string }[] }[]).find((d) => d.id === dep)?.employees ?? [];
    assert.deepEqual(afterPeople.map((e) => e.id), [mine]);
    const matrix = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    const ids = (matrix.rows as { employeeId: string }[]).map((r) => r.employeeId);
    assert.equal(ids.includes(mine), true);
    assert.equal(ids.includes(other), false);
    assert.equal(ids.includes(leader), false, "o líder não vê a própria linha");
    assert.equal((await requestJson(app, "GET", `/api/hr/competencies/employees/${other}`)).status, 404);
  });

  it("aplica a mesma competência aos turnos 1 e 2 sem duplicar catálogo, avaliação ou turno do colaborador", async () => {
    app.setScope({ accessScope: "ALL", actorEmployeeId: null });
    const montagem = seedDepartment(app.db, "Montagem turnos");
    const qualidade = seedDepartment(app.db, "Qualidade turnos");
    const person = seedEmployee(app.db, "Operador turnos", { departmentId: montagem, workSchedule: "Seg–Sex 07:30–17:18" });
    const other = seedEmployee(app.db, "Qualidade turnos pessoa", { departmentId: qualidade });
    const evaluator = seedEmployee(app.db, "Avaliador turnos");
    const catalogBefore = app.db.tables.hrCompetency.length;
    const a = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Solda de gabinete", category: "TECHNICAL" })).json.id as string;
    const b = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Inspeção visual", category: "QUALITY" })).json.id as string;
    assert.equal(app.db.tables.hrCompetency.length, catalogBefore + 2);

    const first = await requestJson(app, "PUT", `/api/hr/competencies/departments/${montagem}/competencies`, {
      items: [
        { competencyId: a, shifts: ["2", "1"] },
        { competencyId: b, shifts: ["1", "2"] },
      ],
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const links = (first.json.departments as { id: string; links: { competencyId: string; appliesToAllShifts: boolean; shifts: string[] }[] }[])
      .find((department) => department.id === montagem)?.links ?? [];
    assert.equal(links.length, 2);
    assert.equal(links.every((link) => link.appliesToAllShifts === false && link.shifts.join(",") === "1,2"), true);
    const parents = () => app.db.tables.hrDepartmentCompetency.filter((row) => row.departmentId === montagem);
    const shiftRows = () => {
      const ids = new Set(parents().map((row) => row.id));
      return app.db.tables.hrDepartmentCompetencyShift.filter((row) => ids.has(String(row.departmentCompetencyId)));
    };
    assert.equal(parents().length, 2);
    assert.equal(shiftRows().length, 4);

    const again = await requestJson(app, "PUT", `/api/hr/competencies/departments/${montagem}/competencies`, {
      items: [
        { competencyId: a, shifts: ["1", "2"] },
        { competencyId: b, shifts: ["1", "2"] },
      ],
    });
    assert.equal(again.status, 200);
    assert.equal(parents().length, 2);
    assert.equal(shiftRows().length, 4);
    assert.equal(app.db.tables.hrCompetency.filter((row) => row.id === a || row.id === b).length, 2);

    const saved = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: person,
      evaluatorEmployeeId: evaluator,
      assessmentDate: "2026-10-15",
      items: [{ competencyId: a, level: 3 }],
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));
    const levels = () => app.db.tables.hrEmployeeCompetencyLevel.filter((row) => row.employeeId === person);
    const history = () => app.db.tables.hrEmployeeCompetencyLevelHistory.filter((row) => row.employeeId === person);
    assert.equal(levels().length, 1);
    assert.equal(levels()[0].competencyId, a);
    assert.equal(levels()[0].level, 3);
    const historyCount = history().length;
    await requestJson(app, "PUT", `/api/hr/competencies/departments/${montagem}/competencies`, {
      items: [
        { competencyId: a, shifts: ["1", "2"] },
        { competencyId: b, shifts: ["1", "2"] },
      ],
    });
    assert.equal(levels().length, 1);
    assert.equal(history().length, historyCount);
    const employee = app.db.tables.employee.find((row) => row.id === person)!;
    assert.equal(employee.departmentId, montagem);
    assert.equal(employee.workSchedule, "Seg–Sex 07:30–17:18");

    const invalid = await requestJson(app, "PUT", `/api/hr/competencies/departments/${montagem}/competencies`, {
      items: [{ competencyId: a, shifts: ["9"] }],
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error, "INVALID_SHIFTS");
    assert.equal(parents().length, 2);
    assert.equal(shiftRows().length, 4);

    const allShifts = await requestJson(app, "PUT", `/api/hr/competencies/departments/${montagem}/competencies`, {
      items: [{ competencyId: a, shifts: ["1", "2", "3"] }],
    });
    assert.equal(allShifts.status, 200);
    assert.equal(parents().length, 1);
    assert.equal(parents()[0].appliesToAllShifts, true);
    assert.equal(shiftRows().length, 0);
    const allLink = (allShifts.json.departments as { id: string; links: { competencyId: string; appliesToAllShifts: boolean; shifts: string[] }[] }[])
      .find((department) => department.id === montagem)?.links[0];
    assert.equal(allLink?.appliesToAllShifts, true);
    assert.deepEqual(allLink?.shifts, []);

    await requestJson(app, "PUT", `/api/hr/competencies/departments/${montagem}/competencies`, {
      items: [
        { competencyId: a, shifts: ["1"] },
        { competencyId: b, shifts: ["2"] },
      ],
    });
    await requestJson(app, "PUT", `/api/hr/competencies/departments/${qualidade}/competencies`, {
      items: [{ competencyId: b, shifts: null }],
    });
    const byShift = (await requestJson(app, "GET", "/api/hr/competencies/matrix?shifts=2")).json;
    const columnIds = (byShift.competencies as { id: string }[]).map((competency) => competency.id);
    assert.equal(columnIds.includes(a), false);
    assert.equal(columnIds.includes(b), true);
    const rowIds = (byShift.rows as { employeeId: string }[]).map((row) => row.employeeId);
    assert.equal(rowIds.includes(person), true);
    assert.equal(rowIds.includes(other), true);
    const byDepartment = (await requestJson(app, "GET", `/api/hr/competencies/matrix?departmentId=${montagem}`)).json;
    const departmentRows = (byDepartment.rows as { employeeId: string }[]).map((row) => row.employeeId);
    assert.deepEqual(departmentRows, [person]);
    const badFilter = await requestJson(app, "GET", "/api/hr/competencies/matrix?shifts=9");
    assert.equal(badFilter.status, 400);
    assert.equal(badFilter.json.error, "INVALID_SHIFTS");
    const overview = (await requestJson(app, "GET", `/api/hr/competencies/overview?departmentId=${montagem}`)).json;
    assert.equal(overview.development.evaluatedEmployees, 1);
    assert.equal(overview.development.employeesInScope, 1);
    const otherOverview = (await requestJson(app, "GET", `/api/hr/competencies/overview?departmentId=${qualidade}`)).json;
    assert.equal(otherOverview.development.evaluatedEmployees, 0);
    assert.equal(levels().length, 1);
  });
});

describe("competencyRoutes — banco simulado", () => {
  it("transação desfaz escrita parcial", async () => {
    const db: FakeDb = createFakeDb();
    await assert.rejects(
      db.prisma.$transaction(async (tx: any) => {
        await tx.hrCompetency.create({ data: { name: "X", category: "TECHNICAL" } });
        throw new Error("boom");
      }),
    );
    assert.equal(db.tables.hrCompetency.length, 0);
  });
});
