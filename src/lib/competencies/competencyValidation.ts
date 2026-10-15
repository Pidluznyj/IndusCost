/**
 * Competências e Desenvolvimento — parsers puros dos corpos de requisição (whitelist).
 * Nada de Prisma aqui; as rotas só gravam o que estes parsers devolvem.
 */

import {
  COMPETENCY_ASSESSMENT_STATUSES,
  isAssessedLevel,
  isCompetencyAssessmentStatus,
  isCompetencyCategory,
  isCompetencyLevel,
  isShiftPattern,
  isTrainingModality,
  isTrainingStatus,
  type CompetencyAssessmentStatus,
  type CompetencyCategory,
  type CompetencyLevel,
  type ShiftPattern,
  type TrainingModality,
  type TrainingStatus,
} from "./competencyDomain";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const COMPETENCY_NAME_MAX_LEN = 120;
export const COMPETENCY_TEXT_MAX_LEN = 2000;
export const TRAINING_TITLE_MAX_LEN = 160;
export const TRAINING_MAX_WORKLOAD_HOURS = 2000;
export const TRAINING_MAX_VALIDITY_MONTHS = 120;
export const TRAINING_MAX_PARTICIPANTS = 500;
export const POSITION_MAX_TEAM = 500;

export function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** "AAAA-MM-DD" válida no calendário. */
export function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export type ParseFailure = { ok: false; code: string; message: string };
export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

function fail(code: string, message: string): ParseFailure {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max ? t : null;
}

function readOptionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const t = value.trim();
  if (t.length > max) return { ok: false };
  return { ok: true, value: t.length > 0 ? t : null };
}

function readInt(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

function readUuidList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const v of value) {
    if (!isUuidString(v)) return null;
    const id = v.trim().toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Competência
// ---------------------------------------------------------------------------

export type CompetencyInput = {
  name: string;
  category: CompetencyCategory;
  description: string | null;
  requiresRecycling: boolean;
  critical: boolean;
};

export function parseCompetencyBody(body: unknown): ParseResult<CompetencyInput> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  const name = readText(body.name, COMPETENCY_NAME_MAX_LEN);
  if (!name) return fail("INVALID_NAME", `Nome da competência é obrigatório (até ${COMPETENCY_NAME_MAX_LEN} caracteres).`);
  if (!isCompetencyCategory(body.category)) return fail("INVALID_CATEGORY", "Categoria inválida.");
  const description = readOptionalText(body.description, COMPETENCY_TEXT_MAX_LEN);
  if (!description.ok) return fail("INVALID_DESCRIPTION", "Descrição inválida.");
  if (body.requiresRecycling != null && typeof body.requiresRecycling !== "boolean") {
    return fail("INVALID_RECYCLING", "Indicador de reciclagem inválido.");
  }
  if (body.critical != null && typeof body.critical !== "boolean") {
    return fail("INVALID_CRITICAL", "Indicador de competência crítica inválido.");
  }
  return {
    ok: true,
    value: {
      name,
      category: body.category,
      description: description.value,
      requiresRecycling: body.requiresRecycling === true,
      critical: body.critical === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Posto de trabalho
// ---------------------------------------------------------------------------

export type WorkPositionInput = {
  name: string;
  departmentId: string | null;
  shiftPattern: ShiftPattern;
  requirements: { competencyId: string; minLevel: number }[];
};

export function parseWorkPositionBody(body: unknown): ParseResult<WorkPositionInput> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  const name = readText(body.name, COMPETENCY_NAME_MAX_LEN);
  if (!name) return fail("INVALID_NAME", `Nome do posto é obrigatório (até ${COMPETENCY_NAME_MAX_LEN} caracteres).`);
  let departmentId: string | null = null;
  if (body.departmentId != null && body.departmentId !== "") {
    if (!isUuidString(body.departmentId)) return fail("INVALID_DEPARTMENT", "Setor inválido.");
    departmentId = body.departmentId.trim().toLowerCase();
  }
  if (!isShiftPattern(body.shiftPattern)) return fail("INVALID_SHIFT", "Turno inválido.");
  if (!Array.isArray(body.requirements)) return fail("INVALID_REQUIREMENTS", "Requisitos inválidos.");
  const requirements: { competencyId: string; minLevel: number }[] = [];
  for (const raw of body.requirements) {
    if (!isRecord(raw) || !isUuidString(raw.competencyId)) return fail("INVALID_REQUIREMENTS", "Requisito inválido.");
    const minLevel = readInt(raw.minLevel);
    if (minLevel === 0) continue; // 0 = não exigido
    if (!isAssessedLevel(minLevel)) return fail("INVALID_REQUIREMENTS", "Nível mínimo deve ser de 1 a 4.");
    const competencyId = raw.competencyId.trim().toLowerCase();
    if (requirements.some((r) => r.competencyId === competencyId)) {
      return fail("DUPLICATE_REQUIREMENT", "Competência repetida nos requisitos.");
    }
    requirements.push({ competencyId, minLevel });
  }
  if (requirements.length === 0) return fail("REQUIREMENTS_REQUIRED", "Defina pelo menos 1 requisito.");
  return { ok: true, value: { name, departmentId, shiftPattern: body.shiftPattern, requirements } };
}

export function parsePositionTeamBody(body: unknown): ParseResult<{ employeeIds: string[] }> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  const employeeIds = readUuidList(body.employeeIds, POSITION_MAX_TEAM);
  if (!employeeIds) return fail("INVALID_EMPLOYEES", "Lista de colaboradores inválida.");
  return { ok: true, value: { employeeIds } };
}

// ---------------------------------------------------------------------------
// Nível (edição manual na matriz)
// ---------------------------------------------------------------------------

export function parseLevelBody(body: unknown): ParseResult<{ level: CompetencyLevel; expectedVersion: number | null }> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  const level = readInt(body.level);
  if (!isCompetencyLevel(level)) return fail("INVALID_LEVEL", "Nível deve ser de 0 a 4.");
  let expectedVersion: number | null = null;
  if (body.expectedVersion != null) {
    const v = readInt(body.expectedVersion);
    if (v === null || v < 0) return fail("INVALID_VERSION", "Versão inválida.");
    expectedVersion = v;
  }
  return { ok: true, value: { level, expectedVersion } };
}

