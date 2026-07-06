import type { FinanceApDashboardFilters, FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import { isFinanceApOpen, matchesFinanceApDashboardFilters } from "./financeAccountsPayableDashboard.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import type { FinanceArDashboardFilters, FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { isFinanceArOpen, isFinanceArAllowedInManagementReport, matchesFinanceArDashboardFilters } from "./financeAccountsReceivableDashboard.js";
import {
  isFinanceApExcludedFromReports,
  resolveEffectiveNomusApReportSyncCutoff,
  type NomusApReportSyncCutoff,
} from "./financeNomusApReportFreshness.js";
import {
  isFinanceArExcludedFromReports,
  resolveEffectiveNomusArReportSyncCutoff,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import {
  bucketizeFinanceHorizonRows,
  type FinanceHorizonAggregation,
  type FinanceHorizonRow,
} from "./financeHorizonBuckets.js";

export type FinanceHorizonSummary = FinanceHorizonAggregation & {
  title: string;
  subtitle: string;
  scopeNote: string;
  countUnitLabel: string;
  ignoresPeriodFilter: boolean;
};

export const FINANCE_HORIZON_AP_SCOPE_NOTE =
  "Horizonte calculado a partir de hoje. Respeita filtros de empresa, fornecedor e status, mas não limita a visão ao mês ou ano de vencimento selecionado." as const;

export const FINANCE_HORIZON_AR_SCOPE_NOTE =
  "Horizonte calculado a partir de hoje. Respeita filtros de empresa, cliente e status, mas não limita a visão ao mês ou ano de vencimento selecionado." as const;

export const FINANCE_HORIZON_BILLING_SCOPE_NOTE =
  "Previsão por carteira de pedidos não faturados nos próximos 60 dias. Não representa NF-e já emitida e não usa o filtro de mês do painel realizado." as const;

function stripHorizonPeriodFilters<T extends { year?: number; month?: number; dueDateFrom?: Date; dueDateTo?: Date }>(
  filters: T
): T {
  return {
    ...filters,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
}

export function buildFinanceApHorizonRows(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceHorizonRow[] {
  const horizonFilters = stripHorizonPeriodFilters(filters);
  const horizonRows: FinanceHorizonRow[] = [];
  const effectiveCutoff = resolveEffectiveNomusApReportSyncCutoff(rows, syncCutoff);

  for (const row of rows) {
    if (isFinanceApExcludedFromReports(row, effectiveCutoff)) {
      continue;
    }
    if (!matchesFinanceApHorizonEntityFilters(row, horizonFilters, referenceDate)) continue;
    if (row.suspendPayment === true) continue;
    if (!isFinanceApOpen(row)) continue;

    horizonRows.push({
      value: row.balancePayable,
      operationalDate: getAccountsPayableOperationalDueDate(row),
    });
  }

  return horizonRows;
}

export function matchesFinanceApHorizonEntityFilters(
  row: FinanceApDashboardRow,
  filters: FinanceApDashboardFilters,
  referenceDate: Date
): boolean {
  return matchesFinanceApDashboardFilters(row, stripHorizonPeriodFilters(filters), referenceDate);
}

export function buildFinanceArHorizonRows(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceHorizonRow[] {
  const horizonFilters = stripHorizonPeriodFilters(filters);
  const horizonRows: FinanceHorizonRow[] = [];
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);

  for (const row of rows) {
    if (isFinanceArExcludedFromReports(row, effectiveCutoff)) continue;
    if (!isFinanceArAllowedInManagementReport(row, referenceDate)) continue;
    if (!matchesFinanceArHorizonEntityFilters(row, horizonFilters, referenceDate)) continue;
    if (row.suspendCollection === true) continue;
    if (!isFinanceArOpen(row)) continue;

    horizonRows.push({
      value: row.balanceReceivable,
      operationalDate: row.dueDate,
    });
  }

  return horizonRows;
}

export function matchesFinanceArHorizonEntityFilters(
  row: FinanceArDashboardRow,
  filters: FinanceArDashboardFilters,
  referenceDate: Date
): boolean {
  return matchesFinanceArDashboardFilters(row, stripHorizonPeriodFilters(filters), referenceDate);
}

export function buildFinanceApHorizonSummary(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceHorizonSummary {
  const aggregation = bucketizeFinanceHorizonRows(
    buildFinanceApHorizonRows(rows, filters, referenceDate, syncCutoff),
    referenceDate
  );
  return {
    ...aggregation,
    title: "Horizonte financeiro — próximos 60 dias",
    subtitle: "Distribuição por janela operacional a partir de hoje. Valores não acumulativos.",
    scopeNote: FINANCE_HORIZON_AP_SCOPE_NOTE,
    countUnitLabel: "título(s)",
    ignoresPeriodFilter: Boolean(filters.year != null || filters.month != null),
  };
}

export function buildFinanceArHorizonSummary(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceHorizonSummary {
  const aggregation = bucketizeFinanceHorizonRows(
    buildFinanceArHorizonRows(rows, filters, referenceDate, syncCutoff),
    referenceDate
  );
  return {
    ...aggregation,
    title: "Horizonte financeiro — próximos 60 dias",
    subtitle: "Distribuição por janela operacional a partir de hoje. Valores não acumulativos.",
    scopeNote: FINANCE_HORIZON_AR_SCOPE_NOTE,
    countUnitLabel: "título(s)",
    ignoresPeriodFilter: Boolean(filters.year != null || filters.month != null),
  };
}

export function buildFinanceBillingHorizonRowsFromOrders(
  orders: Array<{ totalNetValue: number; expectedDeliveryDate: Date | string | null }>,
  referenceDate: Date = new Date()
): FinanceHorizonRow[] {
  return orders
    .filter((order) => order.expectedDeliveryDate != null && Number.isFinite(order.totalNetValue))
    .map((order) => ({
      value: order.totalNetValue,
      operationalDate:
        order.expectedDeliveryDate instanceof Date
          ? order.expectedDeliveryDate
          : new Date(order.expectedDeliveryDate as string),
    }))
    .filter((row) => row.operationalDate != null && !Number.isNaN(row.operationalDate.getTime()));
}

export function createEmptyFinanceHorizonSummary(
  partial: Pick<
    FinanceHorizonSummary,
    "title" | "subtitle" | "scopeNote" | "countUnitLabel" | "ignoresPeriodFilter"
  >
): FinanceHorizonSummary {
  const buckets = [
    { key: "0_7" as const, label: "0–7 dias", amount: 0, count: 0 },
    { key: "8_15" as const, label: "8–15 dias", amount: 0, count: 0 },
    { key: "16_30" as const, label: "16–30 dias", amount: 0, count: 0 },
    { key: "31_45" as const, label: "31–45 dias", amount: 0, count: 0 },
    { key: "46_60" as const, label: "46–60 dias", amount: 0, count: 0 },
  ];
  return {
    buckets,
    total: { key: "total_60", label: "Total 60 dias", amount: 0, count: 0 },
    ...partial,
  };
}

export function buildFinanceBillingHorizonSummary(
  orders: Array<{ totalNetValue: number; expectedDeliveryDate: Date | string | null }>,
  referenceDate: Date = new Date()
): FinanceHorizonSummary {
  const aggregation = bucketizeFinanceHorizonRows(
    buildFinanceBillingHorizonRowsFromOrders(orders, referenceDate),
    referenceDate
  );
  return {
    ...aggregation,
    title: "Horizonte de faturamento — próximos 60 dias",
    subtitle: "Previsão por carteira de pedidos ainda não faturados. Não representa NF-e já emitida.",
    scopeNote: FINANCE_HORIZON_BILLING_SCOPE_NOTE,
    countUnitLabel: "pedido(s)",
    ignoresPeriodFilter: true,
  };
}
