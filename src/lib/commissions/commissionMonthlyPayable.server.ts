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
import { buildVisualAuditNomusReference, computeVisualAuditCards } from "./commissionVisualAudit.js";
import type { VisualAuditNomusReference } from "./commissionVisualAudit.js";
import { paginatedMeta } from "./commissionQuery.js";
import { listPayableVisualAuditRows } from "./commissionVisualAudit.server.js";

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
};

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

  return {
    ...summary,
    cards,
    nomusReference,
    groupings,
    detailRows,
    pagination: paginatedMeta(query.page, query.pageSize, total),
  };
}

export async function exportCommissionMonthlyClosingCsv(
  query: CommissionMonthlyPayableQuery,
  scope: CommissionAccessScope,
  format: "summary" | "detail" | "full"
): Promise<string> {
  const summary = await getCommissionMonthlyPayableSummary(query, scope);
  if (format === "summary") return buildMonthlyPayableSellerSummaryCsv(summary);
  if (format === "detail") return buildMonthlyPayableDetailCsv(summary);
  return `${buildMonthlyPayableSellerSummaryCsv(summary)}\n\n${buildMonthlyPayableDetailCsv(summary)}`;
}
