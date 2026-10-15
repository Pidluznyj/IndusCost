/**
 * Importação assistida de níveis por planilha — I/O (XLSX + Prisma).
 *
 * Sem estado entre prévia e aplicação: a aplicação reenvia o arquivo e as resoluções; o
 * servidor refaz o plano DENTRO da transação e só grava se a impressão digital for a mesma da
 * prévia (senão 409 PREVIEW_STALE). Nada fica em memória do processo.
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  assertWritable,
  writeGovernedLevel,
  CompetencyServiceError,
  loadActiveCompetencies,
  type CompetencyActor,
  type CompetencyDb,
} from "./competency.server";
import {
  COMPETENCY_LEVEL_DESCRIPTIONS,
  COMPETENCY_LEVEL_LABELS,
  type CompetencyLevel,
} from "./competencyDomain";
import {
  buildImportPlan,
  IMPORT_HEADER_EMPLOYEE,
  IMPORT_HEADER_ID,
  IMPORT_HEADER_POSITION,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  importFingerprintSource,
  type ImportContext,
  type ImportResolutions,
} from "./competencyImport";
import { canSeeEmployee, canWriteEmployee, type CompetencyScope } from "./competencyScope";
import { approvalReason } from "./competencyGovernance";
import type { CompetencyImportApplyResult, CompetencyImportPreviewDto } from "./competencyTypes";

const ACTIVE = "ACTIVE";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** XLSX = arquivo ZIP (assinatura "PK\x03\x04"). Outros formatos são recusados. */
export function isXlsxBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/** Primeira aba como matriz de células (linha 0 = cabeçalho). */
export function readImportSheet(buffer: Buffer): unknown[][] {
  if (!isXlsxBuffer(buffer)) {
    throw new CompetencyServiceError("INVALID_FILE", "Envie uma planilha .xlsx (Excel).", 400);
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", sheetRows: IMPORT_MAX_ROWS + 20, cellFormula: false, cellHTML: false });
  } catch {
    throw new CompetencyServiceError("INVALID_FILE", "Não foi possível ler a planilha.", 400);
  }
  const first = workbook.SheetNames[0];
  if (!first) throw new CompetencyServiceError("INVALID_FILE", "A planilha não tem abas.", 400);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[first], { header: 1, raw: true, defval: "", blankrows: false });
  return rows.map((r) => (Array.isArray(r) ? r.slice(0, IMPORT_MAX_COLUMNS) : []));
}

/** Catálogo ativo + colaboradores ATIVOS visíveis no escopo + níveis gravados deles. */
export async function loadImportContext(db: CompetencyDb, scope: CompetencyScope): Promise<ImportContext & { critical: Set<string> }> {
  const [competencies, employeeRows] = await Promise.all([
    loadActiveCompetencies(db),
    db.employee.findMany({ where: { status: ACTIVE } }) as Promise<{ id: string; name: string }[]>,
  ]);
  const employees = employeeRows
    .filter((e) => canSeeEmployee(scope, e.id))
    .map((e) => ({ id: e.id, name: e.name, writable: canWriteEmployee(scope, e.id) }));
  const ids = employees.map((e) => e.id);
  const levels = ids.length
    ? ((await db.hrEmployeeCompetencyLevel.findMany({ where: { employeeId: { in: ids } } })) as {
        employeeId: string;
        competencyId: string;
        level: number;
        source: string;
      }[])
    : [];
  return {
    critical: new Set(competencies.filter((c) => c.critical === true).map((c) => c.id)),
    competencies: competencies.map((c) => ({ id: c.id, name: c.name })),
    employees,
    levels: levels.map((l) => ({ employeeId: l.employeeId, competencyId: l.competencyId, level: l.level, source: l.source })),
  };
}

function fingerprintOf(ctx: ImportContext, plan: ReturnType<typeof buildImportPlan>, fileSha: string): string {
  return sha256Hex(importFingerprintSource(ctx, plan, fileSha));
}

export async function previewCompetencyImport(
  db: CompetencyDb,
  input: { buffer: Buffer; fileName: string; resolutions: ImportResolutions },
  scope: CompetencyScope,
  opts: { actorCanApprove?: boolean } = { actorCanApprove: true },
): Promise<CompetencyImportPreviewDto> {
  const sheet = readImportSheet(input.buffer);
  const fileSha256 = sha256Hex(input.buffer);
  const ctx = await loadImportContext(db, scope);
  const plan = buildImportPlan(sheet, ctx, input.resolutions);
  const previous = ((await db.hrCompetencyImportBatch.findMany({ where: { fileSha256 } })) as {
    createdAt: Date;
    changedCount: number;
  }[]).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    fileName: input.fileName,
    fileSha256,
    fingerprint: fingerprintOf(ctx, plan, fileSha256),
    plan,
    competencies: ctx.competencies,
    /** Candidatos para associar linhas não encontradas: só quem o usuário pode alterar. */
    assignable: ctx.employees.filter((e) => e.writable).map((e) => ({ id: e.id, name: e.name })),
    alreadyImported: previous ? { at: previous.createdAt.toISOString(), changedCount: previous.changedCount } : null,
    requiresApproval: opts.actorCanApprove
      ? []
      : plan.changes
          .filter((c) => approvalReason({ source: "IMPORT", from: c.from, to: c.to, critical: ctx.critical.has(c.competencyId) }))
          .map((c) => `${c.employeeId}:${c.competencyId}`),
  };
}

