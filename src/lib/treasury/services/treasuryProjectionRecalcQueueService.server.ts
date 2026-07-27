/**
 * Enfileiramento + worker da fila PostgreSQL de recálculo de projeção.
 * Sem Redis/RabbitMQ/Kafka no MVP.
 */

import type {
  TreasuryProjectionRecalcEventType,
  TreasuryProjectionScenario,
} from "../contracts/treasuryEnums.js";
import {
  mergeTreasuryProjectionRecalcAfterNomusSyncPayload,
  type TreasuryProjectionRecalcAfterNomusSyncPayload,
} from "../domain/treasuryProjectionRecalcAfterNomusSync.js";
import {
  buildTreasuryProjectionRecalcDeduplicationKey,
  computeTreasuryProjectionRecalcAvailableAt,
  normalizeTreasuryProjectionRecalcSubjectId,
  TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS,
} from "../domain/treasuryProjectionRecalcQueue.js";
import type {
  TreasuryProjectionRecalcJobRepository,
  TreasuryProjectionRecalcJobRow,
} from "../repositories/treasuryProjectionRecalcJobRepository.server.js";

export type EnqueueTreasuryProjectionRecalcInput = {
  companyCode: string;
  scenario: TreasuryProjectionScenario;
  eventType: TreasuryProjectionRecalcEventType;
  subjectId?: string | null;
  payload?: Record<string, unknown> | null;
  requestId?: string | null;
  maxAttempts?: number;
  /** Quando true, antecipa availableAt do job ativo existente. */
  preferSooner?: boolean;
};

export type EnqueueTreasuryProjectionRecalcResult = {
  job: TreasuryProjectionRecalcJobRow;
  deduplicated: boolean;
};

export type TreasuryProjectionRecalcQueueWorkerResult = {
  processed: number;
  succeeded: number;
  retried: number;
  dead: number;
  jobs: TreasuryProjectionRecalcJobRow[];
};

export type TreasuryProjectionRecalcJobHandler = (
  job: TreasuryProjectionRecalcJobRow
) => Promise<void>;

export type TreasuryProjectionRecalcQueueDeps = {
  repository: TreasuryProjectionRecalcJobRepository;
  now?: () => Date;
};

function isAfterNomusSyncPeriodPayload(
  payload: Record<string, unknown>
): boolean {
  return (
    typeof payload.affectedPeriodFrom === "string" &&
    typeof payload.affectedPeriodTo === "string"
  );
}

export async function enqueueTreasuryProjectionRecalc(
  input: EnqueueTreasuryProjectionRecalcInput,
  deps: TreasuryProjectionRecalcQueueDeps
): Promise<EnqueueTreasuryProjectionRecalcResult> {
  const companyCode = input.companyCode.trim();
  if (!companyCode) {
    throw new Error("companyCode é obrigatório para enfileirar recálculo.");
  }
  const now = deps.now?.() ?? new Date();
  const subjectId = normalizeTreasuryProjectionRecalcSubjectId(
    input.eventType,
    input.subjectId
  );
  const deduplicationKey = buildTreasuryProjectionRecalcDeduplicationKey({
    companyCode,
    scenario: input.scenario,
    eventType: input.eventType,
    subjectId,
  });

  const active = await deps.repository.findActiveByDeduplicationKey(
    deduplicationKey
  );
  if (active) {
    const preferSooner = input.preferSooner !== false;
    const nextAvailable =
      preferSooner && active.availableAt.getTime() > now.getTime()
        ? now
        : active.availableAt;
    const payload =
      input.payload === undefined || input.payload === null
        ? active.payloadJson
        : isAfterNomusSyncPeriodPayload(input.payload)
          ? {
              ...mergeTreasuryProjectionRecalcAfterNomusSyncPayload(
                active.payloadJson,
                input.payload as TreasuryProjectionRecalcAfterNomusSyncPayload
              ),
              lastEventType: input.eventType,
              lastEnqueuedAt: now.toISOString(),
            }
          : {
              ...(typeof active.payloadJson === "object" &&
              active.payloadJson !== null
                ? (active.payloadJson as Record<string, unknown>)
                : {}),
              ...input.payload,
              lastEventType: input.eventType,
              lastEnqueuedAt: now.toISOString(),
            };
    const job = await deps.repository.touchPending(active.id, {
      availableAt: nextAvailable,
      payloadJson: payload,
      requestId: input.requestId ?? active.requestId,
      eventType: input.eventType,
    });
    return { job, deduplicated: true };
  }

  const job = await deps.repository.create({
    companyCode,
    scenario: input.scenario,
    eventType: input.eventType,
    deduplicationKey,
    subjectId,
    payloadJson: input.payload ?? null,
    maxAttempts:
      input.maxAttempts ?? TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS,
    availableAt: now,
    requestId: input.requestId ?? null,
  });
  return { job, deduplicated: false };
}

