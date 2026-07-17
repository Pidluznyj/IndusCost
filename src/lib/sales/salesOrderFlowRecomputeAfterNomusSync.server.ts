/**
 * OP-57 — Recomputação incremental do Fluxo de Pedidos após sync oficial.
 *
 * - Soft-fail: nunca derruba o sync chamador
 * - Sem lock de rebuild completo
 * - Sem Nomus HTTP
 * - Dedupe de orderIds na execução
 * - Falhas por pedido registradas para reprocessamento
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveSalesOrderIdsFromNfeExternalIds } from "@/src/lib/commissions/commissionMaterializationOrchestrator.server.js";
import {
  recomputeSalesOrderFlow,
  type RecomputeSalesOrderFlowResult,
  type SalesOrderFlowRecomputeDb,
} from "./salesOrderFlowRecompute.server.js";
import { loadSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.server.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import {
  buildSalesOrderFlowRecomputeAfterSyncTrigger,
  emptySalesOrderFlowRecomputeAfterSyncSummary,
  formatSalesOrderFlowRecomputeAfterSyncLog,
  hasSalesOrderFlowRecomputeTriggerTargets,
  isSalesOrderFlowRecomputeAfterSyncEnabled,
  mergeSalesOrderFlowOrderIdBatches,
  type SalesOrderFlowRecomputeAfterSyncResult,
  type SalesOrderFlowRecomputeAfterSyncTrigger,
} from "./salesOrderFlowRecomputeAfterNomusSync.js";
import type { SalesOrderFlowRecomputeObservabilityLog } from "./salesOrderFlowObservability.js";

export type SalesOrderFlowRecomputeAfterSyncDb = SalesOrderFlowRecomputeDb &
  Pick<
    PrismaClient,
    | "salesOrderNfeLink"
    | "nomusProductionOrderSalesLink"
    | "nomusStockDocument"
    | "orderToCashAuditFact"
    | "integrationRun"
  >;

export type SalesOrderFlowRecomputeAfterSyncDeps = {
  recompute: (
    db: SalesOrderFlowRecomputeDb,
    salesOrderId: string,
    options?: {
      source?: "post-sync";
      evidencePack?: SalesOrderFlowEvidencePack | null;
    }
  ) => Promise<RecomputeSalesOrderFlowResult>;
  loadEvidenceBatch: typeof loadSalesOrderFlowEvidenceBatch;
  resolveOrderIds: (
    db: SalesOrderFlowRecomputeAfterSyncDb,
    trigger: SalesOrderFlowRecomputeAfterSyncTrigger
  ) => Promise<string[]>;
  persistAudit: (
    db: SalesOrderFlowRecomputeAfterSyncDb,
    input: {
      trigger: SalesOrderFlowRecomputeAfterSyncTrigger;
      result: SalesOrderFlowRecomputeAfterSyncResult;
      startedAt: Date;
      finishedAt: Date;
    }
  ) => Promise<void>;
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

export async function resolveSalesOrderIdsFromProductionOrderExternalIds(
  db: Pick<PrismaClient, "nomusProductionOrderSalesLink">,
  productionOrderExternalIds: readonly number[]
): Promise<string[]> {
  const unique = [
    ...new Set(
      productionOrderExternalIds.filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (unique.length === 0) return [];
  const links = await db.nomusProductionOrderSalesLink.findMany({
    where: {
      productionOrderExternalId: { in: unique },
      salesOrderId: { not: null },
    },
    select: { salesOrderId: true },
  });
  return mergeSalesOrderFlowOrderIdBatches(
    links
      .map((l) => l.salesOrderId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
}

export async function resolveSalesOrderIdsFromStockDocumentExternalIds(
  db: Pick<PrismaClient, "nomusStockDocument" | "salesOrderNfeLink" | "orderToCashAuditFact">,
  stockDocumentExternalIds: readonly number[]
): Promise<string[]> {
  const unique = [
    ...new Set(
      stockDocumentExternalIds.filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (unique.length === 0) return [];

  const docs = await db.nomusStockDocument.findMany({
    where: { externalId: { in: unique } },
    select: { externalId: true, idNfe: true },
  });
  const nfeIds = docs
    .map((d) => d.idNfe)
    .filter((id): id is number => id != null && Number.isFinite(id) && id > 0);

  const fromNfe = await resolveSalesOrderIdsFromNfeExternalIds(db, nfeIds);
  const fromNfeIds = fromNfe.map((r) => r.salesOrderId);

  const facts = await db.orderToCashAuditFact.findMany({
    where: { stockDocumentExternalId: { in: unique } },
    select: { salesOrderId: true },
  });
  const fromFacts = facts
    .map((f) => f.salesOrderId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return mergeSalesOrderFlowOrderIdBatches(fromNfeIds, fromFacts);
}

export async function resolveSalesOrderFlowAffectedOrderIds(
  db: SalesOrderFlowRecomputeAfterSyncDb,
  trigger: SalesOrderFlowRecomputeAfterSyncTrigger
): Promise<string[]> {
  const fromNfe = trigger.nfeIds?.length
    ? (await resolveSalesOrderIdsFromNfeExternalIds(db, trigger.nfeIds)).map(
        (r) => r.salesOrderId
      )
    : [];
  const fromOp = trigger.productionOrderExternalIds?.length
    ? await resolveSalesOrderIdsFromProductionOrderExternalIds(
        db,
        trigger.productionOrderExternalIds
      )
    : [];
  const fromStock = trigger.stockDocumentExternalIds?.length
    ? await resolveSalesOrderIdsFromStockDocumentExternalIds(
        db,
        trigger.stockDocumentExternalIds
      )
    : [];

  return mergeSalesOrderFlowOrderIdBatches(
    trigger.salesOrderIds,
    fromNfe,
    fromOp,
    fromStock
  );
}

async function persistAuditBestEffort(
  db: SalesOrderFlowRecomputeAfterSyncDb,
  input: {
    trigger: SalesOrderFlowRecomputeAfterSyncTrigger;
    result: SalesOrderFlowRecomputeAfterSyncResult;
    startedAt: Date;
    finishedAt: Date;
  }
): Promise<void> {
  try {
    const status = input.result.error
      ? "FAILED"
      : input.result.skipped
        ? "SKIPPED"
        : input.result.summary && input.result.summary.errors > 0
          ? "PARTIAL"
          : "SUCCESS";

    const data: Prisma.IntegrationRunUncheckedCreateInput = {
      sourceSystem: "INDUSCOST",
      target: `sales-order-flow-recompute:${input.trigger.source}`,
      kind: "post-sync",
      mode: input.trigger.syncMode,
      status,
      success: status === "SUCCESS" || status === "SKIPPED",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      summaryJson: {
        trigger: input.trigger,
        summary: input.result.summary ?? null,
        skipped: input.result.skipped,
        skipReason: input.result.skipReason ?? null,
        failures: input.result.summary?.failures ?? [],
      },
      errorMessage: input.result.error ?? input.result.skipReason ?? null,
    };

    await db.integrationRun.create({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[sales-order-flow-recompute-after-sync] falha ao registrar auditoria: ${message}`
    );
  }
}

const defaultDeps: SalesOrderFlowRecomputeAfterSyncDeps = {
  recompute: (db, salesOrderId, options) =>
    recomputeSalesOrderFlow(db, salesOrderId, {
      source: "post-sync",
      ...options,
    }),
  loadEvidenceBatch: loadSalesOrderFlowEvidenceBatch,
  resolveOrderIds: resolveSalesOrderFlowAffectedOrderIds,
  persistAudit: persistAuditBestEffort,
};

/**
 * Recomputa pedidos afetados após sync. Soft-fail total (nunca propaga).
 */
