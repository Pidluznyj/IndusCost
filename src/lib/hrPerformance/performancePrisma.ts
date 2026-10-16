/**
 * Persistência Prisma do ciclo de desempenho.
 * Só é chamada com a feature ligada, depois da migration aditiva.
 * Não altera tabelas de experiência, competência, custo ou Nomus.
 */
import type { PrismaClient } from "@prisma/client";
import type { PerformanceStore } from "./performanceRoutes.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";

const GRAPH_LOCK_ID = "graph";

export class GraphConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  constructor() {
    super("VERSION_CONFLICT");
  }
}

/** A segunda gravação com a mesma revisão perde. Não apaga o que a primeira já commitou. */
export function nextGraphRevision(stored: number, incoming: number): number | null {
  if (stored !== incoming) return null;
  return stored + 1;
}

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use">;

export function createPrismaPerformanceStore(db: PrismaClient): PerformanceStore {
  return {
    read: () => loadPerformanceDatabase(db),
    write: (state) => savePerformanceDatabase(db, state),
  };
}

export async function loadPerformanceDatabase(db: PrismaClient): Promise<PerformanceDatabase> {
  const [models, questions, cycles, participants, assignments, answers, invites, sessions, results, feedbacks, pdis, checkins, conducts, audits, reminders] =
    await Promise.all([
      db.hrPerformanceModel.findMany(),
      db.hrPerformanceQuestion.findMany(),
      db.hrPerformanceCycle.findMany(),
      db.hrPerformanceParticipant.findMany(),
      db.hrPerformanceAssignment.findMany(),
      db.hrPerformanceAnswer.findMany(),
      db.hrPerformanceInvite.findMany(),
      db.hrPerformanceSession.findMany(),
      db.hrPerformanceResult.findMany(),
      db.hrPerformanceFeedback.findMany(),
      db.hrPerformancePdi.findMany(),
      db.hrPerformancePdiCheckin.findMany(),
      db.hrPerformanceConductCase.findMany(),
      db.hrPerformanceAuditEvent.findMany(),
      db.hrPerformanceReminder.findMany(),
    ]);
  return {
    models: models.map((row) => ({
      id: row.id,
      lineageId: row.lineageId,
      name: row.name,
      status: row.status as PerformanceDatabase["models"][number]["status"],
      version: row.version,
      governance: "EM_VALIDACAO",
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdByUserId: row.createdByUserId,
    })),
    questions: questions.map((row) => ({
      id: row.id,
      modelId: row.modelId,
      code: row.code,
      pillar: row.pillar as PerformanceDatabase["questions"][number]["pillar"],
      sortOrder: row.sortOrder,
      selfText: row.selfText,
      leaderText: row.leaderText,
      hint: row.hint,
    })),
    cycles: cycles.map((row) => ({
      id: row.id,
      name: row.name,
      periodLabel: row.periodLabel,
      status: row.status as PerformanceDatabase["cycles"][number]["status"],
      modelId: row.modelId,
      selfDueAt: row.selfDueAt,
      leaderDueAt: row.leaderDueAt,
      ownerUserId: row.ownerUserId,
      minObservationDays: row.minObservationDays,
      openedAt: row.openedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
    })),
    participants: participants.map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      eligibility: row.eligibility as PerformanceDatabase["participants"][number]["eligibility"],
      eligibilityReason: row.eligibilityReason,
      roleId: row.roleId,
      roleName: row.roleName,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      managerId: row.managerId,
      managerName: row.managerName,
      admissionDate: row.admissionDate?.toISOString() ?? null,
      registration: row.registration,
      frozen: row.frozen,
    })),
    assignments: assignments.map((row) => ({
      id: row.id,
      participantId: row.participantId,
      cycleId: row.cycleId,
      employeeId: row.employeeId,
      kind: row.kind as PerformanceDatabase["assignments"][number]["kind"],
      evaluatorEmployeeId: row.evaluatorEmployeeId,
      status: row.status as PerformanceDatabase["assignments"][number]["status"],
      version: row.version,
      revision: row.revision,
      supersedesId: row.supersedesId,
      active: row.active,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      assistedByUserId: row.assistedByUserId,
    })),
    answers: answers.map((row) => ({
      id: row.id,
      assignmentId: row.assignmentId,
      questionCode: row.questionCode,
      pillar: row.pillar as PerformanceDatabase["answers"][number]["pillar"],
      kind: row.kind as PerformanceDatabase["answers"][number]["kind"],
      score: row.score as PerformanceDatabase["answers"][number]["score"],
      evidence: row.evidence,
    })),
    invites: invites.map((row) => ({
      id: row.id,
      assignmentId: row.assignmentId,
      linkDigest: row.linkDigest,
      otpDigest: row.otpDigest,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      failedAttempts: row.failedAttempts,
      locked: row.locked,
    })),
    sessions: sessions.map((row) => ({
      id: row.id,
      inviteId: row.inviteId,
      assignmentId: row.assignmentId,
      phase: row.phase as PerformanceDatabase["sessions"][number]["phase"],
      sessionDigest: row.sessionDigest,
      expiresAt: row.expiresAt.toISOString(),
      assistantUserId: row.assistantUserId,
      revoked: row.revoked,
    })),
    results: results.map((row) => ({
      id: row.id,
      participantId: row.participantId,
      version: row.version,
      active: row.active,
      technicalSum: row.technicalSum,
      technicalCount: row.technicalCount,
      cultureSum: row.cultureSum,
      cultureCount: row.cultureCount,
      potentialSum: row.potentialSum,
      potentialCount: row.potentialCount,
      technicalValidation: row.technicalValidation as PerformanceDatabase["results"][number]["technicalValidation"],
      validationNote: row.validationNote,
      cultureBand: row.cultureBand as PerformanceDatabase["results"][number]["cultureBand"],
      cultureBasis: row.cultureBasis,
      quadrant: row.quadrant,
      nineBoxReason: row.nineBoxReason,
      nineX: row.nineX,
      nineY: row.nineY,
      official: row.official,
      reviewStatus: row.reviewStatus as PerformanceDatabase["results"][number]["reviewStatus"],
      algorithmId: row.algorithmId,
      nineBoxRuleId: row.nineBoxRuleId,
      cultureRuleId: row.cultureRuleId,
      supersedesId: row.supersedesId,
    })),
    feedbacks: feedbacks.map((row) => ({
      id: row.id,
      participantId: row.participantId,
      resultId: row.resultId,
      strength: row.strength,
      improvement: row.improvement,
      action: row.action,
      ownerName: row.ownerName,
      dueAt: row.dueAt,
      conversationAt: row.conversationAt,
      leaderEmployeeId: row.leaderEmployeeId,
      viewedAt: row.viewedAt?.toISOString() ?? null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      agreedAt: row.agreedAt?.toISOString() ?? null,
      contestation: row.contestation,
      internalNotes: row.internalNotes,
    })),
    pdis: pdis.map((row) => ({
      id: row.id,
      participantId: row.participantId,
      feedbackId: row.feedbackId,
      title: row.title,
      priority: row.priority,
      justification: row.justification,
      ownerName: row.ownerName,
      dueAt: row.dueAt,
      status: row.status as PerformanceDatabase["pdis"][number]["status"],
    })),
    checkins: checkins.map((row) => ({
      id: row.id,
      pdiId: row.pdiId,
      note: row.note,
      obstacle: row.obstacle,
      nextStep: row.nextStep,
      authorUserId: row.authorUserId,
      createdAt: row.createdAt.toISOString(),
    })),
    conducts: conducts.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      status: row.status as PerformanceDatabase["conducts"][number]["status"],
      summary: row.summary,
      proven: row.proven,
    })),
    audits: audits.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      actorUserId: row.actorUserId,
      action: row.action,
      entityId: row.entityId,
      detail: (row.detail ?? {}) as PerformanceDatabase["audits"][number]["detail"],
    })),
    reminders: reminders.map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      employeeId: row.employeeId,
      audience: row.audience as PerformanceDatabase["reminders"][number]["audience"],
      status: "DRAFT" as const,
    })),
    graphRevision: (await db.hrPerformanceGraphLock.findUnique({ where: { id: GRAPH_LOCK_ID } }))?.revision ?? 0,
  };
}

