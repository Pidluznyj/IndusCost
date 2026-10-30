/**
 * Casos de uso do módulo. Funções puras sobre o estado: a rota persiste o retorno.
 * Não grava token, OTP nem texto de evidência na auditoria.
 *
 * Autorização: toda mutação recebe o escopo (`PerformanceScope`). Ações de RH exigem
 * escopo ALL; ações da liderança exigem ser o avaliador atribuído ou ter a pessoa no
 * escopo de escrita. A interface não é a fronteira de segurança.
 */
import {
  ALGORITHM_ID,
  PDI_STATUS_LABELS,
  PILLARS,
  PROPOSED_BASE_QUESTIONS,
  PROPOSED_MODEL_INSTRUCTIONS,
  QUESTIONS_PER_PILLAR,
  ROLE_EXAMPLES_MAX,
  UNCLASSIFIED_QUADRANT,
  aggregatePillar,
  classifyEligibility,
  classifyFromSignals,
  resultPendingTenureValidation,
  cultureBand,
  evidenceRequired,
  evidenceSatisfied,
  findDivergences,
  isIsoDate,
  isNineBoxBand,
  isPdiStatus,
  nextCycleStatus,
  placeNineBox,
  proposedRules,
  quadrantLabel,
  validateRules,
  EVIDENCE_MAX_CHARS,
  type AnswerInput,
  type CycleStatus,
  type EmployeeSnapshotSource,
  type NineBoxBand,
  type PdiStatus,
  type PerformanceRules,
  type StoredAnswer,
} from "./performanceDomain.js";
import {
  buildInviteHashUrl,
  digestSecret,
  gateInvite,
  newLinkToken,
  newOtpCode,
  newSessionToken,
  publicFailureMessage,
  secretsMatch,
  SESSION_TTL_MS,
  OTP_ATTEMPT_LIMIT,
  INVITE_TTL_DAYS,
} from "./performanceInvite.js";
import { canEvaluateEmployee, canSeeEmployee, type PerformanceScope } from "./performanceAccess.js";
import { isLeadershipKind } from "./performanceLeadership.js";
import {
  applyLeadershipAnswer,
  applyLeadershipSnapshot,
  ensureLeadershipAssignments,
  journeyDone,
  journeyOf,
  leadershipComparison,
  leadershipHomologationProblem,
  leadershipModelProblems,
  leadershipQuestionsFor,
  leadershipRulesOf,
  leadershipSubmitProblem,
  markLeadershipOfficial,
  pendingLeadershipTasks,
  STEP_TEXT,
  type LeadershipSnapshot,
} from "./performanceLeadershipService.js";
import {
  cloneDb,
  newId,
  type AnswerRecord,
  type AssignmentRecord,
  type CycleRecord,
  type ModelRecord,
  type ParticipantRecord,
  type PerformanceDatabase,
  type ResultRecord,
  type RoleExample,
} from "./performanceState.js";
import { formatDateBr } from "./performanceDomain.js";
import { kindWindow, kindWindowOpen, localDay, stageScheduleProblem, windowState } from "./performanceStages.js";

/** Datas de início/fim das etapas além dos dois prazos que já existiam (vazio = sem calendário de etapas). */
export type StageScheduleInput = {
  selfStartAt?: string | null;
  leaderStartAt?: string | null;
  leadershipStartAt?: string | null;
  leadershipDueAt?: string | null;
  calibrationStartAt?: string | null;
  calibrationDueAt?: string | null;
};
const SCHEDULE_FIELDS = ["selfStartAt", "leaderStartAt", "leadershipStartAt", "leadershipDueAt", "calibrationStartAt", "calibrationDueAt"] as const;
type ScheduleFields = { [K in (typeof SCHEDULE_FIELDS)[number]]: string | null };

/** Campos do calendário: o informado (vazio vira nulo) ou, ausente, o atual do ciclo. Sem liderança, as datas dela somem. */
function scheduleFrom(input: StageScheduleInput, current: ScheduleFields | null, leadership: boolean): ScheduleFields {
  const out = {} as ScheduleFields;
  for (const field of SCHEDULE_FIELDS) {
    const given = input[field];
    const value = given === undefined ? current?.[field] ?? null : typeof given === "string" && given.trim() ? given.trim() : null;
    out[field] = value;
  }
  if (!leadership) {
    out.leadershipStartAt = null;
    out.leadershipDueAt = null;
  }
  return out;
}

export type ServiceOptions = {
  now: () => Date;
  officialPublication: boolean;
  identityOtpEnabled: boolean;
  remindersEnabled: boolean;
  publicOrigin: string;
};

export type ServiceError = { ok: false; code: string; message: string; db?: PerformanceDatabase };
export type ServiceOk<T> = { ok: true; db: PerformanceDatabase; value: T };
export type ServiceResult<T> = ServiceOk<T> | ServiceError;

export const HR_SCOPE: PerformanceScope = { kind: "ALL" };

export function fail(code: string, message: string): ServiceError {
  return { ok: false, code, message };
}

export function iso(date: Date): string {
  return date.toISOString();
}

function clean(value: string | null | undefined, max = 2000): string {
  return (value ?? "").trim().slice(0, max);
}

function cleanOrNull(value: string | null | undefined, max = 2000): string | null {
  const text = clean(value, max);
  return text.length > 0 ? text : null;
}

export function audit(
  db: PerformanceDatabase,
  now: Date,
  actorUserId: string | null,
  action: string,
  entityId: string,
  detail: Record<string, string | number | boolean | null>
) {
  db.audits.push({ id: newId(), at: iso(now), actorUserId, action, entityId, detail });
}

const FORBIDDEN_MESSAGE = "Você não tem acesso a esta pessoa ou ação.";

export function hrOnly(scope: PerformanceScope): ServiceError | null {
  return scope.kind === "ALL" ? null : fail("FORBIDDEN", FORBIDDEN_MESSAGE);
}

