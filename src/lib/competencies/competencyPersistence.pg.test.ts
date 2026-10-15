/**
 * Persistência real em PostgreSQL DESCARTÁVEL (opt-in). Fora de `unit-test-files.txt`.
 *
 * Só roda com COMPETENCY_PG_TEST_URL apontando para um banco LOCAL e vazio que já recebeu o schema
 * base + a migration `20261008120000_hr_competencies` (ex.: PGlite em memória via pglite-socket).
 * Recusa qualquer host que não seja 127.0.0.1/localhost. Sem a variável, os testes são ignorados.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  archiveCompetency,
  createAssessment,
  createCompetency,
  createTraining,
  createWorkPosition,
  decideLevelRequest,
  getCompetencyMatrix,
  getCompetencyOverview,
  listAssessments,
  listTrainings,
  setEmployeeCompetencyLevel,
  setTrainingStatus,
  setWorkPositionTeam,
  updateWorkPosition,
  type CompetencyDb,
} from "./competency.server";
import { buildCompetencyScope } from "./competencyScope";
import { applyCompetencyImport, previewCompetencyImport } from "./competencyImport.server";
import { loadDescendantEmployeeIds } from "../peopleProfileHierarchy.server";

const URL = process.env.COMPETENCY_PG_TEST_URL ?? "";
const host = (() => {
  try {
    return new globalThis.URL(URL).hostname;
  } catch {
    return "";
  }
})();
const enabled = URL !== "" && (host === "127.0.0.1" || host === "localhost");
const NOW = new Date("2026-10-15T15:00:00.000Z");
const actor = { userId: null };

describe("Competências — persistência em PostgreSQL local", { skip: !enabled && "COMPETENCY_PG_TEST_URL local ausente" }, () => {
  let prisma: PrismaClient;
  let db: CompetencyDb;
  const ids: Record<string, string> = {};

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    db = prisma as unknown as CompetencyDb;
    const role = await prisma.role.create({ data: { name: "Operador", baseSalary: 3000 } });
    const mk = (name: string, status = "ACTIVE") =>
      prisma.employee.create({
        data: { name, roleId: role.id, department: "Usinagem", costCenter: "CC", classification: "DIRETO", salary: 3000, monthlyHours: 220, status },
      });
    ids.ana = (await mk("Ana Ribeiro")).id;
    ids.edu = (await mk("Eduardo Lima")).id;
    ids.marcos = (await mk("Marcos Teixeira")).id;
    ids.inativo = (await mk("Inativo", "INACTIVE")).id;
    const dir = await prisma.hrDirectorate.create({ data: { name: "Industrial", leaderEmployeeId: ids.marcos } });
    ids.dep = (await prisma.hrDepartment.create({ data: { name: "Usinagem", directorateId: dir.id, leaderEmployeeId: ids.marcos } })).id;
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  it("cria catálogo, posto e equipe; nome único entre ativas (app e índice parcial)", async () => {
    ids.desenho = (await createCompetency(db, { name: "Leitura de desenho", category: "TECHNICAL", description: null, requiresRecycling: false, critical: false }, actor)).id;
    ids.nr12 = (await createCompetency(db, { name: "NR-12", category: "SAFETY", description: null, requiresRecycling: true, critical: false }, actor)).id;
    await assert.rejects(createCompetency(db, { name: "nr-12", category: "SAFETY", description: null, requiresRecycling: false, critical: false }, actor), /Já existe/);
    // O índice parcial também barra no banco (corrida que passasse pela checagem da aplicação).
    await assert.rejects(
      prisma.hrCompetency.create({ data: { name: "NR-12", category: "SAFETY" } }),
      (e: { code?: string }) => e.code === "P2002",
    );
    const pos = await createWorkPosition(
      db,
      { name: "Torno CNC 01", departmentId: ids.dep, shiftPattern: "TWO_SHIFTS", requirements: [{ competencyId: ids.desenho, minLevel: 3 }, { competencyId: ids.nr12, minLevel: 3 }] },
      actor,
    );
    ids.pos = pos.id;
    const team = await setWorkPositionTeam(db, ids.pos, [ids.ana, ids.edu], actor, NOW);
    assert.deepEqual(team.added.sort(), [ids.ana, ids.edu].sort());
    await assert.rejects(setWorkPositionTeam(db, ids.pos, [ids.inativo], actor, NOW), /inativo/);
  });

  it("CHECKs e índice parcial de alocação ativa valem no banco", async () => {
    await assert.rejects(prisma.hrWorkPositionRequirement.create({ data: { positionId: ids.pos, competencyId: ids.desenho, minLevel: 5 } }));
    await assert.rejects(prisma.hrEmployeeCompetencyLevel.create({ data: { employeeId: ids.marcos, competencyId: ids.desenho, level: 9, source: "MANUAL", assessedAt: NOW } }));
    await assert.rejects(
      prisma.hrEmployeeWorkPosition.create({ data: { employeeId: ids.ana, positionId: ids.pos } }),
      (e: { code?: string }) => e.code === "P2002",
    );
  });

  it("avaliação concluída grava itens, níveis, histórico e substitui a pendente (transação real)", async () => {
    await createAssessment(db, { employeeId: ids.ana, evaluatorEmployeeId: ids.marcos, assessmentDate: "2026-10-20", status: "PENDING", notes: null, items: [] }, actor, NOW);
    const res = await createAssessment(
      db,
      { employeeId: ids.ana, evaluatorEmployeeId: ids.marcos, assessmentDate: "2026-10-15", status: "COMPLETED", notes: "ok", items: [{ competencyId: ids.desenho, level: 3 }, { competencyId: ids.nr12, level: 2 }] },
      actor,
      NOW,
    );
    assert.ok(res.replacedPendingId);
    const list = await listAssessments(db);
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].status, list[0].averageLabel, list[0].assessmentDate], ["COMPLETED", "2,5", "2026-10-15"]);
    assert.equal(await prisma.hrEmployeeCompetencyLevelHistory.count({ where: { employeeId: ids.ana } }), 2);
    const ov = await getCompetencyOverview(db, "2026-10-15");
    assert.deepEqual([ov.coverage.met, ov.coverage.total, ov.openGaps, ov.pendingAssessments], [1, 4, 3, 0]);
  });

  it("falha no meio da transação não deixa escrita parcial", async () => {
    await createAssessment(
      db,
      { employeeId: ids.edu, evaluatorEmployeeId: ids.marcos, assessmentDate: "2026-10-15", status: "COMPLETED", notes: null, items: [{ competencyId: ids.desenho, level: 3 }, { competencyId: ids.nr12, level: 3 }] },
      actor,
      NOW,
    );
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.hrEmployeeCompetencyLevel.updateMany({ where: { employeeId: ids.edu }, data: { level: 1 } });
        // viola o único (colaborador, competência) → aborta a transação inteira
        await tx.hrEmployeeCompetencyLevel.create({ data: { employeeId: ids.edu, competencyId: ids.desenho, level: 2, source: "MANUAL", assessedAt: NOW } });
      }),
      (e: { code?: string }) => e.code === "P2002",
    );
    const levels = await prisma.hrEmployeeCompetencyLevel.findMany({ where: { employeeId: ids.edu } });
    assert.equal(levels.length, 2);
    assert.ok(levels.every((l) => l.level === 3), "rollback devolveu os níveis");
  });

  it("nível manual + reciclagem vencida aparecem na matriz", async () => {
    await setEmployeeCompetencyLevel(db, { employeeId: ids.ana, competencyId: ids.nr12, level: 3 }, actor, NOW);
    const t = await createTraining(
      db,
      { title: "NR-12 2024", competencyId: ids.nr12, modality: "IN_PERSON", workloadHours: 8, startDate: "2024-08-01", validityMonths: 24, participantIds: [ids.ana] },
      actor,
    );
    await setTrainingStatus(db, t.id, { status: "COMPLETED", completedOn: "2024-08-01" }, actor, NOW);
    const m = await getCompetencyMatrix(db, "2026-10-15");
    const cell = m.rows.find((r) => r.employeeId === ids.ana)!.cells.find((c) => c.competencyId === ids.nr12)!;
    assert.deepEqual([cell.storedLevel, cell.level, cell.recycling, cell.recyclingExpiresOn], [3, 1, "EXPIRED", "2026-08-01"]);
    const trainings = await listTrainings(db);
    assert.equal(trainings[0].participants[0].completedOn, "2024-08-01");
  });

  it("escopo de líder com a CTE recursiva real de descendentes", async () => {
    // Marcos lidera Ana; Eduardo fica fora da árvore dele.
    await prisma.employee.update({ where: { id: ids.ana }, data: { managerId: ids.marcos } });
    const teamIds = await loadDescendantEmployeeIds(prisma, ids.marcos);
    assert.deepEqual(teamIds, [ids.ana]);
    const scope = buildCompetencyScope({ accessScope: "DESCENDANTS", actorEmployeeId: ids.marcos, teamIds });
    const m = await getCompetencyMatrix(db, "2026-10-15", scope);
    assert.deepEqual(m.rows.map((r) => r.employeeName), ["Ana Ribeiro"]);
    await assert.rejects(
      setEmployeeCompetencyLevel(db, { employeeId: ids.edu, competencyId: ids.desenho, level: 1 }, actor, NOW, scope),
      /fora da sua equipe/,
    );
  });

  it("importação por planilha: lote + histórico com FK, idempotência e prévia desatualizada", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Colaborador", "Leitura de desenho"], ["Eduardo Lima", 4]]), "Níveis");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const scope = buildCompetencyScope({ accessScope: "ALL", actorEmployeeId: null });
    // O nível atual do Eduardo veio de avaliação → conflito; o RH decide aplicar.
    const up = { conflictDecisions: { [`${ids.edu}:${ids.desenho}`]: "APPLY" as const } };
    const preview = await previewCompetencyImport(db, { buffer, fileName: "n.xlsx", resolutions: up }, scope);
    assert.equal(preview.plan.summary.changes, 1);
    const applied = await applyCompetencyImport(db, { buffer, fileName: "n.xlsx", resolutions: up, fingerprint: preview.fingerprint }, scope, actor, NOW);
    assert.equal(applied.changed, 1);
    const batch = await prisma.hrCompetencyImportBatch.findUniqueOrThrow({ where: { id: applied.batchId! } });
    assert.equal((batch.summary as { changes: number }).changes, 1);
    const hist = await prisma.hrEmployeeCompetencyLevelHistory.findMany({ where: { importBatchId: batch.id } });
    assert.deepEqual(hist.map((h) => [h.source, h.newLevel]), [["IMPORT", 4]]);
    // Reaplicar: nenhuma alteração e nenhum lote novo.
    const again = await previewCompetencyImport(db, { buffer, fileName: "n.xlsx", resolutions: up }, scope);
    assert.ok(again.alreadyImported);
    const noop = await applyCompetencyImport(db, { buffer, fileName: "n.xlsx", resolutions: up, fingerprint: again.fingerprint }, scope, actor, NOW);
    assert.deepEqual([noop.batchId, noop.changed], [null, 0]);
    // Prévia desatualizada: o nível muda entre a prévia e a aplicação → 409, nada gravado.
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["Colaborador", "Leitura de desenho"], ["Eduardo Lima", 2]]), "Níveis");
    const down = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const resolutions = { conflictDecisions: { [`${ids.edu}:${ids.desenho}`]: "APPLY" as const } };
    const stale = await previewCompetencyImport(db, { buffer: down, fileName: "d.xlsx", resolutions }, scope);
    await setEmployeeCompetencyLevel(db, { employeeId: ids.edu, competencyId: ids.desenho, level: 3 }, actor, NOW);
    const batches = await prisma.hrCompetencyImportBatch.count();
    await assert.rejects(
      applyCompetencyImport(db, { buffer: down, fileName: "d.xlsx", resolutions, fingerprint: stale.fingerprint }, scope, actor, NOW),
      /mudaram desde a prévia/,
    );
    assert.equal(await prisma.hrCompetencyImportBatch.count(), batches);
  });

  it("governança: versão condicional, solicitação única pendente e aprovação aplicada", async () => {
    const v = (await prisma.hrEmployeeCompetencyLevel.findFirstOrThrow({ where: { employeeId: ids.edu, competencyId: ids.desenho } })).version;
    // Duas gravações sobre a mesma versão: a segunda é recusada.
    await setEmployeeCompetencyLevel(db, { employeeId: ids.edu, competencyId: ids.desenho, level: 2, expectedVersion: v }, actor, NOW);
    await assert.rejects(
      setEmployeeCompetencyLevel(db, { employeeId: ids.edu, competencyId: ids.desenho, level: 1, expectedVersion: v }, actor, NOW),
      /alterado por outra pessoa/,
    );
    // Sem permissão de aprovar: subir para 4 vira solicitação; matriz inalterada.
    const requester = { userId: "00000000-0000-4000-8000-0000000000aa" };
    const req = await setEmployeeCompetencyLevel(
      db,
      { employeeId: ids.edu, competencyId: ids.desenho, level: 4 },
      requester,
      NOW,
      buildCompetencyScope({ accessScope: "ALL", actorEmployeeId: null }),
      { actorCanApprove: false },
    );
    assert.equal(req.outcome, "REQUESTED");
    assert.equal((await prisma.hrEmployeeCompetencyLevel.findFirstOrThrow({ where: { employeeId: ids.edu, competencyId: ids.desenho } })).level, 2);
    // Índice parcial: só uma pendente por colaborador + competência.
    await assert.rejects(
      prisma.hrCompetencyLevelRequest.create({
        data: { employeeId: ids.edu, competencyId: ids.desenho, fromLevel: 2, toLevel: 3, baseVersion: 0, source: "MANUAL", reason: "GOVERNED_LEVEL" },
      }),
      (e: { code?: string }) => e.code === "P2002",
    );
    const approver = { userId: "00000000-0000-4000-8000-0000000000bb" };
    const decided = await decideLevelRequest(db, (req as { requestId: string }).requestId, { decision: "APPROVE", note: null }, approver, NOW);
    assert.deepEqual([decided.status, decided.level], ["APPROVED", 4]);
    const lvl = await prisma.hrEmployeeCompetencyLevel.findFirstOrThrow({ where: { employeeId: ids.edu, competencyId: ids.desenho } });
    assert.equal(lvl.level, 4);
    const hist = await prisma.hrEmployeeCompetencyLevelHistory.findMany({ where: { requestId: (req as { requestId: string }).requestId } });
    assert.deepEqual(hist.map((h) => [h.newLevel, h.actorUserId]), [[4, approver.userId]]);
    await assert.rejects(
      decideLevelRequest(db, (req as { requestId: string }).requestId, { decision: "APPROVE", note: null }, approver, NOW),
      /já foi decidida/,
    );
  });

  it("arquivar competência remove a coluna; editar posto troca requisitos", async () => {
    await updateWorkPosition(db, ids.pos, { name: "Torno CNC 01", departmentId: ids.dep, shiftPattern: "ONE_SHIFT", requirements: [{ competencyId: ids.desenho, minLevel: 2 }] }, actor);
    await archiveCompetency(db, ids.nr12, actor);
    const m = await getCompetencyMatrix(db, "2026-10-15");
    assert.deepEqual(m.competencies.map((c) => c.name), ["Leitura de desenho"]);
    const ov = await getCompetencyOverview(db, "2026-10-15");
    assert.equal(ov.coverage.total, 2);
  });
});
