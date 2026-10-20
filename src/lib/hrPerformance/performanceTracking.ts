/**
 * Central de acompanhamento do ciclo: SÓ metadados operacionais.
 *
 * Para cada participante, a situação de cada obrigação (autoavaliação, avaliação do líder, avaliação
 * do próprio líder, autoavaliação de liderança, avaliação de liderança pelo superior, calibrações,
 * homologação e devolutiva), quem responde, o prazo e o motivo da pendência. Nunca lê nota,
 * comentário, evidência, quadrante, faixa ou índice: a função não toca `answers` nem os campos de
 * pontuação dos resultados. Nenhum filtro é por nota, então filtrar não revela resultado.
 */
import { activeAssignment, activeResult, eligibleParticipants, liveParticipants } from "./performanceService.js";
import { activeKind, activeLeadershipResult, journeyOf } from "./performanceLeadershipService.js";
import type { AssignmentRecord, CycleRecord, ParticipantRecord, PerformanceDatabase } from "./performanceState.js";

export const OBLIGATION_STATUSES = ["NOT_APPLICABLE", "PENDING", "STARTED", "SUBMITTED", "OVERDUE", "DONE"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const OBLIGATION_KEYS = ["self", "leader", "upward", "leadershipSelf", "superior", "calibration", "leadershipCalibration", "homologation", "feedback"] as const;
export type ObligationKey = (typeof OBLIGATION_KEYS)[number];

/** Modalidade: agrupa as obrigações para o filtro. */
export const OBLIGATION_MODALITY: Record<ObligationKey, "INDIVIDUAL" | "LIDERANCA" | "CALIBRACAO" | "FECHAMENTO"> = {
  self: "INDIVIDUAL",
  leader: "INDIVIDUAL",
  upward: "LIDERANCA",
  leadershipSelf: "LIDERANCA",
  superior: "LIDERANCA",
  calibration: "CALIBRACAO",
  leadershipCalibration: "CALIBRACAO",
  homologation: "FECHAMENTO",
  feedback: "FECHAMENTO",
};
export type TrackingModality = (typeof OBLIGATION_MODALITY)[ObligationKey];

export const OBLIGATION_LABELS: Record<ObligationKey, string> = {
  self: "Autoavaliação individual",
  leader: "Avaliação individual pelo líder",
  upward: "Avaliação do próprio líder (ascendente)",
  leadershipSelf: "Autoavaliação de liderança",
  superior: "Avaliação de liderança pelo superior",
  calibration: "Calibração individual",
  leadershipCalibration: "Calibração de liderança",
  homologation: "Homologação",
  feedback: "Devolutiva",
};

export type Obligation = {
  key: ObligationKey;
  status: ObligationStatus;
  /** Quem precisa agir (nome) ou a área (RH). */
  responsible: string | null;
  dueAt: string | null;
  reason: string | null;
  at: string | null;
};

export type TrackingFilters = {
  department?: string | null;
  directorate?: string | null;
  manager?: string | null;
  modality?: TrackingModality | null;
  status?: ObligationStatus | null;
};

/** Diretoria por setor (id ou nome), vinda do organograma. */
export type OrgUnits = { byDepartmentId: ReadonlyMap<string, string>; byDepartmentName: ReadonlyMap<string, string> };

const ORDER = ["DRAFT", "PREPARED", "OPEN", "CONSOLIDATION", "CALIBRATION", "HOMOLOGATED", "CLOSED"];
const stage = (cycle: CycleRecord) => ORDER.indexOf(cycle.status);
const collectionClosed = (cycle: CycleRecord) => stage(cycle) >= ORDER.indexOf("CONSOLIDATION");
const dateBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function inviteReason(db: PerformanceDatabase, assignment: AssignmentRecord, today: string): string {
  const invites = db.invites.filter((i) => i.assignmentId === assignment.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = invites.at(-1);
  if (!last) return assignment.assistedByUserId ? "Preenchimento assistido iniciado" : "Convite não emitido";
  if (last.revokedAt) return `Convite revogado${last.revokedReason ? `: ${last.revokedReason}` : ""}`;
  if (last.locked) return "Convite bloqueado por tentativas de código";
  if (last.expiresAt.slice(0, 10) < today) return "Convite vencido";
  const accessed = db.sessions.some((s) => s.inviteId === last.id && s.phase === "VERIFIED");
  if (accessed) return "Convite acessado, sem envio";
  return inviteDelivered(db, last.id) ? "Convite entregue, ainda não acessado" : "Convite emitido, ainda não entregue";
}

/** Entrega registrada pelo RH (auditoria `INVITE_DELIVERED`). */
export function inviteDelivered(db: PerformanceDatabase, inviteId: string): boolean {
  return db.audits.some((a) => a.action === "INVITE_DELIVERED" && a.entityId === inviteId);
}

/** Situação do convite da autoavaliação, para a central agir (entregar, reemitir, revogar). */
export function inviteStateOf(db: PerformanceDatabase, assignmentId: string | null, today: string): { status: "NONE" | "ACTIVE" | "REVOKED" | "LOCKED" | "EXPIRED"; delivered: boolean; accessed: boolean } {
  if (!assignmentId) return { status: "NONE", delivered: false, accessed: false };
  const last = db.invites.filter((i) => i.assignmentId === assignmentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!last) return { status: "NONE", delivered: false, accessed: false };
  const status = last.revokedAt ? "REVOKED" : last.locked ? "LOCKED" : last.expiresAt.slice(0, 10) < today ? "EXPIRED" : "ACTIVE";
  return { status, delivered: inviteDelivered(db, last.id), accessed: db.sessions.some((s) => s.inviteId === last.id && s.phase === "VERIFIED") };
}

function taskObligation(
  db: PerformanceDatabase,
  cycle: CycleRecord,
  key: ObligationKey,
  task: AssignmentRecord | null,
  input: { responsible: string | null; dueAt: string | null; today: string; portal: boolean; missingReason?: string | null }
): Obligation {
  if (!task) {
    return input.missingReason
      ? { key, status: "PENDING", responsible: input.responsible, dueAt: input.dueAt, reason: input.missingReason, at: null }
      : { key, status: "NOT_APPLICABLE", responsible: null, dueAt: null, reason: null, at: null };
  }
  if (task.status === "SUBMITTED") return { key, status: "SUBMITTED", responsible: input.responsible, dueAt: input.dueAt, reason: null, at: task.submittedAt };
  let reason: string | null = task.status === "RETURNED" ? `Devolvida para revisão${task.returnReason ? `: ${task.returnReason}` : ""}` : task.status === "IN_PROGRESS" ? "Em preenchimento" : null;
  if (input.portal && task.status === "NOT_STARTED") reason = inviteReason(db, task, input.today);
  if (collectionClosed(cycle)) return { key, status: "OVERDUE", responsible: input.responsible, dueAt: input.dueAt, reason: "Coleta encerrada sem envio", at: null };
  if (input.dueAt && input.dueAt.slice(0, 10) < input.today) {
    return { key, status: "OVERDUE", responsible: input.responsible, dueAt: input.dueAt, reason: `Prazo vencido em ${dateBr(input.dueAt)}${reason ? ` · ${reason}` : ""}`, at: null };
  }
  return { key, status: task.status === "NOT_STARTED" ? "PENDING" : "STARTED", responsible: input.responsible, dueAt: input.dueAt, reason, at: null };
}

function nameOf(db: PerformanceDatabase, cycleId: string, employeeId: string | null): string | null {
  if (!employeeId) return null;
  return db.participants.find((p) => p.cycleId === cycleId && p.employeeId === employeeId)?.employeeName ?? null;
}

export function participantObligations(db: PerformanceDatabase, cycle: CycleRecord, participant: ParticipantRecord, today: string): Obligation[] {
  const eligible = participant.eligibility === "ELIGIBLE" && !participant.removedAt;
  const na = (key: ObligationKey): Obligation => ({ key, status: "NOT_APPLICABLE", responsible: null, dueAt: null, reason: eligible ? null : "Não elegível no ciclo", at: null });
  if (!eligible) return OBLIGATION_KEYS.map(na);
  const opened = stage(cycle) >= ORDER.indexOf("OPEN");
  const self = activeAssignment(db, participant.id, "SELF");
  const leader = activeAssignment(db, participant.id, "LEADER");
  const upward = activeKind(db, participant.id, "LEADERSHIP_UPWARD");
  const leadershipSelf = activeKind(db, participant.id, "LEADERSHIP_SELF");
  const superior = activeKind(db, participant.id, "LEADERSHIP_SUPERIOR");
  const leaderName = participant.managerName ?? nameOf(db, cycle.id, leader?.evaluatorEmployeeId ?? null);
  const own = participant.employeeName;

  const out: Obligation[] = [];
  out.push(
    opened
      ? taskObligation(db, cycle, "self", self, { responsible: own, dueAt: cycle.selfDueAt, today, portal: true })
      : { key: "self", status: "PENDING", responsible: own, dueAt: cycle.selfDueAt, reason: "Ciclo ainda não aberto", at: null }
  );
  out.push(
    opened
      ? taskObligation(db, cycle, "leader", leader, {
          responsible: leaderName,
          dueAt: cycle.leaderDueAt,
          today,
          portal: false,
          missingReason: participant.managerSource === "TOPO" ? null : "Sem líder definido",
        })
      : participant.managerId || participant.managerSource === "TOPO"
        ? { key: "leader", status: participant.managerSource === "TOPO" ? "NOT_APPLICABLE" : "PENDING", responsible: leaderName, dueAt: cycle.leaderDueAt, reason: participant.managerSource === "TOPO" ? "Topo da estrutura" : "Ciclo ainda não aberto", at: null }
        : { key: "leader", status: "PENDING", responsible: null, dueAt: cycle.leaderDueAt, reason: "Sem líder definido", at: null }
  );
  if (participant.managerSource === "TOPO" && out[1]!.status === "NOT_APPLICABLE") out[1] = { ...out[1]!, reason: "Topo da estrutura" };
  const upwardSubject = upward?.subjectParticipantId ? db.participants.find((p) => p.id === upward.subjectParticipantId)?.employeeName ?? null : null;
  const up = taskObligation(db, cycle, "upward", upward, { responsible: own, dueAt: cycle.selfDueAt, today, portal: false });
  out.push(up.status === "NOT_APPLICABLE" ? up : { ...up, reason: up.reason ?? (upwardSubject ? `Sobre ${upwardSubject}` : null) });
  out.push(taskObligation(db, cycle, "leadershipSelf", leadershipSelf, { responsible: own, dueAt: cycle.selfDueAt, today, portal: false }));
  out.push(
    taskObligation(db, cycle, "superior", superior, {
      responsible: nameOf(db, cycle.id, superior?.evaluatorEmployeeId ?? null) ?? participant.managerName,
      dueAt: cycle.leaderDueAt,
      today,
      portal: false,
    })
  );

  // Calibração individual: situação do resultado, sem nenhuma pontuação.
  const result = activeResult(db, participant.id);
  out.push(
    result?.reviewStatus === "CALIBRATED"
      ? { key: "calibration", status: "DONE", responsible: "RH (calibração)", dueAt: null, reason: null, at: result.calibratedAt }
      : {
          key: "calibration",
          status: "PENDING",
          responsible: "RH (calibração)",
          dueAt: null,
          reason: !collectionClosed(cycle)
            ? "Aguardando encerramento da coleta"
            : result?.technicalValidation === "PENDING_VALIDATION"
              ? "Aguardando validação técnica da função"
              : "Aguardando calibração",
          at: null,
        }
  );

  // Calibração de liderança: só quem é líder no ciclo com 180°.
  if (!cycle.leadershipModelId || !participant.isLeader) out.push(na("leadershipCalibration"));
  else {
    const lr = activeLeadershipResult(db, participant.id);
    const calibrator = participant.managerSource === "TOPO" ? "RH (topo da estrutura)" : participant.managerName;
    out.push(
      lr
        ? { key: "leadershipCalibration", status: "DONE", responsible: calibrator, dueAt: null, reason: lr.status === "EXCEPTION" ? "Exceção registrada" : null, at: lr.calibratedAt }
        : { key: "leadershipCalibration", status: "PENDING", responsible: calibrator, dueAt: null, reason: collectionClosed(cycle) ? "Aguardando calibração" : "Aguardando encerramento da coleta", at: null }
    );
  }

  out.push(
    result?.official
      ? { key: "homologation", status: "DONE", responsible: "RH (homologação)", dueAt: null, reason: null, at: null }
      : { key: "homologation", status: "PENDING", responsible: "RH (homologação)", dueAt: null, reason: "Ciclo não homologado", at: null }
  );

  const feedback = db.feedbacks.find((f) => f.participantId === participant.id) ?? null;
  out.push(
    !result?.official
      ? { key: "feedback", status: "NOT_APPLICABLE", responsible: leaderName, dueAt: null, reason: "Depois da homologação", at: null }
      : !feedback
        ? { key: "feedback", status: "PENDING", responsible: leaderName, dueAt: null, reason: "Devolutiva não registrada", at: null }
        : feedback.acknowledgedAt
          ? { key: "feedback", status: "DONE", responsible: leaderName, dueAt: feedback.dueAt, reason: null, at: feedback.acknowledgedAt }
          : { key: "feedback", status: "STARTED", responsible: own, dueAt: feedback.dueAt, reason: "Aguardando ciência do colaborador", at: feedback.createdAt }
  );
  return out;
}

function directorateOf(units: OrgUnits | null, p: ParticipantRecord): string {
  if (!units) return "Sem diretoria";
  return (p.departmentId ? units.byDepartmentId.get(p.departmentId) : undefined) ?? units.byDepartmentName.get(p.departmentName) ?? "Sem diretoria";
}

function coverage(rows: { group: string; eligible: boolean; done: boolean; leaderDone: boolean }[]) {
  const map = new Map<string, { group: string; eligible: number; completed: number; leaderCompleted: number }>();
  for (const r of rows) {
    if (!r.eligible) continue;
    const entry = map.get(r.group) ?? { group: r.group, eligible: 0, completed: 0, leaderCompleted: 0 };
    entry.eligible += 1;
    if (r.done) entry.completed += 1;
    if (r.leaderDone) entry.leaderCompleted += 1;
    map.set(r.group, entry);
  }
  return [...map.values()].sort((a, b) => a.group.localeCompare(b.group, "pt-BR"));
}

export function trackingBoard(db: PerformanceDatabase, cycleId: string, filters: TrackingFilters, now: Date, units: OrgUnits | null = null) {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  const today = now.toISOString().slice(0, 10);
  const all = liveParticipants(db, cycleId).sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"));
  const rows = all.map((participant) => {
    const obligations = participantObligations(db, cycle, participant, today);
    const journey = journeyOf(db, participant.id);
    return {
      participantId: participant.id,
      employeeId: participant.employeeId,
      employeeName: participant.employeeName,
      roleName: participant.roleName,
      departmentName: participant.departmentName,
      directorateName: directorateOf(units, participant),
      managerName: participant.managerName,
      managerSource: participant.managerSource,
      eligibility: participant.eligibility,
      isLeader: participant.isLeader,
      selfAssignmentId: activeAssignment(db, participant.id, "SELF")?.id ?? null,
      invite: inviteStateOf(db, activeAssignment(db, participant.id, "SELF")?.id ?? null, today),
      journeyStarted: journey.some((a) => a.status !== "NOT_STARTED"),
      journeyDone: journey.length > 0 && journey.every((a) => a.status === "SUBMITTED"),
      obligations,
    };
  });

  const matches = (row: (typeof rows)[number]) => {
    if (filters.department && row.departmentName !== filters.department) return false;
    if (filters.directorate && row.directorateName !== filters.directorate) return false;
    if (filters.manager && (row.managerName ?? "") !== filters.manager) return false;
    if (filters.modality || filters.status) {
      return row.obligations.some((o) => (!filters.modality || OBLIGATION_MODALITY[o.key] === filters.modality) && (!filters.status || o.status === filters.status));
    }
    return true;
  };
  const visible = rows.filter(matches);
  const eligibleRows = visible.filter((r) => r.eligibility === "ELIGIBLE");
  const eligibleIds = new Set(eligibleRows.map((r) => r.participantId));
  const selfTasks = eligibleRows.map((r) => r.selfAssignmentId).filter((id): id is string => Boolean(id));
  const invitedTasks = selfTasks.filter((id) => db.invites.some((i) => i.assignmentId === id));
  const accessedTasks = selfTasks.filter((id) => db.sessions.some((s) => s.assignmentId === id && s.inviteId && s.phase === "VERIFIED"));
  const count = (key: ObligationKey, statuses: ObligationStatus[]) => eligibleRows.filter((r) => statuses.includes(r.obligations.find((o) => o.key === key)!.status)).length;
  const overdue = eligibleRows.reduce((n, r) => n + r.obligations.filter((o) => o.status === "OVERDUE").length, 0);
  const leaders = eligibleRows.filter((r) => r.isLeader);

  return {
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status, periodLabel: cycle.periodLabel, selfDueAt: cycle.selfDueAt, leaderDueAt: cycle.leaderDueAt, classification: cycle.classification, activation: cycle.activation, leadership: Boolean(cycle.leadershipModelId) },
    indicators: {
      eligible: eligibleRows.length,
      invitesGenerated: invitedTasks.length,
      /** Entrega registrada pelo RH ("entreguei em mãos"); não é confirmação do aparelho. */
      invitesDelivered: eligibleRows.filter((r) => r.invite.delivered).length,
      invitesAccessed: accessedTasks.length,
      surveysStarted: eligibleRows.filter((r) => r.journeyStarted).length,
      surveysCompleted: eligibleRows.filter((r) => r.journeyDone).length,
      participantsPending: eligibleRows.filter((r) => !r.journeyDone).length,
      leaderEvaluationsPending: count("leader", ["PENDING", "STARTED", "OVERDUE"]) + count("superior", ["PENDING", "STARTED", "OVERDUE"]),
      calibrationsPending: count("calibration", ["PENDING"]) + leaders.filter((r) => r.obligations.find((o) => o.key === "leadershipCalibration")!.status === "PENDING").length,
      overdueObligations: overdue,
      homologated: count("homologation", ["DONE"]),
      feedbackDone: count("feedback", ["DONE"]),
    },
    coverage: {
      byDepartment: coverage(visible.map((r) => ({ group: r.departmentName || "Sem setor", eligible: eligibleIds.has(r.participantId), done: r.journeyDone, leaderDone: r.obligations[1]!.status === "SUBMITTED" }))),
      byDirectorate: coverage(visible.map((r) => ({ group: r.directorateName, eligible: eligibleIds.has(r.participantId), done: r.journeyDone, leaderDone: r.obligations[1]!.status === "SUBMITTED" }))),
    },
    rows: visible,
    filters: {
      departments: [...new Set(rows.map((r) => r.departmentName).filter(Boolean))].sort(),
      directorates: [...new Set(rows.map((r) => r.directorateName))].sort(),
      managers: [...new Set(rows.map((r) => r.managerName).filter((m): m is string => Boolean(m)))].sort(),
      modalities: ["INDIVIDUAL", "LIDERANCA", "CALIBRACAO", "FECHAMENTO"] as TrackingModality[],
      statuses: [...OBLIGATION_STATUSES],
    },
    labels: OBLIGATION_LABELS,
    eligibleCount: eligibleParticipants(db, cycleId).length,
  };
}

/** CSV operacional: situação, responsável, prazo e motivo. Sem nenhuma nota, comentário ou resposta. */
export function trackingCsv(board: NonNullable<ReturnType<typeof trackingBoard>>, classification: string): string {
  const cell = (value: string | null | undefined) => {
    // Texto livre (motivo de revogação) não vira fórmula na planilha.
    const raw = value ?? "";
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const header = ["nome", "cargo", "setor", "diretoria", "lider_responsavel", "elegibilidade", "obrigacao", "situacao", "responsavel", "prazo", "motivo", "classificacao_ciclo"];
  const lines = [header.join(",")];
  for (const row of board.rows) {
    for (const o of row.obligations) {
      lines.push(
        [row.employeeName, row.roleName, row.departmentName, row.directorateName, row.managerName, row.eligibility, OBLIGATION_LABELS[o.key], o.status, o.responsible, o.dueAt?.slice(0, 10) ?? "", o.reason, classification]
          .map(cell)
          .join(",")
      );
    }
  }
  return `﻿${lines.join("\n")}`;
}
