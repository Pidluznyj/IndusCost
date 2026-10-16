/**
 * Importação assistida por planilha — rotas reais + XLSX real (biblioteca \`xlsx\`) + banco simulado.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as XLSX from "xlsx";
import { requestJson, seedEmployee, startCompetencyTestApp, type CompetencyTestApp } from "./competencyTestSupport";

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Níveis");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function upload(
  app: CompetencyTestApp,
  path: string,
  file: Buffer | null,
  fields: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const form = new FormData();
  if (file) form.append("file", new Blob([file]), "niveis.xlsx");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${app.baseUrl}${path}`, { method: "POST", body: form });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe("competencyImport — rotas", () => {
  let app: CompetencyTestApp;
  const id: Record<string, string> = {};

  before(async () => {
    app = await startCompetencyTestApp();
    const db = app.db;
    id.g = seedEmployee(db, "Gestor");
    id.ana = seedEmployee(db, "Ana Ribeiro", { managerId: id.g });
    id.jose1 = seedEmployee(db, "José Silva", { managerId: id.g });
    id.jose2 = seedEmployee(db, "José Silva", { managerId: id.g });
    id.x = seedEmployee(db, "Xavier");
    id.desenho = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "Leitura de desenho", category: "TECHNICAL" })).json.id;
    id.nr12 = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "NR-12", category: "SAFETY" })).json.id;
    id.pos = (
      await requestJson(app, "POST", "/api/hr/competencies/positions", {
        name: "Torno",
        shiftPattern: "ONE_SHIFT",
        requirements: [{ competencyId: id.desenho, minLevel: 3 }, { competencyId: id.nr12, minLevel: 2 }],
      })
    ).json.id;
    await requestJson(app, "PUT", `/api/hr/competencies/positions/${id.pos}/team`, { employeeIds: [id.ana, id.x] });
    await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 3 });
    // NR-12 da Ana vem de avaliação formal (2).
    await requestJson(app, "POST", "/api/hr/competencies/assessments", {
      employeeId: id.ana,
      evaluatorEmployeeId: id.g,
      assessmentDate: "2026-10-10",
      items: [{ competencyId: id.desenho, level: 3 }, { competencyId: id.nr12, level: 2 }],
    });
  });
  after(() => app.close());

  it("modelo: XLSX com ID, Colaborador, Posto, competências e níveis gravados (0 em branco)", async () => {
    const res = await fetch(`${app.baseUrl}/api/hr/competencies/import/template`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    assert.deepEqual(wb.SheetNames, ["Níveis", "Instruções"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Níveis"], { header: 1, defval: "" });
    assert.deepEqual(rows[0], ["ID", "Colaborador", "Posto", "Leitura de desenho", "NR-12"]);
    const ana = rows.find((r) => r[1] === "Ana Ribeiro")!;
    assert.deepEqual(ana, [id.ana, "Ana Ribeiro", "Torno", 3, 2]);
    const gestor = rows.find((r) => r[1] === "Gestor")!;
    assert.deepEqual(gestor.slice(3), ["", ""], "nível 0 sai em branco");
  });

  it("reimportar o modelo sem editar: zero alterações e nenhum lote (idempotente)", async () => {
    const template = Buffer.from(await (await fetch(`${app.baseUrl}/api/hr/competencies/import/template`)).arrayBuffer());
    const preview = await upload(app, "/api/hr/competencies/import/preview", template);
    assert.equal(preview.status, 200);
    assert.deepEqual([preview.json.plan.summary.changes, preview.json.plan.summary.conflicts], [0, 0]);
    const writes = app.db.writes.length;
    const apply = await upload(app, "/api/hr/competencies/import/apply", template, { fingerprint: preview.json.fingerprint });
    assert.deepEqual([apply.status, apply.json.batchId, apply.json.changed], [200, null, 0]);
    assert.equal(app.db.writes.length, writes, "nada gravado");
  });

  const sheet = () =>
    xlsx([
      ["Colaborador", "leitura de desenho", "nr-12", "Solda"],
      ["Ana Ribeiro", 4, 1, 3], // dois conflitos (níveis vindos de avaliação; um é rebaixamento) + coluna desconhecida
      ["José Silva", 2, "", ""], // homônimo → ambíguo
      ["Fulano de Tal", 2, 2, ""], // não encontrado
      ["Gestor", "", "ótimo", ""], // célula inválida
    ]);

  it("prévia: conciliação, vazios, inválidos, conflitos e coluna desconhecida — sem gravar", async () => {
    const writes = app.db.writes.length;
    const r = await upload(app, "/api/hr/competencies/import/preview", sheet());
    assert.equal(r.status, 200);
    const { plan } = r.json;
    assert.deepEqual(plan.rows.map((x: any) => x.status), ["MATCHED", "AMBIGUOUS", "NOT_FOUND", "MATCHED"]);
    assert.equal(plan.rows[1].candidates.length, 2);
    assert.deepEqual(plan.rows[0].cells.map((c: any) => [c.kind, c.conflictReason]), [["CONFLICT", "ASSESSED"], ["CONFLICT", "DOWNGRADE"]]);
    assert.deepEqual(
      [plan.summary.changes, plan.summary.conflicts, plan.summary.invalid, plan.summary.empty, plan.summary.pendingRows, plan.summary.unknownColumns],
      [0, 2, 1, 1, 2, 1],
    );
    assert.equal(r.json.alreadyImported, null);
    assert.equal(app.db.writes.length, writes, "prévia não grava");
  });

  it("aplicar com resoluções: grava em lote, com histórico IMPORT; reaplicar não muda nada", async () => {
    const file = sheet();
    const resolutions = JSON.stringify({
      employeeChoices: { "3": id.jose1, "4": id.jose2 },
      conflictDecisions: { [`${id.ana}:${id.desenho}`]: "APPLY", [`${id.ana}:${id.nr12}`]: "APPLY" },
    });
    const preview = await upload(app, "/api/hr/competencies/import/preview", file, { resolutions });
    assert.deepEqual(preview.json.plan.rows.map((x: any) => x.status), ["MATCHED", "MATCHED", "MATCHED", "MATCHED"]);
    assert.equal(preview.json.plan.summary.changes, 5);
    const apply = await upload(app, "/api/hr/competencies/import/apply", file, { resolutions, fingerprint: preview.json.fingerprint });
    assert.equal(apply.status, 200, JSON.stringify(apply.json));
    assert.deepEqual([apply.json.changed, apply.json.conflictsApplied], [5, 2]);
    const batch = app.db.tables.hrCompetencyImportBatch.find((b) => b.id === apply.json.batchId)!;
    assert.deepEqual([batch.changedCount, batch.rowCount], [5, 4]);
    const hist = app.db.tables.hrEmployeeCompetencyLevelHistory.filter((h) => h.importBatchId === batch.id);
    assert.equal(hist.length, 5);
    assert.ok(hist.every((h) => h.source === "IMPORT"));
    const level = (e: string, c: string) => app.db.tables.hrEmployeeCompetencyLevel.find((l) => l.employeeId === e && l.competencyId === c);
    assert.deepEqual([level(id.ana, id.desenho)!.level, level(id.ana, id.nr12)!.level, level(id.ana, id.nr12)!.source], [4, 1, "IMPORT"]);
    // Mesma planilha de novo: já importada, nada a alterar, nenhum lote novo.
    const again = await upload(app, "/api/hr/competencies/import/preview", file, { resolutions });
    assert.ok(again.json.alreadyImported);
    assert.equal(again.json.plan.summary.changes, 0);
    const reapply = await upload(app, "/api/hr/competencies/import/apply", file, { resolutions, fingerprint: again.json.fingerprint });
    assert.deepEqual([reapply.json.batchId, reapply.json.changed], [null, 0]);
    assert.equal(app.db.tables.hrCompetencyImportBatch.length, 1);
  });

  it("prévia desatualizada: nível mudou entre prévia e aplicação → 409 e nada gravado", async () => {
    const file = xlsx([["Colaborador", "Leitura de desenho"], ["Ana Ribeiro", 2]]);
    const resolutions = JSON.stringify({ conflictDecisions: { [`${id.ana}:${id.desenho}`]: "APPLY" } });
    const preview = await upload(app, "/api/hr/competencies/import/preview", file, { resolutions });
    assert.equal(preview.json.plan.summary.changes, 1);
    await requestJson(app, "PUT", `/api/hr/competencies/levels/${id.ana}/${id.desenho}`, { level: 3 });
    const batches = app.db.tables.hrCompetencyImportBatch.length;
    const apply = await upload(app, "/api/hr/competencies/import/apply", file, { resolutions, fingerprint: preview.json.fingerprint });
    assert.deepEqual([apply.status, apply.json.error], [409, "PREVIEW_STALE"]);
    assert.equal(app.db.tables.hrCompetencyImportBatch.length, batches);
  });

  it("líder: modelo e prévia só com a equipe; outra equipe vira 'não encontrado'", async () => {
    app.setScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: id.g });
    try {
      const wb = XLSX.read(Buffer.from(await (await fetch(`${app.baseUrl}/api/hr/competencies/import/template`)).arrayBuffer()), { type: "buffer" });
      const names = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Níveis"], { header: 1 }).slice(1).map((r) => r[1]).sort();
      assert.deepEqual(names, ["Ana Ribeiro", "José Silva", "José Silva"]);
      const file = xlsx([["Colaborador", "Leitura de desenho"], ["Xavier", 4], ["Gestor", 4], ["Ana Ribeiro", 4]]);
      const preview = await upload(app, "/api/hr/competencies/import/preview", file);
      // O próprio líder (Gestor) não está no escopo: "não encontrado", sem confirmar que existe.
      assert.deepEqual(preview.json.plan.rows.map((r: any) => r.status), ["NOT_FOUND", "NOT_FOUND", "MATCHED"]);
      assert.ok(!preview.json.assignable.some((e: any) => e.id === id.x || e.id === id.g));
      // Tentar associar a linha do Xavier ao próprio Xavier não funciona (não é visível).
      const forced = await upload(app, "/api/hr/competencies/import/preview", file, {
        resolutions: JSON.stringify({ employeeChoices: { "2": id.x } }),
      });
      assert.equal(forced.json.plan.rows[0].status, "NOT_FOUND");
    } finally {
      app.setScope({ accessScope: "ALL", actorEmployeeId: null });
    }
  });

  it("arquivo e campos inválidos", async () => {
    assert.equal((await upload(app, "/api/hr/competencies/import/preview", null)).json.error, "FILE_REQUIRED");
    const csv = await upload(app, "/api/hr/competencies/import/preview", Buffer.from("Colaborador;NR-12\nAna;3"));
    assert.deepEqual([csv.status, csv.json.error], [400, "INVALID_FILE"]);
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 1);
    big.write("PK\u0003\u0004", 0, "latin1");
    assert.equal((await upload(app, "/api/hr/competencies/import/preview", big)).status, 413);
    const bad = await upload(app, "/api/hr/competencies/import/preview", xlsx([["Colaborador"]]), { resolutions: "{nao json" });
    assert.equal(bad.json.error, "INVALID_RESOLUTIONS");
    const noFp = await upload(app, "/api/hr/competencies/import/apply", xlsx([["Colaborador", "NR-12"], ["Ana Ribeiro", 3]]));
    assert.equal(noFp.json.error, "FINGERPRINT_REQUIRED");
    const fatal = await upload(app, "/api/hr/competencies/import/preview", xlsx([["Nome completo", "NR-12"], ["Ana", 3]]));
    assert.match(fatal.json.plan.fatal, /Colaborador/);
  });

  it("sem permissão de editar a matriz → 403", async () => {
    const viewer = await startCompetencyTestApp({ granted: ["admin.employees.competencies:view"] });
    try {
      assert.equal((await upload(viewer, "/api/hr/competencies/import/preview", xlsx([["Colaborador"]]))).status, 403);
      assert.equal((await fetch(`${viewer.baseUrl}/api/hr/competencies/import/template`)).status, 403);
    } finally {
      await viewer.close();
    }
  });
});