export async function applyCompetencyImport(
  db: CompetencyDb,
  input: { buffer: Buffer; fileName: string; resolutions: ImportResolutions; fingerprint: string },
  scope: CompetencyScope,
  actor: CompetencyActor,
  now: Date,
  opts: { actorCanApprove?: boolean } = { actorCanApprove: true },
): Promise<CompetencyImportApplyResult> {
  const sheet = readImportSheet(input.buffer);
  const fileSha256 = sha256Hex(input.buffer);
  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    // Estado relido dentro da transação: o que foi pré-visualizado é exatamente o que se grava.
    const ctx = await loadImportContext(t, scope);
    const plan = buildImportPlan(sheet, ctx, input.resolutions);
    if (plan.fatal) throw new CompetencyServiceError("INVALID_SHEET", plan.fatal, 400);
    if (fingerprintOf(ctx, plan, fileSha256) !== input.fingerprint) {
      throw new CompetencyServiceError(
        "PREVIEW_STALE",
        "Os níveis mudaram desde a prévia. Gere a prévia de novo antes de aplicar.",
        409,
      );
    }
    assertWritable(scope, plan.changes.map((c) => c.employeeId));
    if (plan.changes.length === 0) {
      return { batchId: null, changed: 0, requested: 0, conflictsApplied: 0, summary: plan.summary };
    }
    const batch = (await t.hrCompetencyImportBatch.create({
      data: {
        fileName: input.fileName.slice(0, 200),
        fileSha256,
        rowCount: plan.summary.rows,
        changedCount: plan.changes.length,
        conflictAppliedCount: plan.summary.conflictsToApply,
        summary: plan.summary,
        createdByUserId: actor.userId,
      },
    })) as { id: string };
    let changed = 0;
    let requested = 0;
    for (const change of plan.changes) {
      const r = await writeGovernedLevel(t, {
        employeeId: change.employeeId,
        competencyId: change.competencyId,
        level: change.to,
        critical: ctx.critical.has(change.competencyId),
        source: "IMPORT",
        actorCanApprove: opts.actorCanApprove === true,
        actorUserId: actor.userId,
        at: now,
        importBatchId: batch.id,
      });
      if (r.outcome === "APPLIED") changed += 1;
      else if (!r.reused) requested += 1;
    }
    // Reimportação com tudo já pendente: nenhum efeito → sem lote.
    if (changed === 0 && requested === 0) {
      await t.hrCompetencyImportBatch.deleteMany({ where: { id: batch.id } });
      return { batchId: null, changed: 0, requested: 0, conflictsApplied: 0, summary: plan.summary };
    }
    await t.hrCompetencyImportBatch.updateMany({ where: { id: batch.id }, data: { changedCount: changed } });
    return {
      batchId: batch.id,
      changed,
      requested,
      conflictsApplied: plan.summary.conflictsToApply,
      summary: plan.summary,
    };
  });
}

/**
 * Modelo: colaboradores que o usuário pode alterar (alocados ou não) com os níveis GRAVADOS.
 * Nível 0 sai em branco — reimportar o modelo sem editar não altera nada (idempotente).
 */
export async function buildCompetencyImportTemplate(db: CompetencyDb, scope: CompetencyScope): Promise<Buffer> {
  const ctx = await loadImportContext(db, scope);
  const writable = ctx.employees.filter((e) => e.writable).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const assignments = writable.length
    ? ((await db.hrEmployeeWorkPosition.findMany({ where: { employeeId: { in: writable.map((e) => e.id) }, endedAt: null } })) as {
        employeeId: string;
        positionId: string;
      }[])
    : [];
  const positionIds = [...new Set(assignments.map((a) => a.positionId))];
  const positions = positionIds.length
    ? ((await db.hrWorkPosition.findMany({ where: { id: { in: positionIds } } })) as { id: string; name: string }[])
    : [];
  const positionName = new Map(positions.map((p) => [p.id, p.name]));
  const positionOf = new Map(assignments.map((a) => [a.employeeId, positionName.get(a.positionId) ?? ""]));
  const level = new Map(ctx.levels.map((l) => [`${l.employeeId}:${l.competencyId}`, l.level]));
  const header = [IMPORT_HEADER_ID, IMPORT_HEADER_EMPLOYEE, IMPORT_HEADER_POSITION, ...ctx.competencies.map((c) => c.name)];
  const rows = writable.map((e) => [
    e.id,
    e.name,
    positionOf.get(e.id) ?? "",
    ...ctx.competencies.map((c) => {
      const v = level.get(`${e.id}:${c.id}`) ?? 0;
      return v > 0 ? v : "";
    }),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [{ wch: 38 }, { wch: 28 }, { wch: 22 }, ...ctx.competencies.map(() => ({ wch: 18 }))];
  const help = XLSX.utils.aoa_to_sheet([
    ["Como preencher"],
    ["Uma linha por colaborador; uma coluna por competência (o nome da coluna deve ser o da competência)."],
    ["Célula em branco não altera o nível atual. Para registrar 'Não avaliado', digite 0."],
    ["Valores aceitos: 0 a 4 ou o nome do nível. A coluna ID identifica o colaborador; sem ela, o nome é usado."],
    ["Rebaixar um nível ou alterar um nível vindo de avaliação formal exige confirmação na prévia."],
    [],
    ["Nível", "Nome", "Descrição"],
    ...([0, 1, 2, 3, 4] as CompetencyLevel[]).map((n) => [n, COMPETENCY_LEVEL_LABELS[n], COMPETENCY_LEVEL_DESCRIPTIONS[n]]),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Níveis");
  XLSX.utils.book_append_sheet(workbook, help, "Instruções");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