export function parseDecisionBody(body: unknown): ParseResult<{ decision: "APPROVE" | "REJECT"; note: string | null }> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  if (body.decision !== "APPROVE" && body.decision !== "REJECT") return fail("INVALID_DECISION", "Decisão inválida.");
  const note = readOptionalText(body.note, COMPETENCY_TEXT_MAX_LEN);
  if (!note.ok) return fail("INVALID_NOTE", "Justificativa inválida.");
  return { ok: true, value: { decision: body.decision, note: note.value } };
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

export type AssessmentInput = {
  employeeId: string;
  evaluatorEmployeeId: string | null;
  assessmentDate: string;
  status: CompetencyAssessmentStatus;
  notes: string | null;
  items: { competencyId: string; level: number }[];
};

export function parseAssessmentBody(body: unknown): ParseResult<AssessmentInput> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  if (!isUuidString(body.employeeId)) return fail("INVALID_EMPLOYEE", "Colaborador inválido.");
  let evaluatorEmployeeId: string | null = null;
  if (body.evaluatorEmployeeId != null && body.evaluatorEmployeeId !== "") {
    if (!isUuidString(body.evaluatorEmployeeId)) return fail("INVALID_EVALUATOR", "Avaliador inválido.");
    evaluatorEmployeeId = body.evaluatorEmployeeId.trim().toLowerCase();
  }
  if (!isIsoDateString(body.assessmentDate)) return fail("INVALID_DATE", "Data da avaliação inválida.");
  const status = body.status == null ? "COMPLETED" : body.status;
  if (!isCompetencyAssessmentStatus(status)) {
    return fail("INVALID_STATUS", `Status deve ser ${COMPETENCY_ASSESSMENT_STATUSES.join(", ")}.`);
  }
  const notes = readOptionalText(body.notes, COMPETENCY_TEXT_MAX_LEN);
  if (!notes.ok) return fail("INVALID_NOTES", "Observações inválidas.");
  const rawItems = body.items == null ? [] : body.items;
  if (!Array.isArray(rawItems)) return fail("INVALID_ITEMS", "Níveis inválidos.");
  const items: { competencyId: string; level: number }[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw) || !isUuidString(raw.competencyId)) return fail("INVALID_ITEMS", "Nível inválido.");
    const level = readInt(raw.level);
    if (!isAssessedLevel(level)) return fail("INVALID_ITEMS", "Cada nível avaliado deve ser de 1 a 4.");
    const competencyId = raw.competencyId.trim().toLowerCase();
    if (items.some((i) => i.competencyId === competencyId)) return fail("DUPLICATE_ITEM", "Competência repetida.");
    items.push({ competencyId, level });
  }
  if (status === "COMPLETED" && !evaluatorEmployeeId) {
    return fail("EVALUATOR_REQUIRED", "Informe o avaliador.");
  }
  if (status === "COMPLETED" && items.length === 0) {
    return fail("ITEMS_REQUIRED", "Atribua o nível de cada competência exigida.");
  }
  if (status !== "COMPLETED" && items.length > 0) {
    return fail("ITEMS_ONLY_ON_COMPLETION", "Níveis só são gravados ao concluir a avaliação.");
  }
  return {
    ok: true,
    value: {
      employeeId: body.employeeId.trim().toLowerCase(),
      evaluatorEmployeeId,
      assessmentDate: body.assessmentDate,
      status,
      notes: notes.value,
      items,
    },
  };
}

