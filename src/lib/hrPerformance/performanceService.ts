/**
 * Casos de uso do módulo. Funções puras sobre o estado: a rota persiste o retorno.
 * Não grava token, OTP nem texto de evidência na auditoria.
 */
import {
  ALGORITHM_ID,
  PROPOSED_BASE_QUESTIONS,
  PROPOSED_DIVERGENCE_THRESHOLD,
  PROPOSED_MIN_OBSERVATION_DAYS,
  PROPOSED_MIN_VALID_ANSWERS,
  aggregatePillar,
  classifyEligibility,
  cultureBand,
  evidenceSatisfied,
  findDivergences,
  neutralizeSpreadsheetCell,
  nextCycleStatus,
  placeNineBox,
  type AnswerInput,
  type EmployeeSnapshotSource,
  type StoredAnswer,
} from "./performanceDomain.js";
import { buildInviteHashUrl, digestSecret, gateInvite, newLinkToken, newOtpCode, newSessionToken, publicFailureMessage, secretsMatch, SESSION_TTL_MS, OTP_ATTEMPT_LIMIT } from "./performanceInvite.js";
import {
  canEvaluateEmployee,
  canSeeEmployee,
  leaderQueueIncludes,
  type PerformanceScope,
} from "./performanceAccess.js";
import {
  cloneDb,
  newId,
  type AnswerRecord,
  type AssignmentRecord,
  type PerformanceDatabase,
  type ResultRecord,
} from "./performanceState.js";

export type ServiceOptions = {
  now: () => Date;
  officialPublication: boolean;
  identityOtpEnabled: boolean;
  remindersEnabled: boolean;
  publicOrigin: string;
};

export type ServiceError = { ok: false; code: string; message: string; db?: PerformanceDatabase };
export type ServiceOk<T> = { ok: true; db: PerformanceDatabase; value: T };

function fail(code: string, message: string): ServiceError {
  return { ok: false, code, message };
}

function iso(date: Date): string {
  return date.toISOString();
}

function audit(
  db: PerformanceDatabase,
  now: Date,
  actorUserId: string | null,
  action: string,
  entityId: string,
  detail: Record<string, string | number | boolean | null>
) {
  db.audits.push({ id: newId(), at: iso(now), actorUserId, action, entityId, detail });
}

function questionsOf(db: PerformanceDatabase, modelId: string) {
  return db.questions.filter((q) => q.modelId === modelId).sort((a, b) => a.sortOrder - b.sortOrder);
}

function activeAssignment(db: PerformanceDatabase, participantId: string, kind: "SELF" | "LEADER") {
  return db.assignments.find((a) => a.participantId === participantId && a.kind === kind && a.active) ?? null;
}

