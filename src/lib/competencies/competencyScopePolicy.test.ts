/**
 * Política de escopo hierárquico de Competências — cenário completo (rotas reais, banco simulado).
 *
 *   Diretoria Geral (DIR)
 *   └─ Gerente Industrial (GER)
 *      ├─ Supervisor A (SA) ─┬─ Aline A1 ─ Artur A1a (indireto de SA)
 *      │                     └─ André A2
 *      └─ Supervisor B (SB) ─┬─ Bruno B1
 *                            └─ Beatriz B2
 *   Outro Gerente (OG) ─ Olga O1                       ← outra equipe, sem vínculo
 *   Usuário sem colaborador vinculado (actorEmployeeId = null)
 *
 * Regra: quem tem o menu de Competências vê só os subordinados autorizados; nunca a si mesmo,
 * pares, superiores ou outras equipes. ALL só para o perfil administrativo de RH.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PeopleAccessScope } from "../peopleProfileTypes";
import { buildEmployeePermissionBag } from "../employeesPermissions";
import { resolvePeopleAccessScope } from "../peopleProfileCapabilities";
import { ALL_PERMISSION_KEYS } from "../permissionCatalog";
import { resolveCompetencyAccessScope } from "./competencyScope";
import {
  requestJson,
  seedDepartment,
  seedEmployee,
  startCompetencyTestApp,
  type CompetencyTestApp,
} from "./competencyTestSupport";

type Who = { accessScope: PeopleAccessScope; actorEmployeeId: string | null };

describe("escopo de Competências a partir das permissões (sem ampliar por employees.view)", () => {
  const bag = (keys: string[], canonical?: { updateResources?: string[]; createResources?: string[] }) =>
    buildEmployeePermissionBag({
      hasLegacyPermission: (p) => keys.includes(p),
      canonicalAccess: canonical ? ({ viewResources: [], ...canonical } as never) : null,
    });
  it("Organograma (employees.view) não dá acesso global; só a equipe autorizada", () => {
    assert.equal(resolveCompetencyAccessScope(bag(["employees.view"])), "NONE");
    assert.equal(resolveCompetencyAccessScope(bag(["employees.view", "employees.team.view"])), "DIRECT_REPORTS", "editor legado: pai adicionado junto");
    assert.equal(resolveCompetencyAccessScope(bag(["employees.view", "employees.team.descendants.view"])), "DESCENDANTS");
    // A política global de RH continua igual (ficha e outros módulos).
    assert.equal(resolvePeopleAccessScope(bag(["employees.view"])), "ALL");
  });
  it("ALL só com autorização administrativa efetiva de RH (editor do cadastro / SUPER_ADMIN)", () => {
    assert.equal(resolveCompetencyAccessScope(bag(["employees.edit"])), "ALL");
    assert.equal(resolveCompetencyAccessScope(bag([], { updateResources: ["admin.employees"] })), "ALL");
    assert.equal(resolveCompetencyAccessScope(bag([], { createResources: ["admin.employees"] })), "ALL");
    assert.equal(resolveCompetencyAccessScope(bag([...ALL_PERMISSION_KEYS])), "ALL", "SUPER_ADMIN recebe todas as chaves");
  });
  it("acesso ao módulo sem chave de equipe: nenhum colaborador; perfil próprio: SELF (sem dados)", () => {
    assert.equal(resolveCompetencyAccessScope(bag(["employees.competencies.view"])), "NONE");
    assert.equal(resolveCompetencyAccessScope(bag(["employees.profile.view"])), "SELF");
  });
  it("server.ts usa o resolvedor de Competências (não o de RH) para o escopo do módulo", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.ok(server.includes("accessScope: resolveCompetencyAccessScope(employeePermCheck(authUser))"));
    assert.ok(!server.includes("resolvePeopleAccessScope("), "o resolvedor de RH não decide o escopo de Competências");
  });
});

describe("escopo hierárquico de Competências — política oficial", () => {
  let app: CompetencyTestApp;
  const id: Record<string, string> = {};
  const RH: Who = { accessScope: "ALL", actorEmployeeId: null };
  const as = (who: Who) => app.setScope(who);
  const get = async (path: string) => {
    const r = await requestJson(app, "GET", `/api/hr/competencies${path}`);
    return r;
  };
  const names = (rows: { employeeName?: string; name?: string }[]) => rows.map((r) => r.employeeName ?? r.name).sort();

  before(async () => {
    app = await startCompetencyTestApp({ scope: RH });
    const db = app.db;
    id.depA = seedDepartment(db, "Setor A");
    id.depB = seedDepartment(db, "Setor B");
    id.dir = seedEmployee(db, "Diretoria Geral");
    id.ger = seedEmployee(db, "Gerente Industrial", { managerId: id.dir });
    id.sa = seedEmployee(db, "Supervisor A", { managerId: id.ger, departmentId: id.depA });
    id.a1 = seedEmployee(db, "Aline A1", { managerId: id.sa, departmentId: id.depA });
    id.a1a = seedEmployee(db, "Artur A1a", { managerId: id.a1, departmentId: id.depA });
    id.a2 = seedEmployee(db, "André A2", { managerId: id.sa, departmentId: id.depA });
    id.sb = seedEmployee(db, "Supervisor B", { managerId: id.ger, departmentId: id.depB });
    id.b1 = seedEmployee(db, "Bruno B1", { managerId: id.sb, departmentId: id.depB });
    id.b2 = seedEmployee(db, "Beatriz B2", { managerId: id.sb, departmentId: id.depB });
    id.og = seedEmployee(db, "Outro Gerente");
    id.o1 = seedEmployee(db, "Olga O1", { managerId: id.og });
    db.tables.brandingSettings.push({ id: "b1", companyName: "Lazarios Koppetel", updatedAt: new Date() });

    const everyone = [id.dir, id.ger, id.sa, id.a1, id.a1a, id.a2, id.sb, id.b1, id.b2, id.og, id.o1];
    id.comp = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Leitura de desenho", category: "TECHNICAL" })).json.id;
    id.pos = (
      await requestJson(app, "POST", "/api/hr/competencies/positions", {
        name: "Posto geral",
        shiftPattern: "ONE_SHIFT",
        requirements: [{ competencyId: id.comp, minLevel: 3 }],
      })
    ).json.id;
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/positions/${id.pos}/team`, { employeeIds: everyone })).status, 200);
    for (const [i, e] of everyone.entries()) {
      assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/levels/${e}/${id.comp}`, { level: (i % 4) + 1 })).status, 200);
    }
    const assess = async (employeeId: string, evaluatorEmployeeId: string) =>
      (
        await requestJson(app, "POST", "/api/hr/competencies/assessments", {
          employeeId,
          evaluatorEmployeeId,
          assessmentDate: "2026-10-10",
          status: "PENDING",
        })
      ).json.id as string;
    id.assessSA = await assess(id.sa, id.ger); // avaliação do próprio supervisor A
    id.assessA1 = await assess(id.a1, id.sa);
    id.assessB1 = await assess(id.b1, id.sb);
    const training = async (title: string, participantIds: string[]) =>
      (
        await requestJson(app, "POST", "/api/hr/competencies/trainings", {
          title,
          competencyId: id.comp,
          modality: "IN_PERSON",
          workloadHours: 8,
          startDate: "2026-10-01",
          validityMonths: 12,
          participantIds,
        })
      ).json.id as string;
    id.trainA = await training("Turma A", [id.a1, id.a2]);
    id.trainMixed = await training("Turma mista", [id.a2, id.b1]);
    id.trainB = await training("Turma B", [id.b1]);
    id.trainSA = await training("Turma do supervisor A", [id.sa]);
    await requestJson(app, "PATCH", `/api/hr/competencies/trainings/${id.trainSA}/status`, { status: "COMPLETED", completedOn: "2026-10-05" });
    await requestJson(app, "PATCH", `/api/hr/competencies/trainings/${id.trainB}/status`, { status: "COMPLETED", completedOn: "2026-10-05" });
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", { signerName: "Signatário Oficial", signerRole: "Diretor de RH" });
    id.certSA = (await requestJson(app, "POST", `/api/hr/competencies/trainings/${id.trainSA}/certificates`, {})).json.issued[0].id;
    id.certB1 = (await requestJson(app, "POST", `/api/hr/competencies/trainings/${id.trainB}/certificates`, {})).json.issued[0].id;
    const request = (employeeId: string) => ({
      id: crypto.randomUUID(),
      employeeId,
      competencyId: id.comp,
      fromLevel: 1,
      toLevel: 4,
      baseVersion: 1,
      source: "MANUAL",
      reason: "Pedido",
      status: "PENDING",
      requestedByUserId: "00000000-0000-4000-8000-0000000000aa",
      createdAt: new Date("2026-10-12T10:00:00Z"),
      decidedAt: null,
      decidedByUserId: null,
      decisionNote: null,
      importBatchId: null,
    });
    const reqA1 = request(id.a1);
    const reqB1 = request(id.b1);
    const reqSA = request(id.sa);
    db.tables.hrCompetencyLevelRequest.push(reqA1, reqB1, reqSA);
    levelsBefore.b1 = db.tables.hrEmployeeCompetencyLevel.find((l) => l.employeeId === id.b1)?.level;
    levelsBefore.sa = db.tables.hrEmployeeCompetencyLevel.find((l) => l.employeeId === id.sa)?.level;
    id.reqB1 = reqB1.id;
    id.reqSA = reqSA.id;
  });
  after(() => app.close());

  const levelsBefore: Record<string, unknown> = {};
  const SA_DIRECT: Who = { accessScope: "DIRECT_REPORTS", actorEmployeeId: "" };
  const saDirect = (): Who => ({ ...SA_DIRECT, actorEmployeeId: id.sa });

  it("supervisor A (diretos) vê só Aline e André — nem a si, nem o indireto, nem SB, gerente ou diretoria", async () => {
    as(saDirect());
    const m = await get("/matrix");
    assert.deepEqual(names(m.json.rows), ["Aline A1", "André A2"]);
    const o = await get("/overview");
    assert.equal(o.json.scope, "TEAM");
    assert.equal(o.json.allocatedEmployees, 2);
    assert.equal(o.json.coverage.total, 2);
    assert.equal(o.json.pendingAssessments, 1, "só a da Aline");
    assert.equal(o.json.pendingApprovals, 1, "só a da Aline");
  });

  it("supervisor A não vê a própria avaliação, ficha, solicitação ou certificado", async () => {
    as(saDirect());
    const av = await get("/assessments");
    assert.deepEqual(names(av.json.assessments), ["Aline A1"]);
    assert.deepEqual((await get(`/assessments?employeeId=${id.sa}`)).json.assessments, []);
    assert.equal((await get(`/employees/${id.sa}`)).status, 404);
    assert.deepEqual((await get(`/trainings?employeeId=${id.sa}`)).json.trainings, []);
    assert.equal((await get(`/employees/${id.sa}/certificates`)).status, 404);
    assert.equal((await get(`/trainings/${id.trainSA}/certificates`)).status, 404);
    assert.equal((await get(`/trainings/${id.trainSA}/certificates/document?ids=${id.certSA}`)).status, 404);
    const ap = await get("/approvals");
    assert.deepEqual(names(ap.json.requests ?? ap.json.items ?? ap.json), ["Aline A1"]);
  });

  it("supervisor B não vê a equipe A (nem o supervisor A)", async () => {
    as({ accessScope: "DIRECT_REPORTS", actorEmployeeId: id.sb });
    assert.deepEqual(names((await get("/matrix")).json.rows), ["Beatriz B2", "Bruno B1"]);
    for (const e of [id.sa, id.a1, id.a2, id.a1a]) assert.equal((await get(`/employees/${e}`)).status, 404);
  });

  it("DIRECT_REPORTS não inclui indiretos; DESCENDANTS inclui só a árvore autorizada", async () => {
    as(saDirect());
    assert.equal((await get(`/employees/${id.a1a}`)).status, 404, "Artur é indireto");
    as({ accessScope: "DESCENDANTS", actorEmployeeId: id.sa });
    assert.deepEqual(names((await get("/matrix")).json.rows), ["Aline A1", "André A2", "Artur A1a"]);
    as({ accessScope: "DESCENDANTS", actorEmployeeId: id.ger });
    assert.deepEqual(names((await get("/matrix")).json.rows), [
      "Aline A1",
      "André A2",
      "Artur A1a",
      "Beatriz B2",
      "Bruno B1",
      "Supervisor A",
      "Supervisor B",
    ]);
    assert.equal((await get(`/employees/${id.ger}`)).status, 404, "o gerente não vê a si");
    assert.equal((await get(`/employees/${id.dir}`)).status, 404, "nem o superior");
    assert.equal((await get(`/employees/${id.o1}`)).status, 404, "nem outra equipe");
  });

  it("SELF, NONE e usuário sem colaborador: nenhum dado individual e nenhuma escrita", async () => {
    for (const who of [
      { accessScope: "SELF", actorEmployeeId: id.a1 },
      { accessScope: "NONE", actorEmployeeId: id.a1 },
      { accessScope: "DIRECT_REPORTS", actorEmployeeId: null },
      { accessScope: "DESCENDANTS", actorEmployeeId: null },
    ] as Who[]) {
      as(who);
      const label = JSON.stringify(who);
      assert.deepEqual((await get("/matrix")).json.rows, [], label);
      const o = (await get("/overview")).json;
      assert.deepEqual([o.allocatedEmployees, o.coverage.total, o.topGaps.length, o.pendingAssessments, o.pendingApprovals], [0, 0, 0, 0, 0], label);
      assert.deepEqual((await get("/options")).json.employees, [], label);
      assert.equal((await get("/options")).json.selfEvaluator, null, label);
      assert.deepEqual((await get("/assessments")).json.assessments, [], label);
      assert.deepEqual((await get("/trainings")).json.trainings, [], label);
      assert.equal((await get(`/employees/${id.a1}`)).status, 404, label);
      assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.a1}/${id.comp}`, { level: 2 })).status, 403, label);
    }
    as({ accessScope: "SELF", actorEmployeeId: id.a1 });
    assert.equal((await get("/overview")).json.scope, "SELF");
  });

  it("perfil administrativo (ALL) mantém o acesso global", async () => {
    as(RH);
    const rows = names((await get("/matrix")).json.rows);
    assert.equal(rows.length, 11);
    assert.equal((await get(`/employees/${id.sa}`)).status, 200);
  });

  it("filtros, ids e chamadas diretas não ampliam o escopo do supervisor A", async () => {
    as(saDirect());
    assert.deepEqual((await get(`/matrix?departmentId=${id.depB}`)).json.rows, [], "filtro de outro setor só restringe");
    assert.equal((await get(`/overview?departmentId=${id.depB}`)).json.allocatedEmployees, 0);
    for (const row of (await get("/matrix?shifts=2")).json.rows) assert.ok([id.a1, id.a2].includes(row.employeeId));
    assert.deepEqual((await get(`/assessments?employeeId=${id.b1}`)).json.assessments, []);
    assert.deepEqual((await get(`/trainings?employeeId=${id.b1}`)).json.trainings, []);
    assert.equal((await get(`/employees/${id.b1}/certificates`)).status, 404);
    assert.equal((await get(`/trainings/${id.trainB}/certificates`)).status, 404);
    assert.equal((await get(`/trainings/${id.trainB}/certificates/document?ids=${id.certB1}`)).status, 404);
    // Escritas.
    const put = (path: string, body: unknown) => requestJson(app, "PUT", `/api/hr/competencies${path}`, body);
    const post = (path: string, body: unknown) => requestJson(app, "POST", `/api/hr/competencies${path}`, body);
    assert.equal((await put(`/levels/${id.b1}/${id.comp}`, { level: 4 })).status, 403);
    assert.equal((await put(`/levels/${id.sa}/${id.comp}`, { level: 4 })).status, 403, "não altera o próprio nível");
    const assessment = (employeeId: string, evaluatorEmployeeId: string) => ({
      employeeId,
      evaluatorEmployeeId,
      assessmentDate: "2026-10-14",
      items: [{ competencyId: id.comp, level: 3 }],
    });
    assert.equal((await post("/assessments", assessment(id.sa, id.sa))).status, 403, "autoavaliação");
    assert.equal((await post("/assessments", assessment(id.a2, id.b1))).status, 403, "avaliador de outra equipe");
    assert.equal((await post("/assessments", assessment(id.a2, id.ger))).status, 403, "avaliador superior");
    assert.equal((await requestJson(app, "PUT", `/api/hr/competencies/assessments/${id.assessB1}`, { employeeId: id.b1, assessmentDate: "2026-10-21", status: "PENDING" })).status, 404);
    assert.equal((await requestJson(app, "DELETE", `/api/hr/competencies/assessments/${id.assessSA}`)).status, 404, "a própria avaliação: 404");
    assert.equal((await post(`/approvals/${id.reqB1}/decision`, { decision: "APPROVE" })).status, 404);
    assert.equal((await post(`/approvals/${id.reqSA}/decision`, { decision: "APPROVE" })).status, 404);
    assert.equal(
      (await post("/trainings", { title: "X", competencyId: id.comp, modality: "ONLINE", workloadHours: 1, startDate: "2026-10-20", validityMonths: 0, participantIds: [id.a1, id.sa] })).status,
      403,
      "não se inscreve",
    );
    assert.equal((await post(`/trainings/${id.trainMixed}/certificates`, { employeeIds: [id.b1] })).status, 409, "turma não concluída");
    assert.equal((await get("/certificate-settings/signers")).status, 403, "lista de todas as pessoas só para o RH");
    // Bruno já está no posto (RH alocou): mesmo assim 403 — a resposta não revela a alocação.
    assert.equal((await put(`/positions/${id.pos}/team`, { employeeIds: [id.a1, id.a2, id.b1] })).status, 403);
    assert.equal((await put(`/positions/${id.pos}/team`, { employeeIds: [id.a1, id.a2, id.o1] })).status, 403);
    // O próprio líder é aceito só como avaliador (referência), e a avaliação é do liderado.
    assert.equal((await post("/assessments", assessment(id.a2, id.sa))).status, 201);
    // Nada fora do escopo foi alterado (níveis gravados pelo RH na montagem).
    const level = (e: string) => app.db.tables.hrEmployeeCompetencyLevel.find((l) => l.employeeId === e)?.level;
    assert.deepEqual([level(id.b1), level(id.sa)], [levelsBefore.b1, levelsBefore.sa]);
    const active = app.db.tables.hrEmployeeWorkPosition.filter((a) => a.endedAt == null).map((a) => a.employeeId);
    for (const e of [id.b1, id.o1, id.sa]) assert.ok(active.includes(e), "alocações fora do escopo intactas");
  });

  it("importação XLSX: modelo e prévia só com a equipe; nomes de fora viram 'não encontrado'", async () => {
    as(saDirect());
    const res = await fetch(`${app.baseUrl}/api/hr/competencies/import/template`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const sheetNames = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Níveis"], { header: 1 }).slice(1).map((r) => r[1]).sort();
    assert.deepEqual(sheetNames, ["Aline A1", "André A2"]);
    const sheet = XLSX.utils.aoa_to_sheet([["Colaborador", "Leitura de desenho"], ["Supervisor A", 4], ["Bruno B1", 4], ["Gerente Industrial", 4], ["Aline A1", 4]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Níveis");
    const fd = new FormData();
    fd.append("file", new Blob([XLSX.write(book, { type: "buffer", bookType: "xlsx" })]), "niveis.xlsx");
    const preview = await fetch(`${app.baseUrl}/api/hr/competencies/import/preview`, { method: "POST", body: fd }).then((r) => r.json());
    assert.deepEqual(preview.plan.rows.map((r: { status: string }) => r.status), ["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "MATCHED"]);
    assert.ok(!JSON.stringify(preview).includes(id.b1) && !JSON.stringify(preview).includes(id.sa) && !JSON.stringify(preview).includes(id.ger));
  });

  it("nenhum nome ou id fora do escopo aparece em KPIs, listas ou dados auxiliares (supervisor A)", async () => {
    as(saDirect());
    const outside = [
      ["Diretoria Geral", id.dir],
      ["Gerente Industrial", id.ger],
      ["Supervisor B", id.sb],
      ["Bruno B1", id.b1],
      ["Beatriz B2", id.b2],
      ["Outro Gerente", id.og],
      ["Olga O1", id.o1],
      ["Artur A1a", id.a1a],
    ];
    const paths = [
      "/overview",
      "/matrix",
      "/options",
      "/positions",
      "/departments",
      "/catalog",
      "/assessments",
      "/trainings",
      "/approvals",
      "/approvals?status=PENDING",
      `/employees/${id.a1}`,
      `/employees/${id.a1}/certificates`,
      `/trainings/${id.trainA}/certificates`,
      `/trainings/${id.trainMixed}/certificates`,
      "/certificate-settings",
    ];
    for (const path of paths) {
      const r = await get(path);
      const body = JSON.stringify(r.json);
      for (const [name, empId] of outside) {
        assert.ok(!body.includes(name), `${path} revela ${name}`);
        assert.ok(!body.includes(empId), `${path} revela o id de ${name}`);
      }
      // O próprio supervisor só pode aparecer como avaliador/referência, nunca como linha de dados.
      const rows = [...(r.json?.rows ?? []), ...(r.json?.assessments ?? []), ...(r.json?.employees ?? [])];
      assert.ok(rows.every((row: { employeeId?: string; id?: string }) => (row.employeeId ?? row.id) !== id.sa), `${path} traz o próprio supervisor como linha`);
    }
    const trainings = (await get("/trainings")).json.trainings as { title: string; participants: { employeeId: string }[]; hasParticipantsOutsideScope: boolean }[];
    assert.deepEqual(trainings.map((t) => t.title).sort(), ["Turma A", "Turma mista"]);
    const mixed = trainings.find((t) => t.title === "Turma mista")!;
    assert.deepEqual(mixed.participants.map((p) => p.employeeId), [id.a2]);
    assert.equal(mixed.hasParticipantsOutsideScope, true);
  });
});
