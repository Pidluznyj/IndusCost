/**
 * Competências e Desenvolvimento — I/O Prisma.
 *
 * Lê as tabelas planas e monta a entrada da engine oficial (`competencyEngine.ts`);
 * todo número exibido sai da engine. Consultas sem `include` (junção em memória):
 * o volume é o de um cadastro de RH e o formato mantém as rotas testáveis com banco simulado.
 *
 * População da matriz: colaboradores ATIVOS com alocação ativa num posto ATIVO.
 */

import type { PrismaClient } from "@prisma/client";
import {
  assessmentAverage,
  assessmentScope,
  buildCompetencyMatrix,
  buildCompetencyOverview,
  computeCoverage,
  evaluateRequirements,
  formatAssessmentAverage,
  isEmployeeReady,
  type CompetencyEngineInput,
  type TrainingCompletionRef,
} from "./competencyEngine";
import type {
  CompetencyAssessmentDto,
  CompetencyDto,
  EmployeeCompetencyProfileDto,
  CompetencyMatrixResponse,
  CompetencyOptionsResponse,
  CompetencyOverviewResponse,
  LevelRequestDto,
  TrainingDto,
  WorkPositionDto,
} from "./competencyTypes";
import type {
  AssessmentInput,
  CompetencyInput,
  TrainingInput,
  WorkPositionInput,
} from "./competencyValidation";
import { businessTodayIso, type CompetencyLevel, type TrainingStatus } from "./competencyDomain";
import { decideLevelWrite, validateDecision, type LevelChangeSource } from "./competencyGovernance";
import {
  COMPETENCY_SCOPE_ALL,
  canSeeEmployee,
  canWriteEmployee,
  competencyScopeView,
  outOfWriteScope,
  type CompetencyScope,
} from "./competencyScope";

/** Cliente Prisma ou transação. */
export type CompetencyDb = Pick<
  PrismaClient,
  | "employee"
  | "hrDepartment"
  | "hrCompetency"
  | "hrWorkPosition"
  | "hrWorkPositionRequirement"
  | "hrEmployeeWorkPosition"
  | "hrEmployeeCompetencyLevel"
  | "hrEmployeeCompetencyLevelHistory"
  | "hrCompetencyAssessment"
  | "hrCompetencyAssessmentItem"
  | "hrTraining"
  | "hrTrainingParticipant"
  | "hrCompetencyImportBatch"
  | "hrCompetencyLevelRequest"
> & {
  $transaction: PrismaClient["$transaction"];
};

export type CompetencyActor = { userId: string | null };

export class CompetencyServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CompetencyServiceError";
  }
}

const ACTIVE = "ACTIVE";
const INACTIVE = "INACTIVE";
export { businessTodayIso };

/** Data de negócio gravada como meia-noite UTC (lida de volta com `toIsoDate`). */
export function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isActiveEmployee(e: { status?: string | null; terminationDate?: Date | null }): boolean {
  return (e.status ?? ACTIVE) === ACTIVE;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");

export function notFound(what: string): never {
  throw new CompetencyServiceError("NOT_FOUND", `${what} não encontrado(a).`, 404);
}

/** Escrita só nos colaboradores do escopo (liderados); RH (ALL) escreve em todos. */
export function assertWritable(scope: CompetencyScope, employeeIds: readonly string[]) {
  if (outOfWriteScope(scope, employeeIds).length > 0) {
    throw new CompetencyServiceError("OUT_OF_SCOPE", "Colaborador fora da sua equipe.", 403);
  }
}

// ---------------------------------------------------------------------------
// Leitura base
// ---------------------------------------------------------------------------

type CompetencyRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  requiresRecycling: boolean;
  critical?: boolean;
  status: string;
  sortOrder: number;
};

export async function loadActiveCompetencies(db: CompetencyDb): Promise<CompetencyRow[]> {
  const rows = (await db.hrCompetency.findMany({ where: { status: ACTIVE } })) as CompetencyRow[];
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b));
}

type PositionBundle = {
  positions: { id: string; name: string; departmentId: string | null; shiftPattern: string }[];
  requirements: { positionId: string; competencyId: string; minLevel: number }[];
  departments: Map<string, string>;
  assignments: { employeeId: string; positionId: string }[];
  employees: Map<string, { id: string; name: string; departmentId: string | null }>;
};

async function loadPositionBundle(db: CompetencyDb, scope: CompetencyScope): Promise<PositionBundle> {
  const positions = (
    (await db.hrWorkPosition.findMany({ where: { status: ACTIVE } })) as PositionBundle["positions"]
  ).sort(byName);
  const positionIds = positions.map((p) => p.id);
  const [requirements, assignmentsRaw, departmentRows] = await Promise.all([
    positionIds.length
      ? (db.hrWorkPositionRequirement.findMany({ where: { positionId: { in: positionIds } } }) as Promise<
          PositionBundle["requirements"]
        >)
      : Promise.resolve([]),
    positionIds.length
      ? (db.hrEmployeeWorkPosition.findMany({
          where: { positionId: { in: positionIds }, endedAt: null },
        }) as Promise<{ employeeId: string; positionId: string }[]>)
      : Promise.resolve([]),
    (() => {
      const ids = [...new Set(positions.map((p) => p.departmentId).filter((x): x is string => !!x))];
      return ids.length
        ? (db.hrDepartment.findMany({ where: { id: { in: ids } } }) as Promise<{ id: string; name: string }[]>)
        : Promise.resolve([] as { id: string; name: string }[]);
    })(),
  ]);
  const employeeIds = [...new Set(assignmentsRaw.map((a) => a.employeeId))];
  const employeeRows = employeeIds.length
    ? ((await db.employee.findMany({ where: { id: { in: employeeIds } } })) as {
        id: string;
        name: string;
        status: string | null;
        departmentId: string | null;
      }[])
    : [];
  const employees = new Map(
    employeeRows
      .filter((e) => isActiveEmployee(e) && canSeeEmployee(scope, e.id))
      .map((e) => [e.id, { id: e.id, name: e.name, departmentId: e.departmentId }]),
  );
  return {
    positions,
    requirements,
    departments: new Map(departmentRows.map((d) => [d.id, d.name])),
    assignments: assignmentsRaw.filter((a) => employees.has(a.employeeId)),
    employees,
  };
}

