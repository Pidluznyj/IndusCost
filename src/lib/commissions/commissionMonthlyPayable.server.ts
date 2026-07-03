import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthlyClosingCards,
  buildMonthlyClosingGroupings,
  buildMonthlyPayableDetailCsv,
  buildMonthlyPayableSellerSummaryCsv,
  type CommissionMonthlyPayableQuery,
  type CommissionMonthlyPayableSummary,
  type MonthlyClosingCards,
  type MonthlyClosingGroupings,
} from "./commissionMonthlyPayable.js";
import {
  buildMonthlyClosingWorkflowMeta,
  formatWorkflowStatusForCsv,
  monthlyClosingWorkflowCsvHeaderSuffix,
  type MonthlyClosingWorkflowMeta,
  type SellerPaymentBatchLink,
} from "./commissionMonthlyClosingWorkflow.js";
import { buildVisualAuditNomusReference, computeVisualAuditCards } from "./commissionVisualAudit.js";
import type { VisualAuditNomusReference } from "./commissionVisualAudit.js";
import { paginatedMeta } from "./commissionQuery.js";
import { listPayableVisualAuditRows } from "./commissionVisualAudit.server.js";
import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber } from "./commission-money.js";

export type { CommissionMonthlyPayableQuery, CommissionMonthlyPayableSummary };
export {
  aggregateMonthlyPayableFromRows,
  buildMonthlyPayableCsv,
  buildMonthlyPayableDetailCsv,
  buildMonthlyPayableSellerSummaryCsv,
  buildMonthKey,
  formatMonthLabelPt,
  mapRowToPayableDetail,
  buildMonthlyClosingCards,
  buildMonthlyClosingGroupings,
} from "./commissionMonthlyPayable.js";

export type CommissionMonthlyClosingPayload = CommissionMonthlyPayableSummary & {
  cards: MonthlyClosingCards;
  nomusReference: VisualAuditNomusReference;
  groupings: MonthlyClosingGroupings;
  detailRows: CommissionMonthlyPayableSummary["details"];
  pagination: ReturnType<typeof paginatedMeta>;
  workflow: MonthlyClosingWorkflowMeta;
};

