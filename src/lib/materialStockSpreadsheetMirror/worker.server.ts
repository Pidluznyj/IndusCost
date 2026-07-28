/**
 * Worker da outbox — entrega assíncrona; falha não mexe no Material oficial.
 */
import { computeMaterialStockSpreadsheetMirrorAvailableAt } from "./queueRules.js";
import type {
  MaterialStockSpreadsheetOutboxRepository,
  MaterialStockSpreadsheetOutboxRow,
} from "./repository.server.js";
import type { MaterialStockSpreadsheetMirrorConfig } from "./config.js";
import {
  deliverMaterialStockSpreadsheetMirrorWebhook,
  type MirrorWebhookFetch,
} from "./webhookClient.server.js";
import type { MaterialStockSpreadsheetMirrorPayload } from "./types.js";

export type MaterialStockSpreadsheetMirrorWorkerResult = {
  processed: number;
  synced: number;
  retried: number;
  errored: number;
  jobs: MaterialStockSpreadsheetOutboxRow[];
};

function parsePayload(
  raw: unknown
): MaterialStockSpreadsheetMirrorPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.materialId !== "string" || typeof p.code !== "string") {
    return null;
  }
  if (p.operation !== "UPSERT") return null;
  return raw as MaterialStockSpreadsheetMirrorPayload;
}

export async function runMaterialStockSpreadsheetMirrorWorker(input: {
  repository: MaterialStockSpreadsheetOutboxRepository;
  workerId: string;
  now?: () => Date;
  maxJobs?: number;
  fetchImpl?: MirrorWebhookFetch;
  config?: MaterialStockSpreadsheetMirrorConfig;
}): Promise<MaterialStockSpreadsheetMirrorWorkerResult> {
  const nowFn = input.now ?? (() => new Date());
  const maxJobs = Math.max(1, input.maxJobs ?? 1);
  const result: MaterialStockSpreadsheetMirrorWorkerResult = {
    processed: 0,
    synced: 0,
    retried: 0,
    errored: 0,
    jobs: [],
  };

  for (let i = 0; i < maxJobs; i += 1) {
    const now = nowFn();
    const claimed = await input.repository.claimNext(input.workerId, now);
    if (!claimed) break;
    if (!claimed.lockToken) {
      throw new Error(`Outbox ${claimed.id} claim sem lockToken`);
    }

    result.processed += 1;
    const payload = parsePayload(claimed.payloadJson);
    if (!payload) {
      const failNow = nowFn();
      const dead = await input.repository.markError(
        claimed.id,
        claimed.lockToken,
        {
          attempts: claimed.attempts,
          completedAt: failNow,
          lastAttemptAt: failNow,
          error: {
            code: "INVALID_PAYLOAD",
            message: "Payload da outbox inválido.",
          },
        }
      );
      result.errored += 1;
      result.jobs.push(dead);
      continue;
    }

    try {
      const delivery = await deliverMaterialStockSpreadsheetMirrorWebhook(
        payload,
        { fetchImpl: input.fetchImpl, config: input.config }
      );
      const failNow = nowFn();
      if (delivery.ok === true) {
        const done = await input.repository.markSynced(
          claimed.id,
          claimed.lockToken,
          failNow
        );
        result.synced += 1;
        result.jobs.push(done);
        continue;
      }

      const exhausted =
        delivery.retryable === false ||
        claimed.attempts >= claimed.maxAttempts;
      if (exhausted) {
        const dead = await input.repository.markError(
          claimed.id,
          claimed.lockToken,
          {
            attempts: claimed.attempts,
            completedAt: failNow,
            lastAttemptAt: failNow,
            error: { code: delivery.code, message: delivery.message },
          }
        );
        result.errored += 1;
        result.jobs.push(dead);
      } else {
        const retried = await input.repository.markRetry(
          claimed.id,
          claimed.lockToken,
          {
            attempts: claimed.attempts,
            availableAt: computeMaterialStockSpreadsheetMirrorAvailableAt(
              failNow,
              claimed.attempts
            ),
            lastAttemptAt: failNow,
            error: { code: delivery.code, message: delivery.message },
          }
        );
        result.retried += 1;
        result.jobs.push(retried);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro desconhecido no worker";
      const failNow = nowFn();
      if (claimed.attempts >= claimed.maxAttempts) {
        const dead = await input.repository.markError(
          claimed.id,
          claimed.lockToken,
          {
            attempts: claimed.attempts,
            completedAt: failNow,
            lastAttemptAt: failNow,
            error: { code: "WORKER_CRASH", message: message.slice(0, 500) },
          }
        );
        result.errored += 1;
        result.jobs.push(dead);
      } else {
        const retried = await input.repository.markRetry(
          claimed.id,
          claimed.lockToken,
          {
            attempts: claimed.attempts,
            availableAt: computeMaterialStockSpreadsheetMirrorAvailableAt(
              failNow,
              claimed.attempts
            ),
            lastAttemptAt: failNow,
            error: { code: "WORKER_CRASH", message: message.slice(0, 500) },
          }
        );
        result.retried += 1;
        result.jobs.push(retried);
      }
    }
  }

  return result;
}