/** Entrada da engine a partir do banco, restrita aos colaboradores visíveis no escopo. */
export async function loadCompetencyEngineInput(
  db: CompetencyDb,
  asOf: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
  /** Colaboradores visíveis a incluir mesmo sem posto ativo (ex.: ficha individual, inclusive inativo). */
  includeEmployeeIds: readonly string[] = [],
): Promise<CompetencyEngineInput> {
  const [competencies, bundle] = await Promise.all([loadActiveCompetencies(db), loadPositionBundle(db, scope)]);
  const positionByEmployee = new Map(bundle.assignments.map((a) => [a.employeeId, a.positionId]));
  const extraIds = includeEmployeeIds.filter((id) => !bundle.employees.has(id) && canSeeEmployee(scope, id));
  const extras = extraIds.length
    ? ((await db.employee.findMany({ where: { id: { in: extraIds } } })) as { id: string; name: string }[])
    : [];
  const employees = [
    ...[...bundle.employees.values()].map((e) => ({ id: e.id, name: e.name, positionId: positionByEmployee.get(e.id) ?? null })),
    ...extras.map((e) => ({ id: e.id, name: e.name, positionId: null })),
  ].sort(byName);
  const employeeIds = employees.map((e) => e.id);
  const levels = employeeIds.length
    ? ((await db.hrEmployeeCompetencyLevel.findMany({ where: { employeeId: { in: employeeIds } } })) as {
        employeeId: string;
        competencyId: string;
        level: number;
      }[])
    : [];
  const recyclingIds = competencies.filter((c) => c.requiresRecycling).map((c) => c.id);
  let trainingCompletions: TrainingCompletionRef[] = [];
  if (recyclingIds.length && employeeIds.length) {
    const trainings = (await db.hrTraining.findMany({
      where: { competencyId: { in: recyclingIds }, status: "COMPLETED" },
    })) as { id: string; competencyId: string; validityMonths: number; completedAt: Date | null; startDate: Date }[];
    const byId = new Map(trainings.map((t) => [t.id, t]));
    const participants = trainings.length
      ? ((await db.hrTrainingParticipant.findMany({
          where: { trainingId: { in: trainings.map((t) => t.id) }, employeeId: { in: employeeIds } },
        })) as { trainingId: string; employeeId: string; completedAt: Date | null }[])
      : [];
    trainingCompletions = participants.flatMap((p) => {
      const t = byId.get(p.trainingId);
      const completedOn = toIsoDate(p.completedAt ?? t?.completedAt ?? t?.startDate);
      return t && completedOn
        ? [{ employeeId: p.employeeId, competencyId: t.competencyId, completedOn, validityMonths: t.validityMonths }]
        : [];
    });
  }
  return {
    competencies: competencies.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      requiresRecycling: c.requiresRecycling,
      critical: c.critical === true,
    })),
    positions: bundle.positions.map((p) => ({
      id: p.id,
      name: p.name,
      departmentName: p.departmentId ? bundle.departments.get(p.departmentId) ?? null : null,
      shiftPattern: p.shiftPattern,
      requirements: bundle.requirements
        .filter((r) => r.positionId === p.id)
        .map((r) => ({ competencyId: r.competencyId, minLevel: r.minLevel })),
    })),
    employees,
    levels,
    trainingCompletions,
    asOf,
  };
}

/** Treinamentos visíveis: RH vê todos; líder vê os que têm ao menos um participante do escopo. */
async function visibleTrainingIds(db: CompetencyDb, scope: CompetencyScope, trainingIds: string[]): Promise<Set<string>> {
  if (scope.kind === "ALL") return new Set(trainingIds);
  if (trainingIds.length === 0 || scope.visible.size === 0) return new Set();
  const parts = (await db.hrTrainingParticipant.findMany({
    where: { trainingId: { in: trainingIds }, employeeId: { in: [...scope.visible] } },
  })) as { trainingId: string }[];
  return new Set(parts.map((p) => p.trainingId));
}