function monthPeriodBounds(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

async function loadPaymentBatchesBySeller(
  year: number,
  month: number,
  sellerIds: string[]
): Promise<Map<string, SellerPaymentBatchLink[]>> {
  const { from, to } = monthPeriodBounds(year, month);
  const batches = await prisma.commissionPaymentBatch.findMany({
    where: {
      status: { not: "CANCELLED" },
      AND: [{ periodStart: { lte: to } }, { periodEnd: { gte: from } }],
      ...(sellerIds.length > 0 ? { commissionPersonId: { in: sellerIds } } : {}),
    },
    select: {
      id: true,
      commissionPersonId: true,
      status: true,
      totalSelected: true,
      totalPaid: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const map = new Map<string, SellerPaymentBatchLink[]>();
  for (const batch of batches) {
    if (batch.status === "CANCELLED") continue;
    const link: SellerPaymentBatchLink = {
      batchId: batch.id,
      status: batch.status as SellerPaymentBatchLink["status"],
      totalSelected: decimalToNumber(batch.totalSelected),
      totalPaid: decimalToNumber(batch.totalPaid),
    };
    const bucket = map.get(batch.commissionPersonId) ?? [];
    bucket.push(link);
    map.set(batch.commissionPersonId, bucket);
  }
  return map;
}

function countSellerLineAlerts(
  rows: Awaited<ReturnType<typeof loadMonthlyClosingRows>>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.alerts.length === 0) continue;
    counts.set(row.commissionPersonId, (counts.get(row.commissionPersonId) ?? 0) + 1);
  }
  return counts;
}

export function buildMonthlyClosingOfficialSummaryCsv(
  summary: CommissionMonthlyPayableSummary,
  workflow: MonthlyClosingWorkflowMeta
): string {
  const headerLines = [
    `# fechamento_mes=${summary.monthKey}`,
    `# status_geral=${workflow.overallStatusLabel}`,
    `# persistencia_aprovacao=nao`,
    `# total_liberado=${summary.payableCommissionTotal.toFixed(2)}`,
    `# base_rateada=${summary.allocatedBaseAmountTotal.toFixed(2)}`,
    "",
    `vendedor,titulos_recebidos,valor_recebido,base_rateada,comissao_a_pagar,percentual_medio,${monthlyClosingWorkflowCsvHeaderSuffix()}`,
  ];

  const lines = workflow.sellerRows.map((seller) => {
    const base = [
      `"${seller.sellerName.replace(/"/g, '""')}"`,
      seller.receivedTitlesCount,
      seller.receivedAmount.toFixed(2),
      seller.allocatedBaseAmount.toFixed(2),
      seller.releasedCommissionAmount.toFixed(2),
      seller.averageCommissionRate.toFixed(4),
    ];
    return [
      ...base,
      formatWorkflowStatusForCsv(seller.workflow.status),
      seller.workflow.paymentBatchId ?? "",
      seller.workflow.canApprove ? "sim" : "nao",
      seller.workflow.approvalBlockedReason
        ? `"${seller.workflow.approvalBlockedReason.replace(/"/g, '""')}"`
        : "",
    ].join(",");
  });

  return [...headerLines, ...lines].join("\n");
}

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

async function loadMonthlyClosingRows(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope
) {
  return listPayableVisualAuditRows(toPayableRowsQuery(query), scope);
}

/**
 * Resumo mensal oficial: comissão a pagar = liberada em títulos baixados no mês (settlementDate).
 * Reutiliza linhas PAYABLE da auditoria visual — não recalcula comissão nem altera pagamentos.
 */
export async function getCommissionMonthlyPayableSummary(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope
): Promise<CommissionMonthlyPayableSummary> {
  const rows = await loadMonthlyClosingRows(query, scope);
  return aggregateMonthlyPayableFromRows(rows, query);
}

export async function getCommissionMonthlyClosingPage(
  query: CommissionMonthlyPayableQuery & { page: number; pageSize: number },
  scope: CommissionAccessScope
): Promise<CommissionMonthlyClosingPayload> {
  const rows = await loadMonthlyClosingRows(query, scope);
  const summary = aggregateMonthlyPayableFromRows(rows, query);
  const divergenceCount = rows.filter((r) => r.alerts.length > 0).length;
  const cards = buildMonthlyClosingCards(summary, divergenceCount);
  const auditCards = computeVisualAuditCards(rows, "PAYABLE");
  const nomusReference = buildVisualAuditNomusReference({
    mode: "PAYABLE",
    cards: auditCards,
    nomusBase: query.nomusReferenceBase ?? null,
    nomusCommission: query.nomusReferenceCommission ?? null,
  });
  const groupings = buildMonthlyClosingGroupings(rows, summary.monthKey);
  const total = summary.details.length;
  const skip = (query.page - 1) * query.pageSize;
  const detailRows = summary.details.slice(skip, skip + query.pageSize);

  const sellerIds = summary.sellers.map((s) => s.sellerId);
  const paymentBatchesBySeller = await loadPaymentBatchesBySeller(
    query.year,
    query.month,
    sellerIds
  );
  const workflow = buildMonthlyClosingWorkflowMeta({
    sellers: summary.sellers,
    divergenceCount,
    warnings: summary.warnings,
    nomusReference,
    paymentBatchesBySeller,
    sellerLineAlertCounts: countSellerLineAlerts(rows),
  });

  return {
    ...summary,
    cards,
    nomusReference,
    groupings,
    detailRows,
    pagination: paginatedMeta(query.page, query.pageSize, total),
    workflow,
  };
}

export async function exportCommissionMonthlyClosingCsv(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope,
  format: "summary" | "detail" | "full" | "official"
): Promise<string> {
  if (format === "official") {
    const page = await getCommissionMonthlyClosingPage(
      { ...query, page: 1, pageSize: 100000 },
      scope
    );
    return `${buildMonthlyClosingOfficialSummaryCsv(page, page.workflow)}\n\n${buildMonthlyPayableDetailCsv(page)}`;
  }

  const summary = await getCommissionMonthlyPayableSummary(query, scope);
  if (format === "summary") return buildMonthlyPayableSellerSummaryCsv(summary);
  if (format === "detail") return buildMonthlyPayableDetailCsv(summary);
  return `${buildMonthlyPayableSellerSummaryCsv(summary)}\n\n${buildMonthlyPayableDetailCsv(summary)}`;
}
