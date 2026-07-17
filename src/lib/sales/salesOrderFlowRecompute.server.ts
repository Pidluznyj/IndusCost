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
import {
  buildSalesOrderFlowRecomputeFailureObservability,
  buildSalesOrderFlowRecomputeObservability,
  formatSalesOrderFlowRecomputeObservabilityLog,
  type SalesOrderFlowRecomputeObservabilityLog,
  type SalesOrderFlowRecomputeSource,
} from "./salesOrderFlowObservability.js";

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
  /** Preview: calcula e planeja sem persistir snapshots/eventos. */
  dryRun?: boolean;
  /** Origem da recomputação (observabilidade OP-74). */
  source?: SalesOrderFlowRecomputeSource;
  /** Quando false, não emite log estruturado (útil em testes ruidosos). Default true. */
  emitObservabilityLog?: boolean;
};

export type RecomputeSalesOrderFlowResult = {
  salesOrderId: string;
  orderCode: string | null;
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
  /** Métricas/log sanitizado do pedido (OP-74). */
  observability: SalesOrderFlowRecomputeObservabilityLog;
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
  const startedAt = now();
  const source = options.source ?? "unknown";
  const emitLog = options.emitObservabilityLog !== false;
  let orderCode: string | null = null;

  try {
    const computedAt = startedAt;

    const pack =
      options.evidencePack !== undefined
        ? options.evidencePack
        : await loadSalesOrderFlowEvidence(
            db,
            salesOrderId,
            options.evidenceOptions
          );

    if (!pack) {
      throw new SalesOrderFlowOrderNotFoundError(salesOrderId);
    }
    orderCode = pack.order.orderCode?.trim() || null;

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
      fulfillmentClassification: r.fulfillmentClassification,
      cutQuantity: r.cutQuantity,
      canceledQuantity: r.canceledQuantity,
      inconsistenciesJson: r.inconsistenciesJson,
    }));

    const existingOrder = existingOrderRow
      ? {
          currentStage: existingOrderRow.currentStage,
          fingerprint: existingOrderRow.fingerprint,
          inconsistenciesJson: existingOrderRow.inconsistenciesJson,
        }
      : null;

    const itemOccurredAt = new Map<string, Date | null>();
    for (const item of pack.items) {
      const docs = pack.allocations
        .filter(
          (a) =>
            a.salesOrderItemId === item.id && a.stockDocumentExternalId != null
        )
        .map((a) =>
          pack.stockDocuments.find(
            (d) => d.externalId === a.stockDocumentExternalId
          )
        )
        .filter((d): d is NonNullable<typeof d> => d != null);
      let best: Date | null = null;
      for (const doc of docs) {
        if (doc.dataDocumento == null) continue;
        const d =
          doc.dataDocumento instanceof Date
            ? doc.dataDocumento
            : new Date(doc.dataDocumento);
        if (Number.isNaN(d.getTime())) continue;
        if (!best || d.getTime() < best.getTime()) best = d;
      }
      itemOccurredAt.set(item.id, best);
    }

    const orderOccurredAt =
      orderResult.completedAt != null
        ? new Date(orderResult.completedAt)
        : pack.order.issueDate != null
          ? new Date(pack.order.issueDate)
          : null;

    const draft = buildSalesOrderFlowRecomputeDraft({
      salesOrderId,
      itemResults,
      orderResult,
      existingItems,
      existingOrder,
      computedAt,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      evidenceTimes: {
        itemOccurredAt,
        orderOccurredAt:
          orderOccurredAt && !Number.isNaN(orderOccurredAt.getTime())
            ? orderOccurredAt
            : null,
      },
    });

    const plan = planSalesOrderFlowRecompute({
      draft,
      existingOrder,
      existingItems,
    });

    const inconsistencies =
      orderResult.inconsistencies.length +
      itemResults.reduce((sum, item) => sum + item.inconsistencies.length, 0);

    const baseResult = {
      salesOrderId,
      orderCode,
      computationVersion: draft.computationVersion,
      orderFingerprint: draft.orderFingerprint,
      previousOrderStage: existingOrderRow?.currentStage ?? null,
      currentOrderStage: draft.orderWrite.currentStage,
    };

    const finish = (
      result: Omit<RecomputeSalesOrderFlowResult, "observability">
    ): RecomputeSalesOrderFlowResult => {
      const durationMs = now().getTime() - startedAt.getTime();
      const observability = buildSalesOrderFlowRecomputeObservability({
        salesOrderId: result.salesOrderId,
        orderCode: result.orderCode,
        previousStage: result.previousOrderStage,
        currentStage: result.currentOrderStage,
        reason: result.reason,
        computationVersion: result.computationVersion,
        orderFingerprint: result.orderFingerprint,
        action: result.action,
        source,
        durationMs,
        itemsEvaluated: result.items.total,
        itemsCreated: result.items.created,
        itemsUpdated: result.items.updated,
        eventsCreated: result.events.created,
        inconsistencies,
      });
      if (emitLog) {
        console.info(formatSalesOrderFlowRecomputeObservabilityLog(observability));
      }
      return { ...result, observability };
    };

    if (plan.action === "unchanged") {
      return finish({
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
      });
    }

    if (options.dryRun) {
      return finish({
        ...baseResult,
        action: plan.reason === "first_run" ? "created" : "updated",
        reason: plan.reason,
        computedAt: null,
        items: {
          total: draft.itemWrites.length,
          upserted: draft.itemWrites.length,
          created: existingItemRows.length === 0 ? draft.itemWrites.length : 0,
          updated: existingItemRows.length === 0 ? 0 : draft.itemWrites.length,
          deleted: 0,
        },
        events: {
          attempted: plan.draft.events.length,
          created: plan.draft.events.length,
          duplicates: 0,
        },
        skippedWrite: true,
      });
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

    const created = persistResult.replace.upserted.filter(
      (u) => u.action === "create"
    ).length;
    const updated = persistResult.replace.upserted.filter(
      (u) => u.action === "update"
    ).length;

    return finish({
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
    });
  } catch (error) {
    const durationMs = now().getTime() - startedAt.getTime();
    const failureLog = buildSalesOrderFlowRecomputeFailureObservability({
      salesOrderId,
      orderCode,
      source,
      durationMs,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      error,
    });
    if (emitLog) {
      console.warn(formatSalesOrderFlowRecomputeObservabilityLog(failureLog));
    }
    throw error;
  }
}
