/**
 * OP-54 — Recomputação transacional do Fluxo de Pedidos.
 *
 * Fluxo:
 * 1) carregar evidências (fora da tx; sem Nomus HTTP)
 * 2) calcular itens (OP-50) + pedido (OP-51)
 * 3) fingerprint + comparar snapshot atual
 * 4) se mudou: persistir itens + pedido + eventos em uma tx curta
 *
 * Idempotente: fingerprint igual → sem escrita (computedAt preservado).
 */

import type { PrismaClient } from "@prisma/client";
import {
  loadSalesOrderFlowEvidence,
  type LoadSalesOrderFlowEvidenceBatchOptions,
  type SalesOrderFlowEvidencePrisma,
} from "./salesOrderFlowEvidence.server.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import {
  buildSalesOrderFlowRecomputeDraft,
  planSalesOrderFlowRecompute,
} from "./salesOrderFlowRecompute.js";
import {
  appendSalesOrderFlowEvent,
  findSalesOrderFlowSnapshotByOrderId,
  findSalesOrderItemFlowSnapshotsByOrderId,
  replaceSalesOrderItemFlowSnapshotsForOrder,
  upsertSalesOrderFlowSnapshot,
  type SalesOrderFlowRepositoryDb,
} from "./salesOrderFlowRepository.server.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowFingerprint.js";

export class SalesOrderFlowOrderNotFoundError extends Error {
  constructor(public readonly salesOrderId: string) {
    super(`Pedido de venda não encontrado para recomputação de fluxo: ${salesOrderId}`);
    this.name = "SalesOrderFlowOrderNotFoundError";
  }
}

export type SalesOrderFlowRecomputeDb = SalesOrderFlowEvidencePrisma &
  SalesOrderFlowRepositoryDb &
  Pick<PrismaClient, "$transaction" | "salesOrderItem">;

export type RecomputeSalesOrderFlowOptions = {
  referenceDate?: Date | string | null;
  now?: () => Date;
  evidenceOptions?: LoadSalesOrderFlowEvidenceBatchOptions;
  /**
   * Injeção para testes — bypass do loader OP-49.
   * Quando informado, `db` só precisa cobrir repository + $transaction.
   */
  evidencePack?: Awaited<ReturnType<typeof loadSalesOrderFlowEvidence>>;
  itemFinancials?: readonly { salesOrderItemId: string; plannedNetValue: unknown }[];
};

export type RecomputeSalesOrderFlowResult = {
  salesOrderId: string;
  action: "unchanged" | "created" | "updated";
  reason: "fingerprint_match" | "first_run" | "fingerprint_changed";
  computationVersion: string;
  orderFingerprint: string;
  previousOrderStage: string | null;
  currentOrderStage: string;
  /** Só preenchido quando houve escrita. */
  computedAt: string | null;
  items: {
    total: number;
    upserted: number;
    created: number;
    updated: number;
    deleted: number;
  };
  events: {
    attempted: number;
    created: number;
    duplicates: number;
  };
  skippedWrite: boolean;
};

async function loadItemFinancials(
  db: Pick<PrismaClient, "salesOrderItem">,
  salesOrderId: string
): Promise<{ salesOrderItemId: string; plannedNetValue: unknown }[]> {
  const rows = await db.salesOrderItem.findMany({
    where: { salesOrderId },
    select: { id: true, totalNetValue: true },
  });
  return rows.map((r) => ({
    salesOrderItemId: r.id,
    plannedNetValue: r.totalNetValue ?? 0,
  }));
}

/**
 * Recomputa e materializa o fluxo de um pedido.
 * Leituras/cálculo fora da transação; escrita atômica só se fingerprint mudou.
 */
