/**
 * Escopo hierárquico de Competências — testes negativos de acesso cruzado (rotas reais).
 *
 * Organograma:  Diretora (D) ─┬─ Gestor G ─┬─ Ana (O1)
 *                             │            └─ Bruno (O2)
 *               Outra diretora (D2) ─ Gestor H ─ Xavier (X)   ← outra equipe
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildCompetencyScope, canSeeEmployee, canWriteEmployee, competencyScopeView } from "./competencyScope";
import { requestJson, seedEmployee, startCompetencyTestApp, type CompetencyTestApp } from "./competencyTestSupport";

describe("competencyScope — regra pura", () => {
  it("RH (ALL) vê e grava todos", () => {
    const s = buildCompetencyScope({ accessScope: "ALL", actorEmployeeId: null });
    assert.equal(canSeeEmployee(s, "qualquer"), true);
    assert.equal(canWriteEmployee(s, "qualquer"), true);
    assert.equal(competencyScopeView(s), "ALL");
  });

  it("líder vê a si e à equipe, mas só grava na equipe", () => {
    const s = buildCompetencyScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "g", teamIds: ["a", "b", "g"] });
    assert.deepEqual([canSeeEmployee(s, "g"), canSeeEmployee(s, "a"), canSeeEmployee(s, "x")], [true, true, false]);
    assert.deepEqual([canWriteEmployee(s, "g"), canWriteEmployee(s, "a"), canWriteEmployee(s, "x")], [false, true, false]);
    assert.equal(competencyScopeView(s), "TEAM");
  });

  it("sem colaborador vinculado ou escopo NONE: nada", () => {
    for (const s of [
      buildCompetencyScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: null, teamIds: ["a"] }),
      buildCompetencyScope({ accessScope: "NONE", actorEmployeeId: "g" }),
    ]) {
      assert.equal(canSeeEmployee(s, "a"), false);
      assert.equal(canWriteEmployee(s, "a"), false);
      assert.equal(competencyScopeView(s), "NONE");
    }
  });

  it("SELF vê só a si e não grava", () => {
    const s = buildCompetencyScope({ accessScope: "SELF", actorEmployeeId: "g" });
    assert.deepEqual([canSeeEmployee(s, "g"), canWriteEmployee(s, "g")], [true, false]);
    assert.equal(competencyScopeView(s), "SELF");
  });
});

describe("competencyRoutes — acesso cruzado de líder", () => {
  let app: CompetencyTestApp;
  const id: Record<string, string> = {};
  const RH = { accessScope: "ALL" as const, actorEmployeeId: null };
  const asLeader = () => app.setScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: id.g });

  before(async () => {
    app = await startCompetencyTestApp({ scope: RH });
    const db = app.db;
    id.d = seedEmployee(db, "Diretora");
    id.g = seedEmployee(db, "Gestor G", { managerId: id.d });
    id.o1 = seedEmployee(db, "Ana", { managerId: id.g });
    id.o2 = seedEmployee(db, "Bruno", { managerId: id.g });
    id.d2 = seedEmployee(db, "Outra diretora");
    id.h = seedEmployee(db, "Gestor H", { managerId: id.d2 });
    id.x = seedEmployee(db, "Xavier", { managerId: id.h });
    // Montagem feita pelo RH (escopo ALL).
    id.comp = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Leitura", category: "TECHNICAL" })).json.id;
    id.pos = (
      await requestJson(app, "POST", "/api/hr/competencies/positions", {
        name: "Torno",
        shiftPattern: "ONE_SHIFT",
        requirements: [{ competencyId: id.comp, minLevel: 3 }],
      })
    ).json.id;
    const team = await requestJson(app, "PUT", `/api/hr/competencies/positions/${id.pos}/team`, {
      employeeIds: [id.g, id.o1, id.o2, id.x],
    });
    assert.equal(team.status, 200);
    const schedule = (employeeId: string) =>
      requestJson(app, "POST", "/api/hr/competencies/assessments", {
        employeeId,
        evaluatorEmployeeId: id.h,
        assessmentDate: "2026-10-20",
        status: "PENDING",
      });
    id.pendingX = (await schedule(id.x)).json.id;
    id.pendingO1 = (await schedule(id.o1)).json.id;
    const training = (participantIds: string[], title: string) =>
      requestJson(app, "POST", "/api/hr/competencies/trainings", {
        title,
        competencyId: id.comp,
        modality: "ONLINE",
        workloadHours: 4,
        startDate: "2026-10-20",
        validityMonths: 0,
        participantIds,
      });
    id.trainX = (await training([id.x], "Só outra equipe")).json.id;
    id.trainMixed = (await training([id.o1, id.x], "Turma mista")).json.id;
    asLeader();
  });
  after(() => app.close());

  const names = (rows: { employeeName?: string; name?: string }[]) => rows.map((r) => r.employeeName ?? r.name).sort();

  it("matriz mostra só o líder e os liderados", async () => {
    const r = await requestJson(app, "GET", "/api/hr/competencies/matrix");
    assert.deepEqual(names(r.json.rows), ["Ana", "Bruno", "Gestor G"]);
  });

  it("dashboard (overview) calcula só sobre a equipe", async () => {
    const r = await requestJson(app, "GET", "/api/hr/competencies/overview");
    assert.equal(r.json.scope, "TEAM");
    assert.equal(r.json.allocatedEmployees, 3);
    assert.equal(r.json.coverage.total, 3);
    assert.ok(r.json.topGaps.every((g: { employeeId: string }) => g.employeeId !== id.x));
    assert.equal(r.json.pendingAssessments, 1, "só a pendência da Ana");
    assert.equal(r.json.openTrainings, 1, "só a turma com liderado");
  });

  it("busca de colaboradores (options) e equipe do posto não expõem outra equipe", async () => {
    const opts = await requestJson(app, "GET", "/api/hr/competencies/options");
    assert.deepEqual(names(opts.json.employees), ["Ana", "Bruno", "Gestor G"]);
    const pos = await requestJson(app, "GET", "/api/hr/competencies/positions");
    assert.deepEqual(names(pos.json.positions[0].team), ["Ana", "Bruno", "Gestor G"]);
  });

  it("avaliações e treinamentos listam só o que envolve a equipe", async () => {
    const av = await requestJson(app, "GET", "/api/hr/competencies/assessments");
    assert.deepEqual(names(av.json.assessments), ["Ana"]);
    const tr = await requestJson(app, "GET", "/api/hr/competencies/trainings");
    assert.deepEqual(tr.json.trainings.map((t: { title: string }) => t.title), ["Turma mista"]);
    assert.deepEqual(names(tr.json.trainings[0].participants), ["Ana"]);
    assert.equal(tr.json.trainings[0].hiddenParticipantCount, 1);
  });

  it("não altera nível de outra equipe nem o próprio", async () => {
    const other = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.x}/${id.comp}`, { level: 4 });
    assert.deepEqual([other.status, other.json.error], [403, "OUT_OF_SCOPE"]);
    const self = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.g}/${id.comp}`, { level: 4 });
    assert.equal(self.status, 403);
    assert.equal(app.db.tables.hrEmployeeCompetencyLevel.length, 0, "nada gravado");
  });

  it("não avalia outra equipe nem usa avaliador de outra equipe", async () => {
    const body = (employeeId: string, evaluatorEmployeeId: string) => ({
      employeeId,
      evaluatorEmployeeId,
      assessmentDate: "2026-10-15",
      items: [{ competencyId: id.comp, level: 3 }],
    });
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/assessments", body(id.x, id.g))).status, 403);
    const evaluator = await requestJson(app, "POST", "/api/hr/competencies/assessments", body(id.o1, id.h));
    assert.deepEqual([evaluator.status, evaluator.json.message], [403, "Avaliador fora da sua equipe."]);
    assert.equal((await requestJson(app, "POST", "/api/hr/competencies/assessments", body(id.g, id.o1))).status, 403, "autoavaliação");
  });

  it("avaliação pendente de outra equipe: 404 (não confirma existência)", async () => {
    const put = await requestJson(app, "PUT", `/api/hr/competencies/assessments/${id.pendingX}`, {
      employeeId: id.x,
      assessmentDate: "2026-10-21",
      status: "PENDING",
    });
    assert.equal(put.status, 404);
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/assessments/${id.pendingX}`)).status, 404);
    assert.equal(app.db.tables.hrCompetencyAssessment.filter((a) => a.employeeId === id.x).length, 1);
  });

  it("treinamento: não inscreve outra equipe nem altera turma com participante de fora", async () => {
    const create = await requestJson(app, "POST", "/api/hr/competencies/trainings", {
      title: "Tentativa",
      competencyId: id.comp,
      modality: "ONLINE",
      workloadHours: 1,
      startDate: "2026-10-22",
      validityMonths: 0,
      participantIds: [id.o1, id.x],
    });
    assert.equal(create.status, 403);
    assert.equal((await requestJson(app, "PATCH", `/api/hr/competencies/trainings/${id.trainMixed}/status`, { status: "COMPLETED" })).status, 403);
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/trainings/${id.trainMixed}`)).status, 403);
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/trainings/${id.trainX}`)).status, 404);
    assert.equal(app.db.tables.hrTraining.length, 2);
  });

  it("equipe do posto: não aloca outra equipe e preserva quem o líder não vê", async () => {
    const add = await requestJson(app, "PUT", `/api/hr/competencies/positions/${id.pos}/team`, {
      employeeIds: [id.g, id.o1, id.o2, id.h],
    });
    assert.equal(add.status, 403);
    // O líder envia a equipe que enxerga, sem o Xavier → Xavier continua alocado.
    const keep = await requestJson(app, "PUT", `/api/hr/competencies/positions/${id.pos}/team`, {
      employeeIds: [id.g, id.o1],
    });
    assert.equal(keep.status, 200);
    assert.deepEqual(keep.json.removed, [id.o2]);
    const active = app.db.tables.hrEmployeeWorkPosition.filter((a) => a.endedAt == null).map((a) => a.employeeId);
    assert.ok(active.includes(id.x), "Xavier preservado");
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/positions/${id.pos}`)).status, 403, "arquivar afetaria outra equipe");
  });

  it("dentro da equipe o líder grava normalmente", async () => {
    const lvl = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.o1}/${id.comp}`, { level: 3 });
    assert.equal(lvl.status, 200);
    const av = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: id.o1,
      evaluatorEmployeeId: id.g,
      assessmentDate: "2026-10-15",
      items: [{ competencyId: id.comp, level: 3 }],
    });
    assert.equal(av.status, 201);
    assert.equal(av.json.replacedPendingId, id.pendingO1);
  });

  it("descendentes: a diretora vê a árvore inteira dela, mas não a outra diretoria", async () => {
    app.setScope({ accessScope: "DESCENDANTS", actorEmployeeId: id.d });
    const r = await requestJson(app, "GET", "/api/hr/competencies/matrix");
    assert.deepEqual(names(r.json.rows), ["Ana", "Gestor G"]);
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.g}/${id.comp}`, { level: 2 })).status, 200);
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.x}/${id.comp}`, { level: 2 })).status, 403);
    asLeader();
  });

  it("usuário sem colaborador vinculado: nada visível, nada gravável", async () => {
    app.setScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: null });
    const r = await requestJson(app, "GET", "/api/hr/competencies/overview");
    assert.deepEqual([r.json.scope, r.json.allocatedEmployees, r.json.topGaps.length], ["NONE", 0, 0]);
    assert.equal((await requestJson(app, "GET", "/api/hr/competencies/matrix")).json.rows.length, 0);
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.o1}/${id.comp}`, { level: 1 })).status, 403);
    asLeader();
  });

  it("ficha: perfil de outra equipe → 404; liderado e o próprio líder visíveis", async () => {
    assert.equal((await requestJson(app, "GET", `/api/hr/competencies/employees/${id.x}`)).status, 404);
    const liderado = await requestJson(app, "GET", `/api/hr/competencies/employees/${id.o1}`);
    assert.deepEqual([liderado.status, liderado.json.writable], [200, true]);
    const self = await requestJson(app, "GET", `/api/hr/competencies/employees/${id.g}`);
    assert.deepEqual([self.status, self.json.writable], [200, false]);
  });

  it("ficha: filtros por colaborador de fora não revelam nada (nem turma mista)", async () => {
    const av = await requestJson(app, "GET", `/api/hr/competencies/assessments?employeeId=${id.x}`);
    assert.deepEqual([av.status, av.json.assessments], [200, []]);
    const tr = await requestJson(app, "GET", `/api/hr/competencies/trainings?employeeId=${id.x}`);
    assert.deepEqual([tr.status, tr.json.trainings], [200, []]);
    const mine = await requestJson(app, "GET", `/api/hr/competencies/trainings?employeeId=${id.o1}`);
    assert.ok(mine.json.trainings.length >= 1);
  });

  it("RH continua vendo e alterando todos", async () => {
    app.setScope(RH);
    const r = await requestJson(app, "GET", "/api/hr/competencies/matrix");
    assert.ok(names(r.json.rows).includes("Xavier"));
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.x}/${id.comp}`, { level: 2 })).status, 200);
    asLeader();
  });
});