export async function getCompetencyOverview(
  db: CompetencyDb,
  asOf: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<CompetencyOverviewResponse> {
  const [input, assessments, trainings] = await Promise.all([
    loadCompetencyEngineInput(db, asOf, scope),
    db.hrCompetencyAssessment.findMany({ where: { status: { not: "COMPLETED" } } }) as Promise<
      { status: string; employeeId: string }[]
    >,
    db.hrTraining.findMany({ where: { status: { not: "COMPLETED" } } }) as Promise<{ id: string; status: string }[]>,
  ]);
  const seenTrainings = await visibleTrainingIds(db, scope, trainings.map((t) => t.id));
  const pendingRequests = ((await db.hrCompetencyLevelRequest.findMany({ where: { status: "PENDING" } })) as {
    employeeId: string;
  }[]).filter((r) => canSeeEmployee(scope, r.employeeId));
  const overview = buildCompetencyOverview(input, {
    assessmentStatuses: assessments.filter((a) => canSeeEmployee(scope, a.employeeId)).map((a) => a.status),
    trainingStatuses: trainings.filter((t) => seenTrainings.has(t.id)).map((t) => t.status),
  });
  return { ...overview, asOf, scope: competencyScopeView(scope), pendingApprovals: pendingRequests.length };
}

export async function getCompetencyMatrix(
  db: CompetencyDb,
  asOf: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<CompetencyMatrixResponse> {
  const input = await loadCompetencyEngineInput(db, asOf, scope);
  const matrix = buildCompetencyMatrix(input);
  const employeeIds = matrix.rows.map((r) => r.employeeId);
  const [levelRows, pendingRows] = employeeIds.length
    ? await Promise.all([
        db.hrEmployeeCompetencyLevel.findMany({ where: { employeeId: { in: employeeIds } } }) as Promise<
          { employeeId: string; competencyId: string; version: number }[]
        >,
        db.hrCompetencyLevelRequest.findMany({ where: { employeeId: { in: employeeIds }, status: "PENDING" } }) as Promise<
          { id: string; employeeId: string; competencyId: string; toLevel: number }[]
        >,
      ])
    : [[], []];
  const versionOf = new Map(levelRows.map((l) => [`${l.employeeId}:${l.competencyId}`, l.version ?? 1]));
  const pendingOf = new Map(pendingRows.map((p) => [`${p.employeeId}:${p.competencyId}`, p]));
  return {
    ...matrix,
    rows: matrix.rows.map((r) => ({
      ...r,
      writable: canWriteEmployee(scope, r.employeeId),
      cells: r.cells.map((c) => {
        const key = `${r.employeeId}:${c.competencyId}`;
        const pending = pendingOf.get(key);
        return {
          ...c,
          version: versionOf.get(key) ?? 0,
          pending: pending ? { requestId: pending.id, toLevel: pending.toLevel } : null,
        };
      }),
    })),
    asOf,
  };
}

// ---------------------------------------------------------------------------
// Perfil individual (aba Competências da ficha do colaborador)
// ---------------------------------------------------------------------------

export const EMPLOYEE_COMPETENCY_HISTORY_LIMIT = 50;

/**
 * Competências de UM colaborador, para a ficha funcional. Mesma fonte do módulo: engine
 * oficial sobre as mesmas tabelas — nada é copiado para a ficha. Fora do escopo → 404.
 */
export async function getEmployeeCompetencyProfile(
  db: CompetencyDb,
  employeeId: string,
  asOf: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<EmployeeCompetencyProfileDto> {
  if (!canSeeEmployee(scope, employeeId)) notFound("Colaborador");
  const employee = (await db.employee.findUnique({ where: { id: employeeId } })) as { id: string; name: string } | null;
  if (!employee) notFound("Colaborador");
  const input = await loadCompetencyEngineInput(db, asOf, scope, [employeeId]);
  const row = buildCompetencyMatrix(input).rows.find((r) => r.employeeId === employeeId)!;
  const evaluations = evaluateRequirements(input).filter((e) => e.employeeId === employeeId);
  const position = row.positionId ? input.positions.find((p) => p.id === row.positionId) ?? null : null;
  const competencyById = new Map(input.competencies.map((c) => [c.id, c]));
  const history = ((await db.hrEmployeeCompetencyLevelHistory.findMany({ where: { employeeId } })) as {
    id: string;
    competencyId: string;
    previousLevel: number;
    newLevel: number;
    source: string;
    assessmentId: string | null;
    createdAt: Date;
  }[])
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, EMPLOYEE_COMPETENCY_HISTORY_LIMIT);
  const allCompetencies = history.length
    ? ((await db.hrCompetency.findMany({ where: { id: { in: [...new Set(history.map((h) => h.competencyId))] } } })) as {
        id: string;
        name: string;
      }[])
    : [];
  const historyNames = new Map(allCompetencies.map((c) => [c.id, c.name]));
  const required = new Set(evaluations.map((e) => e.competencyId));
  return {
    asOf,
    employeeId,
    employeeName: employee.name,
    writable: canWriteEmployee(scope, employeeId),
    position: position
      ? { id: position.id, name: position.name, departmentName: position.departmentName, shiftPattern: position.shiftPattern }
      : null,
    coverage: computeCoverage(evaluations),
    ready: evaluations.length > 0 && isEmployeeReady(evaluations, employeeId),
    requirements: evaluations.map((e) => {
      const cell = row.cells.find((c) => c.competencyId === e.competencyId)!;
      return {
        competencyId: e.competencyId,
        competencyName: e.competencyName,
        category: competencyById.get(e.competencyId)?.category ?? "",
        critical: e.critical,
        requiredLevel: e.requiredLevel,
        currentLevel: e.currentLevel,
        storedLevel: cell.storedLevel,
        met: e.met,
        gap: e.gap,
        recycling: cell.recycling,
        recyclingExpiresOn: cell.recyclingExpiresOn,
      };
    }),
    otherLevels: row.cells
      .filter((c) => !required.has(c.competencyId) && c.storedLevel > 0)
      .map((c) => ({
        competencyId: c.competencyId,
        competencyName: competencyById.get(c.competencyId)?.name ?? "—",
        category: competencyById.get(c.competencyId)?.category ?? "",
        currentLevel: c.level,
        storedLevel: c.storedLevel,
        recycling: c.recycling,
        recyclingExpiresOn: c.recyclingExpiresOn,
      })),
    history: history.map((h) => ({
      id: h.id,
      competencyId: h.competencyId,
      competencyName: historyNames.get(h.competencyId) ?? "—",
      previousLevel: h.previousLevel,
      newLevel: h.newLevel,
      source: h.source,
      assessmentId: h.assessmentId,
      at: h.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

function competencyDto(c: CompetencyRow): CompetencyDto {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    requiresRecycling: c.requiresRecycling,
    critical: c.critical === true,
  };
}

export async function listCompetencies(db: CompetencyDb): Promise<CompetencyDto[]> {
  return (await loadActiveCompetencies(db)).map(competencyDto);
}

async function assertUniqueCompetencyName(db: CompetencyDb, name: string, exceptId: string | null) {
  const clash = (await loadActiveCompetencies(db)).find(
    (c) => c.id !== exceptId && c.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
  );
  if (clash) throw new CompetencyServiceError("DUPLICATE_NAME", "Já existe uma competência ativa com esse nome.", 409);
}

export async function createCompetency(db: CompetencyDb, input: CompetencyInput, actor: CompetencyActor) {
  await assertUniqueCompetencyName(db, input.name, null);
  const all = (await db.hrCompetency.findMany({})) as CompetencyRow[];
  const sortOrder = all.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
  const row = (await db.hrCompetency.create({
    data: { ...input, sortOrder, status: ACTIVE, createdByUserId: actor.userId, updatedByUserId: actor.userId },
  })) as CompetencyRow;
  return competencyDto(row);
}

async function findActiveCompetency(db: CompetencyDb, id: string): Promise<CompetencyRow> {
  const row = (await db.hrCompetency.findUnique({ where: { id } })) as CompetencyRow | null;
  if (!row || row.status !== ACTIVE) notFound("Competência");
  return row;
}

export async function updateCompetency(db: CompetencyDb, id: string, input: CompetencyInput, actor: CompetencyActor) {
  await findActiveCompetency(db, id);
  await assertUniqueCompetencyName(db, input.name, id);
  const row = (await db.hrCompetency.update({
    where: { id },
    data: { ...input, updatedByUserId: actor.userId },
  })) as CompetencyRow;
  return competencyDto(row);
}

/** Arquiva (status INACTIVE): sai da matriz e dos requisitos; histórico preservado. */
export async function archiveCompetency(db: CompetencyDb, id: string, actor: CompetencyActor) {
  await findActiveCompetency(db, id);
  await db.hrCompetency.update({ where: { id }, data: { status: INACTIVE, updatedByUserId: actor.userId } });
}

// ---------------------------------------------------------------------------
// Postos
// ---------------------------------------------------------------------------

export async function listWorkPositions(
  db: CompetencyDb,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<WorkPositionDto[]> {
  const bundle = await loadPositionBundle(db, scope);
  return bundle.positions.map((p) => ({
    id: p.id,
    name: p.name,
    departmentId: p.departmentId,
    departmentName: p.departmentId ? bundle.departments.get(p.departmentId) ?? null : null,
    shiftPattern: p.shiftPattern,
    requirements: bundle.requirements
      .filter((r) => r.positionId === p.id)
      .map((r) => ({ competencyId: r.competencyId, minLevel: r.minLevel })),
    team: bundle.assignments
      .filter((a) => a.positionId === p.id)
      .map((a) => ({ employeeId: a.employeeId, employeeName: bundle.employees.get(a.employeeId)!.name }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR")),
  }));
}

async function assertPositionRefs(db: CompetencyDb, input: WorkPositionInput) {
  if (input.departmentId) {
    const dep = (await db.hrDepartment.findUnique({ where: { id: input.departmentId } })) as { status: string } | null;
    if (!dep || dep.status !== ACTIVE) throw new CompetencyServiceError("INVALID_DEPARTMENT", "Setor não encontrado.", 400);
  }
  const active = new Set((await loadActiveCompetencies(db)).map((c) => c.id));
  if (input.requirements.some((r) => !active.has(r.competencyId))) {
    throw new CompetencyServiceError("INVALID_REQUIREMENTS", "Requisito com competência inexistente ou arquivada.", 400);
  }
}

async function findActivePosition(db: CompetencyDb, id: string) {
  const row = (await db.hrWorkPosition.findUnique({ where: { id } })) as { id: string; status: string } | null;
  if (!row || row.status !== ACTIVE) notFound("Posto");
  return row;
}

export async function createWorkPosition(db: CompetencyDb, input: WorkPositionInput, actor: CompetencyActor) {
  await assertPositionRefs(db, input);
  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const row = (await t.hrWorkPosition.create({
      data: {
        name: input.name,
        departmentId: input.departmentId,
        shiftPattern: input.shiftPattern,
        status: ACTIVE,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    })) as { id: string };
    for (const r of input.requirements) {
      await t.hrWorkPositionRequirement.create({ data: { positionId: row.id, ...r } });
    }
    return { id: row.id };
  });
}

export async function updateWorkPosition(db: CompetencyDb, id: string, input: WorkPositionInput, actor: CompetencyActor) {
  await findActivePosition(db, id);
  await assertPositionRefs(db, input);
  await db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    await t.hrWorkPosition.update({
      where: { id },
      data: {
        name: input.name,
        departmentId: input.departmentId,
        shiftPattern: input.shiftPattern,
        updatedByUserId: actor.userId,
      },
    });
    await t.hrWorkPositionRequirement.deleteMany({ where: { positionId: id } });
    for (const r of input.requirements) {
      await t.hrWorkPositionRequirement.create({ data: { positionId: id, ...r } });
    }
  });
  return { id };
}

async function loadActiveEmployees(db: CompetencyDb, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string }>();
  const rows = (await db.employee.findMany({ where: { id: { in: ids } } })) as {
    id: string;
    name: string;
    status: string | null;
  }[];
  return new Map(rows.filter(isActiveEmployee).map((e) => [e.id, { id: e.id, name: e.name }]));
}

/**
 * Define a equipe do posto: encerra alocações de quem saiu e aloca quem entrou
 * (encerrando a alocação anterior do colaborador em outro posto). Histórico preservado.
 *
 * Escopo de líder: só aloca ou retira liderados; membros fora da visão dele (outras equipes)
 * não aparecem na lista enviada e são PRESERVADOS — nunca retirados implicitamente.
 */
export async function setWorkPositionTeam(
  db: CompetencyDb,
  positionId: string,
  employeeIds: string[],
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<{ added: string[]; removed: string[] }> {
  await findActivePosition(db, positionId);
  const employees = await loadActiveEmployees(db, employeeIds);
  if (employees.size !== employeeIds.length) {
    throw new CompetencyServiceError("INVALID_EMPLOYEES", "Colaborador inexistente ou inativo.", 400);
  }
  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const current = (await t.hrEmployeeWorkPosition.findMany({
      where: { positionId, endedAt: null },
    })) as { id: string; employeeId: string }[];
    const keep = new Set(employeeIds);
    // Fora da visão do ator: preservado (o líder nem sabe que está no posto).
    const removed = current.filter((a) => !keep.has(a.employeeId) && canSeeEmployee(scope, a.employeeId));
    const already = new Set(current.map((a) => a.employeeId));
    const added = employeeIds.filter((id) => !already.has(id));
    assertWritable(scope, [...added, ...removed.map((a) => a.employeeId)]);
    for (const a of removed) {
      await t.hrEmployeeWorkPosition.update({ where: { id: a.id }, data: { endedAt: now } });
    }
    if (added.length) {
      await t.hrEmployeeWorkPosition.updateMany({
        where: { employeeId: { in: added }, endedAt: null },
        data: { endedAt: now },
      });
      for (const employeeId of added) {
        await t.hrEmployeeWorkPosition.create({
          data: { employeeId, positionId, startedAt: now, createdByUserId: actor.userId },
        });
      }
    }
    return { added, removed: removed.map((a) => a.employeeId) };
  });
}

export async function archiveWorkPosition(
  db: CompetencyDb,
  id: string,
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
) {
  await findActivePosition(db, id);
  await db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    // Arquivar encerra TODAS as alocações: o ator precisa poder escrever em todos os membros.
    const members = (await t.hrEmployeeWorkPosition.findMany({ where: { positionId: id, endedAt: null } })) as {
      employeeId: string;
    }[];
    assertWritable(scope, members.map((m) => m.employeeId));
    await t.hrWorkPosition.update({ where: { id }, data: { status: INACTIVE, updatedByUserId: actor.userId } });
    await t.hrEmployeeWorkPosition.updateMany({ where: { positionId: id, endedAt: null }, data: { endedAt: now } });
  });
}

export async function getCompetencyOptions(
  db: CompetencyDb,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<CompetencyOptionsResponse> {
  const [employees, departments, assignments] = await Promise.all([
    db.employee.findMany({ where: { status: ACTIVE } }) as Promise<
      { id: string; name: string; status: string | null; departmentId: string | null }[]
    >,
    db.hrDepartment.findMany({ where: { status: ACTIVE } }) as Promise<{ id: string; name: string }[]>,
    db.hrEmployeeWorkPosition.findMany({ where: { endedAt: null } }) as Promise<
      { employeeId: string; positionId: string }[]
    >,
  ]);
  const depName = new Map(departments.map((d) => [d.id, d.name]));
  const positionOf = new Map(assignments.map((a) => [a.employeeId, a.positionId]));
  return {
    employees: employees
      .filter((e) => isActiveEmployee(e) && canSeeEmployee(scope, e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        departmentName: e.departmentId ? depName.get(e.departmentId) ?? null : null,
        positionId: positionOf.get(e.id) ?? null,
        writable: canWriteEmployee(scope, e.id),
      }))
      .sort(byName),
    departments: departments.map((d) => ({ id: d.id, name: d.name })).sort(byName),
  };
}

// ---------------------------------------------------------------------------
// Níveis
// ---------------------------------------------------------------------------

export async function applyLevel(
  t: CompetencyDb,
  params: {
    employeeId: string;
    competencyId: string;
    level: CompetencyLevel | number;
    source: LevelChangeSource;
    assessmentId: string | null;
    importBatchId?: string | null;
    requestId?: string | null;
    actorUserId: string | null;
    at: Date;
    /** Concorrência otimista: versão lida pelo usuário (0 = sem nível gravado). */
    expectedVersion?: number | null;
  },
): Promise<{ previousLevel: number; changed: boolean; version: number }> {
  const existing = (await t.hrEmployeeCompetencyLevel.findFirst({
    where: { employeeId: params.employeeId, competencyId: params.competencyId },
  })) as { id: string; level: number; version?: number } | null;
  const previousLevel = existing?.level ?? 0;
  const currentVersion = existing ? existing.version ?? 1 : 0;
  if (params.expectedVersion != null && params.expectedVersion !== currentVersion) {
    throw new CompetencyServiceError("LEVEL_CHANGED", "Este nível foi alterado por outra pessoa. Recarregue e tente de novo.", 409);
  }
  if (existing) {
    // Atualização condicional na versão: duas gravações simultâneas → só uma passa.
    const { count } = await t.hrEmployeeCompetencyLevel.updateMany({
      where: { id: existing.id, version: currentVersion },
      data: {
        level: params.level,
        source: params.source,
        assessedAt: params.at,
        updatedByUserId: params.actorUserId,
        version: currentVersion + 1,
      },
    });
    if (count === 0) {
      throw new CompetencyServiceError("LEVEL_CHANGED", "Este nível foi alterado por outra pessoa. Recarregue e tente de novo.", 409);
    }
  } else {
    await t.hrEmployeeCompetencyLevel.create({
      data: {
        employeeId: params.employeeId,
        competencyId: params.competencyId,
        level: params.level,
        source: params.source,
        assessedAt: params.at,
        updatedByUserId: params.actorUserId,
        version: 1,
      },
    });
  }
  // Mudou por qualquer caminho → solicitação pendente para o mesmo par fica superada.
  await t.hrCompetencyLevelRequest.updateMany({
    where: {
      employeeId: params.employeeId,
      competencyId: params.competencyId,
      status: "PENDING",
      ...(params.requestId ? { id: { not: params.requestId } } : {}),
    },
    data: { status: "SUPERSEDED", decidedAt: params.at },
  });
  // Histórico append-only: registra toda gravação de avaliação e toda mudança manual.
  const changed = previousLevel !== params.level;
  if (changed || params.source === "ASSESSMENT") {
    await t.hrEmployeeCompetencyLevelHistory.create({
      data: {
        employeeId: params.employeeId,
        competencyId: params.competencyId,
        previousLevel,
        newLevel: params.level,
        source: params.source,
        assessmentId: params.assessmentId,
        importBatchId: params.importBatchId ?? null,
        requestId: params.requestId ?? null,
        actorUserId: params.actorUserId,
      },
    });
  }
  return { previousLevel, changed, version: currentVersion + 1 };
}

export type LevelWriteOutcome =
  | { outcome: "APPLIED"; previousLevel: number; changed: boolean; version: number; selfApproved: string | null }
  | { outcome: "REQUESTED"; previousLevel: number; requestId: string; reason: string; reused: boolean };

/**
 * Gravação governada (ajuste na matriz / importação): aplica direto ou cria solicitação pendente.
 * Solicitação idêntica já pendente é reaproveitada (reimportação não duplica).
 */
export async function writeGovernedLevel(
  t: CompetencyDb,
  params: {
    employeeId: string;
    competencyId: string;
    level: number;
    critical: boolean;
    source: "MANUAL" | "IMPORT";
    actorCanApprove: boolean;
    actorUserId: string | null;
    at: Date;
    expectedVersion?: number | null;
    importBatchId?: string | null;
  },
): Promise<LevelWriteOutcome> {
  const existing = (await t.hrEmployeeCompetencyLevel.findFirst({
    where: { employeeId: params.employeeId, competencyId: params.competencyId },
  })) as { level: number; version?: number } | null;
  const from = existing?.level ?? 0;
  const version = existing ? existing.version ?? 1 : 0;
  if (params.expectedVersion != null && params.expectedVersion !== version) {
    throw new CompetencyServiceError("LEVEL_CHANGED", "Este nível foi alterado por outra pessoa. Recarregue e tente de novo.", 409);
  }
  const decision = decideLevelWrite({
    source: params.source,
    from,
    to: params.level,
    critical: params.critical,
    actorCanApprove: params.actorCanApprove,
  });
  if (decision.kind === "APPLY") {
    const r = await applyLevel(t, {
      employeeId: params.employeeId,
      competencyId: params.competencyId,
      level: params.level,
      source: params.source,
      assessmentId: null,
      importBatchId: params.importBatchId ?? null,
      actorUserId: params.actorUserId,
      at: params.at,
      expectedVersion: params.expectedVersion ?? null,
    });
    return { outcome: "APPLIED", ...r, selfApproved: decision.selfApproved };
  }
  const open = (await t.hrCompetencyLevelRequest.findFirst({
    where: { employeeId: params.employeeId, competencyId: params.competencyId, status: "PENDING" },
  })) as { id: string; toLevel: number; baseVersion: number } | null;
  if (open && open.toLevel === params.level && open.baseVersion === version) {
    return { outcome: "REQUESTED", previousLevel: from, requestId: open.id, reason: decision.reason, reused: true };
  }
  if (open) {
    await t.hrCompetencyLevelRequest.updateMany({
      where: { id: open.id, status: "PENDING" },
      data: { status: "SUPERSEDED", decidedAt: params.at },
    });
  }
  const created = (await t.hrCompetencyLevelRequest.create({
    data: {
      employeeId: params.employeeId,
      competencyId: params.competencyId,
      fromLevel: from,
      toLevel: params.level,
      baseVersion: version,
      source: params.source,
      reason: decision.reason,
      importBatchId: params.importBatchId ?? null,
      status: "PENDING",
      requestedByUserId: params.actorUserId,
    },
  })) as { id: string };
  return { outcome: "REQUESTED", previousLevel: from, requestId: created.id, reason: decision.reason, reused: false };
}

/** Ajuste na matriz: governado (pode virar solicitação) e com concorrência otimista. */
export async function setEmployeeCompetencyLevel(
  db: CompetencyDb,
  params: { employeeId: string; competencyId: string; level: CompetencyLevel; expectedVersion?: number | null },
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
  opts: { actorCanApprove?: boolean } = { actorCanApprove: true },
): Promise<LevelWriteOutcome> {
  assertWritable(scope, [params.employeeId]);
  const employees = await loadActiveEmployees(db, [params.employeeId]);
  if (!employees.size) notFound("Colaborador");
  const competency = await findActiveCompetency(db, params.competencyId);
  return db.$transaction(async (tx) =>
    writeGovernedLevel(tx as unknown as CompetencyDb, {
      employeeId: params.employeeId,
      competencyId: params.competencyId,
      level: params.level,
      critical: competency.critical === true,
      source: "MANUAL",
      actorCanApprove: opts.actorCanApprove === true,
      actorUserId: actor.userId,
      at: now,
      expectedVersion: params.expectedVersion ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Aprovações (governança)
// ---------------------------------------------------------------------------

type LevelRequestRow = {
  id: string;
  employeeId: string;
  competencyId: string;
  fromLevel: number;
  toLevel: number;
  baseVersion: number;
  source: string;
  reason: string;
  status: string;
  requestedByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};

export async function listLevelRequests(
  db: CompetencyDb,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
  filter: { status?: "PENDING" | "DECIDED" } = {},
): Promise<LevelRequestDto[]> {
  const where = filter.status === "PENDING" ? { status: "PENDING" } : filter.status === "DECIDED" ? { status: { not: "PENDING" } } : {};
  const rows = ((await db.hrCompetencyLevelRequest.findMany({ where })) as LevelRequestRow[]).filter((r) =>
    canSeeEmployee(scope, r.employeeId),
  );
  const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
  const competencyIds = [...new Set(rows.map((r) => r.competencyId))];
  const [employees, competencies] = await Promise.all([
    employeeIds.length
      ? (db.employee.findMany({ where: { id: { in: employeeIds } } }) as Promise<{ id: string; name: string }[]>)
      : Promise.resolve([]),
    competencyIds.length
      ? (db.hrCompetency.findMany({ where: { id: { in: competencyIds } } }) as Promise<{ id: string; name: string; critical?: boolean }[]>)
      : Promise.resolve([]),
  ]);
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const comp = new Map(competencies.map((c) => [c.id, c]));
  return rows
    .map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empName.get(r.employeeId) ?? "—",
      competencyId: r.competencyId,
      competencyName: comp.get(r.competencyId)?.name ?? "—",
      critical: comp.get(r.competencyId)?.critical === true,
      fromLevel: r.fromLevel,
      toLevel: r.toLevel,
      source: r.source,
      reason: r.reason,
      status: r.status,
      requestedAt: r.createdAt.toISOString(),
      requestedByUserId: r.requestedByUserId,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
    }))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/** Aprovar aplica o nível (se ele não mudou desde a solicitação); rejeitar exige justificativa. */
export async function decideLevelRequest(
  db: CompetencyDb,
  id: string,
  input: { decision: "APPROVE" | "REJECT"; note: string | null },
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<{ id: string; status: string; level: number | null }> {
  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const request = (await t.hrCompetencyLevelRequest.findUnique({ where: { id } })) as LevelRequestRow | null;
    if (!request || !canSeeEmployee(scope, request.employeeId)) notFound("Solicitação");
    assertWritable(scope, [request.employeeId]);
    if (request.status !== "PENDING") {
      throw new CompetencyServiceError("REQUEST_DECIDED", "Esta solicitação já foi decidida.", 409);
    }
    const check = validateDecision({
      decision: input.decision,
      note: input.note,
      requestedByUserId: request.requestedByUserId,
      deciderUserId: actor.userId,
    });
    if (check.ok === false) throw new CompetencyServiceError(check.code, check.message, check.code === "SELF_DECISION" ? 403 : 400);
    const decided = { decidedByUserId: actor.userId, decidedAt: now, decisionNote: input.note?.trim() || null };
    if (input.decision === "REJECT") {
      const { count } = await t.hrCompetencyLevelRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { ...decided, status: "REJECTED" },
      });
      if (count === 0) throw new CompetencyServiceError("REQUEST_DECIDED", "Esta solicitação já foi decidida.", 409);
      return { id, status: "REJECTED", level: null };
    }
    const current = (await t.hrEmployeeCompetencyLevel.findFirst({
      where: { employeeId: request.employeeId, competencyId: request.competencyId },
    })) as { version?: number } | null;
    const currentVersion = current ? current.version ?? 1 : 0;
    if (currentVersion !== request.baseVersion) {
      await t.hrCompetencyLevelRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "SUPERSEDED", decidedAt: now } });
      throw new CompetencyServiceError("REQUEST_STALE", "O nível mudou desde a solicitação; ela foi marcada como superada.", 409);
    }
    // Trava a solicitação primeiro: duas aprovações simultâneas → só uma aplica.
    const { count } = await t.hrCompetencyLevelRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { ...decided, status: "APPROVED" },
    });
    if (count === 0) throw new CompetencyServiceError("REQUEST_DECIDED", "Esta solicitação já foi decidida.", 409);
    await applyLevel(t, {
      employeeId: request.employeeId,
      competencyId: request.competencyId,
      level: request.toLevel,
      source: request.source as LevelChangeSource,
      assessmentId: null,
      requestId: id,
      actorUserId: actor.userId,
      at: now,
      expectedVersion: request.baseVersion,
    });
    return { id, status: "APPROVED", level: request.toLevel };
  });
}

