/**
 * Inteligência Fiscal 360° — fila de processamento, checkpoints e locks (PostgreSQL).
 *
 * - Enfileiramento idempotente: dedupeKey = tipo:entidade:id, único entre PENDING (índice parcial
 *   `FiscalProcessingJob_pending_dedupe_key`) → INSERT ... ON CONFLICT DO NOTHING.
 * - Claim concorrente: FOR UPDATE SKIP LOCKED + leaseToken + leaseUntil (lease). Job RUNNING com lease
 *   vencido (worker caiu) volta a ser reivindicável — recuperação após falha.
 * - O handler lê SEMPRE o estado atual da fonte: reexecutar um job não duplica efeitos.
 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  FISCAL360_JOB_PRIORITY,
  FISCAL360_JOB_TYPES,
  FISCAL360_RULE_VERSIONS,
  type Fiscal360JobType,
} from "./fiscal360Constants.js";

/**
 * Relógio dos jobs: colunas timestamp(3) são gravadas pelo Prisma em UTC (sem fuso). Comparar com now() cru
 * dependeria do fuso do servidor PostgreSQL; (now() AT TIME ZONE 'UTC') é consistente em qualquer fuso.
 */
export type Fiscal360Db = PrismaClient | Prisma.TransactionClient;

/** Namespaces de advisory lock (int4) — exclusivos da 360°. */
export const FISCAL360_LOCK_NAMESPACE = {
  partition: 913601,
  entity: 913602,
  discovery: 913603,
} as const;

export type Fiscal360JobInput = {
  jobType: Fiscal360JobType;
  sourceEntity: string;
  sourceId: string;
  sourceHash?: string | null;
  ruleVersion?: string;
  priority?: number;
  affectedPeriods?: string[];
  auditMeta?: Record<string, unknown> | null;
  requestedByUserId?: string | null;
  runId?: string | null;
};

export type Fiscal360ClaimedJob = {
  id: string;
  jobType: Fiscal360JobType;
  sourceEntity: string;
  sourceId: string;
  sourceHash: string | null;
  ruleVersion: string;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
  dedupeKey: string;
  auditMeta: unknown;
};

function stableValue(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toFixed" in value && "toNumber" in value) {
    return (value as { toString: () => string }).toString();
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = stableValue(obj[k]);
        return acc;
      }, {});
  }
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  return value;
}

/** sha256 estável (ordem de chaves, Decimal/Date normalizados). */
export function fiscal360Hash(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(parts))).digest("hex");
}

export function fiscal360DedupeKey(job: Pick<Fiscal360JobInput, "jobType" | "sourceEntity" | "sourceId">): string {
  return `${job.jobType}:${job.sourceEntity}:${job.sourceId}`;
}

export function partitionJob(companyCnpj: string, month: string, extra?: Partial<Fiscal360JobInput>): Fiscal360JobInput {
  return {
    jobType: FISCAL360_JOB_TYPES.rebuildPartition,
    sourceEntity: "PARTITION",
    sourceId: `${companyCnpj}:${month}`,
    ruleVersion: FISCAL360_RULE_VERSIONS.snapshot,
    affectedPeriods: [month],
    ...extra,
  };
}

export function forecastJob(extra?: Partial<Fiscal360JobInput>): Fiscal360JobInput {
  return {
    jobType: FISCAL360_JOB_TYPES.rebuildForecast,
    sourceEntity: "FORECAST",
    sourceId: "ALL",
    ruleVersion: FISCAL360_RULE_VERSIONS.forecast,
    ...extra,
  };
}

/** Enfileira jobs; duplicados de um PENDING existente são ignorados. Retorna quantos entraram. */
export async function enqueueFiscal360Jobs(db: Fiscal360Db, jobs: Fiscal360JobInput[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const unique = new Map<string, Fiscal360JobInput>();
  for (const job of jobs) unique.set(fiscal360DedupeKey(job), job);
  let inserted = 0;
  const all = [...unique.entries()];
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const values = chunk.map(([dedupeKey, job]) =>
      Prisma.sql`(
        ${randomUUID()}, ${job.jobType}, ${job.sourceEntity}, ${job.sourceId}, ${job.sourceHash ?? null},
        ${job.ruleVersion ?? FISCAL360_RULE_VERSIONS.snapshot}, 'PENDING',
        ${job.priority ?? FISCAL360_JOB_PRIORITY[job.jobType]}, ${dedupeKey},
        ${job.affectedPeriods ?? []}::text[],
        ${job.auditMeta == null ? null : JSON.stringify(job.auditMeta)}::jsonb,
        ${job.requestedByUserId ?? null}, ${job.runId ?? null}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      )`
    );
    const n = await db.$executeRaw(Prisma.sql`
      INSERT INTO "FiscalProcessingJob" (
        "id", "jobType", "sourceEntity", "sourceId", "sourceHash", "ruleVersion", "status", "priority",
        "dedupeKey", "affectedPeriods", "auditMeta", "requestedByUserId", "runId", "availableAt", "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("dedupeKey") WHERE "status" = 'PENDING' DO NOTHING
    `);
    inserted += Number(n);
  }
  return inserted;
}

