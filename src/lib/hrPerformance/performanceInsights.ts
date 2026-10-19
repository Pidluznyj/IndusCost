/**
 * Leituras do módulo: mesa do ciclo, painel, calibração, Nine-Box, histórico, PDI e
 * dados dos relatórios. Nada aqui grava. Toda lista passa pelo escopo do usuário.
 *
 * Definições do painel (RFC-013/032):
 * - População = participantes ativos (não removidos) e ELEGÍVEIS do ciclo, dentro do
 *   escopo e dos filtros. Não elegível e evidência insuficiente aparecem só nas contagens
 *   próprias e nunca como nota baixa.
 * - Cada taxa informa numerador e denominador. Convidado não é respondido.
 */
import {
  CULTURE_BAND_LABELS,
  LOW_SAMPLE_THRESHOLD,
  PILLARS,
  UNCLASSIFIED_QUADRANT,
  aggregatePillar,
  findDivergences,
  formatPillarMean,
  neutralizeSpreadsheetCell,
  type CultureBand,
  type NineBoxBand,
  type Pillar,
  type StoredAnswer,
} from "./performanceDomain.js";
import { canSeeEmployee, type PerformanceScope } from "./performanceAccess.js";
import { cycleGovernance, isHistoryCycle } from "./performanceLifecycle.js";
import { journeyOf, leadershipComparison, leadershipStatusOf } from "./performanceLeadershipService.js";
import {
  activeAssignment,
  activeResult,
  canLeadParticipant,
  eligibleParticipants,
  liveParticipants,
  modelOfCycle,
  modelProblems,
  questionsOf,
  rulesOfCycle,
  toStored,
  type ReportKind,
} from "./performanceService.js";
import type { ParticipantRecord, PerformanceDatabase, ResultRecord } from "./performanceState.js";

export type PeopleFilters = { department?: string | null; role?: string | null; manager?: string | null };

function matchesFilters(participant: ParticipantRecord, filters: PeopleFilters | undefined): boolean {
  if (!filters) return true;
  if (filters.department && participant.departmentName !== filters.department) return false;
  if (filters.role && participant.roleName !== filters.role) return false;
  if (filters.manager && (participant.managerName ?? "") !== filters.manager) return false;
  return true;
}

function visible(scope: PerformanceScope, participant: ParticipantRecord): boolean {
  return canSeeEmployee(scope, participant.employeeId);
}

