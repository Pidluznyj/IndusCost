/**
 * Runner Prisma read-only da auditoria de integridade do Fluxo de Pedidos.
 */

import { loadSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.server.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { buildSalesOrderItemFlowAllocationsFromEvidence } from "./salesOrderItemFlowAllocations.js";
import { buildSalesOrderFlowCompletionContextFromPack } from "./salesOrderFlowCompletionDates.js";
import {
  findSalesOrderFlowSnapshotsByOrderIds,
  type SalesOrderFlowRepositoryDb,
} from "./salesOrderFlowRepository.server.js";
import {
  listSalesOrderFlowRebuildCandidates,
  type SalesOrderFlowRebuildListDb,
} from "./salesOrderFlowRebuild.server.js";
import type { SalesOrderFlowEvidencePrisma } from "./salesOrderFlowEvidence.server.js";
import {
  buildSalesOrderFlowIntegritySummary,
  classifySalesOrderFlowIntegrity,
  emptyIntegrityCounts,
  isActionableIntegrityKind,
  type SalesOrderFlowIntegrityCliArgs,
  type SalesOrderFlowIntegrityOrderFinding,
  type SalesOrderFlowIntegrityReport,
} from "./salesOrderFlowIntegrityAudit.js";

export type SalesOrderFlowIntegrityAuditDb = SalesOrderFlowRebuildListDb &
  SalesOrderFlowEvidencePrisma &
  SalesOrderFlowRepositoryDb;

export async function runSalesOrderFlowIntegrityAudit(
  db: SalesOrderFlowIntegrityAuditDb,
  args: SalesOrderFlowIntegrityCliArgs,
  referenceDate: Date = new Date()
): Promise<SalesOrderFlowIntegrityReport> {
  const counts = {
    ...emptyIntegrityCounts(),
    ordersScanned: 0,
    actionable: 0,
  };
  const findings: SalesOrderFlowIntegrityOrderFinding[] = [];

  let cursorAfterId: string | null = null;
  const maxOrders = args.maxOrders ?? Number.POSITIVE_INFINITY;

  while (counts.ordersScanned < maxOrders) {
    const take = Math.min(
      args.batchSize,
      maxOrders - counts.ordersScanned
    );
    if (take <= 0) break;

    const batch = await listSalesOrderFlowRebuildCandidates(
      db,
      {
        mode: "preview",
        orderCode: null,
        fromDate: args.fromDate,
        toDate: args.toDate,
        batchSize: take,
        includeCompleted: args.includeCompleted,
        resumeFrom: null,
        checkpointFile: "",
        lockFile: "",
        maxBatches: null,
      },
      cursorAfterId
    );
    if (batch.length === 0) break;

    const orderIds = batch.map((c) => c.id);
    const [evidenceById, snapshotsById] = await Promise.all([
      loadSalesOrderFlowEvidenceBatch(db, orderIds),
      findSalesOrderFlowSnapshotsByOrderIds(db, orderIds),
    ]);

    for (const candidate of batch) {
      cursorAfterId = candidate.id;
      const pack = evidenceById.get(candidate.id);
      if (!pack) continue;

      const itemResults = pack.items
        .map((item) =>
          resolveSalesOrderItemFlowFromEvidence(pack, item.id, {
            referenceDate: pack.meta.loadedAt,
          })
        )
        .filter((r): r is NonNullable<typeof r> => r != null);

      const persisted = snapshotsById.get(candidate.id) ?? null;
      const completionCtx = buildSalesOrderFlowCompletionContextFromPack(pack, {
        persistedCompletedAt: persisted?.completedAt ?? null,
      });
      const orderResult = resolveSalesOrderFlow(itemResults, {
        salesOrderId: candidate.id,
        orderStatus: pack.order.status,
        promisedDeliveryAt: pack.order.expectedDeliveryDate,
        referenceDate,
        ...completionCtx,
      });

      let commerciallyClosedItemCount = 0;
      let itemsWithNfeCoverage = 0;
      let itemsWithDocumentCoverage = 0;
      let remainingFulfillmentTotal = 0;

      for (const item of pack.items) {
        if (
          item.fulfillment.classification === "FULLY_FULFILLED" ||
          item.fulfillment.classification === "FULFILLED_WITH_CUT"
        ) {
          commerciallyClosedItemCount += 1;
        }
        const alloc = buildSalesOrderItemFlowAllocationsFromEvidence(pack, item);
        if (alloc.nfeAllocations.some((n) => (Number(n.quantity) || 0) > 0)) {
          itemsWithNfeCoverage += 1;
        }
        if (
          alloc.documentAllocations.some((d) => (Number(d.quantity) || 0) > 0)
        ) {
          itemsWithDocumentCoverage += 1;
        }
      }
      for (const r of itemResults) {
        remainingFulfillmentTotal += Number(r.remainingFulfillmentQuantity) || 0;
      }

      const hasValidNfe = pack.nfes.some(
        (n) => n.isValidForBilling && !n.isCanceled
      );
      const hasStockDocumentWithNfe = pack.stockDocuments.some(
        (d) => d.idNfe != null && !d.isCancelled
      );
      const hasO2cAllocation = pack.allocations.length > 0;

      const { kind, detail } = classifySalesOrderFlowIntegrity({
        calculatedStage: orderResult.currentStage,
        persistedStage: persisted?.currentStage ?? null,
        hasValidNfe,
        hasStockDocumentWithNfe,
        hasO2cAllocation,
        commerciallyClosedItemCount,
        itemsWithNfeCoverage,
        itemsWithDocumentCoverage,
        remainingFulfillmentTotal,
      });

      counts[kind] += 1;
      counts.ordersScanned += 1;
      if (isActionableIntegrityKind(kind)) counts.actionable += 1;

      findings.push({
        salesOrderId: candidate.id,
        orderCode: pack.order.orderCode,
        kind,
        calculatedStage: orderResult.currentStage,
        persistedStage: persisted?.currentStage ?? null,
        hasValidNfe,
        hasStockDocumentWithNfe,
        hasO2cAllocation,
        commerciallyClosedItemCount,
        itemsWithNfeCoverage,
        itemsWithDocumentCoverage,
        remainingFulfillmentTotal: remainingFulfillmentTotal.toFixed(2),
        detail,
      });
    }
  }

  return {
    ok: true,
    mode: "READ_ONLY",
    generatedAt: referenceDate.toISOString(),
    guarantees: {
      databaseWrites: false,
      nomusCalls: false,
      passwordExposed: false,
    },
    filters: {
      fromDate: args.fromDate?.toISOString().slice(0, 10) ?? null,
      toDate: args.toDate?.toISOString().slice(0, 10) ?? null,
      batchSize: args.batchSize,
      includeCompleted: args.includeCompleted,
      maxOrders: args.maxOrders,
    },
    counts,
    findings,
    summary: buildSalesOrderFlowIntegritySummary(counts),
  };
}
