/**
 * Disparo de recálculo de projeção da Tesouraria.
 * Stub síncrono (compat) + variante async que persiste na fila PostgreSQL.
 */

import type { TreasuryProjectionScenario } from "../contracts/treasuryEnums.js";
import type { TreasuryProjectionRecalcJobRepository } from "../repositories/treasuryProjectionRecalcJobRepository.server.js";
import {
  enqueueTreasuryProjectionRecalc,
  mapTreasuryProjectionRecalcReasonToEventType,
  type EnqueueTreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalcQueueService.server.js";

export type TreasuryProjectionRecalcRequest = {
  reason: string;
  titleId: string;
  titleType: "RECEIVABLE" | "PAYABLE";
  expectedDate: string | null;
  /** Data da promessa — alimenta camada provável quando o motor estiver ativo. */
  promisedDate?: string | null;
  /** Data programada de pagamento (CP). */
  scheduledDate?: string | null;
  projectionLayer?:
    | "CONTRACTUAL"
    | "PROBABLE"
    | "CONFIRMED"
    | "MANUAL"
    | null;
  requestedAt: Date;
  requestId?: string | null;
  companyCode?: string | null;
};

export type TreasuryProjectionRecalcResult = {
  accepted: boolean;
  deferred: boolean;
  reason: string;
  queue?: EnqueueTreasuryProjectionRecalcResult | null;
};

const recentRequests: TreasuryProjectionRecalcRequest[] = [];

export function listTreasuryProjectionRecalcRequests(): readonly TreasuryProjectionRecalcRequest[] {
  return recentRequests;
}

export function clearTreasuryProjectionRecalcRequests(): void {
  recentRequests.length = 0;
}

/**
 * Aceita o pedido (compat síncrono). Preferir `requestTreasuryProjectionRecalcAsync`
 * ou `enqueueTreasuryProjectionRecalc` para persistir na fila.
 */
export function requestTreasuryProjectionRecalc(
  input: Omit<TreasuryProjectionRecalcRequest, "requestedAt"> & {
    requestedAt?: Date;
  }
): TreasuryProjectionRecalcResult {
  const entry: TreasuryProjectionRecalcRequest = {
    reason: input.reason,
    titleId: input.titleId,
    titleType: input.titleType,
    expectedDate: input.expectedDate,
    promisedDate: input.promisedDate ?? null,
    scheduledDate: input.scheduledDate ?? null,
    projectionLayer: input.projectionLayer ?? null,
    requestId: input.requestId ?? null,
    companyCode: input.companyCode ?? null,
    requestedAt: input.requestedAt ?? new Date(),
  };
  recentRequests.push(entry);
  if (recentRequests.length > 200) recentRequests.shift();
  return {
    accepted: true,
    deferred: true,
    reason:
      "Recálculo de projeção aceito; persistir via fila PostgreSQL (enqueue).",
    queue: null,
  };
}

/**
 * Enfileira na fila persistente (dedupe por chave ativa) e registra o stub.
 */
export async function requestTreasuryProjectionRecalcAsync(
  input: Omit<TreasuryProjectionRecalcRequest, "requestedAt"> & {
    requestedAt?: Date;
    companyCode: string;
    scenario?: TreasuryProjectionScenario;
  },
  repository: TreasuryProjectionRecalcJobRepository,
  now?: () => Date
): Promise<TreasuryProjectionRecalcResult> {
  const entry: TreasuryProjectionRecalcRequest = {
    reason: input.reason,
    titleId: input.titleId,
    titleType: input.titleType,
    expectedDate: input.expectedDate,
    promisedDate: input.promisedDate ?? null,
    scheduledDate: input.scheduledDate ?? null,
    projectionLayer: input.projectionLayer ?? null,
    requestId: input.requestId ?? null,
    companyCode: input.companyCode,
    requestedAt: input.requestedAt ?? new Date(),
  };
  recentRequests.push(entry);
  if (recentRequests.length > 200) recentRequests.shift();

  const queue = await enqueueTreasuryProjectionRecalc(
    {
      companyCode: input.companyCode,
      scenario: input.scenario ?? input.projectionLayer ?? "PROBABLE",
      eventType: mapTreasuryProjectionRecalcReasonToEventType(input.reason),
      subjectId: input.titleId,
      payload: {
        reason: input.reason,
        titleType: input.titleType,
        expectedDate: input.expectedDate,
        promisedDate: input.promisedDate ?? null,
        scheduledDate: input.scheduledDate ?? null,
      },
      requestId: input.requestId ?? null,
    },
    { repository, now }
  );

  return {
    accepted: true,
    deferred: true,
    reason:
      "Recálculo de projeção enfileirado na fila PostgreSQL (worker assíncrono).",
    queue,
  };
}