export async function recomputeSalesOrderFlow(
  db: SalesOrderFlowRecomputeDb,
  salesOrderId: string,
  options: RecomputeSalesOrderFlowOptions = {}
): Promise<RecomputeSalesOrderFlowResult> {
  const now = options.now ?? (() => new Date());
  const computedAt = now();

  const pack =
    options.evidencePack !== undefined
      ? options.evidencePack
      : await loadSalesOrderFlowEvidence(db, salesOrderId, options.evidenceOptions);

  if (!pack) {
    throw new SalesOrderFlowOrderNotFoundError(salesOrderId);
  }

  const itemResults = pack.items
    .map((item) =>
      resolveSalesOrderItemFlowFromEvidence(pack, item.id, {
        referenceDate: options.referenceDate ?? pack.meta.loadedAt,
      })
    )
    .filter((r): r is NonNullable<typeof r> => r != null);

  const itemFinancials =
    options.itemFinancials ?? (await loadItemFinancials(db, salesOrderId));

  const orderResult = resolveSalesOrderFlow(itemResults, {
    salesOrderId,
    orderStatus: pack.order.status,
    promisedDeliveryAt: pack.order.expectedDeliveryDate,
    referenceDate: options.referenceDate ?? pack.meta.loadedAt,
    itemFinancials,
  });

  const [existingOrderRow, existingItemRows] = await Promise.all([
    findSalesOrderFlowSnapshotByOrderId(db, salesOrderId),
    findSalesOrderItemFlowSnapshotsByOrderId(db, salesOrderId),
  ]);

  const existingItems = existingItemRows.map((r) => ({
    salesOrderItemId: r.salesOrderItemId,
    currentStage: r.currentStage,
    fingerprint: r.fingerprint,
    stageEnteredAt: r.stageEnteredAt,
  }));

  const draft = buildSalesOrderFlowRecomputeDraft({
    salesOrderId,
    itemResults,
    orderResult,
    existingItems,
    computedAt,
    computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
  });

  const plan = planSalesOrderFlowRecompute({
    draft,
    existingOrder: existingOrderRow
      ? {
          currentStage: existingOrderRow.currentStage,
          fingerprint: existingOrderRow.fingerprint,
        }
      : null,
    existingItems,
  });

  const baseResult = {
    salesOrderId,
    computationVersion: draft.computationVersion,
    orderFingerprint: draft.orderFingerprint,
    previousOrderStage: existingOrderRow?.currentStage ?? null,
    currentOrderStage: draft.orderWrite.currentStage,
  };

  if (plan.action === "unchanged") {
    return {
      ...baseResult,
      action: "unchanged",
      reason: "fingerprint_match",
      computedAt: null,
      items: {
        total: draft.itemWrites.length,
        upserted: 0,
        created: 0,
        updated: 0,
        deleted: 0,
      },
      events: { attempted: 0, created: 0, duplicates: 0 },
      skippedWrite: true,
    };
  }

  const persistResult = await db.$transaction(async (tx) => {
    const replace = await replaceSalesOrderItemFlowSnapshotsForOrder(
      tx,
      salesOrderId,
      plan.draft.itemWrites
    );
    await upsertSalesOrderFlowSnapshot(tx, plan.draft.orderWrite);

    let eventsCreated = 0;
    let eventsDuplicates = 0;
    for (const event of plan.draft.events) {
      const appended = await appendSalesOrderFlowEvent(tx, event);
      if (appended.action === "created") eventsCreated += 1;
      else eventsDuplicates += 1;
    }

    return {
      replace,
      eventsCreated,
      eventsDuplicates,
      eventsAttempted: plan.draft.events.length,
    };
  });

  const created = persistResult.replace.upserted.filter((u) => u.action === "create").length;
  const updated = persistResult.replace.upserted.filter((u) => u.action === "update").length;

  return {
    ...baseResult,
    action: plan.reason === "first_run" ? "created" : "updated",
    reason: plan.reason,
    computedAt: computedAt.toISOString(),
    items: {
      total: draft.itemWrites.length,
      upserted: persistResult.replace.upserted.length,
      created,
      updated,
      deleted: persistResult.replace.deleted,
    },
    events: {
      attempted: persistResult.eventsAttempted,
      created: persistResult.eventsCreated,
      duplicates: persistResult.eventsDuplicates,
    },
    skippedWrite: false,
  };
}
