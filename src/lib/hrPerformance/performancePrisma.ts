/**
 * Persistência Prisma do ciclo de desempenho.
 * Só é chamada com a feature ligada, depois das migrations aditivas.
 * Não altera tabelas de experiência, competência, custo ou Nomus.
 *
 * Gravação por diferença: a rota lê o estado (`before`), o caso de uso devolve o novo
 * estado (`after`) e aqui só entram os registros criados ou alterados. Nada é apagado:
 * se um registro sumir do estado, a gravação inteira é recusada. A trava
 * `HrPerformanceGraphLock.revision` faz a segunda gravação concorrente perder (409) sem
 * tocar no que a primeira gravou; a rota então relê e reaplica o caso de uso.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { proposedRules } from "./performanceDomain.js";
import { applyCycleDeletion, DELETION_ORDER, inactiveCycleViolation, type CycleDeletionPlan, type DeletionCollection } from "./performanceLifecycle.js";
import {
  PERFORMANCE_COLLECTIONS,
  diffPerformanceDatabase,
  emptyPerformanceDatabase,
  type PerformanceCollection,
  type PerformanceDatabase,
} from "./performanceState.js";

const GRAPH_LOCK_ID = "graph";

export class GraphConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  constructor() {
    super("VERSION_CONFLICT");
  }
}

/** O caso de uso tentou apagar ou reescrever registro que é só de acréscimo. */
export class HistoryIntegrityError extends Error {
  readonly code = "HISTORY_INTEGRITY";
  constructor(detail: string) {
    super(`HISTORY_INTEGRITY: ${detail}`);
  }
}

/** A segunda gravação com a mesma revisão perde. Não apaga o que a primeira já commitou. */
export function nextGraphRevision(stored: number, incoming: number): number | null {
  if (stored !== incoming) return null;
  return stored + 1;
}

export type PerformanceStore = {
  read: () => Promise<PerformanceDatabase>;
  /** `before` é o estado lido; só a diferença é gravada. */
  write: (after: PerformanceDatabase, before: PerformanceDatabase) => Promise<void>;
  /**
   * Única exclusão física do módulo: ciclo de TESTE já inativo (ver `planCycleDeletion`). Transacional,
   * com nova checagem dentro da transação e auditoria gravada fora dos registros apagados.
   */
  deleteTestCycle?: (plan: CycleDeletionPlan, expectedRevision: number) => Promise<Record<DeletionCollection, number>>;
};

export class DeletionIntegrityError extends Error {}

const DELEGATE: Record<PerformanceCollection, string> = {
  models: "hrPerformanceModel",
  questions: "hrPerformanceQuestion",
  cycles: "hrPerformanceCycle",
  participants: "hrPerformanceParticipant",
  assignments: "hrPerformanceAssignment",
  answers: "hrPerformanceAnswer",
  invites: "hrPerformanceInvite",
  sessions: "hrPerformanceSession",
  results: "hrPerformanceResult",
  feedbacks: "hrPerformanceFeedback",
  pdis: "hrPerformancePdi",
  checkins: "hrPerformancePdiCheckin",
  conducts: "hrPerformanceConductCase",
  audits: "hrPerformanceAuditEvent",
  reminders: "hrPerformanceReminder",
  reports: "hrPerformanceReportIssue",
  leadershipResults: "hrPerformanceLeadershipResult",
  plans: "hrPerformanceFollowUpPlan",
};

const DATE_FIELDS: Record<PerformanceCollection, readonly string[]> = {
  models: ["publishedAt", "archivedAt", "createdAt"],
  questions: [],
  cycles: ["openedAt", "closedAt", "createdAt", "classifiedAt", "activationChangedAt"],
  participants: ["admissionDate", "addedAt", "removedAt", "leadershipSnapshotAt"],
  assignments: ["submittedAt", "createdAt"],
  answers: [],
  invites: ["expiresAt", "revokedAt", "createdAt"],
  sessions: ["expiresAt"],
  results: ["calibratedAt", "createdAt"],
  feedbacks: ["viewedAt", "acknowledgedAt", "agreedAt", "createdAt"],
  pdis: ["createdAt", "updatedAt", "completedAt"],
  checkins: ["createdAt"],
  conducts: [],
  audits: ["at"],
  reminders: [],
  reports: ["issuedAt"],
  leadershipResults: ["calibratedAt", "createdAt"],
  plans: ["proposedAt", "createdAt", "updatedAt"],
};