// ---------------------------------------------------------------------------
// Avaliações
// ---------------------------------------------------------------------------

type AssessmentRow = {
  id: string;
  employeeId: string;
  evaluatorEmployeeId: string | null;
  evaluatorNameSnapshot: string | null;
  positionId: string | null;
  positionNameSnapshot: string | null;
  assessmentDate: Date;
  status: string;
  notes: string | null;
  averageLevel: unknown;
  completedAt: Date | null;
};

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

export async function listAssessments(
  db: CompetencyDb,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
  filter: { employeeId?: string } = {},
): Promise<CompetencyAssessmentDto[]> {
  // Filtro por alguém fora da visão: vazio (não revela nada sobre essa pessoa).
  if (filter.employeeId && !canSeeEmployee(scope, filter.employeeId)) return [];
  const where = filter.employeeId ? { employeeId: filter.employeeId } : {};
  const rows = ((await db.hrCompetencyAssessment.findMany({ where })) as AssessmentRow[]).filter((r) =>
    canSeeEmployee(scope, r.employeeId),
  );
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? ((await db.hrCompetencyAssessmentItem.findMany({ where: { assessmentId: { in: ids } } })) as {
        assessmentId: string;
        competencyId: string;
        level: number;
        requiredLevel: number | null;
      }[])
    : [];
  const people = [...new Set(rows.flatMap((r) => [r.employeeId, r.evaluatorEmployeeId]).filter((x): x is string => !!x))];
  const employeeRows = people.length
    ? ((await db.employee.findMany({ where: { id: { in: people } } })) as { id: string; name: string }[])
    : [];
  const names = new Map(employeeRows.map((e) => [e.id, e.name]));
  return rows
    .map((r) => {
      const averageLevel = decimalToNumber(r.averageLevel);
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName: names.get(r.employeeId) ?? "—",
        positionName: r.positionNameSnapshot,
        evaluatorEmployeeId: r.evaluatorEmployeeId,
        evaluatorName: (r.evaluatorEmployeeId && names.get(r.evaluatorEmployeeId)) || r.evaluatorNameSnapshot,
        assessmentDate: toIsoDate(r.assessmentDate) ?? "",
        status: r.status,
        averageLevel,
        averageLabel: formatAssessmentAverage(averageLevel),
        notes: r.notes,
        items: items
          .filter((i) => i.assessmentId === r.id)
          .map((i) => ({ competencyId: i.competencyId, level: i.level, requiredLevel: i.requiredLevel })),
      };
    })
    .sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate) || a.employeeName.localeCompare(b.employeeName, "pt-BR"));
}