function inviteState(db: PerformanceDatabase, assignmentId: string | null, now: Date) {
  if (!assignmentId) return { status: "NONE" as const, expiresAt: null, issuedAt: null, attempts: 0, revokedReason: null };
  const invite = db.invites
    .filter((i) => i.assignmentId === assignmentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  if (!invite) return { status: "NONE" as const, expiresAt: null, issuedAt: null, attempts: 0, revokedReason: null };
  const status = invite.revokedAt
    ? ("REVOKED" as const)
    : invite.locked
      ? ("LOCKED" as const)
      : new Date(invite.expiresAt).getTime() <= now.getTime()
        ? ("EXPIRED" as const)
        : ("ACTIVE" as const);
  return { status, expiresAt: invite.expiresAt, issuedAt: invite.createdAt, attempts: invite.failedAttempts, revokedReason: invite.revokedReason };
}

function resultSummary(result: ResultRecord | null) {
  if (!result) return null;
  return {
    id: result.id,
    version: result.version,
    quadrant: result.quadrant,
    nineX: result.nineX,
    nineY: result.nineY,
    official: result.official,
    reviewStatus: result.reviewStatus,
    technicalValidation: result.technicalValidation,
    validationNote: result.validationNote,
    cultureBand: result.cultureBand,
    cultureBasis: result.cultureBasis,
    technicalSum: result.technicalSum,
    technicalCount: result.technicalCount,
    potentialSum: result.potentialSum,
    potentialCount: result.potentialCount,
    cultureSum: result.cultureSum,
    cultureCount: result.cultureCount,
    nineBoxReason: result.nineBoxReason,
    adjusted: result.adjusted,
    calibrationNote: result.calibrationNote,
    calibratedAt: result.calibratedAt,
    ruleSetId: result.ruleSnapshot?.ruleSetId ?? null,
  };
}

export function describeCycle(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope, now: Date = new Date()) {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  const model = modelOfCycle(db, cycle);
  const rules = rulesOfCycle(db, cycle);
  const people = db.participants
    .filter((p) => p.cycleId === cycleId && visible(scope, p))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"))
    .map((participant) => {
      const self = activeAssignment(db, participant.id, "SELF");
      const leader = activeAssignment(db, participant.id, "LEADER");
      const result = activeResult(db, participant.id);
      const feedback = db.feedbacks.find((f) => f.participantId === participant.id) ?? null;
      const pdis = db.pdis.filter((p) => p.participantId === participant.id);
      const divergences =
        self?.status === "SUBMITTED" && leader?.status === "SUBMITTED"
          ? findDivergences(toStored(db, self.id), toStored(db, leader.id), rules.divergenceThreshold)
          : [];
      const leaderVersions = db.assignments.filter((a) => a.participantId === participant.id && a.kind === "LEADER").length;
      const journey = journeyOf(db, participant.id);
      return {
        participant,
        leadership: {
          isLeader: participant.isLeader,
          directReportCount: participant.directReportCount,
          status: leadershipStatusOf(db, participant),
          // Andamento operacional das etapas do portal: só o RH acompanha (sem conteúdo).
          journey: scope.kind === "ALL" ? journey.map((a) => ({ kind: a.kind, status: a.status })) : null,
        },
        self: self ? { id: self.id, status: self.status, version: self.version, assisted: Boolean(self.assistedByUserId), submittedAt: self.submittedAt } : null,
        leader: leader
          ? {
              id: leader.id,
              status: leader.status,
              version: leader.version,
              revision: leader.revision,
              evaluatorEmployeeId: leader.evaluatorEmployeeId,
              returnReason: leader.returnReason,
              submittedAt: leader.submittedAt,
            }
          : null,
        leaderVersions,
        result: resultSummary(result),
        feedback: feedback
          ? {
              id: feedback.id,
              strength: feedback.strength,
              improvement: feedback.improvement,
              action: feedback.action,
              ownerName: feedback.ownerName,
              dueAt: feedback.dueAt,
              conversationAt: feedback.conversationAt,
              viewedAt: feedback.viewedAt,
              acknowledgedAt: feedback.acknowledgedAt,
              acknowledgedVia: feedback.acknowledgedVia,
              agreedAt: feedback.agreedAt,
              contestation: feedback.contestation,
              collaboratorNote: feedback.collaboratorNote,
              createdAt: feedback.createdAt,
            }
          : null,
        pdis: pdis.map((p) => ({
          id: p.id,
          title: p.title,
          objective: p.objective,
          competencyCode: p.competencyCode,
          status: p.status,
          dueAt: p.dueAt,
          priority: p.priority,
          justification: p.justification,
          ownerName: p.ownerName,
          checkins: db.checkins.filter((c) => c.pdiId === p.id).length,
        })),
        invite: inviteState(db, self?.id ?? null, now),
        divergences,
      };
    });
  return {
    cycle,
    governance: cycleGovernance(db, cycle),
    model: model
      ? {
          id: model.id,
          name: model.name,
          version: model.version,
          status: model.status,
          instructions: model.instructions,
          rules,
        }
      : null,
    /** Competências de liderança (PDI de liderança). Vazio sem 180° no ciclo. */
    leadershipQuestions: cycle.leadershipModelId ? questionsOf(db, cycle.leadershipModelId).map((q) => ({ code: q.code, pillar: "LEADERSHIP", competency: q.competency })) : [],
    questions: questionsOf(db, cycle.modelId).map((q) => ({
      code: q.code,
      pillar: q.pillar,
      competency: q.competency,
      selfText: q.selfText,
      leaderText: q.leaderText,
      hint: q.hint,
      description: q.description,
      positiveExample: q.positiveExample,
      negativeExample: q.negativeExample,
      roleExamples: q.roleExamples ?? [],
    })),
    people,
    counts: dashboardCounts(db, cycleId, scope, undefined, now),
  };
}

function rate(numerator: number, denominator: number) {
  return { numerator, denominator, ratio: denominator > 0 ? numerator / denominator : null };
}

export function dashboardCounts(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope = { kind: "ALL" }, filters?: PeopleFilters, now: Date = new Date()) {
  const live = liveParticipants(db, cycleId).filter((p) => visible(scope, p) && matchesFilters(p, filters));
  const eligible = live.filter((p) => p.eligibility === "ELIGIBLE");
  // Antes da abertura ainda não há tarefa: conta o líder atribuído ao participante.
  const withLeader = eligible.filter((p) => activeAssignment(db, p.id, "LEADER") || (!p.frozen && p.managerId));
  const today = now.toISOString().slice(0, 10);
  let invited = 0;
  let selfStarted = 0;
  let selfSubmitted = 0;
  let leaderStarted = 0;
  let leaderSubmitted = 0;
  let calibrated = 0;
  let official = 0;
  let feedback = 0;
  let acknowledged = 0;
  let pdiOpen = 0;
  let pdiLate = 0;
  let pdiDone = 0;
  for (const participant of eligible) {
    const self = activeAssignment(db, participant.id, "SELF");
    const leader = activeAssignment(db, participant.id, "LEADER");
    if (self && db.invites.some((i) => i.assignmentId === self.id)) invited += 1;
    if (self && self.status !== "NOT_STARTED") selfStarted += 1;
    if (self?.status === "SUBMITTED") selfSubmitted += 1;
    if (leader && leader.status !== "NOT_STARTED") leaderStarted += 1;
    if (leader?.status === "SUBMITTED") leaderSubmitted += 1;
    const result = activeResult(db, participant.id);
    if (result?.reviewStatus === "CALIBRATED") calibrated += 1;
    if (result?.official) official += 1;
    const fb = db.feedbacks.find((f) => f.participantId === participant.id);
    if (fb) feedback += 1;
    if (fb?.acknowledgedAt) acknowledged += 1;
    for (const pdi of db.pdis.filter((p) => p.participantId === participant.id)) {
      if (pdi.status === "DONE") pdiDone += 1;
      else if (pdi.status !== "CANCELLED") {
        pdiOpen += 1;
        if (pdi.dueAt && pdi.dueAt < today) pdiLate += 1;
      }
    }
  }
  return {
    eligible: eligible.length,
    notEligible: live.filter((p) => p.eligibility === "NOT_ELIGIBLE").length,
    insufficient: live.filter((p) => p.eligibility === "INSUFFICIENT_EVIDENCE").length,
    removed: db.participants.filter((p) => p.cycleId === cycleId && p.removedAt && visible(scope, p) && matchesFilters(p, filters)).length,
    withLeader: withLeader.length,
    withoutLeader: eligible.length - withLeader.length,
    invited,
    selfStarted,
    selfSubmitted,
    leaderStarted,
    leaderSubmitted,
    calibrated,
    official,
    feedback,
    acknowledged,
    pdiOpen,
    pdiLate,
    pdiDone,
    selfPending: eligible.length - selfSubmitted,
    leaderPending: withLeader.length - leaderSubmitted,
    rates: {
      invited: rate(invited, eligible.length),
      selfSubmitted: rate(selfSubmitted, eligible.length),
      leaderSubmitted: rate(leaderSubmitted, withLeader.length),
      calibrated: rate(calibrated, eligible.length),
      official: rate(official, eligible.length),
      feedback: rate(feedback, official),
      acknowledged: rate(acknowledged, feedback),
    },
  };
}

export type NineBoxCell = {
  participantId: string;
  employeeId: string;
  name: string;
  quadrant: string;
  nineX: NineBoxBand | null;
  nineY: NineBoxBand | null;
  official: boolean;
  reviewStatus: string | null;
  adjusted: boolean;
  cultureBand: CultureBand | null;
  technicalValidation: string | null;
  departmentName: string;
  roleName: string;
  managerName: string | null;
  managerId: string | null;
  technical: string | null;
  potential: string | null;
  culture: string | null;
};

/**
 * Liderança (180°) no painel: contagens e média das notas CALIBRADAS por competência. Nada da
 * avaliação da equipe aparece aqui (nem média, nem andamento por líder). Com menos de
 * LOW_SAMPLE_THRESHOLD líderes calibrados, a média por competência não é mostrada.
 */
function leadershipSummary(db: PerformanceDatabase, cycleId: string, visibleEligible: readonly { id: string; isLeader: boolean }[]) {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle?.leadershipModelId) return null;
  const leaders = visibleEligible.filter((p) => p.isLeader);
  const results = leaders.map((p) => db.leadershipResults.find((r) => r.participantId === p.id && r.active)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const upward = db.assignments.filter((a) => a.active && a.kind === "LEADERSHIP_UPWARD" && a.cycleId === cycleId);
  const codes = questionsOf(db, cycle.leadershipModelId).map((q) => ({ code: q.code, competency: q.competency }));
  const enough = results.length >= LOW_SAMPLE_THRESHOLD;
  return {
    leaders: leaders.length,
    calibrated: results.length,
    homologated: results.filter((r) => r.official).length,
    exceptions: results.filter((r) => r.status === "EXCEPTION").length,
    upwardInvited: upward.length,
    upwardSubmitted: upward.filter((a) => a.status === "SUBMITTED").length,
    byCompetency: enough
      ? codes.map(({ code, competency }) => ({ code, competency, mean: results.reduce((s, r) => s + (r.scores[code] ?? 0), 0) / results.length }))
      : null,
    lowSample: !enough,
  };
}

export function dashboard(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope, filters: PeopleFilters | undefined, now: Date) {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  const counts = dashboardCounts(db, cycleId, scope, filters, now);
  const allEligible = eligibleParticipants(db, cycleId).filter((p) => visible(scope, p));
  const eligible = allEligible.filter((p) => matchesFilters(p, filters));
  const cells: NineBoxCell[] = eligible.map((p) => {
    const result = activeResult(db, p.id);
    return {
      participantId: p.id,
      employeeId: p.employeeId,
      name: p.employeeName,
      quadrant: result?.quadrant ?? UNCLASSIFIED_QUADRANT,
      nineX: result?.nineX ?? null,
      nineY: result?.nineY ?? null,
      official: Boolean(result?.official),
      reviewStatus: result?.reviewStatus ?? null,
      adjusted: Boolean(result?.adjusted),
      cultureBand: result?.cultureBand ?? null,
      technicalValidation: result?.technicalValidation ?? null,
      departmentName: p.departmentName,
      roleName: p.roleName,
      managerName: p.managerName,
      managerId: p.managerId,
      technical: result ? formatPillarMean(result.technicalSum, result.technicalCount) : null,
      potential: result ? formatPillarMean(result.potentialSum, result.potentialCount) : null,
      culture: result ? formatPillarMean(result.cultureSum, result.cultureCount) : null,
    };
  });
  const culture: Record<string, number> = { CONSISTENT: 0, DEVELOPING: 0, NEEDS_REVIEW: 0, INSUFFICIENT: 0, NONE: 0 };
  for (const cell of cells) culture[cell.cultureBand ?? "NONE"] = (culture[cell.cultureBand ?? "NONE"] ?? 0) + 1;
  const pdiByStatus: Record<string, number> = {};
  for (const p of db.pdis.filter((pdi) => eligible.some((e) => e.id === pdi.participantId))) pdiByStatus[p.status] = (pdiByStatus[p.status] ?? 0) + 1;
  return {
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status, periodLabel: cycle.periodLabel, classification: cycle.classification, activation: cycle.activation },
    governance: cycleGovernance(db, cycle),
    counts,
    cells,
    culture,
    cultureLabels: CULTURE_BAND_LABELS,
    pdiByStatus,
    leadership: leadershipSummary(db, cycle.id, allEligible.filter((p) => matchesFilters(p, filters))),
    lowSample: cells.length > 0 && cells.length < LOW_SAMPLE_THRESHOLD,
    lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
    filters: {
      departments: [...new Set(allEligible.map((p) => p.departmentName))].sort(),
      roles: [...new Set(allEligible.map((p) => p.roleName))].sort(),
      managers: [...new Set(allEligible.map((p) => p.managerName).filter((m): m is string => Boolean(m)))].sort(),
    },
  };
}

