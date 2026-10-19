/**
 * Avaliação 180° de liderança: casos de uso sobre o grafo do módulo (puro, sem I/O).
 *
 * Quem é líder: participante elegível com pelo menos um liderado direto ativo na hierarquia
 * efetiva, no retrato tirado na abertura do ciclo (`applyLeadershipSnapshot`). Cargo não conta.
 *
 * Tarefas na abertura (só se o ciclo tiver modelo de liderança):
 * - LEADERSHIP_UPWARD: cada participante elegível avalia o seu superior direto, se o superior for
 *   participante elegível e líder no ciclo. `participantId` = quem responde; `subjectParticipantId`
 *   = o líder. Superior indireto não recebe avaliação de quem não é liderado direto.
 * - LEADERSHIP_SELF: cada líder elegível sobre si.
 * - LEADERSHIP_SUPERIOR: o superior efetivo do líder sobre o líder.
 *
 * Confidencialidade: respostas e comentários UPWARD nunca são devolvidos por nenhuma função daqui,
 * a não ser a média agregada (≥ mínimo) e só depois de encerrada a coleta.
 */
import { isFrequencyScore, PROPOSED_MODEL_INSTRUCTIONS, proposedRules, type AnswerInput } from "./performanceDomain.js";
import {
  calibratedIndex,
  commentProblem,
  compareCompetencies,
  isLeadershipKind,
  justificationReasons,
  LEADERSHIP_CODES,
  LEADERSHIP_JUSTIFICATION_MIN,
  leadershipAnswerProblem,
  parseLeadershipRules,
  personalPerspective,
  PROPOSED_LEADERSHIP_QUESTIONS,
  PROPOSED_LEADERSHIP_RULES,
  questionText,
  strengthsAndPriorities,
  teamPerspective,
  type LeadershipAssignmentKind,
  type LeadershipPerspective,
  type LeadershipRules,
  type LeadershipStoredAnswer,
} from "./performanceLeadership.js";
import type { PerformanceScope } from "./performanceAccess.js";
import { cloneDb, newId, type AssignmentRecord, type CycleRecord, type LeadershipResultRecord, type ModelRecord, type ParticipantRecord, type PerformanceDatabase } from "./performanceState.js";
import { audit, eligibleParticipants, fail, hrOnly, HR_SCOPE, iso, liveParticipants, questionsOf, type ServiceOptions, type ServiceResult } from "./performanceService.js";

// ---------------------------------------------------------------- modelo de liderança

export function createLeadershipModel(
  source: PerformanceDatabase,
  input: { name: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ modelId: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 3) return fail("INVALID_NAME", "Informe um nome para o modelo de liderança.");
  const db = cloneDb(source);
  const modelId = newId();
  db.models.push({
    id: modelId,
    lineageId: modelId,
    name,
    description: "Avaliação 180° de liderança: as mesmas oito competências na autoavaliação, na equipe e no superior.",
    instructions: PROPOSED_MODEL_INSTRUCTIONS,
    status: "DRAFT",
    version: 1,
    governance: "EM_VALIDACAO",
    kind: "LEADERSHIP",
    rules: { ...proposedRules(), leadership: { ...PROPOSED_LEADERSHIP_RULES } },
    publishedAt: null,
    archivedAt: null,
    createdByUserId: input.actorUserId,
    createdAt: iso(options.now()),
  });
  PROPOSED_LEADERSHIP_QUESTIONS.forEach((q, index) => {
    db.questions.push({
      id: newId(),
      modelId,
      code: q.code,
      pillar: "LEADERSHIP",
      competency: q.competency,
      sortOrder: index + 1,
      selfText: q.selfText,
      leaderText: q.superiorText,
      upwardText: q.upwardText,
      hint: null,
      description: q.behavior,
      positiveExample: null,
      negativeExample: null,
      roleExamples: [],
    });
  });
  audit(db, options.now(), input.actorUserId, "LEADERSHIP_MODEL_CREATED", modelId, { questions: PROPOSED_LEADERSHIP_QUESTIONS.length });
  return { ok: true, db, value: { modelId } };
}

