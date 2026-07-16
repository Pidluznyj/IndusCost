/**
 * Service de persistência idempotente do cabeçalho de OP Nomus (OP-05).
 * Fluxo: validar → mapear → localizar por externalId → hash → create/update/unchanged.
 * Lote: transação pequena por OP; falha isolada não corrompe as demais.
 * Não persiste itensPedido / salesLinks.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  mapNomusProductionOrderHeader,
  type MapProductionOrderFieldError,
} from "@/src/lib/nomusProductionOrdersMapper.js";
import { upsertNomusProductionOrderHeader } from "@/src/lib/nomusProductionOrdersRepository.server.js";

export type PersistNomusProductionOrderOutcome =
  | "created"
  | "updated"
  | "unchanged"
  | "invalid"
  | "error";

export type PersistNomusProductionOrderResult = {
  outcome: PersistNomusProductionOrderOutcome;
  externalId: number | null;
  productionOrderId: string | null;
  payloadHash: string | null;
  reasons: string[];
  fieldErrors: MapProductionOrderFieldError[];
  error: string | null;
};

export type PersistNomusProductionOrdersBatchSummary = {
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  error: number;
};

export type PersistNomusProductionOrdersBatchResult = {
  results: PersistNomusProductionOrderResult[];
  summary: PersistNomusProductionOrdersBatchSummary;
};

type DbWithOptionalTransaction = PrismaClient | Prisma.TransactionClient;

function emptyResult(
  partial: Partial<PersistNomusProductionOrderResult> &
    Pick<PersistNomusProductionOrderResult, "outcome">
): PersistNomusProductionOrderResult {
  return {
    outcome: partial.outcome,
    externalId: partial.externalId ?? null,
    productionOrderId: partial.productionOrderId ?? null,
    payloadHash: partial.payloadHash ?? null,
    reasons: partial.reasons ?? [],
    fieldErrors: partial.fieldErrors ?? [],
    error: partial.error ?? null,
  };
}

function outcomeFromHeaderAction(
  action: "create" | "update" | "unchanged"
): PersistNomusProductionOrderOutcome {
  if (action === "create") return "created";
  if (action === "update") return "updated";
  return "unchanged";
}

async function runInSmallTransaction<T>(
  db: DbWithOptionalTransaction,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const asClient = db as PrismaClient;
  if (typeof asClient.$transaction === "function") {
    return asClient.$transaction(async (tx) => fn(tx));
  }
  return fn(db as Prisma.TransactionClient);
}

/**
 * Persiste uma OP (somente cabeçalho) a partir do payload Nomus validável.
 */
export async function persistNomusProductionOrder(
  db: DbWithOptionalTransaction,
  raw: unknown,
  options?: { syncedAt?: Date; useTransaction?: boolean }
): Promise<PersistNomusProductionOrderResult> {
  const syncedAt = options?.syncedAt ?? new Date();
  const mapped = mapNomusProductionOrderHeader(raw);

  if (!mapped.ok) {
    return emptyResult({
      outcome: "invalid",
      externalId: mapped.externalId,
      reasons: mapped.reasons,
    });
  }

  const write = async (tx: Prisma.TransactionClient) => {
    const header = await upsertNomusProductionOrderHeader(tx, mapped.row, syncedAt);
    return emptyResult({
      outcome: outcomeFromHeaderAction(header.action),
      externalId: mapped.row.externalId,
      productionOrderId: header.productionOrderId,
      payloadHash: mapped.row.payloadHash,
      fieldErrors: mapped.fieldErrors,
    });
  };

  try {
    if (options?.useTransaction === false) {
      return await write(db as Prisma.TransactionClient);
    }
    return await runInSmallTransaction(db, write);
  } catch (error) {
    return emptyResult({
      outcome: "error",
      externalId: mapped.row.externalId,
      payloadHash: mapped.row.payloadHash,
      fieldErrors: mapped.fieldErrors,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Persiste um lote de OPs com isolamento por item (transação pequena cada).
 * Falha / invalid de uma não impede as demais.
 */
export async function persistNomusProductionOrdersBatch(
  db: DbWithOptionalTransaction,
  payloads: unknown[],
  options?: { syncedAt?: Date }
): Promise<PersistNomusProductionOrdersBatchResult> {
  const syncedAt = options?.syncedAt ?? new Date();
  const results: PersistNomusProductionOrderResult[] = [];
  const summary: PersistNomusProductionOrdersBatchSummary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    error: 0,
  };

  for (const raw of payloads) {
    const result = await persistNomusProductionOrder(db, raw, {
      syncedAt,
      useTransaction: true,
    });
    results.push(result);
    summary[result.outcome] += 1;
  }

  return { results, summary };
}