async function resolveAssessmentContext(db: CompetencyDb, input: AssessmentInput, asOf: string, scope: CompetencyScope) {
  // Líder: avalia só liderados; o avaliador é ele mesmo ou alguém da equipe dele.
  assertWritable(scope, [input.employeeId]);
  if (input.evaluatorEmployeeId && !canSeeEmployee(scope, input.evaluatorEmployeeId)) {
    throw new CompetencyServiceError("OUT_OF_SCOPE", "Avaliador fora da sua equipe.", 403);
  }
  const people = await loadActiveEmployees(
    db,
    [input.employeeId, input.evaluatorEmployeeId].filter((x): x is string => !!x),
  );
  if (!people.has(input.employeeId)) throw new CompetencyServiceError("INVALID_EMPLOYEE", "Colaborador inexistente ou inativo.", 400);
  if (input.evaluatorEmployeeId && !people.has(input.evaluatorEmployeeId)) {
    throw new CompetencyServiceError("INVALID_EVALUATOR", "Avaliador inexistente ou inativo.", 400);
  }
  const engineInput = await loadCompetencyEngineInput(db, asOf, scope);
  const employee = engineInput.employees.find((e) => e.id === input.employeeId);
  const position = employee?.positionId ? engineInput.positions.find((p) => p.id === employee.positionId) ?? null : null;
  return {
    engineInput,
    position,
    evaluatorName: input.evaluatorEmployeeId ? people.get(input.evaluatorEmployeeId)!.name : null,
  };
}

