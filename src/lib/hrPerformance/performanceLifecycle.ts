/**
 * Ciclo de vida administrativo dos ciclos de avaliação (puro, sem I/O).
 *
 * Duas dimensões, independentes da situação operacional (`status`):
 * - Classificação: OFFICIAL ou TEST. TEST nunca compõe indicador oficial. A passagem
 *   OFFICIAL → TEST só é possível se o ciclo não teve publicação oficial; TEST → OFFICIAL não existe
 *   (respostas de teste nunca viram resultado oficial).
 * - Ativação: ACTIVE ou INACTIVE. Inativo fica congelado: nenhuma gravação passa, exceto as próprias
 *   ações de ciclo de vida (ver `inactiveCycleViolation`, aplicada a toda gravação do módulo).
 *
 * Predicado oficial único (`cycleGovernance(...).officialEligible`): OFFICIAL, ACTIVE, homologado ou
 * encerrado, aberto com publicação oficial (não piloto) e com resultado oficial. Toda leitura que
 * agrega entre ciclos usa este predicado ou `isDefaultVisibleCycle`.
 *
 * Exclusão física: só TEST, já inativo, pelo SUPER_ADMIN, com o nome digitado e motivo; bloqueada se
 * houver documento emitido (registro com código rastreável) ou publicação oficial.
 */
import { diffPerformanceDatabase, newId, CYCLE_LIFECYCLE_FIELDS, type CycleRecord, type PerformanceCollection, type PerformanceDatabase, type AuditRecord } from "./performanceState.js";

export type CyclePublication = "NOT_OPENED" | "PILOT" | "OFFICIAL";

export type CycleGovernance = {
  classification: CycleRecord["classification"];
  activation: CycleRecord["activation"];
  status: CycleRecord["status"];
  publication: CyclePublication;
  homologated: boolean;
  officialEligible: boolean;
  /** Por que não entra nos indicadores oficiais (vazio quando entra). */
  reasons: string[];
};

export const LIFECYCLE_ACTIONS = ["CYCLE_CREATED", "CYCLE_CLASSIFIED", "CYCLE_INACTIVATED", "CYCLE_REACTIVATED", "CYCLE_DELETED", "CYCLE_DELETE_BLOCKED"] as const;

const MIN_REASON = 8;

type Ok<T> = { ok: true; db: PerformanceDatabase; value: T };
type Fail = { ok: false; code: string; message: string };

function fail(code: string, message: string): Fail {
  return { ok: false, code, message };
}

function clean(value: string | null | undefined, max = 600): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function audit(db: PerformanceDatabase, now: Date, actorUserId: string | null, action: string, entityId: string, detail: AuditRecord["detail"]): AuditRecord {
  const row: AuditRecord = { id: newId(), at: now.toISOString(), actorUserId, action, entityId, detail };
  db.audits.push(row);
  return row;
}

export function isHomologatedStatus(status: CycleRecord["status"]): boolean {
  return status === "HOMOLOGATED" || status === "CLOSED";
}

/** Aberto sem publicação oficial fica registrado como PILOT_OPEN na auditoria da abertura. */
export function cyclePublication(db: PerformanceDatabase, cycle: CycleRecord): CyclePublication {
  if (!cycle.openedAt) return "NOT_OPENED";
  return db.audits.some((a) => a.action === "PILOT_OPEN" && a.entityId === cycle.id) ? "PILOT" : "OFFICIAL";
}

/**
 * Teve resultado homologado com publicação oficial, como ciclo oficial? Ciclos antigos (sem a
 * classificação registrada na homologação) contam como oficiais, por segurança.
 */
export function wasOfficiallyPublished(db: PerformanceDatabase, cycle: CycleRecord): boolean {
  if (cyclePublication(db, cycle) !== "OFFICIAL") return false;
  const homologations = db.audits.filter((a) => a.action === "RESULTS_HOMOLOGATED" && a.entityId === cycle.id);
  if (homologations.length === 0) return false;
  return homologations.some((a) => a.detail.classification !== "TEST" && a.detail.officialPublication !== false);
}

