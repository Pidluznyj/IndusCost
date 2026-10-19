/**
 * Pessoas e ciclo fictícios para os testes do módulo. Nenhum dado real.
 */
import { buildPerformanceScope } from "./performanceAccess.js";
import { PROPOSED_BASE_QUESTIONS, type EmployeeSnapshotSource, type FrequencyScore } from "./performanceDomain.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import {
  applyParticipants,
  createCycle,
  createDraftModel,
  publishModel,
  reassignLeader,
  saveAnswers,
  submitAssignment,
  transitionCycle,
  type ServiceOptions,
} from "./performanceService.js";

export const NOW = new Date("2026-10-16T15:00:00.000Z");

export const blockedOptions: ServiceOptions = {
  now: () => NOW,
  officialPublication: false,
  identityOtpEnabled: false,
  remindersEnabled: false,
  publicOrigin: "https://induscost.local",
};
export const openOptions: ServiceOptions = { ...blockedOptions, officialPublication: true };

export function must<T>(result: { ok: true; db: PerformanceDatabase; value: T } | { ok: false; message: string; code?: string }): { db: PerformanceDatabase; value: T } {
  if (result.ok === false) throw new Error(`${result.code ?? "ERRO"}: ${result.message}`);
  return result;
}

export function person(id: string, name: string, extra: Partial<EmployeeSnapshotSource> = {}): EmployeeSnapshotSource {
  return {
    id,
    name,
    status: "ACTIVE",
    roleId: "role-op",
    roleName: "Operador de produção",
    departmentId: "dep-prod",
    departmentName: "Produção",
    managerId: "bruno",
    managerName: "Bruno Líder",
    admissionDate: new Date("2024-01-10T12:00:00.000Z"),
    terminationDate: null,
    registration: null,
    ...extra,
  };
}

export const ana = person("ana", "Ana Operadora");
export const bia = person("bia", "Bia Operadora");
export const bruno = person("bruno", "Bruno Líder", { managerId: "carla", managerName: "Carla Gerente", roleName: "Líder de produção" });
export const recem = person("recem", "Caio Recém", { admissionDate: new Date("2026-09-01T12:00:00.000Z") });
export const inativo = person("inativo", "Dora Desligada", { status: "INACTIVE" });
export const afastado = person("afastado", "Eva Afastada");
export const semLider = person("semlider", "Fabi Sem Líder", { managerId: null, managerName: null });
export const outroSetor = person("otavio", "Otávio Manutenção", { managerId: "marcos", managerName: "Marcos Manutenção", departmentName: "Manutenção", departmentId: "dep-man" });

export const hrScope = buildPerformanceScope({ accessScope: "ALL", actorEmployeeId: null });
export const brunoScope = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "bruno", teamIds: ["ana", "bia", "afastado", "recem"] });
export const marcosScope = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "marcos", teamIds: ["otavio"] });
export const anaScope = buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" });

export function publishedModel(options: ServiceOptions = openOptions) {
  let db = emptyPerformanceDatabase();
  const model = must(createDraftModel(db, { name: "Modelo base", actorUserId: "rh", scope: hrScope }, options));
  db = must(publishModel(model.db, { modelId: model.value.modelId, actorUserId: "rh", scope: hrScope }, options)).db;
  return { db, modelId: model.value.modelId };
}

export function draftCycle(employees = [ana, bia, bruno, recem, inativo, afastado, semLider, outroSetor], selected = ["ana", "bia", "recem", "inativo", "afastado", "semlider", "otavio"]) {
  const published = publishedModel();
  const cycle = must(
    createCycle(
      published.db,
      { name: "Ciclo 2026-S2", periodLabel: "2º semestre de 2026", modelId: published.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", scope: hrScope },
      openOptions
    )
  );
  const people = must(
    applyParticipants(
      cycle.db,
      { cycleId: cycle.value.cycleId, employees, selectedIds: selected, exceptions: {}, absenceIds: ["afastado"], roleChangeIds: [], actorUserId: "rh", scope: hrScope },
      openOptions
    )
  );
  return { db: people.db, cycleId: cycle.value.cycleId, modelId: published.modelId, counts: people.value };
}

/** Fabi entra sem gestor; o ciclo só abre depois que o RH escolhe a líder (exceção justificada, fora dos escopos de teste). */
export function withFabiLeader(db: PerformanceDatabase): PerformanceDatabase {
  const fabi = participantOf(db, "semlider");
  return must(
    reassignLeader(db, { participantId: fabi.id, managerId: "carla", managerName: "Carla Gerente", reason: "Cadastro sem gestor; Carla acompanha o turno.", actorUserId: "rh", scope: hrScope }, openOptions)
  ).db;
}

export function openCycle() {
  const draft = draftCycle();
  const prepared = must(transitionCycle(withFabiLeader(draft.db), { cycleId: draft.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions));
  const opened = must(transitionCycle(prepared.db, { cycleId: draft.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions));
  return { ...draft, db: opened.db };
}

export function assignmentOf(db: PerformanceDatabase, employeeId: string, kind: "SELF" | "LEADER") {
  const assignment = db.assignments.find((a) => a.employeeId === employeeId && a.kind === kind && a.active);
  if (!assignment) throw new Error(`sem tarefa ${kind} para ${employeeId}`);
  return assignment;
}

export function participantOf(db: PerformanceDatabase, employeeId: string) {
  const participant = db.participants.find((p) => p.employeeId === employeeId && !p.removedAt);
  if (!participant) throw new Error(`sem participante ${employeeId}`);
  return participant;
}

export function allAnswers(score: FrequencyScore | ((code: string) => FrequencyScore | "NO"), evidence = "Exemplo observado no posto de trabalho.") {
  return PROPOSED_BASE_QUESTIONS.map((q) => {
    const value = typeof score === "function" ? score(q.code) : score;
    if (value === "NO") return { code: q.code, answer: { kind: "notObserved" as const } };
    return { code: q.code, answer: { kind: "score" as const, score: value, evidence: value === 1 || value === 4 ? evidence : null } };
  });
}

export function submitSelf(db: PerformanceDatabase, employeeId: string, score: FrequencyScore | ((code: string) => FrequencyScore | "NO") = 3) {
  const self = assignmentOf(db, employeeId, "SELF");
  const scope = buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: employeeId });
  const saved = must(saveAnswers(db, { assignmentId: self.id, expectedVersion: self.version, answers: allAnswers(score), actorUserId: null, scope }, openOptions));
  return must(submitAssignment(saved.db, { assignmentId: self.id, expectedVersion: saved.value.version, actorUserId: null, scope, assistedConfirmation: true }, openOptions)).db;
}

export function submitLeader(db: PerformanceDatabase, employeeId: string, score: FrequencyScore | ((code: string) => FrequencyScore | "NO"), scope = brunoScope) {
  const leader = assignmentOf(db, employeeId, "LEADER");
  const saved = must(saveAnswers(db, { assignmentId: leader.id, expectedVersion: leader.version, answers: allAnswers(score), actorUserId: "u-bruno", scope }, openOptions));
  return must(submitAssignment(saved.db, { assignmentId: leader.id, expectedVersion: saved.value.version, actorUserId: "u-bruno", scope, assistedConfirmation: true }, openOptions)).db;
}