/** Evolução entre ciclos. Padrão: só ciclos ativos e oficiais (teste e inativo ficam fora). */
export function cycleEvolution(db: PerformanceDatabase, scope: PerformanceScope, now: Date, includeNonOfficial = false) {
  return [...db.cycles]
    .filter((cycle) => includeNonOfficial || isHistoryCycle(cycle))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((cycle) => {
      const counts = dashboardCounts(db, cycle.id, scope, undefined, now);
      const model = modelOfCycle(db, cycle);
      const governance = cycleGovernance(db, cycle);
      return {
        cycleId: cycle.id,
        classification: cycle.classification,
        activation: cycle.activation,
        publication: governance.publication,
        officialEligible: governance.officialEligible,
        name: cycle.name,
        periodLabel: cycle.periodLabel,
        status: cycle.status,
        modelVersion: model?.version ?? null,
        ruleSetId: model?.rules.ruleSetId ?? null,
        eligible: counts.eligible,
        selfSubmitted: counts.selfSubmitted,
        leaderSubmitted: counts.leaderSubmitted,
        calibrated: counts.calibrated,
        official: counts.official,
        feedback: counts.feedback,
        pdiDone: counts.pdiDone,
        pdiOpen: counts.pdiOpen,
      };
    });
}

function pillarMeans(answers: readonly StoredAnswer[], minValid: number) {
  const out = {} as Record<Pillar, { display: string | null; count: number; notObserved: number; insufficient: boolean }>;
  for (const pillar of PILLARS) {
    const math = aggregatePillar(answers, pillar, minValid);
    out[pillar] = { display: math.display, count: math.count, notObserved: math.notObserved, insufficient: math.insufficient };
  }
  return out;
}