export function cycleGovernance(db: PerformanceDatabase, cycle: CycleRecord): CycleGovernance {
  const publication = cyclePublication(db, cycle);
  const homologated = isHomologatedStatus(cycle.status);
  const reasons: string[] = [];
  if (cycle.classification !== "OFFICIAL") reasons.push("Ciclo de teste: nunca compõe indicadores oficiais.");
  if (cycle.activation !== "ACTIVE") reasons.push("Ciclo inativo.");
  if (!homologated) reasons.push("Resultados ainda não homologados.");
  if (publication !== "OFFICIAL") reasons.push(publication === "PILOT" ? "Aberto como piloto, sem publicação oficial." : "Ciclo ainda não aberto.");
  const hasOfficialResult = db.participants.some(
    (p) => p.cycleId === cycle.id && !p.removedAt && db.results.some((r) => r.participantId === p.id && r.active && r.official)
  );
  if (homologated && !hasOfficialResult) reasons.push("Sem resultado homologado válido.");
  return {
    classification: cycle.classification,
    activation: cycle.activation,
    status: cycle.status,
    publication,
    homologated,
    officialEligible: reasons.length === 0,
    reasons,
  };
}

/** Visão operacional padrão (listas, tarefas, histórico da ficha): só ciclos ativos. */
export function isDefaultVisibleCycle(cycle: CycleRecord | undefined | null): boolean {
  return Boolean(cycle && cycle.activation === "ACTIVE");
}

/** Histórico e evolução padrão: ativos e oficiais (piloto aparece rotulado; teste e inativo não). */
export function isHistoryCycle(cycle: CycleRecord | undefined | null): boolean {
  return Boolean(cycle && cycle.activation === "ACTIVE" && cycle.classification === "OFFICIAL");
}

// ---------------------------------------------------------------- trava de ciclo inativo

type Lookup = {
  assignmentCycle: Map<string, string>;
  participantCycle: Map<string, string>;
  pdiParticipant: Map<string, string>;
};

function lookupOf(...dbs: PerformanceDatabase[]): Lookup {
  const assignmentCycle = new Map<string, string>();
  const participantCycle = new Map<string, string>();
  const pdiParticipant = new Map<string, string>();
  for (const db of dbs) {
    for (const a of db.assignments) assignmentCycle.set(a.id, a.cycleId);
    for (const p of db.participants) participantCycle.set(p.id, p.cycleId);
    for (const p of db.pdis) pdiParticipant.set(p.id, p.participantId);
  }
  return { assignmentCycle, participantCycle, pdiParticipant };
}

/** Ciclo dono de um registro, ou null para registros sem ciclo (modelos, perguntas, ocorrências, auditoria). */
export function cycleIdOfRecord(collection: PerformanceCollection, row: Record<string, unknown>, lookup: Lookup): string | null {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  switch (collection) {
    case "cycles":
      return str(row.id);
    case "participants":
    case "assignments":
    case "reminders":
    case "reports":
    case "leadershipResults":
      return str(row.cycleId);
    case "answers":
    case "invites":
    case "sessions":
      return lookup.assignmentCycle.get(str(row.assignmentId) ?? "") ?? null;
    case "results":
    case "feedbacks":
    case "pdis":
      return lookup.participantCycle.get(str(row.participantId) ?? "") ?? null;
    case "checkins": {
      const participantId = lookup.pdiParticipant.get(str(row.pdiId) ?? "");
      return participantId ? lookup.participantCycle.get(participantId) ?? null : null;
    }
    default:
      return null;
  }
}