/** Colunas Json anuláveis: o Prisma exige `Prisma.DbNull` em vez de `null`. */
const NULLABLE_JSON_FIELDS: Partial<Record<PerformanceCollection, readonly string[]>> = {
  models: ["rules"],
  questions: ["roleExamples"],
  results: ["ruleSnapshot"],
};

/** Colunas que existem só no banco (defaults/auditoria do Prisma) e não entram no estado. */
const DB_ONLY_FIELDS: Partial<Record<PerformanceCollection, readonly string[]>> = {
  models: ["updatedAt"],
  cycles: ["updatedAt"],
  conducts: ["createdAt"],
};

/** Coleções só de acréscimo: nenhuma linha muda depois de criada. */
const APPEND_ONLY: ReadonlySet<PerformanceCollection> = new Set(["audits", "checkins", "reports"]);

type Delegate = {
  findMany: () => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};

function delegateOf(client: unknown, collection: PerformanceCollection): Delegate {
  return (client as Record<string, Delegate>)[DELEGATE[collection]]!;
}

export function toDbRow(collection: PerformanceCollection, row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = { ...row };
  for (const field of DATE_FIELDS[collection]) {
    const value = data[field];
    data[field] = typeof value === "string" && value ? new Date(value) : null;
  }
  for (const field of NULLABLE_JSON_FIELDS[collection] ?? []) {
    if (data[field] == null) data[field] = Prisma.DbNull;
  }
  if (collection === "audits") data.detail = data.detail ?? {};
  return data;
}

export function fromDbRow(collection: PerformanceCollection, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const field of DB_ONLY_FIELDS[collection] ?? []) delete out[field];
  for (const field of DATE_FIELDS[collection]) {
    const value = out[field];
    out[field] = value instanceof Date ? value.toISOString() : value ?? null;
  }
  if (collection === "models") {
    out.governance = "EM_VALIDACAO";
    out.rules = out.rules && typeof out.rules === "object" ? { ...proposedRules(), ...(out.rules as object) } : proposedRules();
  }
  if (collection === "questions") {
    out.roleExamples = Array.isArray(out.roleExamples) ? out.roleExamples : [];
    out.upwardText = out.upwardText ?? null;
  }
  if (collection === "models") out.kind = out.kind === "LEADERSHIP" ? "LEADERSHIP" : "INDIVIDUAL";
  if (collection === "participants") {
    out.isLeader = out.isLeader === true;
    out.directReportCount = typeof out.directReportCount === "number" ? out.directReportCount : 0;
  }
  if (collection === "assignments") {
    out.subjectParticipantId = out.subjectParticipantId ?? null;
    out.modelId = out.modelId ?? null;
  }
  if (collection === "leadershipResults") {
    out.scores = (out.scores ?? {}) as object;
    out.justifications = (out.justifications ?? {}) as object;
    out.sources = (out.sources ?? { self: false, superior: false, team: false }) as object;
  }
  if (collection === "cycles") {
    out.classification = out.classification === "TEST" ? "TEST" : "OFFICIAL";
    out.activation = out.activation === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    out.leadershipModelId = out.leadershipModelId ?? null;
    for (const field of ["selfStartAt", "leaderStartAt", "leadershipStartAt", "leadershipDueAt", "calibrationStartAt", "calibrationDueAt"]) out[field] = out[field] ?? null;
  }
  if (collection === "audits") out.detail = (out.detail ?? {}) as object;
  if (collection === "reminders") out.status = "DRAFT";
  return out;
}

export function createPrismaPerformanceStore(db: PrismaClient): PerformanceStore {
  return {
    read: () => loadPerformanceDatabase(db),
    write: (after, before) => savePerformanceDatabase(db, after, before),
    deleteTestCycle: (plan, expectedRevision) => deleteTestCycleInDb(db, plan, expectedRevision),
  };
}