/** Edita os textos de uma competência no rascunho. Código, escala e quantidade não mudam. */
export function updateLeadershipQuestion(
  source: PerformanceDatabase,
  input: { modelId: string; code: string; competency: string; behavior: string; selfText: string; upwardText: string; superiorText: string; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ code: string }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const model = db.models.find((m) => m.id === input.modelId);
  if (!model || model.kind !== "LEADERSHIP") return fail("NOT_FOUND", "Modelo de liderança não encontrado.");
  if (model.status !== "DRAFT") return fail("MODEL_LOCKED", "Versão publicada não muda. Crie uma nova versão.");
  const question = db.questions.find((q) => q.modelId === model.id && q.code === input.code);
  if (!question) return fail("NOT_FOUND", "Competência não encontrada.");
  const text = (v: string, max = 300) => v.replace(/\s+/g, " ").trim().slice(0, max);
  const values = { competency: text(input.competency, 60), behavior: text(input.behavior), selfText: text(input.selfText), upwardText: text(input.upwardText), superiorText: text(input.superiorText) };
  if (values.competency.length < 3) return fail("INVALID_TEXT", "Informe a competência.");
  if ([values.behavior, values.selfText, values.upwardText, values.superiorText].some((v) => v.length < 10)) {
    return fail("INVALID_TEXT", "Escreva o comportamento e as três frases (mínimo de 10 caracteres cada).");
  }
  question.competency = values.competency;
  question.description = values.behavior;
  question.selfText = values.selfText;
  question.upwardText = values.upwardText;
  question.leaderText = values.superiorText;
  audit(db, options.now(), input.actorUserId, "LEADERSHIP_QUESTION_UPDATED", model.id, { code: question.code });
  return { ok: true, db, value: { code: question.code } };
}

export function leadershipModelProblems(db: PerformanceDatabase, model: ModelRecord): string[] {
  const questions = questionsOf(db, model.id);
  const problems: string[] = [];
  const codes = questions.map((q) => q.code).sort();
  if (codes.join() !== [...LEADERSHIP_CODES].sort().join()) problems.push("O modelo de liderança precisa exatamente das oito competências LD-01 a LD-08.");
  if (questions.some((q) => !q.upwardText || q.selfText.trim().length < 10 || q.leaderText.trim().length < 10 || q.upwardText.trim().length < 10)) {
    problems.push("Cada competência precisa das três frases: líder, liderado e superior.");
  }
  if (questions.some((q) => (q.description ?? "").trim().length < 10)) problems.push("Cada competência precisa do comportamento observável.");
  return problems;
}

export function leadershipRulesOf(db: PerformanceDatabase, modelId: string | null): LeadershipRules {
  const model = modelId ? db.models.find((m) => m.id === modelId) : null;
  return parseLeadershipRules((model?.rules as { leadership?: unknown } | undefined)?.leadership);
}