async function replaceIds(tx: Tx, delegate: { deleteMany: (args: { where?: { id?: { notIn: string[] } } }) => Promise<unknown> }, ids: string[]) {
  if (ids.length === 0) {
    await delegate.deleteMany({});
    return;
  }
  await delegate.deleteMany({ where: { id: { notIn: ids } } });
}

export async function savePerformanceDatabase(db: PrismaClient, state: PerformanceDatabase): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.hrPerformanceGraphLock.upsert({
      where: { id: GRAPH_LOCK_ID },
      create: { id: GRAPH_LOCK_ID, revision: 0 },
      update: {},
    });
    const locked = await tx.hrPerformanceGraphLock.updateMany({
      where: { id: GRAPH_LOCK_ID, revision: state.graphRevision },
      data: { revision: { increment: 1 } },
    });
    if (locked.count !== 1) throw new GraphConflictError();

    await replaceIds(tx, tx.hrPerformanceReminder, state.reminders.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceConductCase, state.conducts.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformancePdi, state.pdis.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceFeedback, state.feedbacks.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceResult, state.results.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceSession, state.sessions.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceInvite, state.invites.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceAnswer, state.answers.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceAssignment, state.assignments.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceParticipant, state.participants.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceCycle, state.cycles.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceQuestion, state.questions.map((row) => row.id));
    await replaceIds(tx, tx.hrPerformanceModel, state.models.map((row) => row.id));

    for (const row of state.models) {
      await tx.hrPerformanceModel.upsert({
        where: { id: row.id },
        create: { id: row.id, lineageId: row.lineageId, name: row.name, status: row.status, version: row.version, governance: row.governance, publishedAt: row.publishedAt ? new Date(row.publishedAt) : null, createdByUserId: row.createdByUserId },
        update: { name: row.name, status: row.status, version: row.version, governance: row.governance, publishedAt: row.publishedAt ? new Date(row.publishedAt) : null },
      });
    }
    for (const row of state.questions) {
      await tx.hrPerformanceQuestion.upsert({
        where: { id: row.id },
        create: row,
        update: { selfText: row.selfText, leaderText: row.leaderText, hint: row.hint, sortOrder: row.sortOrder },
      });
    }
    for (const row of state.cycles) {
      await tx.hrPerformanceCycle.upsert({
        where: { id: row.id },
        create: { ...row, openedAt: row.openedAt ? new Date(row.openedAt) : null, closedAt: row.closedAt ? new Date(row.closedAt) : null },
        update: { status: row.status, openedAt: row.openedAt ? new Date(row.openedAt) : null, closedAt: row.closedAt ? new Date(row.closedAt) : null, name: row.name },
      });
    }
    for (const row of state.participants) {
      await tx.hrPerformanceParticipant.upsert({
        where: { id: row.id },
        create: { ...row, admissionDate: row.admissionDate ? new Date(row.admissionDate) : null },
        update: { eligibility: row.eligibility, eligibilityReason: row.eligibilityReason, frozen: row.frozen, managerId: row.managerId, managerName: row.managerName },
      });
    }
    for (const row of state.assignments) {
      await tx.hrPerformanceAssignment.upsert({
        where: { id: row.id },
        create: { ...row, submittedAt: row.submittedAt ? new Date(row.submittedAt) : null },
        update: { status: row.status, version: row.version, revision: row.revision, active: row.active, submittedAt: row.submittedAt ? new Date(row.submittedAt) : null, assistedByUserId: row.assistedByUserId },
      });
    }
    for (const row of state.answers) {
      await tx.hrPerformanceAnswer.upsert({ where: { id: row.id }, create: row, update: { kind: row.kind, score: row.score, evidence: row.evidence } });
    }
    for (const row of state.invites) {
      await tx.hrPerformanceInvite.upsert({
        where: { id: row.id },
        create: { ...row, expiresAt: new Date(row.expiresAt), revokedAt: row.revokedAt ? new Date(row.revokedAt) : null },
        update: { revokedAt: row.revokedAt ? new Date(row.revokedAt) : null, failedAttempts: row.failedAttempts, locked: row.locked },
      });
    }
    for (const row of state.sessions) {
      await tx.hrPerformanceSession.upsert({
        where: { id: row.id },
        create: { ...row, expiresAt: new Date(row.expiresAt) },
        update: { revoked: row.revoked, phase: row.phase, expiresAt: new Date(row.expiresAt) },
      });
    }
    for (const row of state.results) {
      await tx.hrPerformanceResult.upsert({ where: { id: row.id }, create: row, update: { active: row.active, official: row.official, reviewStatus: row.reviewStatus, technicalValidation: row.technicalValidation, validationNote: row.validationNote, quadrant: row.quadrant, nineX: row.nineX, nineY: row.nineY, nineBoxReason: row.nineBoxReason, cultureBand: row.cultureBand, cultureBasis: row.cultureBasis } });
    }
    for (const row of state.feedbacks) {
      await tx.hrPerformanceFeedback.upsert({
        where: { id: row.id },
        create: { ...row, viewedAt: row.viewedAt ? new Date(row.viewedAt) : null, acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null, agreedAt: row.agreedAt ? new Date(row.agreedAt) : null },
        update: { viewedAt: row.viewedAt ? new Date(row.viewedAt) : null, acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null, agreedAt: row.agreedAt ? new Date(row.agreedAt) : null, contestation: row.contestation },
      });
    }
    for (const row of state.pdis) {
      await tx.hrPerformancePdi.upsert({ where: { id: row.id }, create: row, update: { status: row.status, title: row.title } });
    }
    for (const row of state.checkins) {
      await tx.hrPerformancePdiCheckin.upsert({ where: { id: row.id }, create: { ...row, createdAt: new Date(row.createdAt) }, update: { note: row.note } });
    }
    for (const row of state.conducts) {
      await tx.hrPerformanceConductCase.upsert({ where: { id: row.id }, create: row, update: { status: row.status, proven: row.proven } });
    }
    for (const row of state.audits) {
      await tx.hrPerformanceAuditEvent.upsert({ where: { id: row.id }, create: { ...row, at: new Date(row.at) }, update: { action: row.action } });
    }
    for (const row of state.reminders) {
      await tx.hrPerformanceReminder.upsert({ where: { id: row.id }, create: row, update: { status: row.status } });
    }
  });
}

void emptyPerformanceDatabase;