/** Itens da conclusão precisam cobrir exatamente as competências exigidas pelo posto. */
function completionItems(
  input: AssessmentInput,
  ctx: Awaited<ReturnType<typeof resolveAssessmentContext>>,
): { competencyId: string; level: number; requiredLevel: number }[] {
  if (!ctx.position) {
    throw new CompetencyServiceError("NO_POSITION", "Colaborador sem posto de trabalho: aloque-o antes de avaliar.", 409);
  }
  const scope = assessmentScope(ctx.engineInput, input.employeeId);
  const given = new Map(input.items.map((i) => [i.competencyId, i.level]));
  if (scope.length !== given.size || scope.some((s) => !given.has(s.competencyId))) {
    throw new CompetencyServiceError("ITEMS_MISMATCH", "Atribua um nível a cada competência exigida pelo posto.", 400);
  }
  return scope.map((s) => ({ competencyId: s.competencyId, level: given.get(s.competencyId)!, requiredLevel: s.requiredLevel }));
}

async function writeCompletion(
  t: CompetencyDb,
  assessmentId: string,
  input: AssessmentInput,
  items: { competencyId: string; level: number; requiredLevel: number }[],
  actor: CompetencyActor,
) {
  await t.hrCompetencyAssessmentItem.deleteMany({ where: { assessmentId } });
  for (const item of items) {
    await t.hrCompetencyAssessmentItem.create({ data: { assessmentId, ...item } });
  }
  const at = fromIsoDate(input.assessmentDate);
  for (const item of items) {
    await applyLevel(t, {
      employeeId: input.employeeId,
      competencyId: item.competencyId,
      level: item.level,
      source: "ASSESSMENT",
      assessmentId,
      actorUserId: actor.userId,
      at,
    });
  }
}