/**
 * Reivindica até `limit` jobs para este worker. Seguro entre workers concorrentes (SKIP LOCKED).
 * Job RUNNING com lease vencido é retomado (tentativa contabilizada).
 */
export async function claimFiscal360Jobs(
  db: PrismaClient,
  input: { workerId: string; limit: number; leaseMs: number; maxPriority?: number }
): Promise<Fiscal360ClaimedJob[]> {
  const maxPriority = input.maxPriority ?? 1000;
  // Job RUNNING com lease vencido que já esgotou as tentativas não volta à fila para sempre: vira FAILED (visível).
  await db.$executeRaw(Prisma.sql`
    UPDATE "FiscalProcessingJob"
    SET "status" = 'FAILED', "leaseUntil" = NULL, "finishedAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC'),
        "lastError" = 'Lease expirado após esgotar as tentativas (worker interrompido?).'
    WHERE "status" = 'RUNNING' AND "leaseUntil" < (now() AT TIME ZONE 'UTC') AND "attempts" >= "maxAttempts"
  `);
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH picked AS (
      SELECT "id" FROM "FiscalProcessingJob"
      WHERE (("status" = 'PENDING' AND "availableAt" <= (now() AT TIME ZONE 'UTC'))
          OR ("status" = 'RUNNING' AND "leaseUntil" < (now() AT TIME ZONE 'UTC')))
        AND "priority" <= ${maxPriority}
      ORDER BY "priority" ASC, "availableAt" ASC, "createdAt" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "FiscalProcessingJob" j
    SET "status" = 'RUNNING',
        "leasedBy" = ${input.workerId},
        "leaseToken" = gen_random_uuid()::text,
        "leaseUntil" = (now() AT TIME ZONE 'UTC') + (${input.leaseMs}::int * interval '1 millisecond'),
        "startedAt" = (now() AT TIME ZONE 'UTC'),
        "attempts" = j."attempts" + 1,
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    FROM picked
    WHERE j."id" = picked."id"
    RETURNING j."id", j."jobType", j."sourceEntity", j."sourceId", j."sourceHash", j."ruleVersion",
              j."attempts", j."maxAttempts", j."leaseToken", j."dedupeKey", j."auditMeta", j."priority", j."createdAt"
  `);
  return rows
    .map((r) => ({
      id: String(r.id),
      jobType: r.jobType as Fiscal360JobType,
      sourceEntity: String(r.sourceEntity),
      sourceId: String(r.sourceId),
      sourceHash: (r.sourceHash as string | null) ?? null,
      ruleVersion: String(r.ruleVersion),
      attempts: Number(r.attempts),
      maxAttempts: Number(r.maxAttempts),
      leaseToken: String(r.leaseToken),
      dedupeKey: String(r.dedupeKey),
      auditMeta: r.auditMeta,
      _priority: Number(r.priority),
      _createdAt: r.createdAt as Date,
    }))
    .sort((a, b) => a._priority - b._priority || +a._createdAt - +b._createdAt)
    .map(({ _priority, _createdAt, ...job }) => job);
}

/** Renova o lease de um job que ainda vai executar (lote reivindicado maior que o lease). */
export async function extendFiscal360Lease(
  db: PrismaClient,
  job: Pick<Fiscal360ClaimedJob, "id" | "leaseToken">,
  leaseMs: number
): Promise<boolean> {
  const n = await db.$executeRaw(Prisma.sql`
    UPDATE "FiscalProcessingJob"
    SET "leaseUntil" = (now() AT TIME ZONE 'UTC') + (${leaseMs}::int * interval '1 millisecond')
    WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken} AND "status" = 'RUNNING'
  `);
  return Number(n) === 1;
}

export async function completeFiscal360Job(
  db: PrismaClient,
  job: Pick<Fiscal360ClaimedJob, "id" | "leaseToken">,
  input: { durationMs: number; affectedPeriods?: string[]; auditMeta?: Record<string, unknown> | null }
): Promise<boolean> {
  const n = await db.$executeRaw(Prisma.sql`
    UPDATE "FiscalProcessingJob"
    SET "status" = 'SUCCEEDED', "finishedAt" = (now() AT TIME ZONE 'UTC'), "durationMs" = ${input.durationMs},
        "leaseUntil" = NULL, "lastError" = NULL,
        "affectedPeriods" = ${input.affectedPeriods ?? []}::text[],
        "auditMeta" = COALESCE(${input.auditMeta == null ? null : JSON.stringify(input.auditMeta)}::jsonb, "auditMeta"),
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken} AND "status" = 'RUNNING'
  `);
  return Number(n) === 1;
}

/** Remove trechos sensíveis de mensagens de erro (URLs com credencial, tokens). */
export function sanitizeFiscal360Error(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgresql://***")
    .replace(/(password|token|secret|apikey|api_key)=([^&\s]+)/gi, "$1=***")
    .slice(0, 2000);
}

export async function failFiscal360Job(
  db: PrismaClient,
  job: Pick<Fiscal360ClaimedJob, "id" | "leaseToken" | "attempts" | "maxAttempts">,
  error: unknown
): Promise<"RETRY" | "FAILED" | "SUPERSEDED" | "LOST"> {
  const message = sanitizeFiscal360Error(error);
  const definitive = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(30_000 * 2 ** Math.max(0, job.attempts - 1), 30 * 60_000);
  try {
    const n = await db.$executeRaw(Prisma.sql`
      UPDATE "FiscalProcessingJob"
      SET "status" = ${definitive ? "FAILED" : "PENDING"},
          "lastError" = ${message},
          "leaseUntil" = NULL, "leasedBy" = NULL,
          "availableAt" = (now() AT TIME ZONE 'UTC') + (${definitive ? 0 : backoffMs}::int * interval '1 millisecond'),
          "finishedAt" = ${definitive ? new Date() : null},
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken} AND "status" = 'RUNNING'
    `);
    if (Number(n) !== 1) return "LOST";
    return definitive ? "FAILED" : "RETRY";
  } catch (retryError) {
    // Já existe um PENDING com o mesmo dedupeKey: este job foi superado (o PENDING lerá o estado atual).
    if (String((retryError as { code?: string }).code) === "P2010" || /unique|duplicate/i.test(String(retryError))) {
      await db.$executeRaw(Prisma.sql`
        UPDATE "FiscalProcessingJob"
        SET "status" = 'CANCELLED', "lastError" = ${`Superado por job pendente equivalente. Erro original: ${message}`},
            "leaseUntil" = NULL, "finishedAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken}
      `);
      return "SUPERSEDED";
    }
    throw retryError;
  }
}

/** Lock transacional por chave (partição/entidade). Libera no commit/rollback. */
export async function fiscal360XactLock(tx: Prisma.TransactionClient, namespace: number, key: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))`);
}