function onlyLifecycleFieldsChanged(before: CycleRecord, after: CycleRecord): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if ((CYCLE_LIFECYCLE_FIELDS as readonly string[]).includes(key)) continue;
    if (JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((after as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * Recusa qualquer gravação que crie ou altere registro de um ciclo inativo (no estado lido),
 * exceto os campos de ciclo de vida do próprio ciclo. Auditoria sempre pode crescer.
 * Devolve o nome do ciclo bloqueado, ou null.
 */
export function inactiveCycleViolation(before: PerformanceDatabase, after: PerformanceDatabase): string | null {
  const inactive = new Map(before.cycles.filter((c) => c.activation === "INACTIVE").map((c) => [c.id, c]));
  if (inactive.size === 0) return null;
  const lookup = lookupOf(before, after);
  for (const change of diffPerformanceDatabase(before, after)) {
    if (change.collection === "audits") continue;
    for (const row of [...change.created, ...change.updated] as Record<string, unknown>[]) {
      const cycleId = cycleIdOfRecord(change.collection, row, lookup);
      const cycle = cycleId ? inactive.get(cycleId) : undefined;
      if (!cycle) continue;
      if (change.collection === "cycles" && change.updated.includes(row as never) && onlyLifecycleFieldsChanged(cycle, row as unknown as CycleRecord)) continue;
      return cycle.name;
    }
  }
  return null;
}

// ---------------------------------------------------------------- ações do SUPER_ADMIN

type LifecycleInput = { cycleId: string; reason: string; actorUserId: string | null; superAdmin: boolean; now: Date };

function lifecycleTarget(source: PerformanceDatabase, input: LifecycleInput): Fail | { db: PerformanceDatabase; cycle: CycleRecord; reason: string } {
  if (!input.superAdmin) return fail("FORBIDDEN", "Só o SUPER_ADMIN gerencia o ciclo de vida dos ciclos.");
  const reason = clean(input.reason);
  if (reason.length < MIN_REASON) return fail("NOTE_REQUIRED", `Informe o motivo com pelo menos ${MIN_REASON} caracteres.`);
  const db = structuredClone(source);
  const cycle = db.cycles.find((c) => c.id === input.cycleId);
  if (!cycle) return fail("NOT_FOUND", "Ciclo não encontrado.");
  return { db, cycle, reason };
}

export function classifyCycle(source: PerformanceDatabase, input: LifecycleInput & { classification: string }): Ok<{ classification: string }> | Fail {
  const target = lifecycleTarget(source, input);
  if ("ok" in target) return target;
  const { db, cycle, reason } = target;
  if (input.classification !== "TEST" && input.classification !== "OFFICIAL") return fail("INVALID_CLASSIFICATION", "Escolha oficial ou teste.");
  if (cycle.classification === input.classification) return fail("NO_CHANGE", "O ciclo já tem essa classificação.");
  if (input.classification === "OFFICIAL") {
    return fail("TEST_IS_FINAL", "Ciclo de teste não vira oficial: respostas de teste nunca entram em resultado oficial. Crie um ciclo oficial.");
  }
  const governance = cycleGovernance(db, cycle);
  if (wasOfficiallyPublished(db, cycle)) {
    return fail("OFFICIALLY_PUBLISHED", "Este ciclo teve resultados homologados com publicação oficial. Reclassificar exige processo administrativo próprio.");
  }
  const from = cycle.classification;
  cycle.classification = "TEST";
  cycle.classifiedAt = input.now.toISOString();
  cycle.classifiedByUserId = input.actorUserId;
  audit(db, input.now, input.actorUserId, "CYCLE_CLASSIFIED", cycle.id, { from, to: "TEST", reason, status: cycle.status, publication: governance.publication });
  return { ok: true, db, value: { classification: "TEST" } };
}

export function inactivateCycle(source: PerformanceDatabase, input: LifecycleInput): Ok<{ revokedInvites: number; revokedSessions: number }> | Fail {
  const target = lifecycleTarget(source, input);
  if ("ok" in target) return target;
  const { db, cycle, reason } = target;
  if (cycle.activation === "INACTIVE") return fail("NO_CHANGE", "O ciclo já está inativo.");
  const at = input.now.toISOString();
  const assignmentIds = new Set(db.assignments.filter((a) => a.cycleId === cycle.id).map((a) => a.id));
  let revokedInvites = 0;
  for (const invite of db.invites) {
    if (!assignmentIds.has(invite.assignmentId) || invite.revokedAt) continue;
    invite.revokedAt = at;
    invite.revokedReason = "Ciclo inativado";
    revokedInvites += 1;
  }
  let revokedSessions = 0;
  for (const session of db.sessions) {
    if (!assignmentIds.has(session.assignmentId) || session.revoked) continue;
    session.revoked = true;
    revokedSessions += 1;
  }
  cycle.activation = "INACTIVE";
  cycle.activationChangedAt = at;
  cycle.activationChangedByUserId = input.actorUserId;
  cycle.activationReason = reason;
  audit(db, input.now, input.actorUserId, "CYCLE_INACTIVATED", cycle.id, {
    reason,
    status: cycle.status,
    classification: cycle.classification,
    revokedInvites,
    revokedSessions,
  });
  return { ok: true, db, value: { revokedInvites, revokedSessions } };
}

export function reactivateCycle(source: PerformanceDatabase, input: LifecycleInput): Ok<{ status: string; invitesNeedReissue: boolean }> | Fail {
  const target = lifecycleTarget(source, input);
  if ("ok" in target) return target;
  const { db, cycle, reason } = target;
  if (cycle.activation === "ACTIVE") return fail("NO_CHANGE", "O ciclo já está ativo.");
  const model = db.models.find((m) => m.id === cycle.modelId);
  if (!model || (model.status !== "PUBLISHED" && model.status !== "ARCHIVED")) {
    return fail("MODEL_REQUIRED", "O modelo do ciclo não está publicado. Corrija antes de reativar.");
  }
  const at = input.now.toISOString();
  cycle.activation = "ACTIVE";
  cycle.activationChangedAt = at;
  cycle.activationChangedByUserId = input.actorUserId;
  cycle.activationReason = reason;
  // Convites e sessões revogados na inativação continuam revogados: reemissão é explícita.
  const invitesNeedReissue = cycle.status === "OPEN";
  audit(db, input.now, input.actorUserId, "CYCLE_REACTIVATED", cycle.id, { reason, status: cycle.status, classification: cycle.classification, invitesNeedReissue });
  return { ok: true, db, value: { status: cycle.status, invitesNeedReissue } };
}

// ---------------------------------------------------------------- exclusão física segura

/** Ordem de exclusão: dependentes primeiro (respeita as chaves estrangeiras sem depender de cascata). */
export const DELETION_ORDER = ["checkins", "pdis", "feedbacks", "results", "leadershipResults", "sessions", "invites", "answers", "assignments", "reminders", "participants", "cycles"] as const;
export type DeletionCollection = (typeof DELETION_ORDER)[number];

export type CycleDeletionPlan = {
  cycleId: string;
  cycleName: string;
  ids: Record<DeletionCollection, string[]>;
  counts: Record<DeletionCollection, number>;
  audit: AuditRecord;
};

export type CycleDeletionCheck = { deletable: boolean; blockers: string[]; counts: Record<DeletionCollection, number> & { reports: number } };

function collectIds(db: PerformanceDatabase, cycleId: string): Record<DeletionCollection, string[]> {
  const participants = db.participants.filter((p) => p.cycleId === cycleId).map((p) => p.id);
  const participantSet = new Set(participants);
  const assignments = db.assignments.filter((a) => a.cycleId === cycleId || participantSet.has(a.participantId)).map((a) => a.id);
  const assignmentSet = new Set(assignments);
  const feedbacks = db.feedbacks.filter((f) => participantSet.has(f.participantId)).map((f) => f.id);
  const pdis = db.pdis.filter((p) => participantSet.has(p.participantId)).map((p) => p.id);
  const pdiSet = new Set(pdis);
  return {
    checkins: db.checkins.filter((c) => pdiSet.has(c.pdiId)).map((c) => c.id),
    pdis,
    feedbacks,
    results: db.results.filter((r) => participantSet.has(r.participantId)).map((r) => r.id),
    leadershipResults: db.leadershipResults.filter((r) => r.cycleId === cycleId || participantSet.has(r.participantId)).map((r) => r.id),
    sessions: db.sessions.filter((s) => assignmentSet.has(s.assignmentId)).map((s) => s.id),
    invites: db.invites.filter((i) => assignmentSet.has(i.assignmentId)).map((i) => i.id),
    answers: db.answers.filter((a) => assignmentSet.has(a.assignmentId)).map((a) => a.id),
    assignments,
    reminders: db.reminders.filter((r) => r.cycleId === cycleId).map((r) => r.id),
    participants,
    cycles: [cycleId],
  };
}

/** Diagnóstico sem efeito: o que impediria a exclusão e o que seria apagado. */
export function checkCycleDeletion(db: PerformanceDatabase, cycleId: string): CycleDeletionCheck | null {
  const cycle = db.cycles.find((c) => c.id === cycleId);
  if (!cycle) return null;
  const ids = collectIds(db, cycleId);
  const counts = Object.fromEntries(DELETION_ORDER.map((k) => [k, ids[k].length])) as Record<DeletionCollection, number>;
  const reports = db.reports.filter((r) => r.cycleId === cycleId).length;
  const blockers: string[] = [];
  if (cycle.classification !== "TEST") blockers.push("Só ciclos de teste podem ser excluídos. Ciclo oficial não é excluído, nem pelo SUPER_ADMIN.");
  if (cycle.activation !== "INACTIVE") blockers.push("Inative o ciclo antes de excluir.");
  if (wasOfficiallyPublished(db, cycle)) blockers.push("O ciclo teve resultados homologados com publicação oficial.");
  if (reports > 0) blockers.push(`Há ${reports} documento(s) emitido(s) com código rastreável; o registro de emissão precisa ser preservado. Mantenha o ciclo inativo.`);
  return { deletable: blockers.length === 0, blockers, counts: { ...counts, reports } };
}

export function planCycleDeletion(
  source: PerformanceDatabase,
  input: LifecycleInput & { confirmation: string }
): { ok: true; plan: CycleDeletionPlan } | Fail {
  const target = lifecycleTarget(source, input);
  if ("ok" in target) return target;
  const { cycle, reason } = target;
  const typed = clean(input.confirmation, 200);
  if (typed !== cycle.name.trim() && typed !== cycle.id) return fail("CONFIRMATION_MISMATCH", "Digite exatamente o nome do ciclo para confirmar a exclusão.");
  const check = checkCycleDeletion(source, cycle.id)!;
  if (!check.deletable) return fail("DELETE_BLOCKED", check.blockers.join(" "));
  const ids = collectIds(source, cycle.id);
  const counts = Object.fromEntries(DELETION_ORDER.map((k) => [k, ids[k].length])) as Record<DeletionCollection, number>;
  const scratch = { audits: [] as AuditRecord[] } as unknown as PerformanceDatabase;
  const row = audit(scratch, input.now, input.actorUserId, "CYCLE_DELETED", cycle.id, {
    name: cycle.name,
    periodLabel: cycle.periodLabel,
    classification: cycle.classification,
    status: cycle.status,
    reason,
    ...Object.fromEntries(DELETION_ORDER.map((k) => [`deleted_${k}`, counts[k]])),
  });
  return { ok: true, plan: { cycleId: cycle.id, cycleName: cycle.name, ids, counts, audit: row } };
}

/** Aplica a exclusão em memória (store de teste). A versão Prisma faz o mesmo numa transação. */
export function applyCycleDeletion(db: PerformanceDatabase, plan: CycleDeletionPlan): PerformanceDatabase {
  const next = structuredClone(db);
  for (const collection of DELETION_ORDER) {
    const remove = new Set(plan.ids[collection]);
    (next as unknown as Record<string, { id: string }[]>)[collection] = (next[collection] as { id: string }[]).filter((row) => !remove.has(row.id));
  }
  next.audits.push(plan.audit);
  return next;
}

/** Ações de ciclo de vida registradas (consulta de histórico). */
export function cycleLifecycleHistory(db: PerformanceDatabase, cycleId: string) {
  return db.audits
    .filter((a) => a.entityId === cycleId && (LIFECYCLE_ACTIONS as readonly string[]).includes(a.action))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((a) => ({ id: a.id, at: a.at, action: a.action, actorUserId: a.actorUserId, detail: a.detail }));
}