/**
 * Registra avaliação. Concluída: grava média (engine), itens e níveis atuais, e SUBSTITUI a
 * avaliação pendente/em andamento do colaborador (a mais recente vira a concluída; as demais
 * pendências dele são removidas). Pendente/em andamento: só agenda.
 */
export async function createAssessment(
  db: CompetencyDb,
  input: AssessmentInput,
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<{ id: string; replacedPendingId: string | null }> {
  const ctx = await resolveAssessmentContext(db, input, businessTodayIso(now), scope);
  const items = input.status === "COMPLETED" ? completionItems(input, ctx) : [];
  const average = input.status === "COMPLETED" ? assessmentAverage(items.map((i) => i.level)) : null;
  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const data = {
      employeeId: input.employeeId,
      evaluatorEmployeeId: input.evaluatorEmployeeId,
      evaluatorNameSnapshot: ctx.evaluatorName,
      positionId: ctx.position?.id ?? null,
      positionNameSnapshot: ctx.position?.name ?? null,
      assessmentDate: fromIsoDate(input.assessmentDate),
      status: input.status,
      notes: input.notes,
      averageLevel: average,
      completedAt: input.status === "COMPLETED" ? now : null,
      updatedByUserId: actor.userId,
    };
    let replacedPendingId: string | null = null;
    let id: string;
    if (input.status === "COMPLETED") {
      const open = ((await t.hrCompetencyAssessment.findMany({
        where: { employeeId: input.employeeId, status: { not: "COMPLETED" } },
      })) as AssessmentRow[]).sort((a, b) => b.assessmentDate.getTime() - a.assessmentDate.getTime());
      if (open.length) {
        replacedPendingId = open[0].id;
        // Condicional: outra conclusão simultânea da mesma pendência → só uma passa.
        const { count } = await t.hrCompetencyAssessment.updateMany({ where: { id: open[0].id, status: { not: "COMPLETED" } }, data });
        if (count === 0) throw new CompetencyServiceError("ASSESSMENT_LOCKED", "Avaliação já concluída por outra pessoa.", 409);
        id = open[0].id;
        if (open.length > 1) {
          await t.hrCompetencyAssessment.deleteMany({ where: { id: { in: open.slice(1).map((o) => o.id) } } });
        }
      } else {
        id = ((await t.hrCompetencyAssessment.create({ data: { ...data, createdByUserId: actor.userId } })) as { id: string }).id;
      }
      await writeCompletion(t, id, input, items, actor);
    } else {
      id = ((await t.hrCompetencyAssessment.create({ data: { ...data, createdByUserId: actor.userId } })) as { id: string }).id;
    }
    return { id, replacedPendingId };
  });
}

async function findOpenAssessment(db: CompetencyDb, id: string, scope: CompetencyScope): Promise<AssessmentRow> {
  const row = (await db.hrCompetencyAssessment.findUnique({ where: { id } })) as AssessmentRow | null;
  // Fora da visão: 404 (não confirma a existência); visível mas não gravável: 403.
  if (!row || !canSeeEmployee(scope, row.employeeId)) notFound("Avaliação");
  assertWritable(scope, [row.employeeId]);
  if (row.status === "COMPLETED") {
    throw new CompetencyServiceError("ASSESSMENT_LOCKED", "Avaliação concluída não pode ser alterada.", 409);
  }
  return row;
}

/** Atualiza uma avaliação pendente/em andamento (ou a conclui). Concluída é imutável. */
export async function updateAssessment(
  db: CompetencyDb,
  id: string,
  input: AssessmentInput,
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<{ id: string }> {
  const existing = await findOpenAssessment(db, id, scope);
  if (existing.employeeId !== input.employeeId) {
    throw new CompetencyServiceError("EMPLOYEE_MISMATCH", "Não é possível trocar o colaborador da avaliação.", 400);
  }
  const ctx = await resolveAssessmentContext(db, input, businessTodayIso(now), scope);
  const items = input.status === "COMPLETED" ? completionItems(input, ctx) : [];
  const average = input.status === "COMPLETED" ? assessmentAverage(items.map((i) => i.level)) : null;
  await db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const { count } = await t.hrCompetencyAssessment.updateMany({
      where: { id, status: { not: "COMPLETED" } },
      data: {
        evaluatorEmployeeId: input.evaluatorEmployeeId,
        evaluatorNameSnapshot: ctx.evaluatorName,
        positionId: ctx.position?.id ?? existing.positionId,
        positionNameSnapshot: ctx.position?.name ?? existing.positionNameSnapshot,
        assessmentDate: fromIsoDate(input.assessmentDate),
        status: input.status,
        notes: input.notes,
        averageLevel: average,
        completedAt: input.status === "COMPLETED" ? now : null,
        updatedByUserId: actor.userId,
      },
    });
    if (count === 0) throw new CompetencyServiceError("ASSESSMENT_LOCKED", "Avaliação já concluída por outra pessoa.", 409);
    if (input.status === "COMPLETED") await writeCompletion(t, id, input, items, actor);
  });
  return { id };
}

export async function deleteAssessment(
  db: CompetencyDb,
  id: string,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
): Promise<{ employeeId: string }> {
  const existing = await findOpenAssessment(db, id, scope);
  await db.hrCompetencyAssessment.deleteMany({ where: { id } });
  return { employeeId: existing.employeeId };
}