/**
 * Solicita recálculo para os cenários padrão (CONTRACTUAL/PROBABLE/CONFIRMED).
 * MANUAL fica fora do fan-out automático.
 */
export async function enqueueTreasuryProjectionRecalcForDefaultScenarios(
  input: Omit<EnqueueTreasuryProjectionRecalcInput, "scenario">,
  deps: TreasuryProjectionRecalcQueueDeps
): Promise<EnqueueTreasuryProjectionRecalcResult[]> {
  const scenarios: TreasuryProjectionScenario[] = [
    "CONTRACTUAL",
    "PROBABLE",
    "CONFIRMED",
  ];
  const out: EnqueueTreasuryProjectionRecalcResult[] = [];
  for (const scenario of scenarios) {
    out.push(
      await enqueueTreasuryProjectionRecalc({ ...input, scenario }, deps)
    );
  }
  return out;
}

export async function runTreasuryProjectionRecalcWorker(input: {
  repository: TreasuryProjectionRecalcJobRepository;
  workerId: string;
  handler: TreasuryProjectionRecalcJobHandler;
  now?: () => Date;
  maxJobs?: number;
}): Promise<TreasuryProjectionRecalcQueueWorkerResult> {
  const nowFn = input.now ?? (() => new Date());
  const maxJobs = Math.max(1, input.maxJobs ?? 1);
  const result: TreasuryProjectionRecalcQueueWorkerResult = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    jobs: [],
  };

  for (let i = 0; i < maxJobs; i += 1) {
    const now = nowFn();
    const claimed = await input.repository.claimNext(input.workerId, now);
    if (!claimed) break;
    if (!claimed.lockToken) {
      throw new Error(`Job ${claimed.id} claim sem lockToken`);
    }

    result.processed += 1;
    try {
      await input.handler(claimed);
      const done = await input.repository.markSucceeded(
        claimed.id,
        claimed.lockToken,
        nowFn()
      );
      result.succeeded += 1;
      result.jobs.push(done);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro desconhecido no worker";
      const code =
        err instanceof Error && "code" in err && typeof err.code === "string"
          ? err.code
          : "RECALC_HANDLER_FAILED";
      const attempts = claimed.attempts;
      const failNow = nowFn();
      if (attempts >= claimed.maxAttempts) {
        const dead = await input.repository.markDead(
          claimed.id,
          claimed.lockToken,
          {
            attempts,
            completedAt: failNow,
            error: { code, message, detail: { workerId: input.workerId } },
          }
        );
        result.dead += 1;
        result.jobs.push(dead);
      } else {
        const retried = await input.repository.markRetry(
          claimed.id,
          claimed.lockToken,
          {
            attempts,
            availableAt: computeTreasuryProjectionRecalcAvailableAt(
              failNow,
              attempts
            ),
            error: { code, message, detail: { workerId: input.workerId } },
          }
        );
        result.retried += 1;
        result.jobs.push(retried);
      }
    }
  }

  return result;
}

/** Mapeia motivos legados do stub para eventType da fila. */
export function mapTreasuryProjectionRecalcReasonToEventType(
  reason: string
): TreasuryProjectionRecalcEventType {
  const r = reason.toLowerCase();
  if (r.includes("ar_sync") || r.includes("receivable_sync")) return "AR_SYNC";
  if (r.includes("ap_sync") || r.includes("payable_sync")) return "AP_SYNC";
  if (r.includes("settlement") || r.includes("baixa")) return "SETTLEMENT";
  if (r.includes("cancel")) return "CANCELLATION";
  if (r.includes("expectation") || r.includes("expectativa"))
    return "EXPECTATION";
  if (r.includes("promise") || r.includes("promessa")) return "PROMISE";
  if (r.includes("program")) return "PROGRAMMING";
  if (
    r.includes("ledger") ||
    r.includes("lancamento") ||
    r.includes("lançamento")
  )
    return "LEDGER_ENTRY";
  if (r.includes("transfer")) return "TRANSFER";
  if (r.includes("balance") || r.includes("saldo")) return "BALANCE";
  if (r.includes("reconcil")) return "RECONCILIATION";
  if (r.includes("revers")) return "REVERSAL";
  if (r.includes("reopen") || r.includes("reabertura")) return "REOPENING";
  if (r.includes("closing") || r.includes("fechamento")) return "CLOSING";
  return "EXPECTATION";
}