export async function readFiscal360Checkpoint(
  db: Fiscal360Db,
  key: string
): Promise<{ cursorUpdatedAt: Date | null; cursorId: string | null; metadata: Record<string, unknown> | null }> {
  const row = await db.fiscalProcessingCheckpoint.findUnique({ where: { key } });
  return {
    cursorUpdatedAt: row?.cursorUpdatedAt ?? null,
    cursorId: row?.cursorId ?? null,
    metadata: (row?.metadata as Record<string, unknown> | null) ?? null,
  };
}

export async function writeFiscal360Checkpoint(
  db: Fiscal360Db,
  key: string,
  data: { cursorUpdatedAt?: Date | null; cursorId?: string | null; metadata?: Record<string, unknown> | null; success?: boolean }
): Promise<void> {
  const now = new Date();
  const payload = {
    ...(data.cursorUpdatedAt !== undefined ? { cursorUpdatedAt: data.cursorUpdatedAt } : {}),
    ...(data.cursorId !== undefined ? { cursorId: data.cursorId } : {}),
    ...(data.metadata !== undefined ? { metadata: (data.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
    lastRunAt: now,
    ...(data.success ? { lastSuccessAt: now } : {}),
  };
  await db.fiscalProcessingCheckpoint.upsert({
    where: { key },
    create: { key, ...payload },
    update: payload,
  });
}