// ---------------------------------------------------------------------------
// Treinamentos
// ---------------------------------------------------------------------------

type TrainingRow = {
  id: string;
  title: string;
  competencyId: string;
  modality: string;
  workloadHours: number;
  startDate: Date;
  validityMonths: number;
  status: string;
  completedAt: Date | null;
};

export async function listTrainings(
  db: CompetencyDb,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
  filter: { employeeId?: string } = {},
): Promise<TrainingDto[]> {
  // Filtro por alguém fora da visão: vazio (nem a participação em turma mista é revelada).
  if (filter.employeeId && !canSeeEmployee(scope, filter.employeeId)) return [];
  let all = (await db.hrTraining.findMany({})) as TrainingRow[];
  if (filter.employeeId) {
    const mine = (await db.hrTrainingParticipant.findMany({ where: { employeeId: filter.employeeId } })) as {
      trainingId: string;
    }[];
    const ids = new Set(mine.map((p) => p.trainingId));
    all = all.filter((t) => ids.has(t.id));
  }
  const seen = await visibleTrainingIds(db, scope, all.map((r) => r.id));
  const rows = all.filter((r) => seen.has(r.id));
  const ids = rows.map((r) => r.id);
  const [participants, competencies] = await Promise.all([
    ids.length
      ? (db.hrTrainingParticipant.findMany({ where: { trainingId: { in: ids } } }) as Promise<
          { trainingId: string; employeeId: string; completedAt: Date | null }[]
        >)
      : Promise.resolve([]),
    db.hrCompetency.findMany({}) as Promise<{ id: string; name: string }[]>,
  ]);
  const employeeIds = [...new Set(participants.map((p) => p.employeeId))];
  const employeeRows = employeeIds.length
    ? ((await db.employee.findMany({ where: { id: { in: employeeIds } } })) as { id: string; name: string }[])
    : [];
  const names = new Map(employeeRows.map((e) => [e.id, e.name]));
  const compNames = new Map(competencies.map((c) => [c.id, c.name]));
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      competencyId: r.competencyId,
      competencyName: compNames.get(r.competencyId) ?? "—",
      modality: r.modality,
      workloadHours: r.workloadHours,
      startDate: toIsoDate(r.startDate) ?? "",
      validityMonths: r.validityMonths,
      status: r.status,
      completedOn: toIsoDate(r.completedAt),
      hiddenParticipantCount: participants.filter((p) => p.trainingId === r.id && !canSeeEmployee(scope, p.employeeId)).length,
      participants: participants
        .filter((p) => p.trainingId === r.id && canSeeEmployee(scope, p.employeeId))
        .map((p) => ({ employeeId: p.employeeId, employeeName: names.get(p.employeeId) ?? "—", completedOn: toIsoDate(p.completedAt) }))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR")),
    }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title, "pt-BR"));
}

async function assertTrainingRefs(db: CompetencyDb, input: TrainingInput) {
  await findActiveCompetency(db, input.competencyId).catch(() => {
    throw new CompetencyServiceError("INVALID_COMPETENCY", "Competência inexistente ou arquivada.", 400);
  });
  const employees = await loadActiveEmployees(db, input.participantIds);
  if (employees.size !== input.participantIds.length) {
    throw new CompetencyServiceError("INVALID_PARTICIPANTS", "Participante inexistente ou inativo.", 400);
  }
}

function trainingData(input: TrainingInput) {
  return {
    title: input.title,
    competencyId: input.competencyId,
    modality: input.modality,
    workloadHours: input.workloadHours,
    startDate: fromIsoDate(input.startDate),
    validityMonths: input.validityMonths,
  };
}

/** Novo treinamento nasce "Agendado". Líder só inscreve liderados. */
export async function createTraining(
  db: CompetencyDb,
  input: TrainingInput,
  actor: CompetencyActor,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
) {
  assertWritable(scope, input.participantIds);
  await assertTrainingRefs(db, input);
  return db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    const row = (await t.hrTraining.create({
      data: { ...trainingData(input), status: "SCHEDULED", createdByUserId: actor.userId, updatedByUserId: actor.userId },
    })) as { id: string };
    for (const employeeId of input.participantIds) {
      await t.hrTrainingParticipant.create({ data: { trainingId: row.id, employeeId } });
    }
    return { id: row.id };
  });
}

/**
 * Treinamento aberto e gravável no escopo: fora da visão → 404; com algum participante de
 * outra equipe → 403 (alterar a turma afetaria quem o líder não gerencia).
 */
async function findOpenTraining(db: CompetencyDb, id: string, scope: CompetencyScope): Promise<TrainingRow> {
  const row = (await db.hrTraining.findUnique({ where: { id } })) as TrainingRow | null;
  if (!row) notFound("Treinamento");
  if (scope.kind === "LIMITED") {
    if (!(await visibleTrainingIds(db, scope, [id])).has(id)) notFound("Treinamento");
    const parts = (await db.hrTrainingParticipant.findMany({ where: { trainingId: id } })) as { employeeId: string }[];
    assertWritable(scope, parts.map((p) => p.employeeId));
  }
  if (row.status === "COMPLETED") {
    throw new CompetencyServiceError("TRAINING_LOCKED", "Treinamento concluído não pode ser alterado.", 409);
  }
  return row;
}

export async function updateTraining(
  db: CompetencyDb,
  id: string,
  input: TrainingInput,
  actor: CompetencyActor,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
) {
  await findOpenTraining(db, id, scope);
  assertWritable(scope, input.participantIds);
  await assertTrainingRefs(db, input);
  await db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    await t.hrTraining.update({ where: { id }, data: { ...trainingData(input), updatedByUserId: actor.userId } });
    await t.hrTrainingParticipant.deleteMany({ where: { trainingId: id } });
    for (const employeeId of input.participantIds) {
      await t.hrTrainingParticipant.create({ data: { trainingId: id, employeeId } });
    }
  });
  return { id };
}

/** Agendado → Em andamento → Concluído. Concluir grava a conclusão dos participantes (base da reciclagem). */
export async function setTrainingStatus(
  db: CompetencyDb,
  id: string,
  params: { status: TrainingStatus; completedOn: string | null },
  actor: CompetencyActor,
  now: Date,
  scope: CompetencyScope = COMPETENCY_SCOPE_ALL,
) {
  await findOpenTraining(db, id, scope);
  const completedAt = params.status === "COMPLETED" ? fromIsoDate(params.completedOn ?? businessTodayIso(now)) : null;
  await db.$transaction(async (tx) => {
    const t = tx as unknown as CompetencyDb;
    await t.hrTraining.update({
      where: { id },
      data: { status: params.status, completedAt, updatedByUserId: actor.userId },
    });
    if (completedAt) {
      await t.hrTrainingParticipant.updateMany({ where: { trainingId: id, completedAt: null }, data: { completedAt } });
    }
  });
  return { id };
}

export async function deleteTraining(db: CompetencyDb, id: string, scope: CompetencyScope = COMPETENCY_SCOPE_ALL) {
  await findOpenTraining(db, id, scope);
  await db.hrTraining.deleteMany({ where: { id } });
}