function toStored(db: PerformanceDatabase, assignmentId: string): StoredAnswer[] {
  return db.answers
    .filter((a) => a.assignmentId === assignmentId)
    .map((a) => ({
      questionCode: a.questionCode,
      pillar: a.pillar,
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

export function createDraftModel(
  source: PerformanceDatabase,
  input: { name: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ modelId: string }> | ServiceError {
  const name = input.name.trim();
  if (name.length < 3) return fail("INVALID_NAME", "Informe um nome para o modelo.");
  const db = cloneDb(source);
  const modelId = newId();
  db.models.push({
    id: modelId,
    lineageId: modelId,
    name,
    status: "DRAFT",
    version: 1,
    governance: "EM_VALIDACAO",
    publishedAt: null,
    createdByUserId: input.actorUserId,
  });
  for (const question of PROPOSED_BASE_QUESTIONS) {
    db.questions.push({
      id: newId(),
      modelId,
      code: question.code,
      pillar: question.pillar,
      sortOrder: question.sortOrder,
      selfText: question.selfText,
      leaderText: question.leaderText,
      hint: null,
    });
  }
  audit(db, options.now(), input.actorUserId, "MODEL_DRAFT_CREATED", modelId, { governance: "EM_VALIDACAO" });
  return { ok: true, db, value: { modelId } };
}

export function updateDraftQuestion(
  source: PerformanceDatabase,
  input: { modelId: string; code: string; selfText: string; leaderText: string; hint: string | null; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ code: string }> | ServiceError {
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  if (model.status !== "DRAFT") return fail("MODEL_LOCKED", "Modelo publicado não é alterado. Duplique para uma nova versão.");
  const selfText = input.selfText.trim();
  const leaderText = input.leaderText.trim();
  if (selfText.length < 8 || leaderText.length < 8) return fail("INVALID_TEXT", "Escreva a pergunta para a pessoa e para o líder.");
  const siblings = questionsOf(db, model.id).filter((q) => q.code !== input.code);
  if (siblings.some((q) => q.selfText.trim().toLowerCase() === selfText.toLowerCase())) {
    return fail("DUPLICATE_QUESTION", "Já existe pergunta igual neste modelo.");
  }
  const question = db.questions.find((q) => q.modelId === model.id && q.code === input.code);
  if (!question) return fail("NOT_FOUND", "Pergunta não encontrada.");
  question.selfText = selfText;
  question.leaderText = leaderText;
  question.hint = input.hint?.trim() || null;
  audit(db, options.now(), input.actorUserId, "MODEL_QUESTION_EDITED", question.id, { code: question.code });
  return { ok: true, db, value: { code: question.code } };
}

export function publishModel(
  source: PerformanceDatabase,
  input: { modelId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ modelId: string }> | ServiceError {
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  if (model.status === "PUBLISHED") return { ok: true, db: source, value: { modelId: model.id } };
  if (model.status !== "DRAFT") return fail("MODEL_LOCKED", "Só um rascunho pode ser publicado.");
  const questions = questionsOf(db, model.id);
  if (questions.length !== 12) return fail("INVALID_MODEL", "A versão-base precisa das 12 perguntas.");
  if (questions.some((q) => q.selfText.trim().length < 8 || q.leaderText.trim().length < 8)) {
    return fail("INVALID_TEXT", "Toda pergunta precisa de texto para a pessoa e para o líder.");
  }
  model.status = "PUBLISHED";
  model.publishedAt = iso(options.now());
  model.governance = "EM_VALIDACAO";
  audit(db, options.now(), input.actorUserId, "MODEL_PUBLISHED", model.id, {
    version: model.version,
    homologated: false,
  });
  return { ok: true, db, value: { modelId: model.id } };
}

export function duplicateModel(
  source: PerformanceDatabase,
  input: { modelId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ modelId: string }> | ServiceError {
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  const copyId = newId();
  const nextVersion = Math.max(...db.models.filter((m) => m.lineageId === model.lineageId).map((m) => m.version)) + 1;
  db.models.push({
    id: copyId,
    lineageId: model.lineageId,
    name: model.name,
    status: "DRAFT",
    version: nextVersion,
    governance: "EM_VALIDACAO",
    publishedAt: null,
    createdByUserId: input.actorUserId,
  });
  for (const question of questionsOf(db, model.id)) {
    db.questions.push({ ...question, id: newId(), modelId: copyId });
  }
  audit(db, options.now(), input.actorUserId, "MODEL_DUPLICATED", copyId, { from: model.id, version: nextVersion });
  return { ok: true, db, value: { modelId: copyId } };
}

export function archiveModel(
  source: PerformanceDatabase,
  input: { modelId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ modelId: string }> | ServiceError {
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model) return fail("NOT_FOUND", "Modelo não encontrado.");
  if (db.cycles.some((c) => c.modelId === model.id && c.status !== "CLOSED")) {
    return fail("MODEL_IN_USE", "Este modelo está num ciclo que ainda não encerrou.");
  }
  model.status = "ARCHIVED";
  audit(db, options.now(), input.actorUserId, "MODEL_ARCHIVED", model.id, {});
  return { ok: true, db, value: { modelId: model.id } };
}

export function reassignLeader(
  source: PerformanceDatabase,
  input: { participantId: string; managerId: string; managerName: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ participantId: string }> | ServiceError {
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId);
  if (!participant) return fail("NOT_FOUND", "Participante não encontrado.");
  if (input.managerId === participant.employeeId) return fail("SELF_EVALUATOR", "A pessoa não avalia a si mesma como líder.");
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  if (!cycle || cycle.status === "HOMOLOGATED" || cycle.status === "CLOSED") {
    return fail("CYCLE_FROZEN", "O ciclo encerrado preserva o avaliador da época.");
  }
  const leader = activeAssignment(db, participant.id, "LEADER");
  if (leader && (leader.status === "SUBMITTED" || leader.status === "IN_PROGRESS")) {
    return fail("ASSIGNMENT_LOCKED", "A avaliação do líder já começou. Devolva para revisão antes de trocar.");
  }
  participant.managerId = input.managerId;
  participant.managerName = input.managerName;
  if (leader && leader.status === "NOT_STARTED") leader.evaluatorEmployeeId = input.managerId;
  audit(db, options.now(), input.actorUserId, "LEADER_REASSIGNED", participant.id, {});
  return { ok: true, db, value: { participantId: participant.id } };
}

export function updatePdiStatus(
  source: PerformanceDatabase,
  input: { pdiId: string; status: "PLANNED" | "IN_PROGRESS" | "DONE" | "SUSPENDED" | "CANCELLED"; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ pdiId: string }> | ServiceError {
  const db = cloneDb(source);
  const pdi = db.pdis.find((p) => p.id === input.pdiId);
  if (!pdi) return fail("NOT_FOUND", "PDI não encontrado.");
  pdi.status = input.status;
  audit(db, options.now(), input.actorUserId, "PDI_STATUS", pdi.id, { status: input.status });
  return { ok: true, db, value: { pdiId: pdi.id } };
}

export function createCycle(
  source: PerformanceDatabase,
  input: {
    name: string;
    periodLabel: string;
    modelId: string;
    selfDueAt: string;
    leaderDueAt: string;
    actorUserId: string | null;
    minObservationDays?: number;
  },
  options: ServiceOptions
): ServiceOk<{ cycleId: string }> | ServiceError {
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model || model.status !== "PUBLISHED") return fail("MODEL_REQUIRED", "Escolha um modelo publicado.");
  const name = input.name.trim();
  if (name.length < 3) return fail("INVALID_NAME", "Informe o nome do ciclo.");
  const cycleId = newId();
  db.cycles.push({
    id: cycleId,
    name,
    periodLabel: input.periodLabel.trim(),
    status: "DRAFT",
    modelId: model.id,
    selfDueAt: input.selfDueAt,
    leaderDueAt: input.leaderDueAt,
    ownerUserId: input.actorUserId,
    minObservationDays: input.minObservationDays ?? PROPOSED_MIN_OBSERVATION_DAYS,
    openedAt: null,
    closedAt: null,
  });
  audit(db, options.now(), input.actorUserId, "CYCLE_CREATED", cycleId, { status: "DRAFT" });
  return { ok: true, db, value: { cycleId } };
}

export function applyParticipants(
  source: PerformanceDatabase,
  input: {
    cycleId: string;
    employees: readonly EmployeeSnapshotSource[];
    selectedIds: readonly string[];
    exceptions: Readonly<Record<string, string>>;
    absenceIds: readonly string[];
    roleChangeIds: readonly string[];
    actorUserId: string | null;
  },
  options: ServiceOptions
): ServiceOk<{ eligible: number; notEligible: number; insufficient: number }> | ServiceError {
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status !== "DRAFT" && cycle.status !== "PREPARED") {
    return fail("CYCLE_FROZEN", "Participantes já foram congelados na abertura.");
  }
  const selected = new Set(input.selectedIds);
  const wanted = input.employees.filter((e) => selected.has(e.id));
  const seen = new Set<string>();
  db.participants = db.participants.filter((p) => p.cycleId !== cycle.id);
  let eligible = 0;
  let notEligible = 0;
  let insufficient = 0;
  for (const employee of wanted) {
    if (seen.has(employee.id)) continue;
    seen.add(employee.id);
    const decision = classifyEligibility({
      employee,
      asOf: options.now(),
      minObservationDays: cycle.minObservationDays,
      absenceOverlapsReference: input.absenceIds.includes(employee.id),
      roleChangedInsideWindow: input.roleChangeIds.includes(employee.id),
      exceptionReason: input.exceptions[employee.id] ?? null,
    });
    if (decision.state === "ELIGIBLE") eligible += 1;
    else if (decision.state === "NOT_ELIGIBLE") notEligible += 1;
    else insufficient += 1;
    db.participants.push({
      id: newId(),
      cycleId: cycle.id,
      employeeId: employee.id,
      employeeName: employee.name,
      eligibility: decision.state,
      eligibilityReason: decision.reason,
      roleId: employee.roleId,
      roleName: employee.roleName,
      departmentId: employee.departmentId,
      departmentName: employee.departmentName,
      managerId: employee.managerId,
      managerName: employee.managerName,
      admissionDate: employee.admissionDate ? iso(employee.admissionDate) : null,
      registration: employee.registration,
      frozen: false,
    });
  }
  audit(db, options.now(), input.actorUserId, "PARTICIPANTS_SET", cycle.id, { eligible, notEligible, insufficient });
  return { ok: true, db, value: { eligible, notEligible, insufficient } };
}

function ensureAssignments(db: PerformanceDatabase, cycleId: string, modelId: string) {
  const participants = db.participants.filter((p) => p.cycleId === cycleId && p.eligibility === "ELIGIBLE");
  for (const participant of participants) {
    participant.frozen = true;
    if (!activeAssignment(db, participant.id, "SELF")) {
      const id = newId();
      db.assignments.push(blankAssignment(id, participant, "SELF", participant.employeeId));
      blankAnswers(db, id, modelId);
    }
    if (participant.managerId && participant.managerId !== participant.employeeId && !activeAssignment(db, participant.id, "LEADER")) {
      const id = newId();
      db.assignments.push(blankAssignment(id, participant, "LEADER", participant.managerId));
      blankAnswers(db, id, modelId);
    }
  }
}

function blankAssignment(
  id: string,
  participant: { id: string; cycleId: string; employeeId: string },
  kind: "SELF" | "LEADER",
  evaluatorEmployeeId: string
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
  };
}

export function transitionCycle(
  source: PerformanceDatabase,
  input: { cycleId: string; to: import("./performanceDomain.js").CycleStatus; actorUserId: string | null; reversalReason: string | null; pilotAck?: boolean; actorEmployeeId?: string | null; acceptPending?: boolean },
  options: ServiceOptions
): ServiceOk<{ status: string }> | ServiceError {
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  const step = nextCycleStatus(cycle.status, input.to, Boolean(input.reversalReason?.trim()));
  if (step.ok === false) return fail(step.code, "Esta mudança de situação não é permitida.");
  if (input.to === "PREPARED") {
    const model = db.models.find((m) => m.id === cycle.modelId);
    if (!model || model.status !== "PUBLISHED") return fail("MODEL_REQUIRED", "Publique o modelo antes de preparar o ciclo.");
    if (!db.participants.some((p) => p.cycleId === cycle.id)) return fail("PARTICIPANTS_REQUIRED", "Selecione as pessoas do ciclo.");
  }
  if (input.to === "OPEN") {
    if (!options.officialPublication && input.pilotAck !== true) {
      return fail("GOVERNANCE_BLOCKED", "A abertura pede a confirmação de que as regras ainda estão em proposta. O ciclo pode ficar preparado.");
    }
    if (!options.officialPublication) {
      audit(db, options.now(), input.actorUserId, "PILOT_OPEN", cycle.id, { homologated: false });
    }
    const eligible = db.participants.filter((p) => p.cycleId === cycle.id && p.eligibility === "ELIGIBLE");
    if (eligible.length === 0) return fail("PARTICIPANTS_REQUIRED", "Não há pessoa elegível para abrir o ciclo.");
    ensureAssignments(db, cycle.id, cycle.modelId);
    cycle.openedAt = iso(options.now());
  }
  if (input.to === "CONSOLIDATION" && input.acceptPending !== true) {
    const eligible = db.participants.filter((p) => p.cycleId === cycle.id && p.eligibility === "ELIGIBLE");
    const pending = eligible.filter((participant) => {
      const self = activeAssignment(db, participant.id, "SELF");
      const leader = activeAssignment(db, participant.id, "LEADER");
      return self?.status !== "SUBMITTED" || (participant.managerId && leader?.status !== "SUBMITTED");
    });
    if (pending.length > 0) {
      return fail("PENDING_ASSIGNMENTS", `Ainda há ${pending.length} pessoa(s) sem autoavaliação ou sem avaliação do líder. Confirme para seguir mesmo assim.`);
    }
  }
  if (input.to === "HOMOLOGATED") {
    const eligible = db.participants.filter((p) => p.cycleId === cycle.id && p.eligibility === "ELIGIBLE");
    if (input.actorEmployeeId && eligible.some((p) => p.employeeId === input.actorEmployeeId)) {
      return fail("SELF_HOMOLOGATION", "Quem participa do ciclo não homologa o próprio resultado.");
    }
    for (const participant of eligible) {
      const result = db.results.find((r) => r.participantId === participant.id && r.active);
      if (!result || result.reviewStatus !== "CALIBRATED") {
        return fail("CALIBRATION_REQUIRED", "Homologar o ciclo exige a calibração de cada pessoa elegível.");
      }
      if (result.technicalValidation === "PENDING_VALIDATION") {
        return fail("VALIDATION_REQUIRED", "Há desempenho técnico sem validação da função.");
      }
      result.official = true;
    }
  }
  if (input.to === "CLOSED") cycle.closedAt = iso(options.now());
  if (input.reversalReason?.trim() && input.to !== "OPEN") {
    audit(db, options.now(), input.actorUserId, "CYCLE_REVERSED", cycle.id, { to: input.to, reason: input.reversalReason.trim() });
  }
  cycle.status = input.to;
  audit(db, options.now(), input.actorUserId, "CYCLE_TRANSITION", cycle.id, { status: input.to });
  return { ok: true, db, value: { status: cycle.status } };
}

function applyAnswer(row: AnswerRecord, kind: AssignmentRecord["kind"], answer: AnswerInput): ServiceError | null {
  if (!evidenceSatisfied(kind, answer)) {
    return fail("EVIDENCE_REQUIRED", "Nas notas 1 e 4, o líder escreve um exemplo curto do que observou.");
  }
  if (answer.kind === "pending") {
    row.kind = "pending";
    row.score = null;
    row.evidence = null;
    return null;
  }
  if (answer.kind === "notObserved") {
    row.kind = "notObserved";
    row.score = null;
    row.evidence = null;
    return null;
  }
  row.kind = "score";
  row.score = answer.score;
  row.evidence = answer.evidence?.trim() || null;
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
): ServiceOk<{ version: number }> | ServiceError {
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!assignment) return fail("NOT_FOUND", "Tarefa não encontrada.");
  if (assignment.status === "SUBMITTED") return fail("ASSIGNMENT_LOCKED", "Esta resposta já foi enviada.");
  if (assignment.version !== input.expectedVersion) return fail("VERSION_CONFLICT", "A tarefa mudou em outro lugar. Atualize a tela.");
  if (assignment.kind === "LEADER" && !canEvaluateEmployee(input.scope, assignment.employeeId)) {
    return fail("FORBIDDEN", "Você não avalia esta pessoa.");
  }
  if (assignment.kind === "SELF" && input.scope.kind !== "ALL") {
    const actor = input.scope.actorEmployeeId;
    const assisted = Boolean(input.assistedByUserId);
    if (!assisted && actor !== assignment.employeeId) return fail("FORBIDDEN", "A autoavaliação é só da própria pessoa.");
  }
  for (const item of input.answers) {
    const row = db.answers.find((a) => a.assignmentId === assignment.id && a.questionCode === item.code);
    if (!row) return fail("NOT_FOUND", "Pergunta não faz parte desta versão.");
    const problem = applyAnswer(row, assignment.kind, item.answer);
    if (problem) return problem;
  }
  assignment.version += 1;
  assignment.status = "IN_PROGRESS";
  if (input.assistedByUserId) assignment.assistedByUserId = input.assistedByUserId;
  audit(db, options.now(), input.actorUserId, "ANSWERS_SAVED", assignment.id, {
    version: assignment.version,
    count: input.answers.length,
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
): ServiceOk<{ status: string }> | ServiceError {
  const assignment = source.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!assignment) return fail("NOT_FOUND", "Tarefa não encontrada.");
  if (assignment.status === "SUBMITTED") return { ok: true, db: source, value: { status: "SUBMITTED" } };
  if (assignment.assistedByUserId && !input.assistedConfirmation) {
    return fail("ASSIST_CONFIRMATION", "A pessoa precisa confirmar as respostas antes do envio.");
  }
  if (pendingCount(source, assignment.id) > 0) return fail("INCOMPLETE", "Ainda há pergunta sem resposta.");
  const saved = saveAnswers(source, { ...input, answers: [] }, options);
  if (saved.ok === false) return saved;
  const db = saved.db;
  const current = db.assignments.find((a) => a.id === assignment.id)!;
  current.status = "SUBMITTED";
  current.submittedAt = iso(options.now());
  recompute(db, current.participantId);
  audit(db, options.now(), input.actorUserId, "ASSIGNMENT_SUBMITTED", current.id, { kind: current.kind });
  for (const session of db.sessions.filter((s) => s.assignmentId === current.id)) session.revoked = true;
  return { ok: true, db, value: { status: "SUBMITTED" } };
}

function recompute(db: PerformanceDatabase, participantId: string) {
  const participant = db.participants.find((p) => p.id === participantId);
  const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
  if (!participant || !cycle) return;
  const leader = activeAssignment(db, participant.id, "LEADER");
  const sourceAnswers = leader ? toStored(db, leader.id) : [];
  const minValid = PROPOSED_MIN_VALID_ANSWERS;
  const technical = aggregatePillar(sourceAnswers, "TECHNICAL", minValid);
  const culture = aggregatePillar(sourceAnswers, "CULTURE", minValid);
  const potential = aggregatePillar(sourceAnswers, "POTENTIAL", minValid);
  const cultureResult = cultureBand(sourceAnswers, minValid);
  const previous = db.results.find((r) => r.participantId === participant.id && r.active);
  const technicalValidation = technical.insufficient
    ? "INSUFFICIENT"
    : previous?.technicalValidation === "VALIDATED"
      ? "VALIDATED"
      : "PENDING_VALIDATION";
  const placement = placeNineBox({
    technical,
    potential,
    technicalValidation,
  });
  if (previous) previous.active = false;
  const next: ResultRecord = {
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
    validationNote: previous?.validationNote ?? null,
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
  };
  db.results.push(next);
}

export function validateTechnical(
  source: PerformanceDatabase,
  input: { participantId: string; decision: "VALIDATED" | "INSUFFICIENT"; note: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ quadrant: string }> | ServiceError {
  const note = input.note.trim();
  if (note.length < 8) return fail("NOTE_REQUIRED", "Registre o critério da função usado nesta validação.");
  const db = cloneDb(source);
  const current = db.results.find((r) => r.participantId === input.participantId && r.active);
  if (!current) return fail("NOT_FOUND", "Ainda não há resultado do líder.");
  if (current.official) return fail("RESULT_LOCKED", "Resultado homologado só muda por revisão.");
  const previousId = current.id;
  current.active = false;
  const technical = { sum: current.technicalSum, count: current.technicalCount, insufficient: current.technicalCount < PROPOSED_MIN_VALID_ANSWERS, display: null };
  const potential = { sum: current.potentialSum, count: current.potentialCount, insufficient: current.potentialCount < PROPOSED_MIN_VALID_ANSWERS, display: null };
  const placement = placeNineBox({ technical, potential, technicalValidation: input.decision });
  db.results.push({
    ...current,
    id: newId(),
    version: current.version + 1,
    active: true,
    technicalValidation: input.decision,
    validationNote: note,
    quadrant: placement.quadrant,
    nineBoxReason: placement.reason,
    nineX: placement.x,
    nineY: placement.y,
    official: false,
    reviewStatus: "PRELIMINARY",
    supersedesId: previousId,
  });
  audit(db, options.now(), input.actorUserId, "TECHNICAL_VALIDATED", input.participantId, { decision: input.decision });
  return { ok: true, db, value: { quadrant: placement.quadrant } };
}

export function calibrate(
  source: PerformanceDatabase,
  input: { participantId: string; note: string; actorUserId: string | null; actorEmployeeId: string | null },
  options: ServiceOptions
): ServiceOk<{ reviewStatus: string }> | ServiceError {
  const note = input.note.trim();
  if (note.length < 8) return fail("NOTE_REQUIRED", "A calibração precisa de um motivo.");
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId);
  if (!participant) return fail("NOT_FOUND", "Participante não encontrado.");
  if (input.actorEmployeeId && input.actorEmployeeId === participant.employeeId) {
    return fail("SELF_HOMOLOGATION", "A pessoa não calibra o próprio resultado.");
  }
  const current = db.results.find((r) => r.participantId === participant.id && r.active);
  if (!current) return fail("NOT_FOUND", "Sem resultado para calibrar.");
  const previousId = current.id;
  current.active = false;
  db.results.push({
    ...current,
    id: newId(),
    version: current.version + 1,
    active: true,
    reviewStatus: "CALIBRATED",
    official: false,
    supersedesId: previousId,
  });
  audit(db, options.now(), input.actorUserId, "RESULT_CALIBRATED", participant.id, { from: previousId });
  return { ok: true, db, value: { reviewStatus: "CALIBRATED" } };
}

export function issueInvite(
  source: PerformanceDatabase,
  input: { assignmentId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ url: string; otp: string; inviteId: string }> | ServiceError {
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.active && a.kind === "SELF");
  if (!assignment) return fail("NOT_FOUND", "Convite só existe para a autoavaliação.");
  if (assignment.status === "SUBMITTED") return fail("ASSIGNMENT_LOCKED", "A pesquisa já foi enviada.");
  for (const invite of db.invites.filter((i) => i.assignmentId === assignment.id && !i.revokedAt)) {
    invite.revokedAt = iso(options.now());
  }
  const token = newLinkToken();
  const otp = newOtpCode();
  const inviteId = newId();
  const expires = new Date(options.now().getTime() + 14 * 24 * 60 * 60 * 1000);
  db.invites.push({
    id: inviteId,
    assignmentId: assignment.id,
    linkDigest: digestSecret(token),
    otpDigest: digestSecret(otp),
    expiresAt: iso(expires),
    revokedAt: null,
    failedAttempts: 0,
    locked: false,
  });
  audit(db, options.now(), input.actorUserId, "INVITE_ISSUED", inviteId, { assignmentId: assignment.id });
  return { ok: true, db, value: { url: buildInviteHashUrl(options.publicOrigin, token), otp, inviteId } };
}

export function exchangeLink(
  source: PerformanceDatabase,
  input: { token: string },
  options: ServiceOptions
): ServiceOk<{ sessionToken: string; phase: "LINK" }> | ServiceError {
  const db = cloneDb(source);
  const digest = digestSecret(input.token);
  const invite = db.invites.find((i) => secretsMatch(i.linkDigest, digest));
  const assignment = invite ? db.assignments.find((a) => a.id === invite.assignmentId) : null;
  const gate = gateInvite({
    found: Boolean(invite),
    expiresAt: invite ? new Date(invite.expiresAt) : null,
    revokedAt: invite?.revokedAt ? new Date(invite.revokedAt) : null,
    locked: Boolean(invite?.locked),
    submitted: assignment?.status === "SUBMITTED",
    now: options.now(),
  });
  if (!gate.ok || !invite) return fail("INVITE_REJECTED", publicFailureMessage());
  const sessionToken = newSessionToken();
  db.sessions.push({
    id: newId(),
    inviteId: invite.id,
    assignmentId: invite.assignmentId,
    phase: "LINK",
    sessionDigest: digestSecret(sessionToken),
    expiresAt: iso(new Date(options.now().getTime() + SESSION_TTL_MS)),
    assistantUserId: null,
    revoked: false,
  });
  audit(db, options.now(), null, "INVITE_LINK_EXCHANGED", invite.id, {});
  return { ok: true, db, value: { sessionToken, phase: "LINK" } };
}

export function verifyOtp(
  source: PerformanceDatabase,
  input: { sessionToken: string; otp: string },
  options: ServiceOptions
): ServiceOk<{ sessionToken: string }> | ServiceError {
  const db = cloneDb(source);
  const session = liveSession(db, input.sessionToken, options.now());
  if (!session || session.phase !== "LINK" || !session.inviteId) return fail("INVITE_REJECTED", publicFailureMessage());
  const invite = db.invites.find((i) => i.id === session.inviteId);
  if (!invite || invite.locked) return fail("INVITE_REJECTED", publicFailureMessage());
  if (!secretsMatch(invite.otpDigest, digestSecret(input.otp))) {
    invite.failedAttempts += 1;
    if (invite.failedAttempts >= OTP_ATTEMPT_LIMIT) invite.locked = true;
    audit(db, options.now(), null, "OTP_FAILED", invite.id, { locked: invite.locked });
    return { ok: false, code: "INVITE_REJECTED", message: publicFailureMessage(), db };
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
    revoked: false,
  });
  audit(db, options.now(), null, "OTP_VERIFIED", invite.id, {});
  return { ok: true, db, value: { sessionToken } };
}

function liveSession(db: PerformanceDatabase, token: string, now: Date) {
  const digest = digestSecret(token);
  return (
    db.sessions.find(
      (s) => secretsMatch(s.sessionDigest, digest) && !s.revoked && new Date(s.expiresAt).getTime() > now.getTime()
    ) ?? null
  );
}

export function publicForm(
  source: PerformanceDatabase,
  input: { sessionToken: string },
  options: ServiceOptions
): ServiceOk<{ employeeName: string; questions: { code: string; text: string; pillar: string }[]; answers: AnswerRecord[]; version: number; periodLabel: string }> | ServiceError {
  const session = liveSession(source, input.sessionToken, options.now());
  if (!session || (session.phase !== "VERIFIED" && session.phase !== "ASSISTED")) return fail("INVITE_REJECTED", publicFailureMessage());
  const assignment = source.assignments.find((a) => a.id === session.assignmentId);
  const participant = assignment ? source.participants.find((p) => p.id === assignment.participantId) : null;
  const cycle = participant ? source.cycles.find((c) => c.id === participant.cycleId) : null;
  if (!assignment || !participant || !cycle) return fail("INVITE_REJECTED", publicFailureMessage());
  const questions = questionsOf(source, cycle.modelId).map((q) => ({ code: q.code, text: q.selfText, pillar: q.pillar }));
  const answers = source.answers.filter((a) => a.assignmentId === assignment.id);
  return {
    ok: true,
    db: source,
    value: { employeeName: participant.employeeName, questions, answers, version: assignment.version, periodLabel: cycle.periodLabel },
  };
}

export function leaderQueue(db: PerformanceDatabase, scope: PerformanceScope, actorEmployeeId: string | null) {
  return db.assignments
    .filter((a) => a.active && a.kind === "LEADER" && leaderQueueIncludes(scope, a.employeeId, actorEmployeeId))
    .map((assignment) => {
      const participant = db.participants.find((p) => p.id === assignment.participantId);
      const self = participant ? activeAssignment(db, participant.id, "SELF") : null;
      const showSelf = Boolean(self && assignment.status === "SUBMITTED");
      return {
        assignmentId: assignment.id,
        employeeName: participant?.employeeName ?? "",
        roleName: participant?.roleName ?? "",
        departmentName: participant?.departmentName ?? "",
        status: assignment.status,
        version: assignment.version,
        selfVisible: showSelf,
        divergences: showSelf && self ? findDivergences(toStored(db, self.id), toStored(db, assignment.id), PROPOSED_DIVERGENCE_THRESHOLD) : [],
      };
    });
}

export function readLeaderForm(db: PerformanceDatabase, assignmentId: string, scope: PerformanceScope, actorEmployeeId: string | null) {
  const assignment = db.assignments.find((a) => a.id === assignmentId && a.active && a.kind === "LEADER");
  if (!assignment || !leaderQueueIncludes(scope, assignment.employeeId, actorEmployeeId)) return fail("FORBIDDEN", "Acesso negado.");
  const participant = db.participants.find((p) => p.id === assignment.participantId)!;
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  const self = activeAssignment(db, participant.id, "SELF");
  const selfReleased = assignment.status === "SUBMITTED" && self?.status === "SUBMITTED";
  return {
    ok: true as const,
    assignment,
    questions: questionsOf(db, cycle.modelId).map((q) => ({ code: q.code, text: q.leaderText, pillar: q.pillar, hint: q.hint })),
    answers: db.answers.filter((a) => a.assignmentId === assignment.id),
    selfAnswers: selfReleased && self ? db.answers.filter((a) => a.assignmentId === self.id) : [],
    divergences: selfReleased && self ? findDivergences(toStored(db, self.id), toStored(db, assignment.id), PROPOSED_DIVERGENCE_THRESHOLD) : [],
  };
}

export function dashboardCounts(db: PerformanceDatabase, cycleId: string) {
  const participants = db.participants.filter((p) => p.cycleId === cycleId);
  const eligible = participants.filter((p) => p.eligibility === "ELIGIBLE");
  const assignments = db.assignments.filter((a) => a.cycleId === cycleId && a.active);
  const invited = new Set(db.invites.filter((i) => assignments.some((a) => a.id === i.assignmentId)).map((i) => i.assignmentId));
  const self = assignments.filter((a) => a.kind === "SELF");
  const leader = assignments.filter((a) => a.kind === "LEADER");
  return {
    eligible: eligible.length,
    notEligible: participants.filter((p) => p.eligibility === "NOT_ELIGIBLE").length,
    insufficient: participants.filter((p) => p.eligibility === "INSUFFICIENT_EVIDENCE").length,
    invited: invited.size,
    selfStarted: self.filter((a) => a.status !== "NOT_STARTED").length,
    selfSubmitted: self.filter((a) => a.status === "SUBMITTED").length,
    leaderSubmitted: leader.filter((a) => a.status === "SUBMITTED").length,
    calibrated: db.results.filter((r) => r.active && r.reviewStatus === "CALIBRATED" && eligible.some((p) => p.id === r.participantId)).length,
    feedback: db.feedbacks.filter((f) => eligible.some((p) => p.id === f.participantId)).length,
    pdiOpen: db.pdis.filter((p) => p.status !== "DONE" && p.status !== "CANCELLED" && eligible.some((e) => e.id === p.participantId)).length,
    selfPending: eligible.length - self.filter((a) => a.status === "SUBMITTED").length,
    leaderPending: eligible.filter((p) => p.managerId).length - leader.filter((a) => a.status === "SUBMITTED").length,
    pdiLate: db.pdis.filter((p) => p.status !== "DONE" && p.status !== "CANCELLED" && p.dueAt && p.dueAt < new Date().toISOString().slice(0, 10) && eligible.some((e) => e.id === p.participantId)).length,
  };
}

export function describeCycle(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope) {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  const now = Date.now();
  const people = db.participants
    .filter((p) => p.cycleId === cycleId && (scope.kind === "ALL" || scope.visible.has(p.employeeId)))
    .map((participant) => {
      const self = activeAssignment(db, participant.id, "SELF");
      const leader = activeAssignment(db, participant.id, "LEADER");
      const result = db.results.find((r) => r.participantId === participant.id && r.active) ?? null;
      const feedback = db.feedbacks.find((f) => f.participantId === participant.id) ?? null;
      const pdis = db.pdis.filter((p) => p.participantId === participant.id);
      const invite = self ? db.invites.filter((i) => i.assignmentId === self.id).at(-1) ?? null : null;
      const inviteStatus = !invite
        ? "NONE"
        : invite.revokedAt
          ? "REVOKED"
          : invite.locked
            ? "LOCKED"
            : new Date(invite.expiresAt).getTime() <= now
              ? "EXPIRED"
              : "ACTIVE";
      const divergences =
        self?.status === "SUBMITTED" && leader?.status === "SUBMITTED"
          ? findDivergences(toStored(db, self.id), toStored(db, leader.id), PROPOSED_DIVERGENCE_THRESHOLD)
          : [];
      return {
        participant,
        self: self ? { id: self.id, status: self.status, version: self.version } : null,
        leader: leader ? { id: leader.id, status: leader.status, version: leader.version, evaluatorEmployeeId: leader.evaluatorEmployeeId } : null,
        result: result
          ? {
              id: result.id,
              quadrant: result.quadrant,
              official: result.official,
              reviewStatus: result.reviewStatus,
              technicalValidation: result.technicalValidation,
              cultureBand: result.cultureBand,
              technicalSum: result.technicalSum,
              technicalCount: result.technicalCount,
              potentialSum: result.potentialSum,
              potentialCount: result.potentialCount,
              cultureSum: result.cultureSum,
              cultureCount: result.cultureCount,
              nineBoxReason: result.nineBoxReason,
            }
          : null,
        feedback: feedback
          ? { id: feedback.id, strength: feedback.strength, improvement: feedback.improvement, action: feedback.action, acknowledgedAt: feedback.acknowledgedAt, agreedAt: feedback.agreedAt, contestation: feedback.contestation }
          : null,
        pdis: pdis.map((p) => ({ id: p.id, title: p.title, status: p.status, dueAt: p.dueAt, priority: p.priority, ownerName: p.ownerName })),
        inviteStatus,
        inviteExpiresAt: invite?.expiresAt ?? null,
        divergences,
      };
    });
  return { cycle, people, questions: questionsOf(db, cycle.modelId) };
}

export function claimAssisted(
  source: PerformanceDatabase,
  input: { token: string },
  options: ServiceOptions
): ServiceOk<{ sessionToken: string }> | ServiceError {
  const session = liveSession(source, input.token, options.now());
  if (!session || session.phase !== "ASSISTED") return fail("INVITE_REJECTED", publicFailureMessage());
  return { ok: true, db: source, value: { sessionToken: input.token } };
}

export function createFeedback(
  source: PerformanceDatabase,
  input: { participantId: string; strength: string; improvement: string; action: string; ownerName: string; dueAt: string | null; conversationAt: string | null; leaderEmployeeId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ feedbackId: string }> | ServiceError {
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId);
  const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
  const result = db.results.find((r) => r.participantId === input.participantId && r.active && r.official);
  if (!participant || !cycle || !result) return fail("NOT_HOMOLOGATED", "A devolutiva oficial só existe depois da homologação.");
  if (cycle.status !== "HOMOLOGATED" && cycle.status !== "CLOSED") return fail("NOT_HOMOLOGATED", "O ciclo ainda não está homologado.");
  const feedbackId = newId();
  db.feedbacks.push({
    id: feedbackId,
    participantId: participant.id,
    resultId: result.id,
    strength: input.strength.trim(),
    improvement: input.improvement.trim(),
    action: input.action.trim(),
    ownerName: input.ownerName.trim(),
    dueAt: input.dueAt,
    conversationAt: input.conversationAt,
    leaderEmployeeId: input.leaderEmployeeId,
    viewedAt: null,
    acknowledgedAt: null,
    agreedAt: null,
    contestation: null,
    internalNotes: null,
  });
  audit(db, options.now(), input.actorUserId, "FEEDBACK_CREATED", feedbackId, {});
  return { ok: true, db, value: { feedbackId } };
}

export function acknowledgeFeedback(
  source: PerformanceDatabase,
  input: { feedbackId: string; action: "VIEWED" | "ACKNOWLEDGED" | "AGREED" | "CONTESTED"; note: string | null; actorEmployeeId: string },
  options: ServiceOptions
): ServiceOk<{ action: string }> | ServiceError {
  const db = cloneDb(source);
  const feedback = db.feedbacks.find((f) => f.id === input.feedbackId);
  const participant = feedback ? db.participants.find((p) => p.id === feedback.participantId) : null;
  if (!feedback || !participant || participant.employeeId !== input.actorEmployeeId) return fail("FORBIDDEN", "A devolutiva é só da própria pessoa.");
  const at = iso(options.now());
  if (input.action === "VIEWED") feedback.viewedAt = at;
  if (input.action === "ACKNOWLEDGED") feedback.acknowledgedAt = at;
  if (input.action === "AGREED") feedback.agreedAt = at;
  if (input.action === "CONTESTED") feedback.contestation = input.note?.trim() || "Contestação registrada.";
  audit(db, options.now(), null, "FEEDBACK_ACK", feedback.id, { action: input.action });
  return { ok: true, db, value: { action: input.action } };
}

export function createPdi(
  source: PerformanceDatabase,
  input: { feedbackId: string; title: string; priority: boolean; justification: string | null; ownerName: string; dueAt: string | null; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ pdiId: string }> | ServiceError {
  const db = cloneDb(source);
  const feedback = db.feedbacks.find((f) => f.id === input.feedbackId);
  if (!feedback) return fail("NOT_FOUND", "Devolutiva não encontrada.");
  const existingPriority = db.pdis.some((p) => p.feedbackId === feedback.id && p.priority && p.status !== "CANCELLED");
  if (!input.priority && !input.justification?.trim()) return fail("JUSTIFICATION_REQUIRED", "Ação extra precisa de justificativa.");
  if (input.priority && existingPriority) return fail("PRIORITY_EXISTS", "Já existe uma ação prioritária. As demais pedem justificativa.");
  const pdiId = newId();
  db.pdis.push({
    id: pdiId,
    participantId: feedback.participantId,
    feedbackId: feedback.id,
    title: input.title.trim(),
    priority: input.priority,
    justification: input.justification?.trim() || null,
    ownerName: input.ownerName.trim(),
    dueAt: input.dueAt,
    status: "PLANNED",
  });
  audit(db, options.now(), input.actorUserId, "PDI_CREATED", pdiId, { priority: input.priority });
  return { ok: true, db, value: { pdiId } };
}

export function addCheckin(
  source: PerformanceDatabase,
  input: { pdiId: string; note: string; obstacle: string | null; nextStep: string | null; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ checkinId: string }> | ServiceError {
  const db = cloneDb(source);
  const pdi = db.pdis.find((p) => p.id === input.pdiId);
  if (!pdi) return fail("NOT_FOUND", "PDI não encontrado.");
  const checkinId = newId();
  db.checkins.push({
    id: checkinId,
    pdiId: pdi.id,
    note: input.note.trim(),
    obstacle: input.obstacle?.trim() || null,
    nextStep: input.nextStep?.trim() || null,
    authorUserId: input.actorUserId,
    createdAt: iso(options.now()),
  });
  audit(db, options.now(), input.actorUserId, "PDI_CHECKIN", pdi.id, {});
  return { ok: true, db, value: { checkinId } };
}

export function recordConduct(
  source: PerformanceDatabase,
  input: { employeeId: string; summary: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ conductId: string }> | ServiceError {
  const db = cloneDb(source);
  const before = db.results.map((r) => r.id);
  const conductId = newId();
  db.conducts.push({ id: conductId, employeeId: input.employeeId, status: "RECORDED", summary: input.summary.trim(), proven: false });
  audit(db, options.now(), input.actorUserId, "CONDUCT_RECORDED", conductId, { proven: false });
  const after = db.results.map((r) => r.id);
  if (before.join() !== after.join()) return fail("CONDUCT_LEAK", "Ocorrência não pode alterar resultado.");
  return { ok: true, db, value: { conductId } };
}

export function employeeHistory(db: PerformanceDatabase, employeeId: string, scope: PerformanceScope, includeInternal: boolean) {
  if (!canSeeEmployee(scope, employeeId)) return fail("FORBIDDEN", "Acesso negado.");
  const participants = db.participants.filter((p) => p.employeeId === employeeId);
  return {
    ok: true as const,
    cycles: participants.map((participant) => {
      const cycle = db.cycles.find((c) => c.id === participant.cycleId);
      const result = db.results.find((r) => r.participantId === participant.id && r.active && r.official);
      const feedback = db.feedbacks.find((f) => f.participantId === participant.id);
      return {
        cycleName: cycle?.name ?? "",
        periodLabel: cycle?.periodLabel ?? "",
        roleName: participant.roleName,
        departmentName: participant.departmentName,
        eligibility: participant.eligibility,
        quadrant: result?.quadrant ?? null,
        cultureBand: result?.cultureBand ?? null,
        feedback: feedback
          ? {
              strength: feedback.strength,
              improvement: feedback.improvement,
              acknowledgedAt: feedback.acknowledgedAt,
              agreedAt: feedback.agreedAt,
              contestation: feedback.contestation,
              internalNotes: includeInternal ? feedback.internalNotes : null,
            }
          : null,
      };
    }),
  };
}

export function planReminders(
  source: PerformanceDatabase,
  input: { cycleId: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ drafted: number; dispatched: number }> | ServiceError {
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  let drafted = 0;
  for (const assignment of db.assignments.filter((a) => a.cycleId === cycle.id && a.active && a.status !== "SUBMITTED")) {
    const exists = db.reminders.some((r) => r.cycleId === cycle.id && r.employeeId === assignment.evaluatorEmployeeId && r.audience === (assignment.kind === "SELF" ? "SELF" : "LEADER"));
    if (exists) continue;
    db.reminders.push({
      id: newId(),
      cycleId: cycle.id,
      employeeId: assignment.evaluatorEmployeeId,
      audience: assignment.kind === "SELF" ? "SELF" : "LEADER",
      status: "DRAFT",
    });
    drafted += 1;
  }
  audit(db, options.now(), input.actorUserId, "REMINDERS_DRAFTED", cycle.id, { drafted, dispatched: 0 });
  return { ok: true, db, value: { drafted, dispatched: options.remindersEnabled ? 0 : 0 } };
}

export function dispatchReminders(options: ServiceOptions): ServiceOk<{ sent: number }> | ServiceError {
  if (!options.remindersEnabled) return fail("REMINDERS_DISABLED", "Lembretes externos permanecem desligados.");
  return fail("REMINDERS_DISABLED", "Nenhum canal de envio foi autorizado.");
}

export function reportRows(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope) {
  return db.participants
    .filter((p) => p.cycleId === cycleId && canSeeEmployee(scope, p.employeeId))
    .map((participant) => {
      const result = db.results.find((r) => r.participantId === participant.id && r.active);
      return {
        name: neutralizeSpreadsheetCell(participant.employeeName),
        role: neutralizeSpreadsheetCell(participant.roleName),
        department: neutralizeSpreadsheetCell(participant.departmentName),
        eligibility: participant.eligibility,
        quadrant: result?.official ? result.quadrant : "preliminar",
        culture: result?.cultureBand ?? "",
      };
    });
}

export function returnForRevision(
  source: PerformanceDatabase,
  input: { assignmentId: string; reason: string; actorUserId: string | null },
  options: ServiceOptions
): ServiceOk<{ assignmentId: string }> | ServiceError {
  const reason = input.reason.trim();
  if (reason.length < 8) return fail("NOTE_REQUIRED", "Diga o que precisa ser revisto.");
  const db = cloneDb(source);
  const current = db.assignments.find((a) => a.id === input.assignmentId && a.active);
  if (!current || current.status !== "SUBMITTED") return fail("NOT_SUBMITTED", "Só uma resposta enviada volta para revisão.");
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
  });
  for (const answer of db.answers.filter((a) => a.assignmentId === current.id)) {
    db.answers.push({ ...answer, id: newId(), assignmentId: nextId });
  }
  audit(db, options.now(), input.actorUserId, "ASSIGNMENT_RETURNED", nextId, { revision: current.revision + 1 });
  return { ok: true, db, value: { assignmentId: nextId } };
}

export function publicSave(
  source: PerformanceDatabase,
  input: { sessionToken: string; expectedVersion: number; answers: readonly { code: string; answer: AnswerInput }[]; confirm?: boolean },
  options: ServiceOptions
): ServiceOk<{ version: number }> | ServiceError {
  const session = liveSession(source, input.sessionToken, options.now());
  if (!session || (session.phase !== "VERIFIED" && session.phase !== "ASSISTED")) {
    return fail("INVITE_REJECTED", publicFailureMessage());
  }
  const assignment = source.assignments.find((a) => a.id === session.assignmentId);
  const participant = assignment ? source.participants.find((p) => p.id === assignment.participantId) : null;
  if (!assignment || !participant) return fail("INVITE_REJECTED", publicFailureMessage());
  return saveAnswers(
    source,
    {
      assignmentId: assignment.id,
      expectedVersion: input.expectedVersion,
      answers: input.answers,
      actorUserId: session.assistantUserId,
      assistedByUserId: session.phase === "ASSISTED" ? session.assistantUserId : null,
      scope: {
        kind: "LIMITED",
        actorEmployeeId: participant.employeeId,
        visible: new Set([participant.employeeId]),
        writable: new Set<string>(),
      },
    },
    options
  );
}

export function publicSubmit(
  source: PerformanceDatabase,
  input: { sessionToken: string; expectedVersion: number; confirm: boolean },
  options: ServiceOptions
): ServiceOk<{ status: string }> | ServiceError {
  const session = liveSession(source, input.sessionToken, options.now());
  if (!session || (session.phase !== "VERIFIED" && session.phase !== "ASSISTED")) {
    return fail("INVITE_REJECTED", publicFailureMessage());
  }
  const assignment = source.assignments.find((a) => a.id === session.assignmentId);
  const participant = assignment ? source.participants.find((p) => p.id === assignment.participantId) : null;
  if (!assignment || !participant) return fail("INVITE_REJECTED", publicFailureMessage());
  return submitAssignment(
    source,
    {
      assignmentId: assignment.id,
      expectedVersion: input.expectedVersion,
      actorUserId: session.assistantUserId,
      assistedConfirmation: session.phase === "ASSISTED" ? input.confirm : true,
      scope: {
        kind: "LIMITED",
        actorEmployeeId: participant.employeeId,
        visible: new Set([participant.employeeId]),
        writable: new Set<string>(),
      },
    },
    options
  );
}

export function openAssisted(
  source: PerformanceDatabase,
  input: { assignmentId: string; assistantUserId: string; actorEmployeeId: string | null },
  options: ServiceOptions
): ServiceOk<{ sessionToken: string }> | ServiceError {
  const db = cloneDb(source);
  const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.active && a.kind === "SELF");
  if (!assignment) return fail("NOT_FOUND", "Autoavaliação não encontrada.");
  if (assignment.status === "SUBMITTED") return fail("ASSIGNMENT_LOCKED", "A pesquisa já foi enviada.");
  assignment.assistedByUserId = input.assistantUserId;
  const sessionToken = newSessionToken();
  db.sessions.push({
    id: newId(),
    inviteId: null,
    assignmentId: assignment.id,
    phase: "ASSISTED",
    sessionDigest: digestSecret(sessionToken),
    expiresAt: iso(new Date(options.now().getTime() + SESSION_TTL_MS)),
    assistantUserId: input.assistantUserId,
    revoked: false,
  });
  audit(db, options.now(), input.assistantUserId, "ASSISTED_OPENED", assignment.id, {});
  return { ok: true, db, value: { sessionToken } };
}
