import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  aggregateMonthlyPayableFromReceiptPreview,
  aggregateMonthlyPayableFromLedgerLines,
} from "./commissionReceiptClosing.js";
import {
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
} from "./commissionReceiptClosing.server.js";
import { loadCommissionReceiptPreview } from "./commissionReceiptEngine.server.js";
import {
  aggregateMonthlyPayableFromRows,
  enrichMonthlyPayableSummaryWithReportMeta,
  resolveLegacyPayableDeprecation,
  type CommissionMonthlyPayableQuery,
  type CommissionMonthlyPayableSummary,
} from "./commissionMonthlyPayable.js";
import { listPayableVisualAuditRows } from "./commissionVisualAudit.server.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildReceiptClosedMeta,
  buildReceiptPreviewMeta,
  type CommissionReportSourceMode,
} from "./commissionReportSource.js";

export type { CommissionReportSourceMode };

function toPayableRowsQuery(query: CommissionMonthlyPayableQuery) {
  return {
    year: query.year,
    month: query.month,
    commissionPersonId: query.sellerId ?? null,
    customer: query.customer ?? null,
    orderCode: query.orderCode ?? null,
    nfeNumber: query.nfeNumber ?? null,
    nomusReceivableId: query.nomusReceivableId ?? null,
    receivableTitleStatus: query.receivableTitleStatus ?? null,
    commissionStatus: query.commissionStatus ?? null,
    onlyDivergences: query.onlyDivergences ?? false,
  };
}

async function loadLegacyMonthlyPayableSummary(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope,
  sourceMode: CommissionReportSourceMode
): Promise<CommissionMonthlyPayableSummary> {
  const rows = await listPayableVisualAuditRows(toPayableRowsQuery(query), scope);
  const summary = aggregateMonthlyPayableFromRows(rows, query);
  return resolveLegacyPayableDeprecation(summary, sourceMode);
}

/**
 * Resolve comissão PAYABLE oficial do mês conforme --source:
 * auto: ledger fechado > prévia receipt > legado com aviso
 * receipt: ledger fechado > prévia receipt (nunca legado)
 * legacy: sempre visual audit legado
 */
export async function resolveMonthlyPayableReport(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope,
  sourceMode: CommissionReportSourceMode = "auto"
): Promise<CommissionMonthlyPayableSummary> {
  if (sourceMode === "legacy") {
    return loadLegacyMonthlyPayableSummary(query, scope, sourceMode);
  }

  const closed = await findClosedReceiptClosing(prisma, query.year, query.month);
  if (closed) {
    const lines = await loadReceiptClosingLedgerLines(prisma, closed.closingId);
    const summary = aggregateMonthlyPayableFromLedgerLines(lines, query);
    return enrichMonthlyPayableSummaryWithReportMeta(
      { ...summary, closingId: closed.closingId, calculationHash: closed.calculationHash },
      buildReceiptClosedMeta({
        sourceMode,
        closingId: closed.closingId,
        calculationHash: closed.calculationHash,
      })
    );
  }

  if (sourceMode === "receipt" || sourceMode === "auto") {
    const preview = await loadCommissionReceiptPreview(query);
    const summary = aggregateMonthlyPayableFromReceiptPreview(preview, query);
    return enrichMonthlyPayableSummaryWithReportMeta(
      summary,
      buildReceiptPreviewMeta(sourceMode)
    );
  }

  return loadLegacyMonthlyPayableSummary(query, scope, sourceMode);
}