export function questionsOf(db: PerformanceDatabase, modelId: string) {
  return db.questions.filter((q) => q.modelId === modelId).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function modelOfCycle(db: PerformanceDatabase, cycle: CycleRecord): ModelRecord | null {
  return db.models.find((m) => m.id === cycle.modelId) ?? null;
}

export function rulesOfCycle(db: PerformanceDatabase, cycle: CycleRecord): PerformanceRules {
  return modelOfCycle(db, cycle)?.rules ?? proposedRules();
}

export function activeAssignment(db: PerformanceDatabase, participantId: string, kind: "SELF" | "LEADER") {
  return db.assignments.find((a) => a.participantId === participantId && a.kind === kind && a.active) ?? null;
}

export function liveParticipants(db: PerformanceDatabase, cycleId: string): ParticipantRecord[] {
  return db.participants.filter((p) => p.cycleId === cycleId && !p.removedAt);
}

export function eligibleParticipants(db: PerformanceDatabase, cycleId: string): ParticipantRecord[] {
  return liveParticipants(db, cycleId).filter((p) => p.eligibility === "ELIGIBLE");
}

export function activeResult(db: PerformanceDatabase, participantId: string): ResultRecord | null {
  return db.results.find((r) => r.participantId === participantId && r.active) ?? null;
}

/** Respostas da avaliação individual. Linhas de liderança (180°) nunca entram aqui nem na Nine-Box. */
export function toStored(db: PerformanceDatabase, assignmentId: string): StoredAnswer[] {
  return db.answers
    .filter((a) => a.assignmentId === assignmentId && a.pillar !== "LEADERSHIP")
    .map((a) => ({
      questionCode: a.questionCode,
      pillar: a.pillar as StoredAnswer["pillar"],
      kind: a.kind,
      score: a.score,
      evidence: a.evidence,
    }));
}

function blankAnswers(db: PerformanceDatabase, assignmentId: string, modelId: string) {
  for (const question of questionsOf(db, modelId)) {
    db.answers.push({
      id: newId(),
      assignmentId,
      questionCode: question.code,
      pillar: question.pillar,
      kind: "pending",
      score: null,
      evidence: null,
    });
  }
}

/**
 * Só o avaliador atribuído pelo ciclo escreve na avaliação da liderança. O RH não responde em
 * nome de ninguém, nem com alcance de toda a organização: os caminhos formais são trocar o
 * líder (com motivo) ou calibrar com exceção registrada.
 */
export function canActOnLeaderAssignment(scope: PerformanceScope, assignment: AssignmentRecord): boolean {
  const actor = scope.actorEmployeeId ?? null;
  if (!actor || assignment.employeeId === actor) return false;
  return assignment.evaluatorEmployeeId === actor;
}

/** RH ou a liderança da pessoa (avaliador do ciclo ou escopo de escrita). */
export function canLeadParticipant(db: PerformanceDatabase, scope: PerformanceScope, participant: ParticipantRecord): boolean {
  if (scope.kind === "ALL") return true;
  const actor = scope.actorEmployeeId;
  if (!actor || participant.employeeId === actor) return false;
  const leader = activeAssignment(db, participant.id, "LEADER");
  if (leader && leader.evaluatorEmployeeId === actor) return true;
  return canEvaluateEmployee(scope, participant.employeeId);
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export function createDraftModel(
  source: PerformanceDatabase,
  input: { name: string; description?: string | null; instructions?: string | null; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ modelId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const name = clean(input.name, 120);
  if (name.length < 3) return fail("INVALID_NAME", "Informe um nome para o modelo.");
  const db = cloneDb(source);
  const modelId = newId();
  db.models.push({
    id: modelId,
    lineageId: modelId,
    name,
    description: cleanOrNull(input.description, 600),
    instructions: cleanOrNull(input.instructions, 600) ?? PROPOSED_MODEL_INSTRUCTIONS,
    status: "DRAFT",
    version: 1,
    governance: "EM_VALIDACAO",
    kind: "INDIVIDUAL",
    rules: proposedRules(),
    publishedAt: null,
    archivedAt: null,
    createdByUserId: input.actorUserId,
    createdAt: iso(options.now()),
  });
  for (const question of PROPOSED_BASE_QUESTIONS) {
    db.questions.push({
      id: newId(),
      modelId,
      code: question.code,
      pillar: question.pillar,
      competency: question.competency,
      sortOrder: question.sortOrder,
      selfText: question.selfText,
      leaderText: question.leaderText,
      upwardText: null,
      hint: null,
      description: question.description || null,
      positiveExample: question.positiveExample || null,
      negativeExample: question.negativeExample || null,
      roleExamples: [],
    });
  }
  audit(db, options.now(), input.actorUserId, "MODEL_DRAFT_CREATED", modelId, { governance: "EM_VALIDACAO" });
  return { ok: true, db, value: { modelId } };
}

function draftModel(db: PerformanceDatabase, modelId: string): ModelRecord | ServiceError {
  const model = db.models.find((m) => m.id === modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  if (model.status !== "DRAFT") return fail("MODEL_LOCKED", "Modelo publicado não é alterado. Duplique para criar uma nova versão.");
  return model;
}

export function updateModelDraft(
  source: PerformanceDatabase,
  input: {
    modelId: string;
    name?: string;
    description?: string | null;
    instructions?: string | null;
    rules?: PerformanceRules;
    actorUserId: string | null;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ modelId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = draftModel(db, input.modelId);
  if ("ok" in model) return model;
  if (input.name !== undefined) {
    const name = clean(input.name, 120);
    if (name.length < 3) return fail("INVALID_NAME", "Informe um nome para o modelo.");
    model.name = name;
  }
  if (input.description !== undefined) model.description = cleanOrNull(input.description, 600);
  if (input.instructions !== undefined) {
    const instructions = cleanOrNull(input.instructions, 600);
    if (!instructions || instructions.length < 10) return fail("INVALID_TEXT", "Escreva a orientação que a pessoa lê antes de responder.");
    model.instructions = instructions;
  }
  if (input.rules) {
    const problem = validateRules(input.rules);
    if (problem) return fail("INVALID_RULES", problem);
    model.rules = { ...input.rules, ruleSetId: input.rules.ruleSetId.trim() };
  }
  audit(db, options.now(), input.actorUserId, "MODEL_DRAFT_UPDATED", model.id, {
    rules: Boolean(input.rules),
    ruleSetId: model.rules.ruleSetId,
  });
  return { ok: true, db, value: { modelId: model.id } };
}

export function updateDraftQuestion(
  source: PerformanceDatabase,
  input: {
    modelId: string;
    code: string;
    competency?: string;
    selfText: string;
    leaderText: string;
    hint: string | null;
    description?: string | null;
    positiveExample?: string | null;
    negativeExample?: string | null;
    roleExamples?: readonly RoleExample[];
    actorUserId: string | null;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ code: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = draftModel(db, input.modelId);
  if ("ok" in model) return model;
  const selfText = clean(input.selfText, 240);
  const leaderText = clean(input.leaderText, 240);
  if (selfText.length < 8 || leaderText.length < 8) return fail("INVALID_TEXT", "Escreva a pergunta para a pessoa e para o líder.");
  const siblings = questionsOf(db, model.id).filter((q) => q.code !== input.code);
  if (siblings.some((q) => q.selfText.trim().toLowerCase() === selfText.toLowerCase())) {
    return fail("DUPLICATE_QUESTION", "Já existe pergunta igual neste modelo.");
  }
  const question = db.questions.find((q) => q.modelId === model.id && q.code === input.code);
  if (!question) return fail("NOT_FOUND", "Pergunta não encontrada.");
  if (input.competency !== undefined) {
    const competency = clean(input.competency, 80);
    if (competency.length < 3) return fail("INVALID_TEXT", "Informe a competência observada pela pergunta.");
    question.competency = competency;
  }
  question.selfText = selfText;
  question.leaderText = leaderText;
  question.hint = cleanOrNull(input.hint, 300);
  if (input.description !== undefined) question.description = cleanOrNull(input.description, 400);
  if (input.positiveExample !== undefined) question.positiveExample = cleanOrNull(input.positiveExample, 300);
  if (input.negativeExample !== undefined) question.negativeExample = cleanOrNull(input.negativeExample, 300);
  if (input.roleExamples !== undefined) {
    const rows = input.roleExamples
      .map((row) => ({ roleName: clean(row?.roleName, 80), text: clean(row?.text, 300) }))
      .filter((row) => row.roleName || row.text);
    if (rows.length > ROLE_EXAMPLES_MAX) return fail("INVALID_TEXT", `No máximo ${ROLE_EXAMPLES_MAX} exemplos por cargo em cada pergunta.`);
    if (rows.some((row) => row.roleName.length < 2 || row.text.length < 5)) return fail("INVALID_TEXT", "Cada exemplo por cargo precisa do cargo e de um texto.");
    const roles = rows.map((row) => row.roleName.toLowerCase());
    if (new Set(roles).size !== roles.length) return fail("INVALID_TEXT", "Há cargo repetido nos exemplos desta pergunta.");
    question.roleExamples = rows;
  }
  audit(db, options.now(), input.actorUserId, "MODEL_QUESTION_EDITED", question.id, { code: question.code });
  return { ok: true, db, value: { code: question.code } };
}

/** Reordena dentro do pilar. Os três blocos continuam na ordem técnico → cultura → potencial. */
export function moveDraftQuestion(
  source: PerformanceDatabase,
  input: { modelId: string; code: string; direction: "up" | "down"; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ code: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = draftModel(db, input.modelId);
  if ("ok" in model) return model;
  const ordered = questionsOf(db, model.id);
  const index = ordered.findIndex((q) => q.code === input.code);
  if (index < 0) return fail("NOT_FOUND", "Pergunta não encontrada.");
  const current = ordered[index]!;
  const neighbor = ordered[input.direction === "up" ? index - 1 : index + 1];
  if (!neighbor || neighbor.pillar !== current.pillar) return fail("EDGE_OF_PILLAR", "A pergunta já está no limite do seu pilar.");
  const swap = current.sortOrder;
  current.sortOrder = neighbor.sortOrder;
  neighbor.sortOrder = swap;
  audit(db, options.now(), input.actorUserId, "MODEL_QUESTION_MOVED", current.id, { code: current.code, direction: input.direction });
  return { ok: true, db, value: { code: current.code } };
}

export function modelProblems(db: PerformanceDatabase, model: ModelRecord): string[] {
  if (model.kind === "LEADERSHIP") return leadershipModelProblems(db, model);
  const problems: string[] = [];
  const questions = questionsOf(db, model.id);
  if (questions.length !== PILLARS.length * QUESTIONS_PER_PILLAR) problems.push("A versão-base precisa das 12 perguntas.");
  for (const pillar of PILLARS) {
    if (questions.filter((q) => q.pillar === pillar).length !== QUESTIONS_PER_PILLAR) problems.push("Cada pilar precisa de quatro perguntas.");
  }
  if (questions.some((q) => q.selfText.trim().length < 8 || q.leaderText.trim().length < 8)) {
    problems.push("Toda pergunta precisa de texto para a pessoa e para o líder.");
  }
  if (questions.some((q) => (q.competency ?? "").trim().length < 3)) problems.push("Toda pergunta precisa da competência observada.");
  const texts = questions.map((q) => q.selfText.trim().toLowerCase());
  if (new Set(texts).size !== texts.length) problems.push("Há perguntas repetidas.");
  if (!model.instructions || model.instructions.trim().length < 10) problems.push("Escreva a orientação de período de referência.");
  const rules = validateRules(model.rules);
  if (rules) problems.push(rules);
  return [...new Set(problems)];
}

export function publishModel(
  source: PerformanceDatabase,
  input: { modelId: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ modelId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  if (model.status === "PUBLISHED") return { ok: true, db: source, value: { modelId: model.id } };
  if (model.status !== "DRAFT") return fail("MODEL_LOCKED", "Só um rascunho pode ser publicado.");
  const problems = modelProblems(db, model);
  if (problems.length > 0) return fail("INVALID_MODEL", problems[0]!);
  model.status = "PUBLISHED";
  model.publishedAt = iso(options.now());
  model.governance = "EM_VALIDACAO";
  audit(db, options.now(), input.actorUserId, "MODEL_PUBLISHED", model.id, {
    version: model.version,
    ruleSetId: model.rules.ruleSetId,
    homologated: false,
  });
  return { ok: true, db, value: { modelId: model.id } };
}

export function duplicateModel(
  source: PerformanceDatabase,
  input: { modelId: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ modelId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  const copyId = newId();
  const nextVersion = Math.max(...db.models.filter((m) => m.lineageId === model.lineageId).map((m) => m.version)) + 1;
  db.models.push({
    ...model,
    id: copyId,
    status: "DRAFT",
    version: nextVersion,
    governance: "EM_VALIDACAO",
    rules: { ...model.rules },
    publishedAt: null,
    archivedAt: null,
    createdByUserId: input.actorUserId,
    createdAt: iso(options.now()),
  });
  for (const question of questionsOf(db, model.id)) {
    db.questions.push({ ...question, id: newId(), modelId: copyId, roleExamples: (question.roleExamples ?? []).map((row) => ({ ...row })) });
  }
  audit(db, options.now(), input.actorUserId, "MODEL_DUPLICATED", copyId, { from: model.id, version: nextVersion });
  return { ok: true, db, value: { modelId: copyId } };
}

export function archiveModel(
  source: PerformanceDatabase,
  input: { modelId: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ modelId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  if (model.status === "ARCHIVED") return { ok: true, db: source, value: { modelId: model.id } };
  if (db.cycles.some((c) => c.modelId === model.id && c.status !== "CLOSED")) {
    return fail("MODEL_IN_USE", "Este modelo está num ciclo que ainda não encerrou.");
  }
  model.status = "ARCHIVED";
  model.archivedAt = iso(options.now());
  audit(db, options.now(), input.actorUserId, "MODEL_ARCHIVED", model.id, { version: model.version });
  return { ok: true, db, value: { modelId: model.id } };
}

// ---------------------------------------------------------------------------
// Ciclos e participantes
// ---------------------------------------------------------------------------

export function createCycle(
  source: PerformanceDatabase,
  input: {
    name: string;
    periodLabel: string;
    modelId: string;
    selfDueAt: string;
    leaderDueAt: string;
    actorUserId: string | null;
    /** Obrigatória: OFFICIAL compõe indicadores oficiais; TEST nunca compõe. */
    classification: string;
    /** Avaliação 180° de liderança (modelo LEADERSHIP publicado). Opcional. */
    leadershipModelId?: string | null;
    minObservationDays?: number;
    scope?: PerformanceScope;
  } & StageScheduleInput,
  options: ServiceOptions
): ServiceResult<{ cycleId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model || model.status !== "PUBLISHED" || model.kind === "LEADERSHIP") return fail("MODEL_REQUIRED", "Escolha um modelo publicado.");
  const leadershipModel = input.leadershipModelId ? db.models.find((m) => m.id === input.leadershipModelId) : null;
  if (input.leadershipModelId && (!leadershipModel || leadershipModel.kind !== "LEADERSHIP" || leadershipModel.status !== "PUBLISHED")) {
    return fail("MODEL_REQUIRED", "Escolha um modelo de liderança publicado.");
  }
  const name = clean(input.name, 120);
  if (name.length < 3) return fail("INVALID_NAME", "Informe o nome do ciclo.");
  const periodLabel = clean(input.periodLabel, 80);
  if (periodLabel.length < 2) return fail("INVALID_PERIOD", "Informe a referência do ciclo, por exemplo 2º semestre de 2026.");
  if (!isIsoDate(input.selfDueAt) || !isIsoDate(input.leaderDueAt)) return fail("INVALID_DATE", "Informe os prazos da pessoa e do líder.");
  if (input.leaderDueAt < input.selfDueAt) return fail("INVALID_DATE", "O prazo do líder não pode vir antes do prazo da pessoa.");
  if (input.classification !== "OFFICIAL" && input.classification !== "TEST") {
    return fail("CLASSIFICATION_REQUIRED", "Diga se o ciclo é oficial ou de teste.");
  }
  const classification = input.classification;
  const schedule = scheduleFrom(input, null, Boolean(leadershipModel));
  const scheduleProblem = stageScheduleProblem({ ...schedule, selfDueAt: input.selfDueAt, leaderDueAt: input.leaderDueAt }, Boolean(leadershipModel));
  if (scheduleProblem) return fail("INVALID_DATE", scheduleProblem);
  const cycleId = newId();
  db.cycles.push({
    id: cycleId,
    name,
    periodLabel,
    status: "DRAFT",
    modelId: model.id,
    selfDueAt: input.selfDueAt,
    leaderDueAt: input.leaderDueAt,
    ownerUserId: input.actorUserId,
    minObservationDays: input.minObservationDays ?? model.rules.minObservationDays,
    openedAt: null,
    closedAt: null,
    createdAt: iso(options.now()),
    classification,
    classifiedAt: iso(options.now()),
    classifiedByUserId: input.actorUserId,
    activation: "ACTIVE",
    activationChangedAt: null,
    activationChangedByUserId: null,
    activationReason: null,
    leadershipModelId: leadershipModel?.id ?? null,
    ...schedule,
  });
  audit(db, options.now(), input.actorUserId, "CYCLE_CREATED", cycleId, { status: "DRAFT", modelVersion: model.version, classification, leadership: Boolean(leadershipModel), staged: Boolean(schedule.selfStartAt) });
  return { ok: true, db, value: { cycleId } };
}

export function updateCycle(
  source: PerformanceDatabase,
  input: {
    cycleId: string;
    name: string;
    periodLabel: string;
    selfDueAt: string;
    leaderDueAt: string;
    reason: string | null;
    actorUserId: string | null;
    scope: PerformanceScope;
  } & StageScheduleInput,
  options: ServiceOptions
): ServiceResult<{ cycleId: string }> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status === "HOMOLOGATED" || cycle.status === "CLOSED") return fail("CYCLE_FROZEN", "Ciclo homologado ou encerrado não muda.");
  const name = clean(input.name, 120);
  const periodLabel = clean(input.periodLabel, 80);
  if (name.length < 3 || periodLabel.length < 2) return fail("INVALID_NAME", "Informe o nome e a referência do ciclo.");
  if (!isIsoDate(input.selfDueAt) || !isIsoDate(input.leaderDueAt)) return fail("INVALID_DATE", "Informe os prazos da pessoa e do líder.");
  if (input.leaderDueAt < input.selfDueAt) return fail("INVALID_DATE", "O prazo do líder não pode vir antes do prazo da pessoa.");
  const schedule = scheduleFrom(input, cycle, Boolean(cycle.leadershipModelId));
  const scheduleProblem = stageScheduleProblem({ ...schedule, selfDueAt: input.selfDueAt, leaderDueAt: input.leaderDueAt }, Boolean(cycle.leadershipModelId));
  if (scheduleProblem) return fail("INVALID_DATE", scheduleProblem);
  const scheduleChanged = SCHEDULE_FIELDS.some((field) => (cycle[field] ?? null) !== schedule[field]);
  const datesChanged = cycle.selfDueAt !== input.selfDueAt || cycle.leaderDueAt !== input.leaderDueAt || scheduleChanged;
  const reason = clean(input.reason, 300);
  if (datesChanged && cycle.status !== "DRAFT" && cycle.status !== "PREPARED" && reason.length < 8) {
    return fail("NOTE_REQUIRED", "Diga por que o prazo mudou depois da abertura.");
  }
  audit(db, options.now(), input.actorUserId, "CYCLE_UPDATED", cycle.id, {
    selfDueFrom: cycle.selfDueAt,
    selfDueTo: input.selfDueAt,
    leaderDueFrom: cycle.leaderDueAt,
    leaderDueTo: input.leaderDueAt,
    ...(scheduleChanged ? { scheduleFrom: JSON.stringify(Object.fromEntries(SCHEDULE_FIELDS.map((f) => [f, cycle[f] ?? null]))), scheduleTo: JSON.stringify(schedule) } : {}),
    reason: reason || null,
  });
  cycle.name = name;
  cycle.periodLabel = periodLabel;
  cycle.selfDueAt = input.selfDueAt;
  cycle.leaderDueAt = input.leaderDueAt;
  Object.assign(cycle, schedule);
  return { ok: true, db, value: { cycleId: cycle.id } };
}

function classifyParticipant(participant: ParticipantRecord, cycle: CycleRecord, now: Date) {
  return classifyEligibility({
    employee: {
      status: participant.employeeStatus,
      admissionDate: participant.admissionDate ? new Date(participant.admissionDate) : null,
      terminationDate: null,
    },
    asOf: now,
    minObservationDays: cycle.minObservationDays,
    absenceOverlapsReference: participant.absenceInWindow,
    roleChangedInsideWindow: participant.roleChangedInWindow,
    exceptionReason: participant.eligibilityException,
  });
}

function countEligibility(db: PerformanceDatabase, cycleId: string) {
  const live = liveParticipants(db, cycleId);
  return {
    eligible: live.filter((p) => p.eligibility === "ELIGIBLE").length,
    notEligible: live.filter((p) => p.eligibility === "NOT_ELIGIBLE").length,
    insufficient: live.filter((p) => p.eligibility === "INSUFFICIENT_EVIDENCE").length,
  };
}

/**
 * Inclui pessoas do cadastro oficial no ciclo. Incremental: quem já está não duplica;
 * quem foi removido antes da abertura volta com um snapshot novo.
 */
export function applyParticipants(
  source: PerformanceDatabase,
  input: {
    cycleId: string;
    employees: readonly EmployeeSnapshotSource[];
    selectedIds: readonly string[];
    exceptions: Readonly<Record<string, string>>;
    absenceIds: readonly string[];
    roleChangeIds: readonly string[];
    endedAbsenceIds?: readonly string[];
    managerChangeIds?: readonly string[];
    actorUserId: string | null;
    scope?: PerformanceScope;
    /** Retrato de liderança na inclusão (liderados diretos ativos na organização). A abertura refaz o retrato. */
    leadershipSnapshot?: Readonly<Record<string, { directReportIds: readonly string[] }>>;
    /** Como a inclusão foi feita (hierarquia): vai para a auditoria. */
    source?: { mode: string; leaderEmployeeId: string | null; leaderName: string | null; requested: number } | null;
  },
  options: ServiceOptions
): ServiceResult<{ eligible: number; notEligible: number; insufficient: number; added: number; duplicates: number; reactivated: number; missing: number }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status !== "DRAFT" && cycle.status !== "PREPARED") {
    return fail("CYCLE_FROZEN", "Participantes já foram congelados na abertura.");
  }
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  const wanted = [...new Set(input.selectedIds)];
  let added = 0;
  let duplicates = 0;
  let reactivated = 0;
  let missing = 0;
  const now = options.now();
  for (const employeeId of wanted) {
    const employee = byId.get(employeeId);
    if (!employee) {
      missing += 1;
      continue;
    }
    const existing = db.participants.find((p) => p.cycleId === cycle.id && p.employeeId === employee.id);
    if (existing && !existing.removedAt) {
      duplicates += 1;
      continue;
    }
    const exception = cleanOrNull(input.exceptions[employee.id], 300);
    const signals = {
      absenceIds: input.absenceIds,
      roleChangeIds: input.roleChangeIds,
      endedAbsenceIds: input.endedAbsenceIds ?? [],
      managerChangeIds: input.managerChangeIds ?? [],
    };
    const snapshot: Omit<ParticipantRecord, "id" | "eligibility" | "eligibilityReason"> = {
      cycleId: cycle.id,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeStatus: employee.terminationDate ? "INACTIVE" : employee.status ?? "ACTIVE",
      eligibilityException: exception,
      absenceInWindow: signals.absenceIds.includes(employee.id),
      roleChangedInWindow: signals.roleChangeIds.includes(employee.id) || signals.managerChangeIds.includes(employee.id),
      roleId: employee.roleId,
      roleName: employee.roleName,
      departmentId: employee.departmentId,
      departmentName: employee.departmentName,
      managerId: employee.managerId && employee.managerId !== employee.id ? employee.managerId : null,
      managerName: employee.managerId && employee.managerId !== employee.id ? employee.managerName : null,
      managerSource: employee.managerSource ?? "CADASTRO",
      admissionDate: employee.admissionDate ? iso(employee.admissionDate) : null,
      registration: employee.registration,
      frozen: false,
      addedAt: iso(now),
      removedAt: null,
      removedReason: null,
      // Liderança pela organização inteira (não pela população do ciclo), quando o retrato veio junto.
      isLeader: (input.leadershipSnapshot?.[employee.id]?.directReportIds.length ?? 0) > 0,
      directReportCount: input.leadershipSnapshot?.[employee.id]?.directReportIds.length ?? 0,
      leadershipSnapshotAt: input.leadershipSnapshot ? iso(now) : null,
    };
    const decision = classifyFromSignals({
      employee,
      asOf: now,
      minObservationDays: cycle.minObservationDays,
      signals,
      exceptionReason: exception,
    });
    if (existing) {
      Object.assign(existing, snapshot, { eligibility: decision.state, eligibilityReason: decision.reason });
      reactivated += 1;
    } else {
      db.participants.push({ id: newId(), ...snapshot, eligibility: decision.state, eligibilityReason: decision.reason });
      added += 1;
    }
  }
  const counts = countEligibility(db, cycle.id);
  audit(db, now, input.actorUserId, input.source ? "PARTICIPANTS_INCLUDED_BY_HIERARCHY" : "PARTICIPANTS_ADDED", cycle.id, {
    added,
    reactivated,
    duplicates,
    missing,
    ...counts,
    ...(input.source ? { mode: input.source.mode, leaderEmployeeId: input.source.leaderEmployeeId, leaderName: input.source.leaderName, requested: input.source.requested, exceptions: Object.keys(input.exceptions).length } : {}),
  });
  return { ok: true, db, value: { ...counts, added, duplicates, reactivated, missing } };
}

/**
 * Reclassifica quem já está em rascunho ou preparado. Não mexe em resposta, tarefa enviada,
 * exceção do RH nem em ciclo aberto, homologado ou encerrado.
 */
export function reclassifyPreparedParticipants(
  source: PerformanceDatabase,
  input: {
    cycleId: string;
    employees: readonly EmployeeSnapshotSource[];
    absenceIds: readonly string[];
    roleChangeIds: readonly string[];
    endedAbsenceIds?: readonly string[];
    managerChangeIds?: readonly string[];
    actorUserId: string | null;
    scope: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{
  changed: number;
  unchanged: number;
  skippedSubmitted: number;
  rows: { employeeId: string; name: string; before: string; after: string; beforeReason: string; afterReason: string }[];
}> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status === "HOMOLOGATED" || cycle.status === "CLOSED") {
    return fail("CYCLE_FROZEN", "Ciclo homologado ou encerrado não muda.");
  }
  if (cycle.status !== "DRAFT" && cycle.status !== "PREPARED") {
    return fail("CYCLE_STAGE", "Ciclo aberto não é reclassificado em silêncio. A classificação da abertura permanece.");
  }
  const byEmployee = new Map(input.employees.map((employee) => [employee.id, employee]));
  const signals = {
    absenceIds: input.absenceIds,
    roleChangeIds: input.roleChangeIds,
    endedAbsenceIds: input.endedAbsenceIds ?? [],
    managerChangeIds: input.managerChangeIds ?? [],
  };
  const now = options.now();
  const rows: { employeeId: string; name: string; before: string; after: string; beforeReason: string; afterReason: string }[] = [];
  let unchanged = 0;
  let skippedSubmitted = 0;
  for (const participant of liveParticipants(db, cycle.id)) {
    const submitted = db.assignments.some((assignment) => assignment.participantId === participant.id && assignment.status === "SUBMITTED");
    if (submitted) {
      skippedSubmitted += 1;
      continue;
    }
    const employee = byEmployee.get(participant.employeeId);
    if (!employee) {
      unchanged += 1;
      continue;
    }
    const decision = classifyFromSignals({
      employee,
      asOf: now,
      minObservationDays: cycle.minObservationDays,
      signals,
      exceptionReason: participant.eligibilityException,
    });
    const before = participant.eligibility;
    const beforeReason = participant.eligibilityReason;
    const absenceInWindow = signals.absenceIds.includes(employee.id);
    const roleChangedInWindow = signals.roleChangeIds.includes(employee.id) || signals.managerChangeIds.includes(employee.id);
    if (before === decision.state && beforeReason === decision.reason && participant.absenceInWindow === absenceInWindow && participant.roleChangedInWindow === roleChangedInWindow) {
      unchanged += 1;
      continue;
    }
    participant.eligibility = decision.state;
    participant.eligibilityReason = decision.reason;
    participant.absenceInWindow = absenceInWindow;
    participant.roleChangedInWindow = roleChangedInWindow;
    participant.employeeStatus = employee.terminationDate ? "INACTIVE" : employee.status ?? "ACTIVE";
    participant.admissionDate = employee.admissionDate ? iso(employee.admissionDate) : null;
    rows.push({ employeeId: employee.id, name: employee.name, before, after: decision.state, beforeReason, afterReason: decision.reason });
  }
  audit(db, now, input.actorUserId, "PARTICIPANTS_RECLASSIFIED", cycle.id, {
    changed: rows.length,
    unchanged,
    skippedSubmitted,
    summary: rows
      .slice(0, 40)
      .map((row) => `${row.name}: ${row.before} → ${row.after}`)
      .join(" | ")
      .slice(0, 2000),
  });
  return { ok: true, db, value: { changed: rows.length, unchanged, skippedSubmitted, rows } };
}

/** Antes da abertura: tira a pessoa da lista. Depois: retira do ciclo com motivo, sem apagar o que já existe. */
export function removeParticipant(
  source: PerformanceDatabase,
  input: { participantId: string; reason: string; actorUserId: string | null; scope: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ participantId: string }> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId);
  if (!participant || participant.removedAt) return fail("NOT_FOUND", "Participante não encontrado.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status === "HOMOLOGATED" || cycle.status === "CLOSED") return fail("CYCLE_FROZEN", "Ciclo homologado preserva os participantes.");
  const reason = clean(input.reason, 300);
  const opened = cycle.status !== "DRAFT" && cycle.status !== "PREPARED";
  if (reason.length < (opened ? 8 : 3)) {
    return fail("NOTE_REQUIRED", opened ? "Diga por que a pessoa sai do ciclo (desligamento, afastamento…)." : "Informe o motivo da remoção.");
  }
  const now = options.now();
  participant.removedAt = iso(now);
  participant.removedReason = reason;
  if (opened) {
    for (const assignment of db.assignments.filter((a) => a.participantId === participant.id && a.active)) {
      for (const invite of db.invites.filter((i) => i.assignmentId === assignment.id && !i.revokedAt)) {
        invite.revokedAt = iso(now);
        invite.revokedReason = "Pessoa retirada do ciclo";
      }
      for (const session of db.sessions.filter((s) => s.assignmentId === assignment.id && !s.revoked)) session.revoked = true;
    }
  }
  audit(db, now, input.actorUserId, opened ? "PARTICIPANT_WITHDRAWN" : "PARTICIPANT_REMOVED", participant.id, { cycleStatus: cycle.status });
  return { ok: true, db, value: { participantId: participant.id } };
}

export function setEligibilityException(
  source: PerformanceDatabase,
  input: { participantId: string; reason: string | null; actorUserId: string | null; scope: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ eligibility: string }> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId && !p.removedAt);
  if (!participant) return fail("NOT_FOUND", "Participante não encontrado.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  if (!cycle || (cycle.status !== "DRAFT" && cycle.status !== "PREPARED")) {
    return fail("CYCLE_FROZEN", "A elegibilidade é congelada na abertura.");
  }
  const reason = cleanOrNull(input.reason, 300);
  if (reason && reason.length < 8) return fail("NOTE_REQUIRED", "Justifique a exceção com pelo menos 8 caracteres.");
  participant.eligibilityException = reason;
  const decision = classifyParticipant(participant, cycle, options.now());
  participant.eligibility = decision.state;
  participant.eligibilityReason = decision.reason;
  audit(db, options.now(), input.actorUserId, reason ? "ELIGIBILITY_EXCEPTION_SET" : "ELIGIBILITY_EXCEPTION_CLEARED", participant.id, {
    eligibility: decision.state,
  });
  return { ok: true, db, value: { eligibility: decision.state } };
}

function blankAssignment(
  id: string,
  participant: { id: string; cycleId: string; employeeId: string },
  kind: "SELF" | "LEADER",
  evaluatorEmployeeId: string,
  now: Date
): AssignmentRecord {
  return {
    id,
    participantId: participant.id,
    cycleId: participant.cycleId,
    employeeId: participant.employeeId,
    kind,
    evaluatorEmployeeId,
    status: "NOT_STARTED",
    version: 1,
    revision: 1,
    supersedesId: null,
    active: true,
    submittedAt: null,
    assistedByUserId: null,
    returnReason: null,
    createdAt: iso(now),
    subjectParticipantId: null,
    modelId: null,
  };
}

function ensureAssignments(db: PerformanceDatabase, cycle: CycleRecord, now: Date) {
  for (const participant of eligibleParticipants(db, cycle.id)) {
    participant.frozen = true;
    if (!activeAssignment(db, participant.id, "SELF")) {
      const id = newId();
      db.assignments.push(blankAssignment(id, participant, "SELF", participant.employeeId, now));
      blankAnswers(db, id, cycle.modelId);
    }
    if (participant.managerId && participant.managerId !== participant.employeeId && !activeAssignment(db, participant.id, "LEADER")) {
      const id = newId();
      db.assignments.push(blankAssignment(id, participant, "LEADER", participant.managerId, now));
      blankAnswers(db, id, cycle.modelId);
    }
  }
  for (const participant of liveParticipants(db, cycle.id)) participant.frozen = true;
}

/**
 * Troca o avaliador (exceção do RH, com motivo). Depois da abertura, a avaliação anterior
 * fica inativa e preservada; nasce uma nova tarefa para o novo líder.
 */
export function reassignLeader(
  source: PerformanceDatabase,
  input: { participantId: string; managerId: string; managerName: string; reason: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ participantId: string; assignmentId: string | null }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId && !p.removedAt);
  if (!participant) return fail("NOT_FOUND", "Participante não encontrado.");
  if (!input.managerId) return fail("LEADER_REQUIRED", "Escolha o líder na lista de pessoas.");
  if (input.managerId === participant.employeeId) return fail("SELF_EVALUATOR", "A pessoa não avalia a si mesma como líder.");
  const reason = clean(input.reason, 300);
  if (reason.length < 8) return fail("NOTE_REQUIRED", "Justifique a troca de líder com pelo menos 8 caracteres.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  if (!cycle || cycle.status === "HOMOLOGATED" || cycle.status === "CLOSED") {
    return fail("CYCLE_FROZEN", "O ciclo homologado preserva o avaliador da época.");
  }
  const now = options.now();
  const previousManager = participant.managerId;
  participant.managerId = input.managerId;
  participant.managerName = clean(input.managerName, 160) || null;
  participant.managerSource = "RH";
  let assignmentId: string | null = null;
  const opened = cycle.status !== "DRAFT" && cycle.status !== "PREPARED";
  if (opened && participant.eligibility === "ELIGIBLE") {
    const current = activeAssignment(db, participant.id, "LEADER");
    if (current && current.evaluatorEmployeeId === input.managerId) return fail("SAME_LEADER", "Esta pessoa já é a avaliadora.");
    const id = newId();
    const next = blankAssignment(id, participant, "LEADER", input.managerId, now);
    if (current) {
      current.active = false;
      next.revision = current.revision + 1;
      next.supersedesId = current.id;
    }
    db.assignments.push(next);
    blankAnswers(db, id, cycle.modelId);
    assignmentId = id;
    if (activeResult(db, participant.id)) recompute(db, participant.id, now);
  }
  audit(db, now, input.actorUserId, "LEADER_REASSIGNED", participant.id, {
    from: previousManager,
    to: input.managerId,
    reason,
    afterOpening: opened,
  });
  return { ok: true, db, value: { participantId: participant.id, assignmentId } };
}

/**
 * Atualiza o líder dos participantes pela hierarquia efetiva, antes da abertura.
 * Exceção do RH (managerSource = RH) não é tocada. Depois da abertura, troca só com motivo.
 */
export function syncParticipantLeaders(
  source: PerformanceDatabase,
  input: { cycleId: string; employees: readonly EmployeeSnapshotSource[]; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ changed: number; withoutLeader: number; keptByHr: number }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status !== "DRAFT" && cycle.status !== "PREPARED") {
    return fail("CYCLE_FROZEN", "Depois da abertura, o líder só muda pela troca com motivo.");
  }
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  let changed = 0;
  let withoutLeader = 0;
  let keptByHr = 0;
  for (const participant of liveParticipants(db, cycle.id)) {
    if (participant.managerSource === "RH") {
      keptByHr += 1;
      continue;
    }
    const employee = byId.get(participant.employeeId);
    if (!employee) continue;
    const managerId = employee.managerId && employee.managerId !== participant.employeeId ? employee.managerId : null;
    if (!managerId) withoutLeader += 1;
    if (participant.managerId === managerId) continue;
    participant.managerId = managerId;
    participant.managerName = managerId ? employee.managerName : null;
    participant.managerSource = employee.managerSource ?? "CADASTRO";
    changed += 1;
  }
  audit(db, options.now(), input.actorUserId, "LEADERS_SYNCED", cycle.id, { changed, withoutLeader, keptByHr });
  return { ok: true, db, value: { changed, withoutLeader, keptByHr } };
}

/**
 * Elegíveis sem líder válido: a avaliação da liderança não teria quem fizesse. O topo da
 * estrutura (managerSource TOPO, vindo da hierarquia efetiva) não tem superior por definição.
 */
function participantsWithoutLeader(db: PerformanceDatabase, cycleId: string) {
  return eligibleParticipants(db, cycleId).filter((p) => p.managerSource !== "TOPO" && (!p.managerId || p.managerId === p.employeeId));
}

function pendingParticipants(db: PerformanceDatabase, cycleId: string) {
  return eligibleParticipants(db, cycleId).filter((participant) => {
    const self = activeAssignment(db, participant.id, "SELF");
    const leader = activeAssignment(db, participant.id, "LEADER");
    // Sem tarefa do líder também é pendência (antes passava em silêncio), exceto o topo da estrutura.
    const leaderPending = participant.managerSource === "TOPO" && !leader ? false : leader?.status !== "SUBMITTED";
    return self?.status !== "SUBMITTED" || leaderPending || pendingLeadershipTasks(db, participant.id) > 0;
  });
}

/** Avaliação da liderança enviada para a pessoa (a versão ativa). */
export function hasSubmittedLeaderEvaluation(db: PerformanceDatabase, participantId: string): boolean {
  return activeAssignment(db, participantId, "LEADER")?.status === "SUBMITTED";
}

export function transitionCycle(
  source: PerformanceDatabase,
  input: {
    cycleId: string;
    to: CycleStatus;
    actorUserId: string | null;
    reversalReason: string | null;
    pilotAck?: boolean;
    actorEmployeeId?: string | null;
    acceptPending?: boolean;
    /** Só a rota de homologação (permissão de calibração) passa `true`. */
    canHomologate?: boolean;
    /** Liderados diretos ativos (hierarquia efetiva), exigido na abertura de ciclo com 180°. */
    leadershipSnapshot?: LeadershipSnapshot;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ status: string; pending?: number }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  const reason = clean(input.reversalReason, 300);
  const isReversal = nextCycleStatus(cycle.status, input.to, true).ok && nextCycleStatus(cycle.status, input.to, false).ok === false;
  if (isReversal && reason.length < 8) return fail("NOTE_REQUIRED", "Voltar a situação do ciclo exige um motivo com pelo menos 8 caracteres.");
  const step = nextCycleStatus(cycle.status, input.to, reason.length >= 8);
  if (step.ok === false) return fail(step.code, "Esta mudança de situação não é permitida.");
  const now = options.now();
  if (input.to === "HOMOLOGATED" && input.canHomologate !== true) {
    return fail("FORBIDDEN", "Homologar exige a permissão de calibração.");
  }
  if (isReversal && cycle.status === "HOMOLOGATED" && input.canHomologate !== true) {
    return fail("FORBIDDEN", "Reabrir resultados homologados exige a permissão de calibração.");
  }
  if (input.to === "PREPARED" && !isReversal) {
    const model = modelOfCycle(db, cycle);
    if (!model || model.status !== "PUBLISHED") return fail("MODEL_REQUIRED", "Publique o modelo antes de preparar o ciclo.");
    if (liveParticipants(db, cycle.id).length === 0) return fail("PARTICIPANTS_REQUIRED", "Selecione as pessoas do ciclo.");
  }
  let pending = 0;
  if (input.to === "OPEN" && !isReversal) {
    if (!options.officialPublication && input.pilotAck !== true) {
      return fail("GOVERNANCE_BLOCKED", "A abertura pede a confirmação de que as regras ainda estão em proposta. O ciclo pode ficar preparado.");
    }
    if (eligibleParticipants(db, cycle.id).length === 0) return fail("PARTICIPANTS_REQUIRED", "Não há pessoa elegível para abrir o ciclo.");
    const missingLeader = participantsWithoutLeader(db, cycle.id);
    if (missingLeader.length > 0) {
      const names = missingLeader.slice(0, 5).map((p) => p.employeeName).join(", ");
      const more = missingLeader.length > 5 ? ` e mais ${missingLeader.length - 5}` : "";
      return fail(
        "LEADER_MISSING",
        `${missingLeader.length} pessoa(s) elegível(is) sem líder: ${names}${more}. Atualize os líderes pelo organograma, escolha o líder ou retire a pessoa do ciclo.`
      );
    }
    if (!options.officialPublication) audit(db, now, input.actorUserId, "PILOT_OPEN", cycle.id, { homologated: false });
    ensureAssignments(db, cycle, now);
    if (cycle.leadershipModelId) {
      if (!input.leadershipSnapshot) return fail("LEADERSHIP_SNAPSHOT_REQUIRED", "Não foi possível ler a hierarquia para a avaliação de liderança. Tente de novo.");
      applyLeadershipSnapshot(db, cycle, input.leadershipSnapshot, now);
      const created = ensureLeadershipAssignments(db, cycle, now);
      audit(db, now, input.actorUserId, "LEADERSHIP_ASSIGNMENTS_CREATED", cycle.id, {
        leaders: liveParticipants(db, cycle.id).filter((p) => p.isLeader).length,
        ...created,
      });
    }
    cycle.openedAt = iso(now);
  }
  if (input.to === "CONSOLIDATION" && !isReversal) {
    pending = pendingParticipants(db, cycle.id).length;
    if (pending > 0 && input.acceptPending !== true) {
      return fail("PENDING_ASSIGNMENTS", `Ainda há ${pending} pessoa(s) sem autoavaliação ou sem avaliação do líder. Confirme para seguir mesmo assim.`);
    }
    if (pending > 0) audit(db, now, input.actorUserId, "PENDING_ACCEPTED", cycle.id, { pending, stage: "CONSOLIDATION" });
    let revoked = 0;
    for (const participant of liveParticipants(db, cycle.id)) {
      const self = activeAssignment(db, participant.id, "SELF");
      if (!self || self.status === "SUBMITTED") continue;
      for (const invite of db.invites.filter((i) => i.assignmentId === self.id && !i.revokedAt)) {
        invite.revokedAt = iso(now);
        invite.revokedReason = "Coleta encerrada";
        revoked += 1;
      }
      for (const session of db.sessions.filter((s) => s.assignmentId === self.id && !s.revoked)) session.revoked = true;
    }
    if (revoked > 0) audit(db, now, input.actorUserId, "INVITES_REVOKED_AT_CLOSE", cycle.id, { revoked });
  }
  if (input.to === "CALIBRATION" && !isReversal) {
    for (const participant of eligibleParticipants(db, cycle.id)) {
      if (!activeResult(db, participant.id)) recompute(db, participant.id, now);
    }
  }
  if (input.to === "HOMOLOGATED") {
    const eligible = eligibleParticipants(db, cycle.id);
    if (input.actorEmployeeId && eligible.some((p) => p.employeeId === input.actorEmployeeId)) {
      return fail("SELF_HOMOLOGATION", "Quem participa do ciclo não homologa o próprio resultado.");
    }
    for (const participant of eligible) {
      if (resultPendingTenureValidation(participant)) {
        return fail(
          "TENURE_VALIDATION_REQUIRED",
          `${participant.employeeName} participa, mas o resultado espera o RH validar o tempo mínimo ou confirmar o vínculo.`
        );
      }
      const leader = activeAssignment(db, participant.id, "LEADER");
      if (leader && (leader.status === "RETURNED" || (leader.status === "IN_PROGRESS" && leader.revision > 1))) {
        return fail("REVISION_OPEN", `A revisão do líder de ${participant.employeeName} ainda não voltou.`);
      }
      const result = activeResult(db, participant.id);
      if (!result || result.reviewStatus !== "CALIBRATED") {
        return fail("CALIBRATION_REQUIRED", "Homologar o ciclo exige a calibração de cada pessoa elegível.");
      }
      if (!hasSubmittedLeaderEvaluation(db, participant.id) && !calibratedWithoutLeaderException(db, participant.id, result.id)) {
        return fail(
          "LEADER_EVALUATION_REQUIRED",
          `${participant.employeeName} não tem avaliação do líder. Peça a avaliação, troque o líder ou registre a exceção na calibração.`
        );
      }
      if (result.technicalValidation === "PENDING_VALIDATION") {
        return fail("VALIDATION_REQUIRED", "Há desempenho técnico sem validação da função.");
      }
    }
    const leadershipProblem = leadershipHomologationProblem(db, cycle);
    if (leadershipProblem) return fail("LEADERSHIP_CALIBRATION_REQUIRED", leadershipProblem);
    for (const participant of eligible) activeResult(db, participant.id)!.official = true;
    markLeadershipOfficial(db, cycle, true);
    audit(db, now, input.actorUserId, "RESULTS_HOMOLOGATED", cycle.id, {
      count: eligible.length,
      classification: cycle.classification,
      officialPublication: options.officialPublication === true,
    });
  }
  if (isReversal && cycle.status === "HOMOLOGATED") {
    markLeadershipOfficial(db, cycle, false);
    let reopened = 0;
    for (const participant of eligibleParticipants(db, cycle.id)) {
      const result = activeResult(db, participant.id);
      if (result?.official) {
        result.official = false;
        reopened += 1;
      }
    }
    audit(db, now, input.actorUserId, "RESULTS_REOPENED", cycle.id, { reopened });
  }
  if (input.to === "CLOSED") {
    const withoutFeedback = eligibleParticipants(db, cycle.id).filter(
      (p) => activeResult(db, p.id)?.official && !db.feedbacks.some((f) => f.participantId === p.id)
    ).length;
    if (withoutFeedback > 0 && input.acceptPending !== true) {
      return fail("PENDING_FEEDBACK", `${withoutFeedback} pessoa(s) ainda sem devolutiva registrada. Confirme para encerrar mesmo assim.`);
    }
    if (withoutFeedback > 0) audit(db, now, input.actorUserId, "PENDING_ACCEPTED", cycle.id, { pending: withoutFeedback, stage: "CLOSED" });
    pending = withoutFeedback;
    cycle.closedAt = iso(now);
  }
  if (isReversal) {
    audit(db, now, input.actorUserId, "CYCLE_REVERSED", cycle.id, { from: cycle.status, to: input.to, reason });
  }
  cycle.status = input.to;
  audit(db, now, input.actorUserId, "CYCLE_TRANSITION", cycle.id, { status: input.to });
  return { ok: true, db, value: { status: cycle.status, pending } };
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

function applyAnswer(row: AnswerRecord, kind: AssignmentRecord["kind"], answer: AnswerInput, rules: PerformanceRules): ServiceError | null {
  if (!evidenceSatisfied(kind, answer, rules)) {
    return fail("EVIDENCE_REQUIRED", `Nas notas 1 e 4, escreva um exemplo do que você observou (mínimo de ${rules.evidenceMinChars} caracteres).`);
  }
  if (answer.kind === "pending") {
    row.kind = "pending";
    row.score = null;
    row.evidence = null;
    return null;
  }
  const evidence = kind === "LEADER" ? cleanOrNull(answer.evidence ?? null, EVIDENCE_MAX_CHARS) : null;
  if (answer.kind === "notObserved") {
    row.kind = "notObserved";
    row.score = null;
    row.evidence = evidence;
    return null;
  }
  row.kind = "score";
  row.score = answer.score;
  row.evidence = evidence;
  return null;
}

/** Etapas respondidas pela própria pessoa no portal (autoavaliação e liderança). */
function isJourneyKind(kind: AssignmentRecord["kind"]): boolean {
  return kind === "SELF" || kind === "LEADERSHIP_UPWARD" || kind === "LEADERSHIP_SELF";
}

/**
 * Responder adiantado: a etapa ainda não abriu, mas a pessoa já concluiu a primeira que estava disponível e pode seguir,
 * se quiser. O início da etapa só deixa de travar; o fim continua valendo, e a primeira etapa nunca abre antes da data.
 * - Na jornada (autoavaliação → liderança): as anteriores enviadas ou encerradas, com pelo menos uma enviada.
 * - Avaliações que o líder faz: a autoavaliação dele neste ciclo enviada. Quem não participa do ciclo espera a data.
 */
function answersAhead(db: PerformanceDatabase, cycle: CycleRecord, assignment: AssignmentRecord, now: Date): boolean {
  if (cycle.status !== "OPEN" || assignment.status === "SUBMITTED") return false;
  const window = kindWindow(cycle, assignment.kind);
  if (!window) return false;
  const today = localDay(now);
  if (windowState(window, today) !== "BEFORE") return false;
  if (isJourneyKind(assignment.kind)) {
    const journey = journeyOf(db, assignment.participantId);
    const earlier = journey.slice(0, journey.findIndex((a) => a.id === assignment.id));
    return (
      earlier.some((a) => a.status === "SUBMITTED") &&
      earlier.every((a) => {
        const earlierWindow = kindWindow(cycle, a.kind);
        return a.status === "SUBMITTED" || (earlierWindow !== null && windowState(earlierWindow, today) === "AFTER");
      })
    );
  }
  return db.assignments.some(
    (a) =>
      a.active &&
      a.cycleId === cycle.id &&
      a.kind === "SELF" &&
      a.employeeId === assignment.evaluatorEmployeeId &&
      a.status === "SUBMITTED"
  );
}

/** Data em que a etapa abre, quando a pessoa está respondendo adiantado. */
function aheadOpensAt(db: PerformanceDatabase, cycle: CycleRecord, assignment: AssignmentRecord, now: Date): string | null {
  return answersAhead(db, cycle, assignment, now) ? kindWindow(cycle, assignment.kind)?.startsAt ?? null : null;
}

function assignmentClosedMessage(db: PerformanceDatabase, cycle: CycleRecord, assignment: AssignmentRecord, now: Date): string | null {
  return answersAhead(db, cycle, assignment, now) ? null : stageClosedMessage(cycle, assignment.kind, now);
}

/**
 * A tarefa aceita resposta agora? Com o ciclo Aberto e calendário de etapas, só dentro da janela da etapa dela
 * (autoavaliação, líder ou liderança), ou antes dela para quem pode adiantar (`answersAhead`). Depois da coleta, a
 * avaliação do líder segue aberta para revisão devolvida.
 */
function collectionOpenFor(db: PerformanceDatabase, cycle: CycleRecord, assignment: AssignmentRecord, now: Date): boolean {
  if (answersAhead(db, cycle, assignment, now)) return true;
  if (cycle.status === "OPEN" && !kindWindowOpen(cycle, assignment.kind, localDay(now))) {
    // A avaliação do líder não abre antes do início; depois do fim fica atrasada (como o prazo antigo) e segue
    // aceitando resposta até o RH fechar a coleta. Assim a revisão devolvida também continua possível.
    const window = assignment.kind === "LEADER" ? kindWindow(cycle, assignment.kind) : null;
    if (!window || windowState(window, localDay(now)) !== "AFTER") return false;
  }
  if (isJourneyKind(assignment.kind)) return cycle.status === "OPEN";
  return cycle.status === "OPEN" || cycle.status === "CONSOLIDATION" || cycle.status === "CALIBRATION";
}

/** Por que a etapa desta tarefa não aceita resposta hoje (null = aceita ou não há calendário). */
export function stageClosedMessage(cycle: CycleRecord, kind: AssignmentRecord["kind"], now: Date): string | null {
  if (cycle.status !== "OPEN") return null;
  const window = kindWindow(cycle, kind);
  if (!window) return null;
  const state = windowState(window, localDay(now));
  if (state === "BEFORE") return `A etapa “${window.label}” abre em ${formatDateBr(window.startsAt)}.`;
  if (state === "AFTER" && kind !== "LEADER") return `A etapa “${window.label}” terminou em ${formatDateBr(window.endsAt)}. Fale com o RH se precisar.`;
  return null;
}

export function saveAnswers(
  source: PerformanceDatabase,
  input: {
    assignmentId: string;
    expectedVersion: number;
    answers: readonly { code: string; answer: AnswerInput }[];
    actorUserId: string | null;
    scope: PerformanceScope;
    assistedByUserId?: string | null;
  },
  options: ServiceOptions
): ServiceResult<{ version: number }> {
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!assignment) return fail("NOT_FOUND", "Tarefa não encontrada.");
  const participant = db.participants.find((p) => p.id === assignment.participantId);
  const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
  if (!participant || !cycle || participant.removedAt) return fail("NOT_FOUND", "Tarefa não encontrada.");
  if ((assignment.kind === "LEADER" || assignment.kind === "LEADERSHIP_SUPERIOR") && !canActOnLeaderAssignment(input.scope, assignment)) {
    return fail("FORBIDDEN", "Você não avalia esta pessoa.");
  }
  if (assignment.kind === "LEADERSHIP_UPWARD" || assignment.kind === "LEADERSHIP_SELF") {
    // Só quem responde (ou o preenchimento assistido). Nem o RH preenche ou lê a avaliação da equipe.
    const own = input.scope.kind === "LIMITED" && input.scope.actorEmployeeId === assignment.evaluatorEmployeeId;
    if (!own && !input.assistedByUserId) return fail("FORBIDDEN", "Esta etapa é respondida só pela própria pessoa.");
  }
  if (assignment.kind === "SELF" && input.scope.kind !== "ALL") {
    const actor = input.scope.actorEmployeeId;
    const assisted = Boolean(input.assistedByUserId);
    if (!assisted && actor !== assignment.employeeId) return fail("FORBIDDEN", "A autoavaliação é só da própria pessoa.");
  }
  if (assignment.status === "SUBMITTED") return fail("ASSIGNMENT_LOCKED", "Esta resposta já foi enviada.");
  if (!collectionOpenFor(db, cycle, assignment, options.now())) {
    return fail("COLLECTION_CLOSED", stageClosedMessage(cycle, assignment.kind, options.now()) ?? "A coleta deste ciclo está fechada.");
  }
  if (assignment.version !== input.expectedVersion) return fail("VERSION_CONFLICT", "A avaliação mudou em outro lugar. Atualize a tela para ver a versão atual.");
  const rules = rulesOfCycle(db, cycle);
  for (const item of input.answers) {
    const row = db.answers.find((a) => a.assignmentId === assignment.id && a.questionCode === item.code);
    if (!row) return fail("NOT_FOUND", "Pergunta não faz parte desta versão.");
    if (isLeadershipKind(assignment.kind)) {
      const leadershipProblem = applyLeadershipAnswer(row, item.answer);
      if (leadershipProblem) return fail(leadershipProblem.code, leadershipProblem.message);
      continue;
    }
    const problem = applyAnswer(row, assignment.kind, item.answer, rules);
    if (problem) return problem;
  }
  assignment.version += 1;
  assignment.status = "IN_PROGRESS";
  if (input.assistedByUserId) assignment.assistedByUserId = input.assistedByUserId;
  audit(db, options.now(), input.actorUserId, "ANSWERS_SAVED", assignment.id, {
    version: assignment.version,
    count: input.answers.length,
    assisted: Boolean(input.assistedByUserId),
  });
  return { ok: true, db, value: { version: assignment.version } };
}

function pendingCount(db: PerformanceDatabase, assignmentId: string): number {
  return db.answers.filter((a) => a.assignmentId === assignmentId && a.kind === "pending").length;
}

export function submitAssignment(
  source: PerformanceDatabase,
  input: { assignmentId: string; expectedVersion: number; actorUserId: string | null; scope: PerformanceScope; assistedConfirmation: boolean },
  options: ServiceOptions
): ServiceResult<{ status: string }> {
  const assignment = source.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!assignment) return fail("NOT_FOUND", "Tarefa não encontrada.");
  if ((assignment.kind === "LEADER" || assignment.kind === "LEADERSHIP_SUPERIOR") && !canActOnLeaderAssignment(input.scope, assignment)) return fail("FORBIDDEN", "Você não avalia esta pessoa.");
  if (assignment.status === "SUBMITTED") return { ok: true, db: source, value: { status: "SUBMITTED" } };
  if (assignment.assistedByUserId && !input.assistedConfirmation) {
    return fail("ASSIST_CONFIRMATION", "A pessoa precisa confirmar as respostas antes do envio.");
  }
  if (pendingCount(source, assignment.id) > 0) return fail("INCOMPLETE", "Ainda há pergunta sem resposta.");
  const cycle = source.cycles.find((c) => c.id === assignment.cycleId);
  if (isLeadershipKind(assignment.kind)) {
    const leadershipProblem = leadershipSubmitProblem(source, assignment);
    if (leadershipProblem) return fail("COMMENT_REQUIRED", leadershipProblem);
  } else if (cycle) {
    const rules = rulesOfCycle(source, cycle);
    const missingEvidence = source.answers.some(
      (a) =>
        a.assignmentId === assignment.id &&
        a.kind === "score" &&
        evidenceRequired(assignment.kind, { kind: "score", score: a.score!, evidence: a.evidence }, rules) &&
        !evidenceSatisfied(assignment.kind, { kind: "score", score: a.score!, evidence: a.evidence }, rules)
    );
    if (missingEvidence) return fail("EVIDENCE_REQUIRED", "Há nota 1 ou 4 sem exemplo observado.");
  }
  const saved = saveAnswers(source, { ...input, answers: [] }, options);
  if (saved.ok === false) return saved;
  const db = saved.db;
  const current = db.assignments.find((a) => a.id === assignment.id)!;
  current.status = "SUBMITTED";
  current.submittedAt = iso(options.now());
  // Resultado individual (Nine-Box) só depende das tarefas individuais.
  if (!isLeadershipKind(current.kind)) recompute(db, current.participantId, options.now());
  audit(db, options.now(), input.actorUserId, "ASSIGNMENT_SUBMITTED", current.id, {
    kind: current.kind,
    revision: current.revision,
    assisted: Boolean(current.assistedByUserId),
  });
  if (isJourneyKind(current.kind)) {
    // A sessão do portal só termina quando todas as etapas da pessoa estiverem enviadas.
    if (journeyDone(db, current.participantId)) {
      const root = activeAssignment(db, current.participantId, "SELF");
      for (const session of db.sessions.filter((s) => s.assignmentId === current.id || s.assignmentId === root?.id)) session.revoked = true;
    }
  } else {
    for (const session of db.sessions.filter((s) => s.assignmentId === current.id)) session.revoked = true;
  }
  return { ok: true, db, value: { status: "SUBMITTED" } };
}

/** Recalcula o resultado preliminar. Só a avaliação ENVIADA do líder entra na nota oficial. */
export function recompute(db: PerformanceDatabase, participantId: string, now: Date) {
  const participant = db.participants.find((p) => p.id === participantId);
  const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
  if (!participant || !cycle) return;
  const model = modelOfCycle(db, cycle);
  const rules = model?.rules ?? proposedRules();
  const leader = activeAssignment(db, participant.id, "LEADER");
  const sourceAnswers = leader && leader.status === "SUBMITTED" ? toStored(db, leader.id) : [];
  const technical = aggregatePillar(sourceAnswers, "TECHNICAL", rules.minValidAnswers);
  const culture = aggregatePillar(sourceAnswers, "CULTURE", rules.minValidAnswers);
  const potential = aggregatePillar(sourceAnswers, "POTENTIAL", rules.minValidAnswers);
  const cultureResult = cultureBand(sourceAnswers, rules);
  const previous = activeResult(db, participant.id);
  const sameTechnical = previous && previous.technicalSum === technical.sum && previous.technicalCount === technical.count;
  const technicalValidation = technical.insufficient
    ? "INSUFFICIENT"
    : previous?.technicalValidation === "VALIDATED" && sameTechnical
      ? "VALIDATED"
      : "PENDING_VALIDATION";
  const placement = placeNineBox({ technical, potential, technicalValidation, rules });
  if (previous) previous.active = false;
  db.results.push({
    id: newId(),
    participantId: participant.id,
    version: (previous?.version ?? 0) + 1,
    active: true,
    technicalSum: technical.sum,
    technicalCount: technical.count,
    cultureSum: culture.sum,
    cultureCount: culture.count,
    potentialSum: potential.sum,
    potentialCount: potential.count,
    technicalValidation,
    validationNote: technicalValidation === "VALIDATED" ? previous?.validationNote ?? null : null,
    cultureBand: cultureResult.band,
    cultureBasis: cultureResult.basis,
    quadrant: placement.quadrant,
    nineBoxReason: placement.reason,
    nineX: placement.x,
    nineY: placement.y,
    official: false,
    reviewStatus: "PRELIMINARY",
    algorithmId: ALGORITHM_ID,
    nineBoxRuleId: placement.ruleId,
    cultureRuleId: cultureResult.ruleId,
    supersedesId: previous?.id ?? null,
    ruleSnapshot: { ...rules, modelId: cycle.modelId, modelVersion: model?.version ?? 0 },
    adjusted: false,
    calibrationNote: null,
    calibratedByUserId: null,
    calibratedAt: null,
    createdAt: iso(now),
  });
}

function nextResultVersion(db: PerformanceDatabase, current: ResultRecord, patch: Partial<ResultRecord>, now: Date): ResultRecord {
  current.active = false;
  const next: ResultRecord = {
    ...current,
    ...patch,
    id: newId(),
    version: current.version + 1,
    active: true,
    official: false,
    supersedesId: current.id,
    createdAt: iso(now),
  };
  db.results.push(next);
  return next;
}

export function validateTechnical(
  source: PerformanceDatabase,
  input: { participantId: string; decision: "VALIDATED" | "INSUFFICIENT"; note: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ quadrant: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  if (input.decision !== "VALIDATED" && input.decision !== "INSUFFICIENT") return fail("INVALID_DECISION", "Escolha validar ou marcar evidência insuficiente.");
  const note = clean(input.note, 600);
  if (note.length < 8) return fail("NOTE_REQUIRED", "Registre o critério da função usado nesta validação.");
  const db = cloneDb(source);
  const current = activeResult(db, input.participantId);
  if (!current) return fail("NOT_FOUND", "Ainda não há resultado do líder.");
  if (current.official) return fail("RESULT_LOCKED", "Resultado homologado só muda por revisão formal do ciclo.");
  const participant = db.participants.find((p) => p.id === input.participantId)!;
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  const rules = current.ruleSnapshot ?? rulesOfCycle(db, cycle);
  const technical = { sum: current.technicalSum, count: current.technicalCount, notObserved: 0, insufficient: current.technicalCount < rules.minValidAnswers, display: null };
  const potential = { sum: current.potentialSum, count: current.potentialCount, notObserved: 0, insufficient: current.potentialCount < rules.minValidAnswers, display: null };
  if (input.decision === "VALIDATED" && technical.insufficient) {
    return fail("INSUFFICIENT_EVIDENCE", "Com menos respostas válidas que o mínimo, o técnico não pode ser validado.");
  }
  const placement = placeNineBox({ technical, potential, technicalValidation: input.decision, rules });
  nextResultVersion(
    db,
    current,
    {
      technicalValidation: input.decision,
      validationNote: note,
      quadrant: placement.quadrant,
      nineBoxReason: placement.reason,
      nineX: placement.x,
      nineY: placement.y,
      reviewStatus: "PRELIMINARY",
      adjusted: false,
      calibrationNote: null,
      calibratedAt: null,
      calibratedByUserId: null,
    },
    options.now()
  );
  audit(db, options.now(), input.actorUserId, "TECHNICAL_VALIDATED", input.participantId, { decision: input.decision });
  return { ok: true, db, value: { quadrant: placement.quadrant } };
}

export function calibrate(
  source: PerformanceDatabase,
  input: {
    participantId: string;
    note: string;
    actorUserId: string | null;
    actorEmployeeId: string | null;
    decision?: "CONFIRM" | "ADJUST";
    technicalBand?: NineBoxBand | null;
    potentialBand?: NineBoxBand | null;
    /** Exceção explícita: confirmar sem avaliação do líder (fica sem quadrante e auditado). */
    acceptMissingLeader?: boolean;
    /** Quem participou da sessão de calibração (comitê: líder de líderes, pares, RH). Vai para a nota e a auditoria. */
    committee?: string | null;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ reviewStatus: string; quadrant: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const committee = clean(input.committee ?? "", 300);
  const note = committee ? clean(`Comitê: ${committee} · ${clean(input.note, 600)}`, 600) : clean(input.note, 600);
  if (note.length < 8) return fail("NOTE_REQUIRED", "A calibração precisa de um motivo com pelo menos 8 caracteres.");
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId && !p.removedAt);
  if (!participant) return fail("NOT_FOUND", "Participante não encontrado.");
  if (input.actorEmployeeId && input.actorEmployeeId === participant.employeeId) {
    return fail("SELF_HOMOLOGATION", "A pessoa não calibra o próprio resultado.");
  }
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  if (cycle.status !== "CONSOLIDATION" && cycle.status !== "CALIBRATION") {
    return fail("CYCLE_STAGE", "A calibração acontece na consolidação ou na calibração do ciclo.");
  }
  const now = options.now();
  if (!activeResult(db, participant.id)) recompute(db, participant.id, now);
  const current = activeResult(db, participant.id)!;
  if (current.official) return fail("RESULT_LOCKED", "Resultado homologado só muda por revisão formal do ciclo.");
  if (current.technicalValidation === "PENDING_VALIDATION") {
    return fail("VALIDATION_REQUIRED", "Valide o desempenho técnico com a função antes de calibrar.");
  }
  const decision = input.decision ?? "CONFIRM";
  const withoutLeader = !hasSubmittedLeaderEvaluation(db, participant.id);
  if (withoutLeader && input.acceptMissingLeader !== true) {
    return fail(
      "LEADER_EVALUATION_REQUIRED",
      "Não há avaliação do líder enviada. Peça a avaliação ou troque o líder; só registre a exceção se a pessoa realmente não puder ser avaliada pela liderança."
    );
  }
  if (withoutLeader && decision === "ADJUST") {
    return fail("INSUFFICIENT_EVIDENCE", "Sem avaliação do líder não há posição para ajustar.");
  }
  let patch: Partial<ResultRecord> = { reviewStatus: "CALIBRATED", adjusted: false };
  if (decision === "ADJUST") {
    if (current.quadrant === UNCLASSIFIED_QUADRANT || current.nineX == null || current.nineY == null) {
      return fail("INSUFFICIENT_EVIDENCE", "Sem evidência suficiente não há quadrante para ajustar.");
    }
    if (!isNineBoxBand(input.technicalBand) || !isNineBoxBand(input.potentialBand)) {
      return fail("INVALID_BAND", "Escolha a faixa de desempenho e de potencial.");
    }
    if (input.technicalBand === current.nineX && input.potentialBand === current.nineY) {
      return fail("NO_CHANGE", "A posição escolhida é a mesma. Use Confirmar.");
    }
    patch = {
      reviewStatus: "CALIBRATED",
      adjusted: true,
      nineX: input.technicalBand,
      nineY: input.potentialBand,
      quadrant: quadrantLabel(input.technicalBand, input.potentialBand),
      nineBoxReason: "Posição ajustada na calibração, com justificativa registrada. As notas originais continuam na versão anterior.",
    };
  }
  const next = nextResultVersion(
    db,
    current,
    { ...patch, calibrationNote: note, calibratedByUserId: input.actorUserId, calibratedAt: iso(now) },
    now
  );
  audit(
    db,
    now,
    input.actorUserId,
    withoutLeader ? CALIBRATED_WITHOUT_LEADER : decision === "ADJUST" ? "RESULT_ADJUSTED" : "RESULT_CALIBRATED",
    participant.id,
    {
      from: current.id,
      to: next.id,
      fromQuadrant: current.quadrant,
      toQuadrant: next.quadrant,
    }
  );
  return { ok: true, db, value: { reviewStatus: "CALIBRATED", quadrant: next.quadrant } };
}

const CALIBRATED_WITHOUT_LEADER = "RESULT_CALIBRATED_WITHOUT_LEADER";

/** A versão ativa do resultado foi confirmada sem avaliação do líder, como exceção registrada. */
function calibratedWithoutLeaderException(db: PerformanceDatabase, participantId: string, resultId: string): boolean {
  return db.audits.some((a) => a.action === CALIBRATED_WITHOUT_LEADER && a.entityId === participantId && a.detail.to === resultId);
}

export function returnForRevision(
  source: PerformanceDatabase,
  input: { assignmentId: string; reason: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ assignmentId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const reason = clean(input.reason, 600);
  if (reason.length < 8) return fail("NOTE_REQUIRED", "Diga o que precisa ser revisto.");
  const db = cloneDb(source);
  const current = db.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!current || current.status !== "SUBMITTED") return fail("NOT_SUBMITTED", "Só uma resposta enviada volta para revisão.");
  if (current.kind !== "LEADER") return fail("NOT_LEADER", "Só a avaliação da liderança volta para revisão.");
  const cycle = db.cycles.find((c) => c.id === current.cycleId);
  if (!cycle || !["OPEN", "CONSOLIDATION", "CALIBRATION"].includes(cycle.status)) {
    return fail("CYCLE_STAGE", "A revisão só é pedida antes da homologação.");
  }
  if (activeResult(db, current.participantId)?.official) return fail("RESULT_LOCKED", "Resultado homologado só muda por revisão formal do ciclo.");
  current.active = false;
  const nextId = newId();
  db.assignments.push({
    ...current,
    id: nextId,
    status: "RETURNED",
    version: 1,
    revision: current.revision + 1,
    supersedesId: current.id,
    active: true,
    submittedAt: null,
    returnReason: reason,
    createdAt: iso(options.now()),
  });
  for (const answer of db.answers.filter((a) => a.assignmentId === current.id)) {
    db.answers.push({ ...answer, id: newId(), assignmentId: nextId });
  }
  audit(db, options.now(), input.actorUserId, "ASSIGNMENT_RETURNED", nextId, { revision: current.revision + 1, previous: current.id });
  return { ok: true, db, value: { assignmentId: nextId } };
}

// ---------------------------------------------------------------------------
// Convites e portal
// ---------------------------------------------------------------------------

function inviteExpiry(cycle: CycleRecord, now: Date): Date {
  const max = now.getTime() + INVITE_TTL_DAYS * 86_400_000;
  // O mesmo convite vale para a jornada inteira (autoavaliação e, depois, liderança): vai até a última etapa dela.
  const lastJourneyDay = cycle.leadershipModelId && cycle.leadershipDueAt && cycle.leadershipDueAt > cycle.selfDueAt ? cycle.leadershipDueAt : cycle.selfDueAt;
  const dueEnd = new Date(`${lastJourneyDay}T23:59:59.000-03:00`).getTime();
  const floor = now.getTime() + 86_400_000;
  return new Date(Math.max(floor, Math.min(max, Number.isNaN(dueEnd) ? max : dueEnd)));
}

type IssuedInvite = { participantId: string; employeeName: string; roleName: string; url: string; otp: string; inviteId: string; expiresAt: string };

function issueInto(db: PerformanceDatabase, assignmentId: string, actorUserId: string | null, now: Date, options: ServiceOptions): IssuedInvite | ServiceError {
  const assignment = db.assignments.find((a) => a.id === assignmentId && a.active && a.kind === "SELF");
  if (!assignment) return fail("NOT_FOUND", "Convite só existe para a autoavaliação.");
  // O convite abre a jornada inteira: só fica bloqueado quando todas as etapas foram enviadas.
  if (journeyDone(db, assignment.participantId)) return fail("ASSIGNMENT_LOCKED", "A pesquisa já foi enviada.");
  const participant = db.participants.find((p) => p.id === assignment.participantId);
  const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
  if (!participant || !cycle || participant.removedAt) return fail("NOT_FOUND", "Participante fora do ciclo.");
  if (cycle.status !== "OPEN") return fail("CYCLE_STAGE", "Convites só são emitidos com o ciclo aberto.");
  for (const invite of db.invites.filter((i) => i.assignmentId === assignment.id && !i.revokedAt)) {
    invite.revokedAt = iso(now);
    invite.revokedReason = "Reemissão";
  }
  for (const session of db.sessions.filter((s) => s.assignmentId === assignment.id && s.phase !== "ASSISTED" && !s.revoked)) session.revoked = true;
  const token = newLinkToken();
  const otp = newOtpCode();
  const inviteId = newId();
  const expires = inviteExpiry(cycle, now);
  db.invites.push({
    id: inviteId,
    assignmentId: assignment.id,
    linkDigest: digestSecret(token),
    otpDigest: digestSecret(otp),
    expiresAt: iso(expires),
    revokedAt: null,
    revokedReason: null,
    failedAttempts: 0,
    locked: false,
    createdAt: iso(now),
  });
  audit(db, now, actorUserId, "INVITE_ISSUED", inviteId, { assignmentId: assignment.id });
  return {
    participantId: participant.id,
    employeeName: participant.employeeName,
    roleName: participant.roleName,
    url: buildInviteHashUrl(options.publicOrigin, token),
    otp,
    inviteId,
    expiresAt: iso(expires),
  };
}

export function issueInvite(
  source: PerformanceDatabase,
  input: { assignmentId: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<IssuedInvite> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const issued = issueInto(db, input.assignmentId, input.actorUserId, options.now(), options);
  if ("ok" in issued) return issued;
  return { ok: true, db, value: issued };
}

/** Lote: emite para quem ainda não respondeu. `onlyMissing` preserva convites ativos. */
export function issueInvitesBatch(
  source: PerformanceDatabase,
  input: { cycleId: string; participantIds: readonly string[] | null; onlyMissing: boolean; actorUserId: string | null; scope: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ issued: IssuedInvite[]; skipped: number; deferred: number }> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status !== "OPEN") return fail("CYCLE_STAGE", "Convites só são emitidos com o ciclo aberto.");
  const now = options.now();
  const wanted = input.participantIds ? new Set(input.participantIds) : null;
  const issued: IssuedInvite[] = [];
  let skipped = 0;
  let deferred = 0;
  for (const participant of eligibleParticipants(db, cycle.id)) {
    if (wanted && !wanted.has(participant.id)) continue;
    if (participant.absenceInWindow && !participant.eligibilityException?.trim()) {
      deferred += 1;
      continue;
    }
    const self = activeAssignment(db, participant.id, "SELF");
    if (!self || journeyDone(db, participant.id)) {
      skipped += 1;
      continue;
    }
    if (input.onlyMissing) {
      const live = db.invites.some(
        (i) => i.assignmentId === self.id && !i.revokedAt && !i.locked && new Date(i.expiresAt).getTime() > now.getTime()
      );
      if (live) {
        skipped += 1;
        continue;
      }
    }
    const result = issueInto(db, self.id, input.actorUserId, now, options);
    if ("ok" in result) return result;
    issued.push(result);
  }
  audit(db, now, input.actorUserId, "INVITES_BATCH", cycle.id, { issued: issued.length, skipped, deferred });
  return { ok: true, db, value: { issued, skipped, deferred } };
}

/** O RH registra que a folha do QR foi entregue em mãos. Vai para a auditoria; a central mostra "entregue". */
export function markInviteDelivered(
  source: PerformanceDatabase,
  input: { assignmentId: string; actorUserId: string | null; scope: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ inviteId: string }> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!assignment) return fail("NOT_FOUND", "Tarefa não encontrada.");
  const invite = db.invites.filter((i) => i.assignmentId === assignment.id && !i.revokedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!invite) return fail("INVITE_REQUIRED", "Não há convite ativo para registrar a entrega.");
  audit(db, options.now(), input.actorUserId, "INVITE_DELIVERED", invite.id, { assignmentId: assignment.id });
  return { ok: true, db, value: { inviteId: invite.id } };
}

export function revokeInvite(
  source: PerformanceDatabase,
  input: { assignmentId: string; reason: string; actorUserId: string | null; scope: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ revoked: number }> {
  const denied = hrOnly(input.scope);
  if (denied) return denied;
  const reason = clean(input.reason, 300);
  if (reason.length < 3) return fail("NOTE_REQUIRED", "Informe o motivo da revogação.");
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.kind === "SELF");
  if (!assignment) return fail("NOT_FOUND", "Convite não encontrado.");
  const now = options.now();
  let revoked = 0;
  for (const invite of db.invites.filter((i) => i.assignmentId === assignment.id && !i.revokedAt)) {
    invite.revokedAt = iso(now);
    invite.revokedReason = reason;
    revoked += 1;
  }
  for (const session of db.sessions.filter((s) => s.assignmentId === assignment.id && !s.revoked)) session.revoked = true;
  if (revoked === 0) return fail("NO_ACTIVE_INVITE", "Não há convite ativo para revogar.");
  audit(db, now, input.actorUserId, "INVITE_REVOKED", assignment.id, { revoked });
  return { ok: true, db, value: { revoked } };
}

function inviteContext(db: PerformanceDatabase, assignmentId: string) {
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const participant = assignment ? db.participants.find((p) => p.id === assignment.participantId) : null;
  const found = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
  // Ciclo inativo não abre nada no portal: mesma resposta neutra de convite inválido.
  const cycle = found && found.activation === "ACTIVE" ? found : null;
  return { assignment, participant, cycle };
}

export function exchangeLink(
  source: PerformanceDatabase,
  input: { token: string },
  options: ServiceOptions
): ServiceResult<{ sessionToken: string; phase: "LINK" }> {
  if (!input.token || input.token.length > 200) return fail("INVITE_REJECTED", publicFailureMessage());
  const db = cloneDb(source);
  const digest = digestSecret(input.token);
  const invite = db.invites.find((i) => secretsMatch(i.linkDigest, digest));
  const { assignment, participant, cycle } = invite ? inviteContext(db, invite.assignmentId) : { assignment: null, participant: null, cycle: null };
  const gate = gateInvite({
    found: Boolean(invite),
    expiresAt: invite ? new Date(invite.expiresAt) : null,
    revokedAt: invite?.revokedAt ? new Date(invite.revokedAt) : null,
    locked: Boolean(invite?.locked),
    submitted: assignment ? journeyDone(db, assignment.participantId) : false,
    now: options.now(),
  });
  if (!gate.ok || !invite || !assignment?.active || !participant || participant.removedAt || cycle?.status !== "OPEN") {
    return fail("INVITE_REJECTED", publicFailureMessage());
  }
  const sessionToken = newSessionToken();
  db.sessions.push({
    id: newId(),
    inviteId: invite.id,
    assignmentId: invite.assignmentId,
    phase: "LINK",
    sessionDigest: digestSecret(sessionToken),
    expiresAt: iso(new Date(options.now().getTime() + SESSION_TTL_MS)),
    assistantUserId: null,
    assistReason: null,
    revoked: false,
  });
  audit(db, options.now(), null, "INVITE_LINK_EXCHANGED", invite.id, {});
  return { ok: true, db, value: { sessionToken, phase: "LINK" } };
}

export function verifyOtp(
  source: PerformanceDatabase,
  input: { sessionToken: string; otp: string },
  options: ServiceOptions
): ServiceResult<{ sessionToken: string }> {
  const db = cloneDb(source);
  const session = liveSession(db, input.sessionToken, options.now());
  if (!session || session.phase !== "LINK" || !session.inviteId) return fail("INVITE_REJECTED", publicFailureMessage());
  const invite = db.invites.find((i) => i.id === session.inviteId);
  if (!invite || invite.locked || invite.revokedAt || new Date(invite.expiresAt).getTime() <= options.now().getTime()) {
    return fail("INVITE_REJECTED", publicFailureMessage());
  }
  const otp = String(input.otp ?? "").replace(/\D/g, "").slice(0, 12);
  if (!secretsMatch(invite.otpDigest, digestSecret(otp))) {
    invite.failedAttempts += 1;
    if (invite.failedAttempts >= OTP_ATTEMPT_LIMIT) invite.locked = true;
    audit(db, options.now(), null, "OTP_FAILED", invite.id, { locked: invite.locked, attempts: invite.failedAttempts });
    return { ok: false, code: "INVITE_REJECTED", message: invite.locked ? "Convite bloqueado. Procure o RH para um novo." : "Código incorreto. Confira com o RH.", db };
  }
  const sessionToken = newSessionToken();
  session.revoked = true;
  db.sessions.push({
    id: newId(),
    inviteId: invite.id,
    assignmentId: invite.assignmentId,
    phase: "VERIFIED",
    sessionDigest: digestSecret(sessionToken),
    expiresAt: iso(new Date(options.now().getTime() + SESSION_TTL_MS)),
    assistantUserId: null,
    assistReason: null,
    revoked: false,
  });
  audit(db, options.now(), null, "OTP_VERIFIED", invite.id, {});
  return { ok: true, db, value: { sessionToken } };
}

export function liveSession(db: PerformanceDatabase, token: string, now: Date) {
  if (!token) return null;
  const digest = digestSecret(token);
  return (
    db.sessions.find(
      (s) => secretsMatch(s.sessionDigest, digest) && !s.revoked && new Date(s.expiresAt).getTime() > now.getTime()
    ) ?? null
  );
}

function formSession(db: PerformanceDatabase, token: string, now: Date) {
  const session = liveSession(db, token, now);
  if (!session || (session.phase !== "VERIFIED" && session.phase !== "ASSISTED")) return null;
  const { assignment: root, participant, cycle } = inviteContext(db, session.assignmentId);
  if (!root || !root.active || !participant || participant.removedAt || !cycle) return null;
  // A sessão nasce na autoavaliação e acompanha a jornada: a etapa atual é a primeira não enviada (pulando a que já
  // terminou no calendário, para a pessoa não ficar presa fora das etapas seguintes).
  const current = journeyStepNow(db, participant.id, cycle, now);
  return { session, root, assignment: current ?? root, participant, cycle, done: current === null };
}

export type PublicFormStep = {
  kind: "SELF" | "LEADERSHIP_UPWARD" | "LEADERSHIP_SELF";
  index: number;
  total: number;
  title: string;
  intro: string;
  /** Primeiro nome do líder avaliado (só na avaliação do líder). */
  subjectFirstName: string | null;
  /** Notas 1 e 4 pedem comentário (liderança). */
  commentRule: { required: boolean; minLetters: number } | null;
};

export type PublicFormValue = {
  step: PublicFormStep;
  steps: { kind: string; title: string; status: string }[];
  employeeName: string;
  periodLabel: string;
  cycleName: string;
  instructions: string;
  questions: { code: string; text: string; pillar: string; competency?: string; behavior?: string }[];
  answers: { questionCode: string; kind: string; score: number | null; comment?: string | null }[];
  version: number;
  status: string;
  assisted: boolean;
  expiresAt: string;
  dueAt: string;
  /** Preenchida quando a pessoa está adiantando esta etapa: a data em que ela abre para todos. */
  opensAt: string | null;
};

export function publicForm(source: PerformanceDatabase, input: { sessionToken: string }, options: ServiceOptions): ServiceResult<PublicFormValue> {
  const ctx = formSession(source, input.sessionToken, options.now());
  if (!ctx || ctx.cycle.status !== "OPEN" || ctx.done) return fail("INVITE_REJECTED", publicFailureMessage());
  const closed = assignmentClosedMessage(source, ctx.cycle, ctx.assignment, options.now());
  if (closed) return fail("STAGE_CLOSED", closed);
  return { ok: true, db: source, value: journeyFormValue(source, { ...ctx, assisted: ctx.session.phase === "ASSISTED", expiresAt: ctx.session.expiresAt, now: options.now() }) };
}

/** Formulário da etapa atual da jornada (portal ou dentro do sistema): o mesmo conteúdo nos dois caminhos. */
function journeyFormValue(
  source: PerformanceDatabase,
  ctx: { cycle: CycleRecord; participant: ParticipantRecord; assignment: AssignmentRecord; assisted: boolean; expiresAt: string; now: Date }
): PublicFormValue {
  const model = modelOfCycle(source, ctx.cycle);
  const leadership = isLeadershipKind(ctx.assignment.kind);
  const questions = leadership
    ? leadershipQuestionsFor(source, ctx.assignment).map((q) => ({ code: q.code, text: q.text, pillar: "LEADERSHIP", competency: q.competency, behavior: q.behavior }))
    : questionsOf(source, ctx.cycle.modelId).map((q) => ({ code: q.code, text: q.selfText, pillar: q.pillar }));
  // A pessoa vê de volta só o que ela mesma respondeu nesta etapa.
  const answers = source.answers
    .filter((a) => a.assignmentId === ctx.assignment.id)
    .map((a) => (leadership ? { questionCode: a.questionCode, kind: a.kind, score: a.score, comment: a.evidence } : { questionCode: a.questionCode, kind: a.kind, score: a.score }));
  const journey = journeyOf(source, ctx.participant.id);
  const stepKind = ctx.assignment.kind as PublicFormStep["kind"];
  const subject = ctx.assignment.kind === "LEADERSHIP_UPWARD" ? source.participants.find((p) => p.id === ctx.assignment.subjectParticipantId) : null;
  const rules = leadership ? leadershipRulesOf(source, ctx.assignment.modelId) : null;
  const window = kindWindow(ctx.cycle, ctx.assignment.kind);
  return {
      step: {
        kind: stepKind,
        index: journey.findIndex((a) => a.id === ctx.assignment.id) + 1,
        total: journey.length,
        title: STEP_TEXT[stepKind].title,
        intro: STEP_TEXT[stepKind].intro,
        subjectFirstName: subject ? subject.employeeName.split(/\s+/).filter((w) => !/^\[.*\]$/.test(w))[0] ?? null : null,
        commentRule: rules ? { required: true, minLetters: rules.commentMinLetters } : null,
      },
      steps: journey.map((a) => ({ kind: a.kind, title: STEP_TEXT[a.kind as PublicFormStep["kind"]].title, status: a.status })),
      employeeName: ctx.participant.employeeName.split(/\s+/)[0] ?? ctx.participant.employeeName,
      periodLabel: ctx.cycle.periodLabel,
      cycleName: ctx.cycle.name,
      instructions: model?.instructions ?? PROPOSED_MODEL_INSTRUCTIONS,
      questions,
      answers,
      version: ctx.assignment.version,
      status: ctx.assignment.status,
      assisted: ctx.assisted,
      expiresAt: ctx.expiresAt,
      dueAt: window?.endsAt ?? ctx.cycle.selfDueAt,
      opensAt: aheadOpensAt(source, ctx.cycle, ctx.assignment, ctx.now),
  };
}

// ---------------------------------------------------------------------------
// Autoavaliação dentro do sistema (quem tem usuário ligado ao cadastro)
// ---------------------------------------------------------------------------

/**
 * A jornada da própria pessoa (autoavaliação → avaliação do líder dela → a própria liderança) no ciclo aberto e
 * ativo mais recente em que ela participa. Mesmas regras do portal: só a própria pessoa, só a etapa da vez, só na
 * janela da etapa. O RH e o super administrador não respondem por ninguém por aqui.
 */
/**
 * Etapa da jornada a responder agora: a primeira não enviada cuja janela ainda não terminou. Se todas as pendentes
 * já terminaram, a primeira delas (a tela explica que terminou). Sem calendário, igual a `currentJourneyStep`.
 */
function journeyStepNow(db: PerformanceDatabase, participantId: string, cycle: CycleRecord, now: Date): AssignmentRecord | null {
  const pending = journeyOf(db, participantId).filter((a) => a.status !== "SUBMITTED");
  if (cycle.status !== "OPEN") return pending[0] ?? null;
  const today = localDay(now);
  return pending.find((a) => {
    const window = kindWindow(cycle, a.kind);
    return !window || windowState(window, today) !== "AFTER";
  }) ?? pending[0] ?? null;
}

function myJourneyContext(db: PerformanceDatabase, actorEmployeeId: string | null, now: Date) {
  if (!actorEmployeeId) return null;
  const candidates = db.participants
    .filter((p) => p.employeeId === actorEmployeeId && !p.removedAt)
    .map((participant) => ({ participant, cycle: db.cycles.find((c) => c.id === participant.cycleId) }))
    .filter((x): x is { participant: ParticipantRecord; cycle: CycleRecord } => Boolean(x.cycle && x.cycle.status === "OPEN" && x.cycle.activation === "ACTIVE"))
    .map((x) => ({ ...x, assignment: journeyStepNow(db, x.participant.id, x.cycle, now) }))
    .filter((x): x is typeof x & { assignment: AssignmentRecord } => x.assignment !== null)
    // Primeiro o ciclo em que a etapa da pessoa está aberta hoje; depois o aberto mais recente.
    .map((x) => ({ ...x, openToday: assignmentClosedMessage(db, x.cycle, x.assignment, now) === null }))
    .sort((a, b) => Number(b.openToday) - Number(a.openToday) || (b.cycle.openedAt ?? "").localeCompare(a.cycle.openedAt ?? ""));
  return candidates[0] ?? null;
}

const myScope = (actorEmployeeId: string): PerformanceScope => ({
  kind: "LIMITED",
  actorEmployeeId,
  visible: new Set([actorEmployeeId]),
  writable: new Set<string>(),
});

/** Resumo para o aviso "Falta com você": a etapa da pessoa e se ela está aberta hoje. */
export function myJourneySummary(db: PerformanceDatabase, actorEmployeeId: string | null, now: Date) {
  const ctx = myJourneyContext(db, actorEmployeeId, now);
  if (!ctx) return null;
  const closed = assignmentClosedMessage(db, ctx.cycle, ctx.assignment, now);
  return { cycleId: ctx.cycle.id, cycleName: ctx.cycle.name, kind: ctx.assignment.kind, title: STEP_TEXT[ctx.assignment.kind as PublicFormStep["kind"]].title, open: closed === null, message: closed, opensAt: aheadOpensAt(db, ctx.cycle, ctx.assignment, now) };
}

export function myForm(source: PerformanceDatabase, input: { actorEmployeeId: string | null }, options: ServiceOptions): ServiceResult<PublicFormValue> {
  const ctx = myJourneyContext(source, input.actorEmployeeId, options.now());
  if (!ctx) return fail("NO_PENDING", "Você não tem pesquisa de desempenho aberta agora.");
  const closed = assignmentClosedMessage(source, ctx.cycle, ctx.assignment, options.now());
  if (closed) return fail("STAGE_CLOSED", closed);
  return { ok: true, db: source, value: journeyFormValue(source, { ...ctx, assisted: false, expiresAt: "", now: options.now() }) };
}

export function mySave(
  source: PerformanceDatabase,
  input: { actorEmployeeId: string | null; actorUserId: string | null; expectedVersion: number; answers: readonly { code: string; answer: AnswerInput }[]; step?: string | null },
  options: ServiceOptions
): ServiceResult<{ version: number }> {
  const ctx = myJourneyContext(source, input.actorEmployeeId, options.now());
  if (!ctx || !input.actorEmployeeId) return fail("NO_PENDING", "Você não tem pesquisa de desempenho aberta agora.");
  if (input.step && input.step !== ctx.assignment.kind) return fail("STEP_CHANGED", "Esta etapa já foi concluída. Atualize a tela para continuar.");
  const keepComment = isLeadershipKind(ctx.assignment.kind);
  return saveAnswers(
    source,
    {
      assignmentId: ctx.assignment.id,
      expectedVersion: input.expectedVersion,
      answers: input.answers.map((item) => ({ code: item.code, answer: keepComment || item.answer.kind !== "score" ? item.answer : { kind: "score", score: item.answer.score } })),
      actorUserId: input.actorUserId,
      scope: myScope(input.actorEmployeeId),
    },
    options
  );
}

export function mySubmit(
  source: PerformanceDatabase,
  input: { actorEmployeeId: string | null; actorUserId: string | null; expectedVersion: number; step?: string | null },
  options: ServiceOptions
): ServiceResult<{ status: string; done: boolean; next: string | null }> {
  const ctx = myJourneyContext(source, input.actorEmployeeId, options.now());
  if (!ctx || !input.actorEmployeeId) return fail("NO_PENDING", "Você não tem pesquisa de desempenho aberta agora.");
  if (input.step && input.step !== ctx.assignment.kind) return fail("STEP_CHANGED", "Esta etapa já foi concluída. Atualize a tela para continuar.");
  const submitted = submitAssignment(
    source,
    { assignmentId: ctx.assignment.id, expectedVersion: input.expectedVersion, actorUserId: input.actorUserId, assistedConfirmation: true, scope: myScope(input.actorEmployeeId) },
    options
  );
  if (submitted.ok === false) return submitted;
  const next = journeyStepNow(submitted.db, ctx.participant.id, ctx.cycle, options.now());
  return { ok: true, db: submitted.db, value: { status: submitted.value.status, done: next === null, next: next?.kind ?? null } };
}

export function publicSave(
  source: PerformanceDatabase,
  input: { sessionToken: string; expectedVersion: number; answers: readonly { code: string; answer: AnswerInput }[]; step?: string | null },
  options: ServiceOptions
): ServiceResult<{ version: number }> {
  const ctx = formSession(source, input.sessionToken, options.now());
  if (!ctx || ctx.done) return fail("INVITE_REJECTED", publicFailureMessage());
  if (input.step && input.step !== ctx.assignment.kind) return fail("STEP_CHANGED", "Esta etapa já foi concluída. Atualize a tela para continuar.");
  const keepComment = isLeadershipKind(ctx.assignment.kind);
  return saveAnswers(
    source,
    {
      assignmentId: ctx.assignment.id,
      expectedVersion: input.expectedVersion,
      answers: input.answers.map((item) => ({ code: item.code, answer: keepComment || item.answer.kind !== "score" ? item.answer : { kind: "score", score: item.answer.score } })),
      actorUserId: ctx.session.assistantUserId,
      assistedByUserId: ctx.session.phase === "ASSISTED" ? ctx.session.assistantUserId : null,
      scope: {
        kind: "LIMITED",
        actorEmployeeId: ctx.participant.employeeId,
        visible: new Set([ctx.participant.employeeId]),
        writable: new Set<string>(),
      },
    },
    options
  );
}

export function publicSubmit(
  source: PerformanceDatabase,
  input: { sessionToken: string; expectedVersion: number; confirm: boolean; step?: string | null },
  options: ServiceOptions
): ServiceResult<{ status: string; done: boolean; next: string | null }> {
  const ctx = formSession(source, input.sessionToken, options.now());
  if (!ctx || ctx.done) return fail("INVITE_REJECTED", publicFailureMessage());
  if (ctx.cycle.status !== "OPEN") return fail("COLLECTION_CLOSED", "A coleta deste ciclo está fechada.");
  if (input.step && input.step !== ctx.assignment.kind) return fail("STEP_CHANGED", "Esta etapa já foi concluída. Atualize a tela para continuar.");
  const submitted = submitAssignment(
    source,
    {
      assignmentId: ctx.assignment.id,
      expectedVersion: input.expectedVersion,
      actorUserId: ctx.session.assistantUserId,
      assistedConfirmation: ctx.session.phase === "ASSISTED" ? input.confirm === true : true,
      scope: {
        kind: "LIMITED",
        actorEmployeeId: ctx.participant.employeeId,
        visible: new Set([ctx.participant.employeeId]),
        writable: new Set<string>(),
      },
    },
    options
  );
  if (submitted.ok === false) return submitted;
  const next = journeyStepNow(submitted.db, ctx.participant.id, ctx.cycle, options.now());
  return { ok: true, db: submitted.db, value: { status: submitted.value.status, done: next === null, next: next?.kind ?? null } };
}

/** Encerra a sessão do aparelho (botão Sair ou fim do preenchimento assistido). */
export function publicLogout(source: PerformanceDatabase, input: { sessionToken: string }, options: ServiceOptions): ServiceResult<{ ended: boolean }> {
  const db = cloneDb(source);
  const session = liveSession(db, input.sessionToken, options.now());
  if (!session) return { ok: true, db: source, value: { ended: false } };
  session.revoked = true;
  audit(db, options.now(), session.assistantUserId, "PORTAL_SESSION_ENDED", session.assignmentId, { phase: session.phase });
  return { ok: true, db, value: { ended: true } };
}

/** Preenchimento assistido em aparelho da empresa. O motivo fica registrado; a autoria é da pessoa. */
export function openAssisted(
  source: PerformanceDatabase,
  input: { assignmentId: string; assistantUserId: string | null; actorEmployeeId: string | null; reason: string; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ sessionToken: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const reason = clean(input.reason, 300);
  if (reason.length < 8) return fail("NOTE_REQUIRED", "Registre o motivo do preenchimento assistido.");
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.active && a.kind === "SELF");
  if (!assignment) return fail("NOT_FOUND", "Autoavaliação não encontrada.");
  if (journeyDone(db, assignment.participantId)) return fail("ASSIGNMENT_LOCKED", "A pesquisa já foi enviada.");
  if (input.actorEmployeeId && input.actorEmployeeId === assignment.employeeId) return fail("FORBIDDEN", "A própria pessoa não abre o modo assistido para si.");
  const { participant, cycle } = inviteContext(db, assignment.id);
  if (!participant || participant.removedAt || cycle?.status !== "OPEN") return fail("CYCLE_STAGE", "O preenchimento assistido só acontece com o ciclo aberto.");
  for (const session of db.sessions.filter((s) => s.assignmentId === assignment.id && s.phase === "ASSISTED" && !s.revoked)) session.revoked = true;
  const sessionToken = newSessionToken();
  db.sessions.push({
    id: newId(),
    inviteId: null,
    assignmentId: assignment.id,
    phase: "ASSISTED",
    sessionDigest: digestSecret(sessionToken),
    expiresAt: iso(new Date(options.now().getTime() + 30 * 60 * 1000)),
    assistantUserId: input.assistantUserId,
    assistReason: reason,
    revoked: false,
  });
  audit(db, options.now(), input.assistantUserId, "ASSISTED_OPENED", assignment.id, { reason });
  return { ok: true, db, value: { sessionToken } };
}

/** Troca o token de abertura (que passou pela URL) por uma sessão nova, de uso no aparelho. */
export function claimAssisted(
  source: PerformanceDatabase,
  input: { token: string },
  options: ServiceOptions
): ServiceResult<{ sessionToken: string }> {
  const db = cloneDb(source);
  const session = liveSession(db, input.token, options.now());
  if (!session || session.phase !== "ASSISTED") return fail("INVITE_REJECTED", publicFailureMessage());
  session.revoked = true;
  const sessionToken = newSessionToken();
  db.sessions.push({ ...session, id: newId(), sessionDigest: digestSecret(sessionToken), revoked: false, expiresAt: iso(new Date(options.now().getTime() + SESSION_TTL_MS)) });
  audit(db, options.now(), session.assistantUserId, "ASSISTED_CLAIMED", session.assignmentId, {});
  return { ok: true, db, value: { sessionToken } };
}

// ---------------------------------------------------------------------------
// Liderança
// ---------------------------------------------------------------------------

export function leaderQueue(db: PerformanceDatabase, scope: PerformanceScope, actorEmployeeId: string | null, now: Date = new Date()) {
  return db.assignments
    .filter((a) => a.active && a.kind === "LEADER")
    .filter((a) => (actorEmployeeId ? a.evaluatorEmployeeId === actorEmployeeId && a.employeeId !== actorEmployeeId : false))
    .filter((a) => canActOnLeaderAssignment(scope.kind === "ALL" ? { kind: "LIMITED", actorEmployeeId, visible: new Set(), writable: new Set() } : scope, a))
    .map((assignment) => {
      const participant = db.participants.find((p) => p.id === assignment.participantId);
      if (!participant || participant.removedAt) return null;
      const cycle = db.cycles.find((c) => c.id === participant.cycleId);
      // Ciclo inativo sai da visão operacional (continua consultável no histórico de auditoria).
      if (!cycle || cycle.activation !== "ACTIVE") return null;
      const self = activeAssignment(db, participant.id, "SELF");
      const showSelf = Boolean(self && self.status === "SUBMITTED" && assignment.status === "SUBMITTED");
      const result = activeResult(db, participant.id);
      const feedback = db.feedbacks.find((f) => f.participantId === participant.id) ?? null;
      return {
        assignmentId: assignment.id,
        participantId: participant.id,
        employeeName: participant.employeeName,
        roleName: participant.roleName,
        departmentName: participant.departmentName,
        cycleId: cycle.id,
        cycleName: cycle.name,
        cycleStatus: cycle.status,
        dueAt: cycle.leaderDueAt,
        status: assignment.status,
        version: assignment.version,
        revision: assignment.revision,
        returnReason: assignment.returnReason,
        editable: collectionOpenFor(db, cycle, assignment, now) && assignment.status !== "SUBMITTED",
        /** Etapa do líder fora da janela (abre em / terminou em). */
        stageMessage: assignment.status !== "SUBMITTED" ? assignmentClosedMessage(db, cycle, assignment, now) : null,
        /** A etapa ainda não abriu, mas o líder já pode adiantar. */
        opensAt: aheadOpensAt(db, cycle, assignment, now),
        selfVisible: showSelf,
        divergences:
          showSelf && self ? findDivergences(toStored(db, self.id), toStored(db, assignment.id), rulesOfCycle(db, cycle).divergenceThreshold) : [],
        officialResult: result?.official
          ? { quadrant: result.quadrant, cultureBand: result.cultureBand, technicalSum: result.technicalSum, technicalCount: result.technicalCount, potentialSum: result.potentialSum, potentialCount: result.potentialCount }
          : null,
        /** Etapa de calibração: o líder vê a posição preliminar para propor (o RH decide). */
        preliminaryResult:
          result && !result.official && (cycle.status === "CONSOLIDATION" || cycle.status === "CALIBRATION")
            ? { quadrant: result.quadrant, nineX: result.nineX, nineY: result.nineY, calibrated: result.reviewStatus === "CALIBRATED" }
            : null,
        plan: planView(db, participant.id),
        planEditable: planStageOf(cycle) !== null,
        proposalEditable: planStageOf(cycle) === "PROPOSAL",
        feedback: feedback ? { id: feedback.id, acknowledgedAt: feedback.acknowledgedAt, createdAt: feedback.createdAt } : null,
        pdis: db.pdis.filter((p) => p.participantId === participant.id).map((p) => ({ id: p.id, title: p.title, status: p.status, dueAt: p.dueAt })),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

// ---------------------------------------------------------------------------
// Calibração e devolutiva conduzidas pelo líder (plano por pessoa)
// ---------------------------------------------------------------------------

/**
 * O que o plano aceita na situação do ciclo: proposta de posição só na consolidação/calibração (antes de o RH
 * tornar oficial); agenda da conversa e rascunho de devolutiva/PDI da consolidação até o encerramento.
 */
export function planStageOf(cycle: CycleRecord): "PROPOSAL" | "FOLLOW_UP" | null {
  if (cycle.activation !== "ACTIVE") return null;
  if (cycle.status === "CONSOLIDATION" || cycle.status === "CALIBRATION") return "PROPOSAL";
  if (cycle.status === "HOMOLOGATED") return "FOLLOW_UP";
  return null;
}

export function planView(db: PerformanceDatabase, participantId: string) {
  const plan = db.plans.find((p) => p.participantId === participantId);
  if (!plan) return null;
  const { id, proposalDecision, proposalNineX, proposalNineY, proposalNote, proposedAt, meetingAt, meetingPlace, draftStrength, draftImprovement, draftAction, draftPdiTitle, draftPdiObjective, draftPdiDueAt, updatedAt } = plan;
  return { id, proposalDecision, proposalNineX, proposalNineY, proposalNote, proposedAt, meetingAt, meetingPlace, draftStrength, draftImprovement, draftAction, draftPdiTitle, draftPdiObjective, draftPdiDueAt, updatedAt };
}

/** Quem conduz a calibração e a devolutiva desta pessoa: o líder dela (tarefa de líder ou gestor no ciclo) ou o RH. */
function leadsForPlan(db: PerformanceDatabase, scope: PerformanceScope, participant: ParticipantRecord): boolean {
  if (scope.kind === "ALL") return true;
  const actor = scope.actorEmployeeId;
  if (!actor || participant.employeeId === actor) return false;
  const leader = activeAssignment(db, participant.id, "LEADER");
  return (leader?.evaluatorEmployeeId ?? participant.managerId) === actor;
}

export type FollowUpPlanInput = {
  participantId: string;
  proposal?: { decision: string; nineX?: string | null; nineY?: string | null; note?: string | null } | null;
  meeting?: { at?: string | null; place?: string | null } | null;
  draft?: {
    strength?: string | null;
    improvement?: string | null;
    action?: string | null;
    pdiTitle?: string | null;
    pdiObjective?: string | null;
    pdiDueAt?: string | null;
  } | null;
  actorUserId: string | null;
  scope: PerformanceScope;
};

export function saveFollowUpPlan(source: PerformanceDatabase, input: FollowUpPlanInput, options: ServiceOptions): ServiceResult<{ planId: string }> {
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId);
  if (!participant || participant.removedAt) return fail("NOT_FOUND", "Pessoa não encontrada no ciclo.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (!leadsForPlan(db, input.scope, participant)) return fail("FORBIDDEN", "Só o líder da pessoa (ou o RH) conduz a calibração e a devolutiva dela.");
  const stage = planStageOf(cycle);
  if (!stage) return fail("CYCLE_STAGE", "A calibração e a devolutiva começam quando a coleta fecha.");
  if (input.proposal && stage !== "PROPOSAL") return fail("CYCLE_STAGE", "Os resultados já são oficiais: a proposta de posição não muda mais. Registre a devolutiva.");
  const nowIso = iso(options.now());
  let plan = db.plans.find((p) => p.participantId === participant.id);
  if (!plan) {
    const leader = activeAssignment(db, participant.id, "LEADER");
    plan = {
      id: newId(),
      cycleId: cycle.id,
      participantId: participant.id,
      leaderEmployeeId: leader?.evaluatorEmployeeId ?? participant.managerId ?? (input.scope.kind === "LIMITED" ? input.scope.actorEmployeeId ?? "" : ""),
      proposalDecision: null,
      proposalNineX: null,
      proposalNineY: null,
      proposalNote: null,
      proposedAt: null,
      meetingAt: null,
      meetingPlace: null,
      draftStrength: null,
      draftImprovement: null,
      draftAction: null,
      draftPdiTitle: null,
      draftPdiObjective: null,
      draftPdiDueAt: null,
      updatedByUserId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (!plan.leaderEmployeeId) return fail("LEADER_MISSING", "A pessoa não tem líder neste ciclo.");
    db.plans.push(plan);
  }
  if (input.proposal) {
    const decision = input.proposal.decision;
    if (decision !== "CONFIRM" && decision !== "ADJUST") return fail("INVALID_DECISION", "Escolha confirmar a posição ou propor um ajuste.");
    const note = cleanOrNull(input.proposal.note ?? null, 1000);
    if (decision === "ADJUST") {
      if (!isNineBoxBand(input.proposal.nineX) || !isNineBoxBand(input.proposal.nineY)) return fail("INVALID_BAND", "Informe o desempenho e o potencial propostos.");
      if (!note || note.length < 8) return fail("NOTE_REQUIRED", "Explique o ajuste proposto (mínimo de 8 caracteres).");
    }
    plan.proposalDecision = decision;
    plan.proposalNineX = decision === "ADJUST" ? (input.proposal.nineX as NineBoxBand) : null;
    plan.proposalNineY = decision === "ADJUST" ? (input.proposal.nineY as NineBoxBand) : null;
    plan.proposalNote = note;
    plan.proposedAt = nowIso;
  }
  if (input.meeting) {
    const at = cleanOrNull(input.meeting.at ?? null, 16);
    if (at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return fail("INVALID_DATE", "Informe a data e a hora da conversa.");
    if (at && !isIsoDate(at.slice(0, 10))) return fail("INVALID_DATE", "Informe uma data válida para a conversa.");
    plan.meetingAt = at;
    plan.meetingPlace = cleanOrNull(input.meeting.place ?? null, 200);
  }
  if (input.draft) {
    const due = cleanOrNull(input.draft.pdiDueAt ?? null, 10);
    if (due && !isIsoDate(due)) return fail("INVALID_DATE", "Informe uma data válida para o prazo do PDI.");
    plan.draftStrength = cleanOrNull(input.draft.strength ?? null);
    plan.draftImprovement = cleanOrNull(input.draft.improvement ?? null);
    plan.draftAction = cleanOrNull(input.draft.action ?? null);
    plan.draftPdiTitle = cleanOrNull(input.draft.pdiTitle ?? null, 200);
    plan.draftPdiObjective = cleanOrNull(input.draft.pdiObjective ?? null);
    plan.draftPdiDueAt = due;
  }
  plan.updatedAt = nowIso;
  plan.updatedByUserId = input.actorUserId;
  audit(db, options.now(), input.actorUserId, "FOLLOW_UP_PLAN_SAVED", participant.id, {
    proposal: input.proposal ? plan.proposalDecision : undefined,
    meetingAt: input.meeting ? plan.meetingAt : undefined,
    draft: input.draft ? true : undefined,
  });
  return { ok: true, db, value: { planId: plan.id } };
}

/**
 * Avisos de "Minha equipe": por que uma tarefa pode não aparecer (ciclo inativo) e quantas pendências o líder tem
 * (base do aviso "Falta com você" no topo da página).
 */
export function teamNotices(db: PerformanceDatabase, actorEmployeeId: string | null, now: Date) {
  if (!actorEmployeeId) return { linked: false, inactiveCycles: [] as { cycleId: string; cycleName: string; tasks: number }[], pendingLeader: 0, pendingCalibration: 0, myJourney: null };
  const inactive = new Map<string, { cycleId: string; cycleName: string; tasks: number }>();
  for (const a of db.assignments) {
    if (!a.active || a.evaluatorEmployeeId !== actorEmployeeId || a.employeeId === actorEmployeeId) continue;
    if (a.kind !== "LEADER" && a.kind !== "LEADERSHIP_SUPERIOR") continue;
    const cycle = db.cycles.find((c) => c.id === a.cycleId);
    if (!cycle || cycle.activation === "ACTIVE" || cycle.status === "CLOSED") continue;
    const entry = inactive.get(cycle.id) ?? { cycleId: cycle.id, cycleName: cycle.name, tasks: 0 };
    entry.tasks += 1;
    inactive.set(cycle.id, entry);
  }
  const queue = leaderQueue(db, { kind: "LIMITED", actorEmployeeId, visible: new Set(), writable: new Set() }, actorEmployeeId, now);
  return {
    linked: true,
    inactiveCycles: [...inactive.values()],
    pendingLeader: queue.filter((item) => item.editable && item.status !== "SUBMITTED").length,
    pendingCalibration: queue.filter((item) => item.proposalEditable && !item.plan?.proposalDecision).length,
    myJourney: myJourneySummary(db, actorEmployeeId, now),
  };
}

export function readLeaderForm(db: PerformanceDatabase, assignmentId: string, scope: PerformanceScope, actorEmployeeId: string | null, now: Date = new Date()) {
  const assignment = db.assignments.find((a) => a.id === assignmentId && a.active && a.kind === "LEADER");
  const allowed =
    assignment &&
    (scope.kind === "ALL"
      ? true
      : Boolean(actorEmployeeId && assignment.evaluatorEmployeeId === actorEmployeeId && assignment.employeeId !== actorEmployeeId));
  if (!assignment || !allowed) return fail("FORBIDDEN", "Acesso negado.");
  const participant = db.participants.find((p) => p.id === assignment.participantId);
  if (!participant || participant.removedAt) return fail("FORBIDDEN", "Acesso negado.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  const model = modelOfCycle(db, cycle);
  const rules = rulesOfCycle(db, cycle);
  const self = activeAssignment(db, participant.id, "SELF");
  const selfReleased = assignment.status === "SUBMITTED" && self?.status === "SUBMITTED";
  return {
    ok: true as const,
    assignment: {
      id: assignment.id,
      status: assignment.status,
      version: assignment.version,
      revision: assignment.revision,
      returnReason: assignment.returnReason,
      submittedAt: assignment.submittedAt,
    },
    employee: { name: participant.employeeName, roleName: participant.roleName, departmentName: participant.departmentName },
    cycle: { id: cycle.id, name: cycle.name, periodLabel: cycle.periodLabel, status: cycle.status, dueAt: cycle.leaderDueAt },
    editable: collectionOpenFor(db, cycle, assignment, now) && assignment.status !== "SUBMITTED",
    instructions: model?.instructions ?? PROPOSED_MODEL_INSTRUCTIONS,
    rules: { requireExtremeEvidence: rules.requireExtremeEvidence, evidenceMinChars: rules.evidenceMinChars },
    questions: questionsOf(db, cycle.modelId).map((q) => ({
      code: q.code,
      text: q.leaderText,
      pillar: q.pillar,
      competency: q.competency,
      hint: q.hint,
      description: q.description,
      positiveExample: q.positiveExample,
      negativeExample: q.negativeExample,
      // Só o exemplo do cargo da pessoa avaliada (snapshot do ciclo).
      roleExample: (q.roleExamples ?? []).find((row) => row.roleName.trim().toLowerCase() === participant.roleName.trim().toLowerCase())?.text ?? null,
    })),
    answers: db.answers
      .filter((a) => a.assignmentId === assignment.id)
      .map((a) => ({ questionCode: a.questionCode, kind: a.kind, score: a.score, evidence: a.evidence })),
    selfAnswers: selfReleased && self
      ? db.answers.filter((a) => a.assignmentId === self.id).map((a) => ({ questionCode: a.questionCode, kind: a.kind, score: a.score }))
      : [],
    divergences: selfReleased && self ? findDivergences(toStored(db, self.id), toStored(db, assignment.id), rules.divergenceThreshold) : [],
  };
}

// ---------------------------------------------------------------------------
// Devolutiva e PDI
// ---------------------------------------------------------------------------

export function createFeedback(
  source: PerformanceDatabase,
  input: {
    participantId: string;
    strength: string;
    improvement: string;
    action: string;
    ownerName: string;
    dueAt: string | null;
    conversationAt: string | null;
    leaderEmployeeId?: string | null;
    actorUserId: string | null;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ feedbackId: string }> {
  const scope = input.scope ?? HR_SCOPE;
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId && !p.removedAt);
  if (!participant) return fail("NOT_FOUND", "Participante não encontrado.");
  if (!canLeadParticipant(db, scope, participant)) return fail("FORBIDDEN", FORBIDDEN_MESSAGE);
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  const result = db.results.find((r) => r.participantId === input.participantId && r.active && r.official);
  if (!cycle || !result) return fail("NOT_HOMOLOGATED", "A devolutiva oficial só existe depois da homologação.");
  if (cycle.status !== "HOMOLOGATED" && cycle.status !== "CLOSED") return fail("NOT_HOMOLOGATED", "O ciclo ainda não está homologado.");
  if (db.feedbacks.some((f) => f.participantId === participant.id)) return fail("FEEDBACK_EXISTS", "A devolutiva desta pessoa já foi registrada.");
  const strength = clean(input.strength, 600);
  const improvement = clean(input.improvement, 600);
  const action = clean(input.action, 600);
  if (strength.length < 3 || improvement.length < 3 || action.length < 3) {
    return fail("INVALID_TEXT", "Preencha o ponto forte, o ponto de desenvolvimento e a ação combinada.");
  }
  const ownerName = clean(input.ownerName, 160);
  if (ownerName.length < 2) return fail("INVALID_TEXT", "Informe o responsável pela ação.");
  if (input.dueAt && !isIsoDate(input.dueAt)) return fail("INVALID_DATE", "Prazo inválido.");
  if (input.conversationAt && !isIsoDate(input.conversationAt)) return fail("INVALID_DATE", "Data da conversa inválida.");
  const leader = activeAssignment(db, participant.id, "LEADER");
  const leaderEmployeeId =
    leader?.evaluatorEmployeeId ?? participant.managerId ?? (scope.kind === "LIMITED" ? scope.actorEmployeeId : null) ?? input.leaderEmployeeId ?? null;
  if (!leaderEmployeeId) return fail("LEADER_REQUIRED", "Atribua o líder antes de registrar a devolutiva.");
  const feedbackId = newId();
  const now = options.now();
  db.feedbacks.push({
    id: feedbackId,
    participantId: participant.id,
    resultId: result.id,
    strength,
    improvement,
    action,
    ownerName,
    dueAt: input.dueAt,
    conversationAt: input.conversationAt,
    leaderEmployeeId,
    viewedAt: null,
    acknowledgedAt: null,
    agreedAt: null,
    contestation: null,
    collaboratorNote: null,
    acknowledgedVia: null,
    acknowledgedByUserId: null,
    internalNotes: null,
    createdByUserId: input.actorUserId,
    createdAt: iso(now),
  });
  audit(db, now, input.actorUserId, "FEEDBACK_CREATED", feedbackId, { participantId: participant.id, resultVersion: result.version });
  return { ok: true, db, value: { feedbackId } };
}

/**
 * Ciência, concordância e contestação são registros separados. Ciência não é concordância.
 * A própria pessoa registra (SELF) ou o RH/líder registra presencialmente (ASSISTED).
 */
export function acknowledgeFeedback(
  source: PerformanceDatabase,
  input: {
    feedbackId: string;
    action: "VIEWED" | "ACKNOWLEDGED" | "AGREED" | "CONTESTED";
    note: string | null;
    actorEmployeeId: string | null;
    actorUserId?: string | null;
    assisted?: boolean;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ action: string }> {
  const db = cloneDb(source);
  const feedback = db.feedbacks.find((f) => f.id === input.feedbackId);
  const participant = feedback ? db.participants.find((p) => p.id === feedback.participantId) : null;
  if (!feedback || !participant) return fail("FORBIDDEN", "A devolutiva é só da própria pessoa.");
  const self = Boolean(input.actorEmployeeId && participant.employeeId === input.actorEmployeeId);
  const assisted = !self && input.assisted === true && Boolean(input.scope) && canLeadParticipant(db, input.scope!, participant);
  if (!self && !assisted) return fail("FORBIDDEN", "A devolutiva é só da própria pessoa.");
  if (!["VIEWED", "ACKNOWLEDGED", "AGREED", "CONTESTED"].includes(input.action)) return fail("INVALID_ACTION", "Ação inválida.");
  const note = cleanOrNull(input.note, 600);
  if (input.action === "CONTESTED" && (!note || note.length < 8)) return fail("NOTE_REQUIRED", "Descreva o fato contestado com pelo menos 8 caracteres.");
  const at = iso(options.now());
  if (input.action === "VIEWED") feedback.viewedAt = feedback.viewedAt ?? at;
  if (input.action === "ACKNOWLEDGED") {
    feedback.acknowledgedAt = feedback.acknowledgedAt ?? at;
    feedback.viewedAt = feedback.viewedAt ?? at;
    feedback.acknowledgedVia = self ? "SELF" : "ASSISTED";
    feedback.acknowledgedByUserId = input.actorUserId ?? null;
  }
  if (input.action === "AGREED") feedback.agreedAt = feedback.agreedAt ?? at;
  if (input.action === "CONTESTED") feedback.contestation = note;
  if (note && input.action !== "CONTESTED") feedback.collaboratorNote = note;
  audit(db, options.now(), input.actorUserId ?? null, "FEEDBACK_ACK", feedback.id, { action: input.action, via: self ? "SELF" : "ASSISTED" });
  return { ok: true, db, value: { action: input.action } };
}

export function createPdi(
  source: PerformanceDatabase,
  input: {
    feedbackId: string;
    title: string;
    objective?: string | null;
    competencyCode?: string | null;
    priority: boolean;
    justification: string | null;
    ownerName: string;
    dueAt: string | null;
    actorUserId: string | null;
    scope?: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ pdiId: string }> {
  const scope = input.scope ?? HR_SCOPE;
  const db = cloneDb(source);
  const feedback = db.feedbacks.find((f) => f.id === input.feedbackId);
  if (!feedback) return fail("NOT_FOUND", "Devolutiva não encontrada.");
  const participant = db.participants.find((p) => p.id === feedback.participantId)!;
  if (!canLeadParticipant(db, scope, participant)) return fail("FORBIDDEN", FORBIDDEN_MESSAGE);
  const title = clean(input.title, 200);
  if (title.length < 3) return fail("INVALID_TEXT", "Descreva a ação do PDI.");
  const ownerName = clean(input.ownerName, 160);
  if (ownerName.length < 2) return fail("INVALID_TEXT", "Informe o responsável.");
  if (!input.dueAt || !isIsoDate(input.dueAt)) return fail("INVALID_DATE", "Informe o prazo da ação.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  const competencyCode = cleanOrNull(input.competencyCode, 20);
  // PDI de liderança: competências LD-xx do modelo de liderança do ciclo, só para quem é líder no ciclo.
  const leadershipCode = Boolean(competencyCode && cycle.leadershipModelId && participant.isLeader && questionsOf(db, cycle.leadershipModelId).some((q) => q.code === competencyCode));
  if (competencyCode && !leadershipCode && !questionsOf(db, cycle.modelId).some((q) => q.code === competencyCode)) {
    return fail("INVALID_COMPETENCY", "Competência não faz parte do modelo deste ciclo.");
  }
  const existingPriority = db.pdis.some((p) => p.feedbackId === feedback.id && p.priority && p.status !== "CANCELLED");
  const priority = input.priority && !existingPriority;
  if (input.priority && existingPriority) return fail("PRIORITY_EXISTS", "Já existe uma ação prioritária. As demais pedem justificativa.");
  const justification = cleanOrNull(input.justification, 600);
  if (!priority && (!justification || justification.length < 8)) return fail("JUSTIFICATION_REQUIRED", "Ação extra precisa de justificativa.");
  const pdiId = newId();
  const now = iso(options.now());
  db.pdis.push({
    id: pdiId,
    participantId: feedback.participantId,
    feedbackId: feedback.id,
    title,
    objective: cleanOrNull(input.objective, 600),
    competencyCode,
    priority,
    justification: priority ? null : justification,
    ownerName,
    dueAt: input.dueAt,
    status: "PLANNED",
    evidence: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  audit(db, options.now(), input.actorUserId, "PDI_CREATED", pdiId, { priority });
  return { ok: true, db, value: { pdiId } };
}

const FINAL_PDI: readonly PdiStatus[] = ["DONE", "CANCELLED"];

export function updatePdiStatus(
  source: PerformanceDatabase,
  input: { pdiId: string; status: PdiStatus; note?: string | null; evidence?: string | null; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ pdiId: string }> {
  const scope = input.scope ?? HR_SCOPE;
  if (!isPdiStatus(input.status)) return fail("INVALID_STATUS", "Situação do PDI inválida.");
  const db = cloneDb(source);
  const pdi = db.pdis.find((p) => p.id === input.pdiId);
  if (!pdi) return fail("NOT_FOUND", "PDI não encontrado.");
  const participant = db.participants.find((p) => p.id === pdi.participantId)!;
  if (!canLeadParticipant(db, scope, participant)) return fail("FORBIDDEN", FORBIDDEN_MESSAGE);
  if (FINAL_PDI.includes(pdi.status)) return fail("PDI_CLOSED", "Ação concluída ou cancelada fica preservada como está.");
  if (pdi.status === input.status) return fail("SAME_STATUS", "A ação já está nesta situação.");
  const note = cleanOrNull(input.note, 600);
  if ((input.status === "DONE" || input.status === "CANCELLED" || input.status === "SUSPENDED") && (!note || note.length < 8)) {
    return fail("NOTE_REQUIRED", "Registre o que aconteceu (mínimo de 8 caracteres).");
  }
  const now = iso(options.now());
  const from = pdi.status;
  pdi.status = input.status;
  pdi.updatedAt = now;
  if (input.status === "DONE") {
    pdi.completedAt = now;
    pdi.evidence = cleanOrNull(input.evidence, 600) ?? note;
  }
  if (note) {
    db.checkins.push({ id: newId(), pdiId: pdi.id, note: `Situação: ${PDI_STATUS_LABELS[from]} → ${PDI_STATUS_LABELS[input.status]}. ${note}`, obstacle: null, nextStep: null, authorUserId: input.actorUserId, createdAt: now });
  }
  audit(db, options.now(), input.actorUserId, "PDI_STATUS", pdi.id, { from, to: input.status });
  return { ok: true, db, value: { pdiId: pdi.id } };
}

export function addCheckin(
  source: PerformanceDatabase,
  input: { pdiId: string; note: string; obstacle: string | null; nextStep: string | null; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ checkinId: string }> {
  const scope = input.scope ?? HR_SCOPE;
  const db = cloneDb(source);
  const pdi = db.pdis.find((p) => p.id === input.pdiId);
  if (!pdi) return fail("NOT_FOUND", "PDI não encontrado.");
  const participant = db.participants.find((p) => p.id === pdi.participantId)!;
  if (!canLeadParticipant(db, scope, participant)) return fail("FORBIDDEN", FORBIDDEN_MESSAGE);
  if (FINAL_PDI.includes(pdi.status)) return fail("PDI_CLOSED", "Ação concluída ou cancelada fica preservada como está.");
  const note = clean(input.note, 600);
  if (note.length < 3) return fail("INVALID_TEXT", "Escreva o progresso observado.");
  const checkinId = newId();
  const now = iso(options.now());
  db.checkins.push({
    id: checkinId,
    pdiId: pdi.id,
    note,
    obstacle: cleanOrNull(input.obstacle, 600),
    nextStep: cleanOrNull(input.nextStep, 600),
    authorUserId: input.actorUserId,
    createdAt: now,
  });
  pdi.updatedAt = now;
  if (pdi.status === "PLANNED") pdi.status = "IN_PROGRESS";
  audit(db, options.now(), input.actorUserId, "PDI_CHECKIN", pdi.id, {});
  return { ok: true, db, value: { checkinId } };
}

// ---------------------------------------------------------------------------
// Ocorrências, lembretes e relatórios
// ---------------------------------------------------------------------------

export function recordConduct(
  source: PerformanceDatabase,
  input: { employeeId: string; summary: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceResult<{ conductId: string }> {
  const summary = clean(input.summary, 1000);
  if (summary.length < 8) return fail("INVALID_TEXT", "Descreva o relato com pelo menos 8 caracteres.");
  if (!input.employeeId) return fail("NOT_FOUND", "Pessoa não informada.");
  const db = cloneDb(source);
  const before = db.results.map((r) => `${r.id}:${r.quadrant}:${r.cultureBand}`);
  const conductId = newId();
  db.conducts.push({ id: conductId, employeeId: input.employeeId, status: "RECORDED", summary, proven: false });
  audit(db, options.now(), input.actorUserId, "CONDUCT_RECORDED", conductId, { proven: false });
  const after = db.results.map((r) => `${r.id}:${r.quadrant}:${r.cultureBand}`);
  if (before.join() !== after.join()) return fail("CONDUCT_LEAK", "Ocorrência não pode alterar resultado.");
  return { ok: true, db, value: { conductId } };
}

export function planReminders(
  source: PerformanceDatabase,
  input: { cycleId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceResult<{ drafted: number; dispatched: number }> {
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  let drafted = 0;
  const live = new Set(liveParticipants(db, cycle.id).map((p) => p.id));
  for (const assignment of db.assignments.filter((a) => a.cycleId === cycle.id && a.active && a.status !== "SUBMITTED" && live.has(a.participantId))) {
    const audience = assignment.kind === "SELF" ? "SELF" : "LEADER";
    const exists = db.reminders.some((r) => r.cycleId === cycle.id && r.employeeId === assignment.evaluatorEmployeeId && r.audience === audience);
    if (exists) continue;
    db.reminders.push({ id: newId(), cycleId: cycle.id, employeeId: assignment.evaluatorEmployeeId, audience, status: "DRAFT" });
    drafted += 1;
  }
  audit(db, options.now(), input.actorUserId, "REMINDERS_DRAFTED", cycle.id, { drafted, dispatched: 0 });
  return { ok: true, db, value: { drafted, dispatched: 0 } };
}

export function dispatchReminders(options: ServiceOptions): ServiceResult<{ sent: number }> {
  if (!options.remindersEnabled) return fail("REMINDERS_DISABLED", "Lembretes externos permanecem desligados.");
  return fail("REMINDERS_DISABLED", "Nenhum canal de envio foi autorizado.");
}

/** Exportação (CSV) também deixa rastro: quem exportou, quando e quantas linhas. */
export function recordExport(
  source: PerformanceDatabase,
  input: { cycleId: string; rows: number; format: "CSV" | "CSV_OPERACIONAL"; actorUserId: string | null },
  options: ServiceOptions
): ServiceResult<{ rows: number }> {
  const db = cloneDb(source);
  if (!db.cycles.some((c) => c.id === input.cycleId)) return fail("NOT_FOUND", "Ciclo não encontrado.");
  audit(db, options.now(), input.actorUserId, "EXPORT", input.cycleId, { format: input.format, rows: input.rows });
  return { ok: true, db, value: { rows: input.rows } };
}

export const REPORT_KINDS = ["individual", "devolutiva", "pdi", "consolidado", "ninebox", "historico", "lideranca"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const PERSONAL_REPORT_KINDS: readonly ReportKind[] = ["individual", "devolutiva", "pdi", "historico", "lideranca"];

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && (REPORT_KINDS as readonly string[]).includes(value);
}

/** Código rastreável do documento: DCP-AAAAMMDD-XXXXXX. A versão conta emissões do mesmo documento. */
export function issueReport(
  source: PerformanceDatabase,
  input: { cycleId: string; kind: ReportKind; participantId: string | null; actorUserId: string | null; actorName: string | null; scope: PerformanceScope; randomSuffix: string },
  options: ServiceOptions
): ServiceResult<{ code: string; version: number; issuedAt: string }> {
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (PERSONAL_REPORT_KINDS.includes(input.kind)) {
    const participant = db.participants.find((p) => p.id === input.participantId && p.cycleId === cycle.id);
    if (!participant) return fail("NOT_FOUND", "Escolha a pessoa do documento.");
    if (input.kind === "lideranca") {
      // Mesma regra da calibração: RH ou o superior do líder; nunca o próprio líder sozinho.
      const actor = input.scope.kind === "ALL" ? null : input.scope.actorEmployeeId;
      const view = leadershipComparison(db, participant.id, input.scope, actor);
      if (view.ok === false) return fail(view.code, view.message);
      if (!view.result) return fail("LEADERSHIP_NOT_CALIBRATED", "Calibre a liderança antes de emitir o documento.");
    } else if (!canSeeEmployee(input.scope, participant.employeeId)) return fail("FORBIDDEN", FORBIDDEN_MESSAGE);
  } else if (input.scope.kind !== "ALL") {
    return fail("FORBIDDEN", "Relatórios do ciclo inteiro são do RH.");
  }
  const now = options.now();
  const stamp = iso(now).slice(0, 10).replace(/-/g, "");
  const code = `DCP-${stamp}-${input.randomSuffix.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 6).padEnd(6, "0")}`;
  if (db.reports.some((r) => r.code === code)) return fail("CODE_COLLISION", "Tente emitir de novo.");
  const version =
    db.reports.filter((r) => r.kind === input.kind && r.cycleId === cycle.id && (r.participantId ?? null) === (input.participantId ?? null)).length + 1;
  db.reports.push({
    id: newId(),
    code,
    kind: input.kind,
    cycleId: cycle.id,
    participantId: PERSONAL_REPORT_KINDS.includes(input.kind) ? input.participantId : null,
    version,
    issuedByUserId: input.actorUserId,
    issuedByName: cleanOrNull(input.actorName, 160),
    issuedAt: iso(now),
  });
  audit(db, now, input.actorUserId, "REPORT_ISSUED", cycle.id, { code, kind: input.kind, version });
  return { ok: true, db, value: { code, version, issuedAt: iso(now) } };
}