export async function runSalesOrderFlowRecomputeAfterNomusSync(
  db: SalesOrderFlowRecomputeAfterSyncDb,
  trigger: SalesOrderFlowRecomputeAfterSyncTrigger,
  deps: Partial<SalesOrderFlowRecomputeAfterSyncDeps> = {}
): Promise<SalesOrderFlowRecomputeAfterSyncResult> {
  const resolved: SalesOrderFlowRecomputeAfterSyncDeps = {
    ...defaultDeps,
    ...deps,
  };
  const env = resolved.env ?? process.env;
  const nowFn = resolved.now ?? (() => new Date());
  const startedAt = nowFn();

  if (!isSalesOrderFlowRecomputeAfterSyncEnabled(env)) {
    const result: SalesOrderFlowRecomputeAfterSyncResult = {
      enabled: false,
      skipped: true,
      skipReason: "flag_disabled",
    };
    console.warn(formatSalesOrderFlowRecomputeAfterSyncLog(result, trigger));
    return result;
  }

  if (trigger.syncMode !== "apply") {
    const result: SalesOrderFlowRecomputeAfterSyncResult = {
      enabled: true,
      skipped: true,
      skipReason: "not_apply_mode",
    };
    console.warn(formatSalesOrderFlowRecomputeAfterSyncLog(result, trigger));
    return result;
  }

  if (!hasSalesOrderFlowRecomputeTriggerTargets(trigger)) {
    const result: SalesOrderFlowRecomputeAfterSyncResult = {
      enabled: true,
      skipped: true,
      skipReason: "no_affected_targets",
    };
    console.warn(formatSalesOrderFlowRecomputeAfterSyncLog(result, trigger));
    return result;
  }

  try {
    const orderIds = await resolved.resolveOrderIds(db, trigger);
    const summary = emptySalesOrderFlowRecomputeAfterSyncSummary();
    summary.ordersSelected = orderIds.length;

    if (orderIds.length === 0) {
      const result: SalesOrderFlowRecomputeAfterSyncResult = {
        enabled: true,
        skipped: true,
        skipReason: "no_resolved_orders",
        summary,
      };
      console.warn(formatSalesOrderFlowRecomputeAfterSyncLog(result, trigger));
      await resolved.persistAudit(db, {
        trigger,
        result,
        startedAt,
        finishedAt: nowFn(),
      });
      return result;
    }

    // OP-75: uma carga de evidências para todos os IDs resolvidos (evita N× pipeline).
    let evidenceBatchLoaded = false;
    let evidenceByOrderId = new Map<string, SalesOrderFlowEvidencePack>();
    try {
      evidenceByOrderId = await resolved.loadEvidenceBatch(db, orderIds);
      evidenceBatchLoaded = true;
    } catch {
      evidenceBatchLoaded = false;
    }

    const observabilityLogs: SalesOrderFlowRecomputeObservabilityLog[] = [];
    for (const salesOrderId of orderIds) {
      try {
        const pack = evidenceByOrderId.get(salesOrderId);
        const outcome = await resolved.recompute(db, salesOrderId, {
          ...(evidenceBatchLoaded
            ? { evidencePack: pack ?? null }
            : {}),
        });
        summary.ordersProcessed += 1;
        if (outcome.action === "created") summary.created += 1;
        else if (outcome.action === "updated") summary.updated += 1;
        else summary.unchanged += 1;
        if (outcome.observability) {
          observabilityLogs.push(outcome.observability);
        }
      } catch (error) {
        summary.errors += 1;
        summary.failures.push({
          salesOrderId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    summary.durationMs = nowFn().getTime() - startedAt.getTime();
    summary.observability = {
      ordersEvaluated: observabilityLogs.length + summary.errors,
      itemsEvaluated: observabilityLogs.reduce(
        (sum, log) => sum + log.metrics.itemsEvaluated,
        0
      ),
      snapshotsCreated: observabilityLogs.reduce(
        (sum, log) => sum + log.metrics.snapshotsCreated,
        0
      ),
      snapshotsUpdated: observabilityLogs.reduce(
        (sum, log) => sum + log.metrics.snapshotsUpdated,
        0
      ),
      eventsCreated: observabilityLogs.reduce(
        (sum, log) => sum + log.metrics.eventsCreated,
        0
      ),
      inconsistencies: observabilityLogs.reduce(
        (sum, log) => sum + log.metrics.inconsistencies,
        0
      ),
      computationVersion: observabilityLogs[0]?.computationVersion ?? null,
    };
    const result: SalesOrderFlowRecomputeAfterSyncResult = {
      enabled: true,
      skipped: false,
      summary,
    };
    console.warn(formatSalesOrderFlowRecomputeAfterSyncLog(result, trigger));
    if (summary.failures.length > 0) {
      console.error(
        `[sales-order-flow-recompute-after-sync] falhas para reprocessamento: ${JSON.stringify(summary.failures)}`
      );
    }
    await resolved.persistAudit(db, {
      trigger,
      result,
      startedAt,
      finishedAt: nowFn(),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: SalesOrderFlowRecomputeAfterSyncResult = {
      enabled: true,
      skipped: false,
      error: message,
    };
    console.error(formatSalesOrderFlowRecomputeAfterSyncLog(result, trigger));
    await resolved.persistAudit(db, {
      trigger,
      result,
      startedAt,
      finishedAt: nowFn(),
    });
    return result;
  }
}

export { buildSalesOrderFlowRecomputeAfterSyncTrigger };