/** Liga ou desliga o 180° no ciclo, antes da abertura. */
export function setCycleLeadershipModel(
  source: PerformanceDatabase,
  input: { cycleId: string; leadershipModelId: string | null; actorUserId: string | null; scope?: PerformanceScope },
  options: ServiceOptions
): ServiceResult<{ leadershipModelId: string | null }> {
  const denied = hrOnly(input.scope ?? HR_SCOPE);
  if (denied) return denied;
  const db = cloneDb(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  if (cycle.status !== "DRAFT" && cycle.status !== "PREPARED") return fail("CYCLE_FROZEN", "A avaliação de liderança é definida antes da abertura.");
  if (input.leadershipModelId) {
    const model = db.models.find((m) => m.id === input.leadershipModelId);
    if (!model || model.kind !== "LEADERSHIP" || model.status !== "PUBLISHED") return fail("MODEL_REQUIRED", "Escolha um modelo de liderança publicado.");
  }
  const from = cycle.leadershipModelId;
  cycle.leadershipModelId = input.leadershipModelId;
  audit(db, options.now(), input.actorUserId, "CYCLE_LEADERSHIP_SET", cycle.id, { from, to: input.leadershipModelId });
  return { ok: true, db, value: { leadershipModelId: cycle.leadershipModelId } };
}

// ---------------------------------------------------------------- retrato e tarefas

/** employeeId → liderados diretos ativos (hierarquia efetiva), calculado pelo servidor na abertura. */
export type LeadershipSnapshot = Record<string, { directReportIds: readonly string[] }>;

/** Grava em cada participante se ele é líder no ciclo. Não depende de cargo. */
export function applyLeadershipSnapshot(db: PerformanceDatabase, cycle: CycleRecord, snapshot: LeadershipSnapshot, now: Date) {
  for (const participant of liveParticipants(db, cycle.id)) {
    const reports = (snapshot[participant.employeeId]?.directReportIds ?? []).filter((id) => id !== participant.employeeId);
    participant.isLeader = reports.length > 0;
    participant.directReportCount = reports.length;
    participant.leadershipSnapshotAt = iso(now);
  }
}

function blankLeadershipAssignment(
  db: PerformanceDatabase,
  owner: ParticipantRecord,
  kind: LeadershipAssignmentKind,
  employeeId: string,
  evaluatorEmployeeId: string,
  subjectParticipantId: string | null,
  modelId: string,
  now: Date
): AssignmentRecord {
  const assignment: AssignmentRecord = {
    id: newId(),
    participantId: owner.id,
    cycleId: owner.cycleId,
    employeeId,
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
    subjectParticipantId,
    modelId,
  };
  db.assignments.push(assignment);
  for (const q of questionsOf(db, modelId)) {
    db.answers.push({ id: newId(), assignmentId: assignment.id, questionCode: q.code, pillar: "LEADERSHIP", kind: "pending", score: null, evidence: null });
  }
  return assignment;
}

function activeKind(db: PerformanceDatabase, participantId: string, kind: LeadershipAssignmentKind) {
  return db.assignments.find((a) => a.participantId === participantId && a.kind === kind && a.active) ?? null;
}

/** Cria as tarefas de liderança (idempotente). Chamado na abertura, depois do retrato. */
export function ensureLeadershipAssignments(db: PerformanceDatabase, cycle: CycleRecord, now: Date): { upward: number; self: number; superior: number } {
  const counts = { upward: 0, self: 0, superior: 0 };
  const modelId = cycle.leadershipModelId;
  if (!modelId) return counts;
  const eligible = eligibleParticipants(db, cycle.id);
  const byEmployee = new Map(eligible.map((p) => [p.employeeId, p]));
  for (const p of eligible) {
    const superior = p.managerId && p.managerId !== p.employeeId ? byEmployee.get(p.managerId) : undefined;
    if (superior && superior.isLeader && !activeKind(db, p.id, "LEADERSHIP_UPWARD")) {
      blankLeadershipAssignment(db, p, "LEADERSHIP_UPWARD", superior.employeeId, p.employeeId, superior.id, modelId, now);
      counts.upward += 1;
    }
    if (!p.isLeader) continue;
    if (!activeKind(db, p.id, "LEADERSHIP_SELF")) {
      blankLeadershipAssignment(db, p, "LEADERSHIP_SELF", p.employeeId, p.employeeId, null, modelId, now);
      counts.self += 1;
    }
    if (p.managerId && p.managerId !== p.employeeId && !activeKind(db, p.id, "LEADERSHIP_SUPERIOR")) {
      blankLeadershipAssignment(db, p, "LEADERSHIP_SUPERIOR", p.employeeId, p.managerId, null, modelId, now);
      counts.superior += 1;
    }
  }
  return counts;
}

/** Tarefas de liderança ainda abertas ligadas à pessoa (como respondente ou como líder avaliado pelo superior). */
export function pendingLeadershipTasks(db: PerformanceDatabase, participantId: string): number {
  return db.assignments.filter((a) => a.active && isLeadershipKind(a.kind) && a.participantId === participantId && a.status !== "SUBMITTED").length;
}

// ---------------------------------------------------------------- jornada do portal

export type JourneyStepKind = "SELF" | "LEADERSHIP_UPWARD" | "LEADERSHIP_SELF";
const JOURNEY_ORDER: readonly JourneyStepKind[] = ["SELF", "LEADERSHIP_UPWARD", "LEADERSHIP_SELF"];

/** Etapas do portal desta pessoa, em ordem. Cada uma é uma tarefa própria, com estado próprio. */
export function journeyOf(db: PerformanceDatabase, participantId: string): AssignmentRecord[] {
  return JOURNEY_ORDER.map((kind) => db.assignments.find((a) => a.participantId === participantId && a.kind === kind && a.active)).filter((a): a is AssignmentRecord => Boolean(a));
}

export function currentJourneyStep(db: PerformanceDatabase, participantId: string): AssignmentRecord | null {
  return journeyOf(db, participantId).find((a) => a.status !== "SUBMITTED") ?? null;
}

export function journeyDone(db: PerformanceDatabase, participantId: string): boolean {
  return currentJourneyStep(db, participantId) === null;
}

export const STEP_TEXT: Record<JourneyStepKind, { title: string; intro: string }> = {
  SELF: { title: "Sua autoavaliação", intro: "Responda pensando no período de referência do ciclo." },
  LEADERSHIP_UPWARD: {
    title: "Avaliação do meu líder",
    intro: "Sua autoavaliação foi enviada com sucesso. Agora queremos conhecer sua percepção sobre a liderança do seu gestor.",
  },
  LEADERSHIP_SELF: { title: "Sua liderança", intro: "Agora avalie a sua atuação como líder da sua equipe, nas mesmas competências." },
};

export function perspectiveOf(kind: LeadershipAssignmentKind): LeadershipPerspective {
  return kind === "LEADERSHIP_SELF" ? "SELF" : kind === "LEADERSHIP_UPWARD" ? "UPWARD" : "SUPERIOR";
}

/** Perguntas de uma tarefa de liderança no texto da perspectiva. */
export function leadershipQuestionsFor(db: PerformanceDatabase, assignment: AssignmentRecord) {
  const perspective = perspectiveOf(assignment.kind as LeadershipAssignmentKind);
  return questionsOf(db, assignment.modelId ?? "").map((q) => ({
    code: q.code,
    competency: q.competency,
    behavior: q.description ?? "",
    text: questionText({ selfText: q.selfText, upwardText: q.upwardText ?? q.selfText, superiorText: q.leaderText }, perspective),
  }));
}

// ---------------------------------------------------------------- respostas

/** Valida e grava uma resposta de liderança. O comentário fica na coluna `evidence`. */
export function applyLeadershipAnswer(
  row: { kind: string; score: number | null; evidence: string | null },
  answer: AnswerInput,
  rules: LeadershipRules
): { code: string; message: string } | null {
  const comment = answer.kind === "pending" ? null : (answer.evidence ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || null;
  const problem = leadershipAnswerProblem(answer.kind === "score" ? { kind: "score", score: answer.score, comment } : answer.kind === "notObserved" ? { kind: "notObserved", comment } : { kind: "pending" }, rules);
  if (problem) return { code: "COMMENT_REQUIRED", message: problem };
  if (answer.kind === "pending") {
    row.kind = "pending";
    row.score = null;
    row.evidence = null;
  } else if (answer.kind === "notObserved") {
    row.kind = "notObserved";
    row.score = null;
    row.evidence = comment;
  } else {
    row.kind = "score";
    row.score = answer.score;
    row.evidence = comment;
  }
  return null;
}

/** Envio de liderança exige comentário válido em toda nota 1 ou 4 (checagem final no servidor). */
export function leadershipSubmitProblem(db: PerformanceDatabase, assignment: AssignmentRecord): string | null {
  const rules = leadershipRulesOf(db, assignment.modelId);
  for (const a of db.answers.filter((x) => x.assignmentId === assignment.id)) {
    if (a.kind === "score" && (a.score === 1 || a.score === 4) && commentProblem(a.evidence, rules.commentMinLetters)) {
      return "Há nota 1 ou 4 sem comentário que descreva o comportamento observado.";
    }
  }
  return null;
}

function storedOf(db: PerformanceDatabase, assignmentId: string): LeadershipStoredAnswer[] {
  // Só nota e tipo: o comentário nunca sai desta função.
  return db.answers.filter((a) => a.assignmentId === assignmentId).map((a) => ({ questionCode: a.questionCode, kind: a.kind, score: a.score }));
}

// ---------------------------------------------------------------- avaliação pelo superior

/** Formulário de liderança do superior (nunca abre UPWARD nem a autoavaliação do líder). */
export function readSuperiorLeadershipForm(db: PerformanceDatabase, assignmentId: string, actorEmployeeId: string | null, scope: PerformanceScope) {
  const assignment = db.assignments.find((a) => a.id === assignmentId && a.active && a.kind === "LEADERSHIP_SUPERIOR");
  if (!assignment) return { ok: false as const, code: "NOT_FOUND", message: "Tarefa não encontrada." };
  const allowed = scope.kind === "ALL" ? actorEmployeeId === assignment.evaluatorEmployeeId || actorEmployeeId === null : actorEmployeeId === assignment.evaluatorEmployeeId;
  if (!allowed || actorEmployeeId === assignment.employeeId) return { ok: false as const, code: "FORBIDDEN", message: "Você não avalia esta liderança." };
  const participant = db.participants.find((p) => p.id === assignment.participantId)!;
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  const rules = leadershipRulesOf(db, assignment.modelId);
  return {
    ok: true as const,
    assignment: { id: assignment.id, kind: assignment.kind, status: assignment.status, version: assignment.version, submittedAt: assignment.submittedAt },
    participant: { id: participant.id, employeeName: participant.employeeName, roleName: participant.roleName, departmentName: participant.departmentName, directReportCount: participant.directReportCount },
    cycle: { id: cycle.id, name: cycle.name, periodLabel: cycle.periodLabel, status: cycle.status, dueAt: cycle.leaderDueAt },
    rules,
    questions: leadershipQuestionsFor(db, assignment),
    answers: db.answers.filter((a) => a.assignmentId === assignment.id).map((a) => ({ questionCode: a.questionCode, kind: a.kind, score: a.score, comment: a.evidence })),
  };
}

// ---------------------------------------------------------------- consolidação e calibração

export type LeadershipStatus = "NOT_APPLICABLE" | "PENDING" | "AVAILABLE" | "CALIBRATED" | "EXCEPTION" | "HOMOLOGATED";

export const LEADERSHIP_STATUS_LABELS: Record<LeadershipStatus, string> = {
  NOT_APPLICABLE: "Não é líder no ciclo",
  PENDING: "Pendente",
  AVAILABLE: "Disponível para calibração",
  CALIBRATED: "Calibrada",
  EXCEPTION: "Exceção justificada",
  HOMOLOGATED: "Homologada",
};

function collectionClosed(cycle: CycleRecord): boolean {
  return cycle.status === "CONSOLIDATION" || cycle.status === "CALIBRATION" || cycle.status === "HOMOLOGATED" || cycle.status === "CLOSED";
}

export function activeLeadershipResult(db: PerformanceDatabase, participantId: string): LeadershipResultRecord | null {
  return db.leadershipResults.find((r) => r.participantId === participantId && r.active) ?? null;
}

export function leadershipStatusOf(db: PerformanceDatabase, participant: ParticipantRecord): LeadershipStatus {
  const cycle = db.cycles.find((c) => c.id === participant.cycleId);
  if (!cycle?.leadershipModelId || !participant.isLeader || participant.eligibility !== "ELIGIBLE" || participant.removedAt) return "NOT_APPLICABLE";
  const result = activeLeadershipResult(db, participant.id);
  if (result) return result.official ? "HOMOLOGATED" : result.status;
  if (!collectionClosed(cycle)) return "PENDING";
  const superior = activeKind(db, participant.id, "LEADERSHIP_SUPERIOR");
  return superior?.status === "SUBMITTED" ? "AVAILABLE" : "PENDING";
}

function canCalibrateLeader(scope: PerformanceScope, actorEmployeeId: string | null, participant: ParticipantRecord): boolean {
  if (actorEmployeeId && actorEmployeeId === participant.employeeId) return false;
  if (scope.kind === "ALL") return true;
  return Boolean(actorEmployeeId && participant.managerId === actorEmployeeId);
}

/** As três perspectivas lado a lado. A equipe só aparece agregada, com coleta encerrada e amostra mínima. */
export function leadershipComparison(db: PerformanceDatabase, participantId: string, scope: PerformanceScope, actorEmployeeId: string | null) {
  const participant = db.participants.find((p) => p.id === participantId && !p.removedAt);
  if (!participant) return { ok: false as const, code: "NOT_FOUND", message: "Participante não encontrado." };
  if (!canCalibrateLeader(scope, actorEmployeeId, participant)) return { ok: false as const, code: "FORBIDDEN", message: "Só o superior do líder ou o RH calibram esta liderança." };
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  if (!cycle.leadershipModelId || !participant.isLeader) return { ok: false as const, code: "NOT_A_LEADER", message: "A pessoa não é líder neste ciclo." };
  const rules = leadershipRulesOf(db, cycle.leadershipModelId);
  const questions = leadershipQuestionsFor(db, { modelId: cycle.leadershipModelId, kind: "LEADERSHIP_SUPERIOR" } as AssignmentRecord);
  const selfTask = activeKind(db, participant.id, "LEADERSHIP_SELF");
  const superiorTask = activeKind(db, participant.id, "LEADERSHIP_SUPERIOR");
  const self = personalPerspective(selfTask?.status === "SUBMITTED" ? storedOf(db, selfTask.id) : null);
  const superior = personalPerspective(superiorTask?.status === "SUBMITTED" ? storedOf(db, superiorTask.id) : null);
  const upward = db.assignments.filter((a) => a.active && a.kind === "LEADERSHIP_UPWARD" && a.subjectParticipantId === participant.id);
  const submitted = upward.filter((a) => a.status === "SUBMITTED");
  // Coleta aberta: nada da equipe (nem a contagem de enviados muda a cada resposta na tela).
  const team = collectionClosed(cycle)
    ? teamPerspective(submitted.map((a) => storedOf(db, a.id)), rules)
    : { ...teamPerspective([], rules), message: "A percepção da equipe aparece depois que a coleta é encerrada." };
  const rows = compareCompetencies({ questions, self, superior, team, rules });
  const result = activeLeadershipResult(db, participant.id);
  return {
    ok: true as const,
    participant: { id: participant.id, employeeName: participant.employeeName, roleName: participant.roleName, departmentName: participant.departmentName, directReportCount: participant.directReportCount, managerName: participant.managerName },
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
    status: leadershipStatusOf(db, participant),
    rules,
    coverage: {
      teamInvited: upward.length,
      teamRespondents: collectionClosed(cycle) ? submitted.length : null,
      teamDisclosed: team.disclosed,
      selfSubmitted: self.submitted,
      superiorSubmitted: superior.submitted,
    },
    self: { index: self.index, coverage: self.coverage },
    superior: { index: superior.index, coverage: superior.coverage },
    team: { index: team.index, coverage: team.coverage, disclosed: team.disclosed, message: team.message },
    rows: rows.map((r) => ({ ...r, dispersion: team.competencies.find((c) => c.code === r.code)?.dispersion ?? null })),
    result: result
      ? {
          id: result.id,
          version: result.version,
          status: result.status,
          scores: result.scores,
          justifications: result.justifications,
          generalNote: result.generalNote,
          exceptionReason: result.exceptionReason,
          official: result.official,
          calibratedAt: result.calibratedAt,
          index: calibratedIndex(result.scores),
          ...strengthsAndPriorities(result.scores, questions),
        }
      : null,
  };
}

export function calibrateLeadership(
  source: PerformanceDatabase,
  input: {
    participantId: string;
    scores: Record<string, unknown>;
    justifications: Record<string, unknown>;
    generalNote: string;
    exceptionReason?: string | null;
    actorUserId: string | null;
    actorEmployeeId: string | null;
    scope: PerformanceScope;
  },
  options: ServiceOptions
): ServiceResult<{ status: string; version: number }> {
  const view = leadershipComparison(source, input.participantId, input.scope, input.actorEmployeeId);
  if (view.ok === false) return fail(view.code, view.message);
  const db = cloneDb(source);
  const participant = db.participants.find((p) => p.id === input.participantId)!;
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  if (cycle.status !== "CONSOLIDATION" && cycle.status !== "CALIBRATION") return fail("CYCLE_STAGE", "A calibração de liderança acontece na consolidação ou na calibração do ciclo.");
  if (participant.eligibility !== "ELIGIBLE") return fail("NOT_ELIGIBLE", "A pessoa não é elegível neste ciclo.");
  const current = activeLeadershipResult(db, participant.id);
  if (current?.official) return fail("RESULT_LOCKED", "Calibração homologada só muda por revisão formal do ciclo.");
  const exceptionReason = (input.exceptionReason ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || null;
  const missing: string[] = [];
  if (!view.coverage.superiorSubmitted) missing.push("avaliação do superior");
  if (!view.coverage.selfSubmitted) missing.push("autoavaliação de liderança");
  if (missing.length > 0) {
    if (!exceptionReason || commentProblem(exceptionReason, LEADERSHIP_JUSTIFICATION_MIN)) {
      return fail("LEADERSHIP_SOURCES_REQUIRED", `Falta ${missing.join(" e ")}. Conclua a fonte ou registre a exceção com motivo.`);
    }
  }
  const scores: Record<string, number> = {};
  for (const code of LEADERSHIP_CODES) {
    const value = input.scores[code];
    if (!isFrequencyScore(value)) return fail("INVALID_SCORE", `Defina a nota calibrada (1 a 4) de ${code}.`);
    scores[code] = value;
  }
  const justifications: Record<string, string> = {};
  for (const row of view.rows) {
    const text = typeof input.justifications[row.code] === "string" ? (input.justifications[row.code] as string).replace(/\s+/g, " ").trim().slice(0, 600) : "";
    const reasons = justificationReasons(row, scores[row.code]!);
    if (reasons.length > 0 && commentProblem(text, LEADERSHIP_JUSTIFICATION_MIN)) {
      return fail("JUSTIFICATION_REQUIRED", `${row.code} (${row.competency}) precisa de justificativa: ${reasons.join(", ").toLowerCase()}.`);
    }
    if (text) justifications[row.code] = text;
  }
  const generalNote = input.generalNote.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (commentProblem(generalNote, LEADERSHIP_JUSTIFICATION_MIN)) return fail("NOTE_REQUIRED", "Registre a fundamentação geral da calibração.");
  const model = db.models.find((m) => m.id === cycle.leadershipModelId)!;
  if (current) current.active = false;
  const next: LeadershipResultRecord = {
    id: newId(),
    participantId: participant.id,
    cycleId: cycle.id,
    version: (current?.version ?? 0) + 1,
    active: true,
    status: missing.length > 0 ? "EXCEPTION" : "CALIBRATED",
    scores,
    justifications,
    generalNote,
    exceptionReason: missing.length > 0 ? exceptionReason : null,
    sources: { self: view.coverage.selfSubmitted, superior: view.coverage.superiorSubmitted, team: view.coverage.teamDisclosed },
    teamRespondents: view.coverage.teamRespondents ?? 0,
    teamDisclosed: view.coverage.teamDisclosed,
    official: false,
    modelId: model.id,
    modelVersion: model.version,
    calibratedByUserId: input.actorUserId,
    calibratedAt: iso(options.now()),
    supersedesId: current?.id ?? null,
    createdAt: iso(options.now()),
  };
  db.leadershipResults.push(next);
  audit(db, options.now(), input.actorUserId, next.status === "EXCEPTION" ? "LEADERSHIP_CALIBRATED_EXCEPTION" : "LEADERSHIP_CALIBRATED", participant.id, {
    from: current?.id ?? null,
    to: next.id,
    version: next.version,
    teamDisclosed: next.teamDisclosed,
    missing: missing.join(", ") || null,
  });
  return { ok: true, db, value: { status: next.status, version: next.version } };
}

/** Lista para a calibração de liderança: só o que o ator pode calibrar, sem nada individual da equipe. */
export function leadershipCalibrationList(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope, actorEmployeeId: string | null) {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  return liveParticipants(db, cycleId)
    .filter((p) => p.isLeader && p.eligibility === "ELIGIBLE" && canCalibrateLeader(scope, actorEmployeeId, p))
    .map((p) => {
      const upward = db.assignments.filter((a) => a.active && a.kind === "LEADERSHIP_UPWARD" && a.subjectParticipantId === p.id);
      const result = activeLeadershipResult(db, p.id);
      return {
        participantId: p.id,
        employeeName: p.employeeName,
        roleName: p.roleName,
        departmentName: p.departmentName,
        managerName: p.managerName,
        directReportCount: p.directReportCount,
        status: leadershipStatusOf(db, p),
        teamInvited: upward.length,
        selfStatus: activeKind(db, p.id, "LEADERSHIP_SELF")?.status ?? null,
        superiorStatus: activeKind(db, p.id, "LEADERSHIP_SUPERIOR")?.status ?? null,
        calibratedIndex: result ? calibratedIndex(result.scores) : null,
      };
    });
}

/** Homologação: todo líder elegível precisa de calibração (ou exceção registrada). */
export function leadershipHomologationProblem(db: PerformanceDatabase, cycle: CycleRecord): string | null {
  if (!cycle.leadershipModelId) return null;
  const missing = eligibleParticipants(db, cycle.id).filter((p) => p.isLeader && !activeLeadershipResult(db, p.id));
  return missing.length ? `Falta calibrar a liderança de ${missing.slice(0, 5).map((p) => p.employeeName).join(", ")}${missing.length > 5 ? ` e mais ${missing.length - 5}` : ""}.` : null;
}

export function markLeadershipOfficial(db: PerformanceDatabase, cycle: CycleRecord, official: boolean): number {
  let changed = 0;
  for (const p of eligibleParticipants(db, cycle.id)) {
    const result = activeLeadershipResult(db, p.id);
    if (result && result.official !== official) {
      result.official = official;
      changed += 1;
    }
  }
  return changed;
}

/** Fila do superior: avaliações de liderança e calibrações que cabem a ele. */
export function superiorLeadershipQueue(db: PerformanceDatabase, actorEmployeeId: string | null) {
  if (!actorEmployeeId) return [];
  return db.assignments
    .filter((a) => a.active && a.kind === "LEADERSHIP_SUPERIOR" && a.evaluatorEmployeeId === actorEmployeeId && a.employeeId !== actorEmployeeId)
    .map((a) => {
      const participant = db.participants.find((p) => p.id === a.participantId);
      const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
      if (!participant || participant.removedAt || !cycle || cycle.activation !== "ACTIVE") return null;
      return {
        assignmentId: a.id,
        participantId: participant.id,
        employeeName: participant.employeeName,
        roleName: participant.roleName,
        departmentName: participant.departmentName,
        directReportCount: participant.directReportCount,
        cycleId: cycle.id,
        cycleName: cycle.name,
        cycleStatus: cycle.status,
        status: a.status,
        dueAt: cycle.leaderDueAt,
        leadershipStatus: leadershipStatusOf(db, participant),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}