/** Fila de calibração do RH: perspectivas lado a lado, divergências e evidências do líder. */
export function calibrationQueue(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope, filters?: PeopleFilters) {
  if (scope.kind !== "ALL") return null;
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  const rules = rulesOfCycle(db, cycle);
  const questions = questionsOf(db, cycle.modelId);
  const byCode = new Map(questions.map((q) => [q.code, q]));
  return {
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
    rules,
    rows: eligibleParticipants(db, cycleId)
      .filter((p) => matchesFilters(p, filters))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"))
      .map((participant) => {
        const self = activeAssignment(db, participant.id, "SELF");
        const leader = activeAssignment(db, participant.id, "LEADER");
        const selfAnswers = self?.status === "SUBMITTED" ? toStored(db, self.id) : [];
        const leaderAnswers = leader?.status === "SUBMITTED" ? toStored(db, leader.id) : [];
        const result = activeResult(db, participant.id);
        return {
          participantId: participant.id,
          employeeName: participant.employeeName,
          roleName: participant.roleName,
          departmentName: participant.departmentName,
          managerName: participant.managerName,
          selfStatus: self?.status ?? null,
          leaderStatus: leader?.status ?? null,
          leaderAssignmentId: leader?.id ?? null,
          leaderRevision: leader?.revision ?? null,
          self: pillarMeans(selfAnswers, rules.minValidAnswers),
          leader: pillarMeans(leaderAnswers, rules.minValidAnswers),
          divergences: findDivergences(selfAnswers, leaderAnswers, rules.divergenceThreshold).map((d) => ({
            ...d,
            competency: byCode.get(d.questionCode)?.competency ?? d.questionCode,
            text: byCode.get(d.questionCode)?.leaderText ?? "",
          })),
          evidences: leaderAnswers
            .filter((a) => a.evidence)
            .map((a) => ({ questionCode: a.questionCode, competency: byCode.get(a.questionCode)?.competency ?? a.questionCode, score: a.score, notObserved: a.kind === "notObserved", evidence: a.evidence })),
          result: resultSummary(result),
          versions: db.results.filter((r) => r.participantId === participant.id).length,
        };
      }),
  };
}