const DELETE_DELEGATE: Record<DeletionCollection, string> = {
  checkins: "hrPerformancePdiCheckin",
  pdis: "hrPerformancePdi",
  feedbacks: "hrPerformanceFeedback",
  results: "hrPerformanceResult",
  sessions: "hrPerformanceSession",
  invites: "hrPerformanceInvite",
  answers: "hrPerformanceAnswer",
  assignments: "hrPerformanceAssignment",
  reminders: "hrPerformanceReminder",
  participants: "hrPerformanceParticipant",
  leadershipResults: "hrPerformanceLeadershipResult",
  plans: "hrPerformanceFollowUpPlan",
  cycles: "hrPerformanceCycle",
};

async function deleteTestCycleInDb(db: PrismaClient, plan: CycleDeletionPlan, expectedRevision: number): Promise<Record<DeletionCollection, number>> {
  return db.$transaction(
    async (tx) => {
      const locked = await tx.hrPerformanceGraphLock.updateMany({
        where: { id: GRAPH_LOCK_ID, revision: expectedRevision },
        data: { revision: { increment: 1 } },
      });
      if (locked.count !== 1) throw new GraphConflictError();
      // Nova checagem dentro da transação: o estado lido pode ter mudado.
      const cycle = await tx.hrPerformanceCycle.findUnique({ where: { id: plan.cycleId }, select: { classification: true, activation: true } });
      if (!cycle || cycle.classification !== "TEST" || cycle.activation !== "INACTIVE") {
        throw new DeletionIntegrityError("O ciclo deixou de ser teste inativo.");
      }
      if ((await tx.hrPerformanceReportIssue.count({ where: { cycleId: plan.cycleId } })) > 0) {
        throw new DeletionIntegrityError("Há documento emitido para o ciclo.");
      }
      const deleted = {} as Record<DeletionCollection, number>;
      for (const collection of DELETION_ORDER) {
        const ids = plan.ids[collection];
        const delegate = (tx as unknown as Record<string, { deleteMany: (args: unknown) => Promise<{ count: number }> }>)[DELETE_DELEGATE[collection]];
        deleted[collection] = ids.length === 0 ? 0 : (await delegate.deleteMany({ where: { id: { in: ids } } })).count;
        if (deleted[collection] !== plan.counts[collection]) {
          throw new DeletionIntegrityError(`${collection}: esperado ${plan.counts[collection]}, apagado ${deleted[collection]}.`);
        }
      }
      // Integridade: nada do ciclo pode sobrar.
      const leftovers = await Promise.all([
        tx.hrPerformanceCycle.count({ where: { id: plan.cycleId } }),
        tx.hrPerformanceParticipant.count({ where: { cycleId: plan.cycleId } }),
        tx.hrPerformanceAssignment.count({ where: { cycleId: plan.cycleId } }),
        tx.hrPerformanceReminder.count({ where: { cycleId: plan.cycleId } }),
      ]);
      if (leftovers.some((n) => n > 0)) throw new DeletionIntegrityError("Sobraram registros do ciclo.");
      await tx.hrPerformanceAuditEvent.create({ data: toDbRow("audits", plan.audit as unknown as Record<string, unknown>) as never });
      return deleted;
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

export async function loadPerformanceDatabase(db: PrismaClient): Promise<PerformanceDatabase> {
  const state = emptyPerformanceDatabase();
  // Retrato único: a revisão do grafo e as linhas saem do mesmo instantâneo (REPEATABLE READ).
  // Lidos em conexões separadas, a revisão podia vir de depois de uma gravação e as linhas de antes,
  // e a gravação seguinte passava pela trava com dados velhos (perda silenciosa da outra gravação).
  const [lock, ...rows] = await db.$transaction(
    (tx) =>
      Promise.all([
        tx.hrPerformanceGraphLock.findUnique({ where: { id: GRAPH_LOCK_ID } }),
        ...PERFORMANCE_COLLECTIONS.map((collection) => delegateOf(tx, collection).findMany()),
      ]),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000, maxWait: 10_000 }
  );
  PERFORMANCE_COLLECTIONS.forEach((collection, index) => {
    (state[collection] as unknown[]) = (rows[index] as Record<string, unknown>[]).map((row) => fromDbRow(collection, row));
  });
  state.graphRevision = (lock as { revision: number } | null)?.revision ?? 0;
  return state;
}

/** Plano da gravação. Exportado para o teste provar que nada é apagado. */
/** Gravação em ciclo inativo: recusada para todas as rotas, de uma vez. */
export class CycleInactiveError extends Error {
  constructor(public readonly cycleName: string) {
    super(`Ciclo inativo: ${cycleName}`);
  }
}

export function planPerformanceWrite(before: PerformanceDatabase, after: PerformanceDatabase) {
  const blocked = inactiveCycleViolation(before, after);
  if (blocked) throw new CycleInactiveError(blocked);
  const changes = diffPerformanceDatabase(before, after);
  for (const change of changes) {
    if (change.removed.length > 0) throw new HistoryIntegrityError(`${change.collection} removeria ${change.removed.length} registro(s)`);
    if (APPEND_ONLY.has(change.collection) && change.updated.length > 0) {
      throw new HistoryIntegrityError(`${change.collection} é só de acréscimo`);
    }
  }
  return changes;
}

export async function savePerformanceDatabase(db: PrismaClient, after: PerformanceDatabase, before: PerformanceDatabase): Promise<void> {
  const changes = planPerformanceWrite(before, after);
  if (changes.length === 0) return;
  const byCollection = new Map(changes.map((change) => [change.collection, change]));
  await db.$transaction(
    async (tx) => {
      await tx.hrPerformanceGraphLock.upsert({
        where: { id: GRAPH_LOCK_ID },
        create: { id: GRAPH_LOCK_ID, revision: 0 },
        update: {},
      });
      const locked = await tx.hrPerformanceGraphLock.updateMany({
        where: { id: GRAPH_LOCK_ID, revision: before.graphRevision },
        data: { revision: { increment: 1 } },
      });
      if (locked.count !== 1) throw new GraphConflictError();
      // Primeiro as alterações (ex.: desativar a tarefa anterior), depois as inclusões,
      // para respeitar o índice único parcial de tarefa ativa e as chaves estrangeiras.
      for (const collection of PERFORMANCE_COLLECTIONS) {
        const change = byCollection.get(collection);
        if (!change) continue;
        for (const row of change.updated) {
          const { id, ...data } = toDbRow(collection, row as Record<string, unknown>);
          await delegateOf(tx, collection).update({ where: { id: id as string }, data });
        }
      }
      for (const collection of PERFORMANCE_COLLECTIONS) {
        const change = byCollection.get(collection);
        if (!change || change.created.length === 0) continue;
        await delegateOf(tx, collection).createMany({ data: change.created.map((row) => toDbRow(collection, row as Record<string, unknown>)) });
      }
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

/** Store em memória para testes e harness. Mesma regra: trava por revisão e nada apagado. */
export function createMemoryPerformanceStore(initial: PerformanceDatabase = emptyPerformanceDatabase()) {
  let current = structuredClone(initial);
  const store: PerformanceStore & { snapshot: () => PerformanceDatabase; seed: (next: PerformanceDatabase) => void } = {
    read: async () => structuredClone(current),
    write: async (after, before) => {
      if (before.graphRevision !== current.graphRevision) throw new GraphConflictError();
      planPerformanceWrite(before, after);
      current = { ...structuredClone(after), graphRevision: current.graphRevision + 1 };
    },
    deleteTestCycle: async (plan, expectedRevision) => {
      if (expectedRevision !== current.graphRevision) throw new GraphConflictError();
      const cycle = current.cycles.find((c) => c.id === plan.cycleId);
      if (!cycle || cycle.classification !== "TEST" || cycle.activation !== "INACTIVE") throw new DeletionIntegrityError("O ciclo deixou de ser teste inativo.");
      if (current.reports.some((r) => r.cycleId === plan.cycleId)) throw new DeletionIntegrityError("Há documento emitido para o ciclo.");
      current = { ...applyCycleDeletion(current, plan), graphRevision: current.graphRevision + 1 };
      return { ...plan.counts };
    },
    snapshot: () => structuredClone(current),
    seed: (next) => {
      current = structuredClone(next);
    },
  };
  return store;
}
