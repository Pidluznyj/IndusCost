import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  buildReceivableForecastDetailCsv,
  buildReceivableForecastMonthlyCsv,
  type CommissionReceivableForecastQuery,
  type ReceivableForecastSummary,
} from "./commissionReceivableForecast.js";
import { paginatedMeta } from "./commissionQuery.js";
import { loadCommissionReceivableForecastPreview } from "./commissionReceiptEngine.server.js";
import {
  buildReceivableForecastOfficialPayload,
  type ReceivableForecastOfficialPayload,
} from "./commissionReceivableForecastOfficial.js";

export type { CommissionReceivableForecastQuery, ReceivableForecastSummary };
export {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastDetailCsv,
  buildReceivableForecastMonthlyCsv,
  classifyForecastBucket,
  currentMonthKey,
  nextMonthKey,
} from "./commissionReceivableForecast.js";
export {
  COMMISSION_FORECAST_RECONCILIATION_NOTE,
  COMMISSION_FORECAST_SCOPE_NOTE,
} from "./commissionReceivableForecastOfficial.js";

export type CommissionReceivableForecastPayload = ReceivableForecastOfficialPayload & {
  detailRows: ReceivableForecastOfficialPayload["details"];
  pagination: ReturnType<typeof paginatedMeta>;
};

function toForecastLoaderInput(query: CommissionReceivableForecastQuery) {
  return {
    dueDateFrom: query.dueDateFrom ?? null,
    dueDateTo: query.dueDateTo ?? null,
    horizonMonths: query.horizonMonths ?? null,
    customer: query.customer ?? null,
    seller: null,
    commissionPersonId: query.commissionPersonId ?? null,
    orderCode: query.orderCode ?? null,
    nfeNumber: query.nfeNumber ?? null,
    nomusReceivableId: query.nomusReceivableId ?? null,
    applyMaterialization: true,
  };
}

/**
 * Previsão por vencimento (dueDate) — motor oficial de recebimento (títulos em aberto).
 * Mesmas regras de vendedor, exclusões e schedules do Fechamento do mês.
 */
export async function getCommissionReceivableForecastPage(
  query: CommissionReceivableForecastQuery & { page: number; pageSize: number },
  _scope: CommissionAccessScope
): Promise<CommissionReceivableForecastPayload> {
  const preview = await loadCommissionReceivableForecastPreview(toForecastLoaderInput(query));
  const official = buildReceivableForecastOfficialPayload(preview, query);
  const total = official.details.length;
  const skip = (query.page - 1) * query.pageSize;

  return {
    ...official,
    detailRows: official.details.slice(skip, skip + query.pageSize),
    pagination: paginatedMeta(query.page, query.pageSize, total),
  };
}

export async function exportCommissionReceivableForecastCsv(
  query: CommissionReceivableForecastQuery,
  _scope: CommissionAccessScope,
  format: "monthly" | "detail" | "full"
): Promise<string> {
  const preview = await loadCommissionReceivableForecastPreview(toForecastLoaderInput(query));
  const official = buildReceivableForecastOfficialPayload(preview, query);
  if (format === "monthly") return buildReceivableForecastMonthlyCsv(official);
  if (format === "detail") return buildReceivableForecastDetailCsv(official);
  return `${buildReceivableForecastMonthlyCsv(official)}\n\n${buildReceivableForecastDetailCsv(official)}`;
}