// ---------------------------------------------------------------------------
// Treinamento
// ---------------------------------------------------------------------------

export type TrainingInput = {
  title: string;
  competencyId: string;
  modality: TrainingModality;
  workloadHours: number;
  startDate: string;
  validityMonths: number;
  participantIds: string[];
};

export function parseTrainingBody(body: unknown): ParseResult<TrainingInput> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  const title = readText(body.title, TRAINING_TITLE_MAX_LEN);
  if (!title) return fail("INVALID_TITLE", `Título é obrigatório (até ${TRAINING_TITLE_MAX_LEN} caracteres).`);
  if (!isUuidString(body.competencyId)) return fail("INVALID_COMPETENCY", "Competência inválida.");
  if (!isTrainingModality(body.modality)) return fail("INVALID_MODALITY", "Modalidade inválida.");
  const workloadHours = readInt(body.workloadHours);
  if (workloadHours === null || workloadHours < 0 || workloadHours > TRAINING_MAX_WORKLOAD_HOURS) {
    return fail("INVALID_WORKLOAD", "Carga horária inválida.");
  }
  if (!isIsoDateString(body.startDate)) return fail("INVALID_DATE", "Data de início inválida.");
  const validityMonths = readInt(body.validityMonths ?? 0);
  if (validityMonths === null || validityMonths < 0 || validityMonths > TRAINING_MAX_VALIDITY_MONTHS) {
    return fail("INVALID_VALIDITY", "Validade inválida (0 = sem validade).");
  }
  const participantIds = readUuidList(body.participantIds, TRAINING_MAX_PARTICIPANTS);
  if (!participantIds) return fail("INVALID_PARTICIPANTS", "Participantes inválidos.");
  if (participantIds.length === 0) return fail("PARTICIPANTS_REQUIRED", "Selecione pelo menos 1 participante.");
  return {
    ok: true,
    value: {
      title,
      competencyId: body.competencyId.trim().toLowerCase(),
      modality: body.modality,
      workloadHours,
      startDate: body.startDate,
      validityMonths,
      participantIds,
    },
  };
}

export function parseTrainingStatusBody(
  body: unknown,
): ParseResult<{ status: TrainingStatus; completedOn: string | null }> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  if (!isTrainingStatus(body.status)) return fail("INVALID_STATUS", "Status inválido.");
  let completedOn: string | null = null;
  if (body.completedOn != null && body.completedOn !== "") {
    if (!isIsoDateString(body.completedOn)) return fail("INVALID_DATE", "Data de conclusão inválida.");
    completedOn = body.completedOn;
  }
  return { ok: true, value: { status: body.status, completedOn } };
}
