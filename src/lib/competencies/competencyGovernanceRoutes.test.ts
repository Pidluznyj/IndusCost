/**
 * Governança de níveis nas rotas reais: aprovação (nível 3–4 e competência crítica),
 * histórico, autoaprovação proibida, concorrência otimista e importação governada.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as XLSX from "xlsx";
import { requestJson, seedEmployee, startCompetencyTestApp, TEST_USER_ID, type CompetencyTestApp } from "./competencyTestSupport";

const LEADER_GRANTS = [
  "admin.employees.competencies:view",
  "admin.employees.competencies:update",
  "admin.employees.competencies:manage",
  "admin.employees.competencies.assessments:view",
  "admin.employees.competencies.assessments:create",
  "admin.employees.competencies.approvals:view",
];
const APPROVER_ID = "00000000-0000-4000-8000-0000000000bb";

describe("competencyGovernance — rotas", () => {
  let app: CompetencyTestApp;
  const id: Record<string, string> = {};
  const level = (comp: string) =>
    app.db.tables.hrEmployeeCompetencyLevel.find((l) => l.employeeId === id.ana && l.competencyId === comp);
  const requests = () => app.db.tables.hrCompetencyLevelRequest;
  const cell = async (comp: string) => {
    const m = (await requestJson(app, "GET", "/api/hr/competencies/matrix")).json;
    return m.rows.find((r: any) => r.employeeId === id.ana).cells.find((c: any) => c.competencyId === comp);
  };
  const asLeader = () => {
    app.setGranted(LEADER_GRANTS);
    app.setUser(TEST_USER_ID);
  };
  const asApprover = () => {
    app.setGranted("all");
    app.setUser(APPROVER_ID);
  };

  before(async () => {
    app = await startCompetencyTestApp();
    id.ana = seedEmployee(app.db, "Ana Ribeiro");
    id.desenho = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Leitura de desenho", category: "TECHNICAL" })).json.id;
    id.nr12 = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "NR-12", category: "SAFETY", critical: true })).json.id;
    id.pos = (
      await requestJson(app, "POST", "/api/hr/competencies/positions", {
        name: "Torno",
        shiftPattern: "ONE_SHIFT",
        requirements: [{ competencyId: id.desenho, minLevel: 3 }, { competencyId: id.nr12, minLevel: 2 }],
      })
    ).json.id;
    await requestJson(app, "PUT", `/api/hr/competencies/positions/${id.pos}/team`, { employeeIds: [id.ana] });
    asLeader();
  });
  after(() => app.close());

  it("catálogo guarda a flag de competência crítica e a engine conta lacunas críticas", async () => {
    const cat = (await requestJson(app, "GET", "/api/hr/competencies/catalog")).json.competencies;
    assert.deepEqual(cat.map((c: any) => [c.name, c.critical]), [["Leitura de desenho", false], ["NR-12", true]]);
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.deepEqual([ov.openGaps, ov.criticalGaps], [2, 1]);
  });

  it("até nível 2 em competência comum grava direto", async () => {
    const r = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 2, expectedVersion: 0 });
    assert.deepEqual([r.status, r.json.outcome, r.json.version], [200, "APPLIED", 1]);
  });

  it("subir para 3 sem permissão de aprovar vira solicitação; a matriz não muda", async () => {
    const r = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 3, expectedVersion: 1 });
    assert.deepEqual([r.status, r.json.outcome, r.json.reason], [202, "REQUESTED", "GOVERNED_LEVEL"]);
    assert.equal(level(id.desenho)!.level, 2);
    const c = await cell(id.desenho);
    assert.deepEqual([c.level, c.version, c.pending?.toLevel], [2, 1, 3]);
    const ov = (await requestJson(app, "GET", "/api/hr/competencies/overview")).json;
    assert.equal(ov.pendingApprovals, 1);
    // Mesmo pedido de novo não duplica.
    await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 3, expectedVersion: 1 });
    assert.equal(requests().filter((q) => q.status === "PENDING").length, 1);
  });

  it("competência crítica: qualquer subida exige aprovação", async () => {
    const r = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.nr12}`, { level: 1, expectedVersion: 0 });
    assert.deepEqual([r.status, r.json.reason], [202, "CRITICAL_COMPETENCY"]);
    assert.equal(level(id.nr12), undefined);
  });

  it("quem pediu não decide a própria solicitação", async () => {
    const reqId = requests().find((q) => q.competencyId === id.desenho && q.status === "PENDING")!.id;
    app.setGranted("all"); // mesmo usuário, agora com permissão de aprovar
    const r = await requestJson(app, "POST", `/api/hr/competencies/approvals/${reqId}/decision`, { decision: "APPROVE" });
    assert.deepEqual([r.status, r.json.error], [403, "SELF_DECISION"]);
    asLeader();
  });

  it("sem permissão de aprovar → 403 na decisão; vê a lista pendente", async () => {
    const reqId = requests().find((q) => q.competencyId === id.desenho && q.status === "PENDING")!.id;
    assert.equal((await requestJson(app, "POST", `/api/hr/competencies/approvals/${reqId}/decision`, { decision: "APPROVE" })).status, 403);
    const list = (await requestJson(app, "GET", "/api/hr/competencies/approvals")).json.requests;
    assert.deepEqual(list.map((q: any) => [q.competencyName, q.fromLevel, q.toLevel, q.critical]).sort(), [
      ["Leitura de desenho", 2, 3, false],
      ["NR-12", 0, 1, true],
    ]);
  });

  it("aprovador aprova: nível aplicado com histórico ligado à solicitação; segunda decisão → 409", async () => {
    asApprover();
    const reqId = requests().find((q) => q.competencyId === id.desenho && q.status === "PENDING")!.id;
    const r = await requestJson(app, "POST", `/api/hr/competencies/approvals/${reqId}/decision`, { decision: "APPROVE" });
    assert.deepEqual([r.status, r.json.status, r.json.level], [200, "APPROVED", 3]);
    assert.deepEqual([level(id.desenho)!.level, level(id.desenho)!.version], [3, 2]);
    const hist = app.db.tables.hrEmployeeCompetencyLevelHistory.filter((h) => h.requestId === reqId);
    assert.deepEqual(hist.map((h) => [h.previousLevel, h.newLevel, h.actorUserId]), [[2, 3, APPROVER_ID]]);
    const again = await requestJson(app, "POST", `/api/hr/competencies/approvals/${reqId}/decision`, { decision: "APPROVE" });
    assert.deepEqual([again.status, again.json.error], [409, "REQUEST_DECIDED"]);
  });

  it("rejeitar exige justificativa e não muda o nível", async () => {
    const reqId = requests().find((q) => q.competencyId === id.nr12 && q.status === "PENDING")!.id;
    const noNote = await requestJson(app, "POST", `/api/hr/competencies/approvals/${reqId}/decision`, { decision: "REJECT" });
    assert.deepEqual([noNote.status, noNote.json.error], [400, "NOTE_REQUIRED"]);
    const ok = await requestJson(app, "POST", `/api/hr/competencies/approvals/${reqId}/decision`, { decision: "REJECT", note: "Sem certificado NR-12" });
    assert.equal(ok.json.status, "REJECTED");
    assert.equal(level(id.nr12), undefined);
    const decided = (await requestJson(app, "GET", "/api/hr/competencies/approvals?status=DECIDED")).json.requests;
    assert.ok(decided.some((q: any) => q.id === reqId && q.decisionNote === "Sem certificado NR-12"));
  });

  it("concorrência: editar sobre versão antiga → 409 e nada gravado", async () => {
    const before = level(id.desenho)!.level;
    const stale = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 4, expectedVersion: 1 });
    assert.deepEqual([stale.status, stale.json.error], [409, "LEVEL_CHANGED"]);
    assert.equal(level(id.desenho)!.level, before);
  });

  it("aprovador grava direto (registrado) e rebaixar nunca exige aprovação", async () => {
    const up = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 4, expectedVersion: 2 });
    assert.deepEqual([up.status, up.json.outcome, up.json.version], [200, "APPLIED", 3]);
    asLeader();
    const down = await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 1, expectedVersion: 3 });
    assert.deepEqual([down.status, down.json.outcome], [200, "APPLIED"]);
  });

  it("mudança por outro caminho supera a solicitação pendente", async () => {
    await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 3 });
    const pending = requests().find((q) => q.competencyId === id.desenho && q.status === "PENDING")!;
    // Avaliação formal grava direto e supera a pendência do mesmo par.
    const av = await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: id.ana,
      evaluatorEmployeeId: id.ana,
      assessmentDate: "2026-10-15",
      items: [{ competencyId: id.desenho, level: 2 }, { competencyId: id.nr12, level: 2 }],
    });
    assert.equal(av.status, 201, JSON.stringify(av.json));
    assert.equal(requests().find((q) => q.id === pending.id)!.status, "SUPERSEDED");
    assert.equal(level(id.nr12)!.level, 2, "avaliação formal não passa por aprovação, nem em crítica");
  });

  it("importação sem permissão de aprovar: subidas governadas viram solicitações; reimportar não duplica", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Colaborador", "Leitura de desenho", "NR-12"], ["Ana Ribeiro", 4, ""]]), "Níveis");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const send = async (path: string, fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.append("file", new Blob([buffer]), "n.xlsx");
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const res = await fetch(`${app.baseUrl}${path}`, { method: "POST", body: form });
      return res.json();
    };
    // O nível atual veio de avaliação → conflito ASSESSED; decide aplicar.
    const resolutions = JSON.stringify({ conflictDecisions: { [`${id.ana}:${id.desenho}`]: "APPLY" } });
    const preview = await send("/api/hr/competencies/import/preview", { resolutions });
    assert.deepEqual(preview.requiresApproval, [`${id.ana}:${id.desenho}`]);
    const applied = await send("/api/hr/competencies/import/apply", { resolutions, fingerprint: preview.fingerprint });
    assert.deepEqual([applied.changed, applied.requested], [0, 1]);
    assert.equal(level(id.desenho)!.level, 2, "pendente não altera a matriz");
    const batch = app.db.tables.hrCompetencyImportBatch.find((b) => b.id === applied.batchId)!;
    assert.equal(requests().find((q) => q.importBatchId === batch.id)?.source, "IMPORT");
    const again = await send("/api/hr/competencies/import/preview", { resolutions });
    const reapplied = await send("/api/hr/competencies/import/apply", { resolutions, fingerprint: again.fingerprint });
    assert.deepEqual([reapplied.batchId, reapplied.requested], [null, 0]);
    assert.equal(requests().filter((q) => q.status === "PENDING" && q.competencyId === id.desenho).length, 1);
  });
});