export function resultHistory(db: PerformanceDatabase, participantId: string, scope: PerformanceScope) {
  const participant = db.participants.find((p) => p.id === participantId);
  if (!participant || scope.kind !== "ALL") return null;
  return {
    participant: { id: participant.id, employeeName: participant.employeeName },
    versions: db.results
      .filter((r) => r.participantId === participantId)
      .sort((a, b) => a.version - b.version)
      .map((r) => ({ ...resultSummary(r)!, createdAt: r.createdAt, supersedesId: r.supersedesId, calibratedByUserId: r.calibratedByUserId })),
    events: db.audits
      .filter((a) => a.entityId === participantId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((a) => ({ at: a.at, action: a.action, actorUserId: a.actorUserId, detail: a.detail })),
  };
}

/** Linha do tempo da pessoa. Só resultado homologado. Sinaliza troca de metodologia. */
/**
 * Histórico da pessoa. Padrão: só ciclos ativos e oficiais (piloto aparece com `officialEligible`
 * falso e o motivo). `includeNonOfficial` (auditoria do RH) traz também teste e inativo, rotulados.
 */
export function employeeHistory(db: PerformanceDatabase, employeeId: string, scope: PerformanceScope, includeInternal: boolean, includeNonOfficial = false) {
  if (!canSeeEmployee(scope, employeeId)) return { ok: false as const, code: "FORBIDDEN", message: "Acesso negado." };
  const participants = db.participants
    .filter((p) => p.employeeId === employeeId && !p.removedAt)
    .map((p) => ({ participant: p, cycle: db.cycles.find((c) => c.id === p.cycleId)! }))
    .filter((item) => item.cycle && (includeNonOfficial || isHistoryCycle(item.cycle)))
    .sort((a, b) => a.cycle.createdAt.localeCompare(b.cycle.createdAt));
  let previousKey: string | null = null;
  return {
    ok: true as const,
    cycles: participants.map(({ participant, cycle }) => {
      const model = modelOfCycle(db, cycle);
      const result = db.results.find((r) => r.participantId === participant.id && r.active && r.official);
      const feedback = db.feedbacks.find((f) => f.participantId === participant.id);
      const rules = result?.ruleSnapshot ?? model?.rules ?? null;
      const key = model && rules ? `${model.lineageId}|${rules.ruleSetId}|${rules.nineBoxLowCut}|${rules.nineBoxHighCut}` : null;
      const comparable = previousKey === null ? null : key !== null && key === previousKey;
      if (result) previousKey = key;
      return {
        cycleId: cycle.id,
        participantId: participant.id,
        cycleName: cycle.name,
        periodLabel: cycle.periodLabel,
        cycleStatus: cycle.status,
        classification: cycle.classification,
        activation: cycle.activation,
        officialEligible: cycleGovernance(db, cycle).officialEligible,
        notOfficialReasons: cycleGovernance(db, cycle).reasons,
        modelName: model?.name ?? "",
        modelVersion: model?.version ?? null,
        ruleSetId: rules?.ruleSetId ?? null,
        comparableWithPrevious: result ? comparable : null,
        roleName: participant.roleName,
        departmentName: participant.departmentName,
        managerName: participant.managerName,
        eligibility: participant.eligibility,
        quadrant: result?.quadrant ?? null,
        cultureBand: result?.cultureBand ?? null,
        technical: result ? formatPillarMean(result.technicalSum, result.technicalCount) : null,
        potential: result ? formatPillarMean(result.potentialSum, result.potentialCount) : null,
        culture: result ? formatPillarMean(result.cultureSum, result.cultureCount) : null,
        feedback: feedback
          ? {
              strength: feedback.strength,
              improvement: feedback.improvement,
              action: feedback.action,
              acknowledgedAt: feedback.acknowledgedAt,
              agreedAt: feedback.agreedAt,
              contestation: feedback.contestation,
              internalNotes: includeInternal ? feedback.internalNotes : null,
            }
          : null,
        pdis: db.pdis.filter((p) => p.participantId === participant.id).map((p) => ({ title: p.title, status: p.status, dueAt: p.dueAt })),
      };
    }),
  };
}

export type PdiFilters = { status?: string | null; due?: "late" | "next30" | "all" | null; cycleId?: string | null };

export function pdiTracking(db: PerformanceDatabase, scope: PerformanceScope, filters: PdiFilters, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  return db.pdis
    .map((pdi) => {
      const participant = db.participants.find((p) => p.id === pdi.participantId);
      const cycle = participant ? db.cycles.find((c) => c.id === participant.cycleId) : null;
      if (!participant || !cycle || !canLeadParticipant(db, scope, participant)) return null;
      // Ciclo inativo sai do acompanhamento padrão; só aparece filtrando o próprio ciclo (auditoria).
      if (cycle.activation !== "ACTIVE" && filters.cycleId !== cycle.id) return null;
      const open = pdi.status !== "DONE" && pdi.status !== "CANCELLED";
      const late = open && Boolean(pdi.dueAt && pdi.dueAt < today);
      const checkins = db.checkins.filter((c) => c.pdiId === pdi.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        id: pdi.id,
        title: pdi.title,
        objective: pdi.objective,
        competencyCode: pdi.competencyCode,
        status: pdi.status,
        priority: pdi.priority,
        justification: pdi.justification,
        ownerName: pdi.ownerName,
        dueAt: pdi.dueAt,
        late,
        open,
        evidence: pdi.evidence,
        completedAt: pdi.completedAt,
        employeeName: participant.employeeName,
        departmentName: participant.departmentName,
        cycleId: cycle.id,
        cycleName: cycle.name,
        checkins: checkins.map((c) => ({ id: c.id, note: c.note, obstacle: c.obstacle, nextStep: c.nextStep, createdAt: c.createdAt })),
        lastCheckinAt: checkins.at(-1)?.createdAt ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => !filters.cycleId || row.cycleId === filters.cycleId)
    .filter((row) => !filters.status || row.status === filters.status)
    .filter((row) => {
      if (!filters.due || filters.due === "all") return true;
      if (filters.due === "late") return row.late;
      return row.open && Boolean(row.dueAt && row.dueAt >= today && row.dueAt <= in30);
    })
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

export function reportRows(db: PerformanceDatabase, cycleId: string, scope: PerformanceScope) {
  return liveParticipants(db, cycleId)
    .filter((p) => canSeeEmployee(scope, p.employeeId))
    .map((participant) => {
      const result = activeResult(db, participant.id);
      return {
        name: neutralizeSpreadsheetCell(participant.employeeName),
        role: neutralizeSpreadsheetCell(participant.roleName),
        department: neutralizeSpreadsheetCell(participant.departmentName),
        eligibility: participant.eligibility,
        quadrant: participant.eligibility !== "ELIGIBLE" ? "não se aplica" : result?.official ? neutralizeSpreadsheetCell(result.quadrant) : "preliminar",
        culture: result?.official ? result.cultureBand : "",
      };
    });
}

/** Dados do documento impresso. Nunca inclui ocorrência de conduta. */
export function reportData(
  db: PerformanceDatabase,
  input: { cycleId: string; kind: ReportKind; participantId: string | null },
  scope: PerformanceScope,
  now: Date
) {
  const workspace = describeCycle(db, input.cycleId, scope, now);
  if (!workspace) return null;
  const cycle = workspace.cycle;
  const questions = workspace.questions;
  const person = input.participantId ? workspace.people.find((item) => item.participant.id === input.participantId) ?? null : null;
  const rules = workspace.model?.rules ?? null;
  const detail = person
    ? (() => {
        const self = activeAssignment(db, person.participant.id, "SELF");
        const leader = activeAssignment(db, person.participant.id, "LEADER");
        const minValid = rules?.minValidAnswers ?? 3;
        const selfAnswers = self?.status === "SUBMITTED" ? toStored(db, self.id) : [];
        const leaderAnswers = leader?.status === "SUBMITTED" ? toStored(db, leader.id) : [];
        return {
          self: pillarMeans(selfAnswers, minValid),
          leader: pillarMeans(leaderAnswers, minValid),
          leaderAnswers: questions.map((q) => {
            const answer = leaderAnswers.find((a) => a.questionCode === q.code);
            return { code: q.code, pillar: q.pillar, competency: q.competency, score: answer?.score ?? null, notObserved: answer?.kind === "notObserved", evidence: answer?.evidence ?? null };
          }),
          checkins: db.checkins
            .filter((c) => person.pdis.some((p) => p.id === c.pdiId))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((c) => ({ pdiId: c.pdiId, note: c.note, obstacle: c.obstacle, nextStep: c.nextStep, createdAt: c.createdAt })),
          history: employeeHistory(db, person.participant.employeeId, scope, false),
        };
      })()
    : null;
  // Documento de liderança: só o comparativo agregado (a equipe vem como média divulgável).
  const leadershipView =
    input.kind === "lideranca" && person ? leadershipComparison(db, person.participant.id, scope, scope.kind === "ALL" ? null : scope.actorEmployeeId) : null;
  return {
    kind: input.kind,
    cycle: { id: cycle.id, name: cycle.name, periodLabel: cycle.periodLabel, status: cycle.status, selfDueAt: cycle.selfDueAt, leaderDueAt: cycle.leaderDueAt, classification: cycle.classification },
    governance: workspace.governance,
    model: workspace.model,
    leadership: leadershipView && leadershipView.ok ? leadershipView : null,
    questions,
    counts: workspace.counts,
    people: workspace.people
      .filter((item) => !item.participant.removedAt && item.participant.eligibility === "ELIGIBLE")
      .map((item) => ({
        participantId: item.participant.id,
        employeeName: item.participant.employeeName,
        roleName: item.participant.roleName,
        departmentName: item.participant.departmentName,
        managerName: item.participant.managerName,
        result: item.result,
        feedback: Boolean(item.feedback),
        pdis: item.pdis.length,
      })),
    person: person
      ? {
          participant: person.participant,
          result: person.result,
          feedback: person.feedback,
          pdis: person.pdis,
          divergences: person.divergences,
          ...detail,
        }
      : null,
  };
}

export function modelDetail(db: PerformanceDatabase, modelId: string) {
  const model = db.models.find((item) => item.id === modelId);
  if (!model) return null;
  const lineage = db.models
    .filter((m) => m.lineageId === model.lineageId)
    .sort((a, b) => a.version - b.version)
    .map((m) => ({ id: m.id, version: m.version, status: m.status, publishedAt: m.publishedAt, archivedAt: m.archivedAt, ruleSetId: m.rules.ruleSetId }));
  return {
    model,
    questions: questionsOf(db, model.id),
    problems: model.status === "DRAFT" ? modelProblems(db, model) : [],
    lineage,
    usedBy: db.cycles.filter((c) => c.modelId === model.id).map((c) => ({ id: c.id, name: c.name, status: c.status })),
  };
}
