import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastDetailCsv,
  buildReceivableForecastMonthlyCsv,
  type CommissionReceivableForecastQuery,
  type ReceivableForecastSummary,
} from "./commissionReceivableForecast.js";
import { paginatedMeta } from "./commissionQuery.js";
import { listForecastVisualAuditRows } from "./commissionVisualAudit.server.js";

export type { CommissionReceivableForecastQuery, ReceivableForecastSummary };
export {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastDetailCsv,
  buildReceivableForecastMonthlyCsv,
  classifyForecastBucket,
  currentMonthKey,
  nextMonthKey,
} from "./commissionReceivableForecast.js";

export type CommissionReceivableForecastPayload = ReceivableForecastSummary & {
  detailRows: ReceivableForecastSummary["details"];
  pagination: ReturnType<typeof paginatedMeta>;
};

function toForecastRowsQuery(query: CommissionReceivableForecastQuery) {
  return {
    commissionPersonId: query.commissionPersonId ?? null,
    customer: query.customer ?? null,
    orderCode: query.orderCode ?? null,
    nfeNumber: query.nfeNumber ?? null,
    nomusReceivableId: query.nomusReceivableId ?? null,
    receivableTitleStatus: query.receivableTitleStatus ?? null,
    commissionStatus: query.commissionStatus ?? null,
    dueDateFrom: query.dueDateFrom ?? null,
    dueDateTo: query.dueDateTo ?? null,
    onlyDivergences: query.onlyDivergences ?? false,
  };
}

/**
 * Previsão por vencimento (dueDate) — títulos em aberto, comissão pendente não liberada.
 * Reutiliza linhas FORECAST da auditoria visual; não altera dados nem liberação.
 */
export async function getCommissionReceivableForecastPage(
  query: CommissionReceivableForecastQuery & { page: number; pageSize: number },
  scope: CommissionAccessScope
): Promise<CommissionReceivableForecastPayload> {
  const rows = await listForecastVisualAuditRows(toForecastRowsQuery(query), scope);
  const summary = aggregateReceivableForecastFromRows(rows, query);
  const total = summary.details.length;
  const skip = (query.page - 1) * query.pageSize;

  return {
    ...summary,
    detailRows: summary.details.slice(skip, skip + query.pageSize),
    pagination: paginatedMeta(query.page, query.pageSize, total),
  };
}

export async function exportCommissionReceivableForecastCsv(
  query: CommissionReceivableForecastQuery,
  scope: CommissionAccessScope,
  format: "monthly" | "detail" | "full"
): Promise<string> {
  const rows = await listForecastVisualAuditRows(toForecastRowsQuery(query), scope);
  const summary = aggregateReceivableForecastFromRows(rows, query);
  if (format === "monthly") return buildReceivableForecastMonthlyCsv(summary);
  if (format === "detail") return buildReceivableForecastDetailCsv(summary);
  return `${buildReceivableForecastMonthlyCsv(summary)}\n\n${buildReceivableForecastDetailCsv(summary)}`;
}
