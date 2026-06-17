/**
 * Auditoria de paridade entre visões financeiras AR/AP.
 * Usado pelos testes de consistência e por diagnósticos internos.
 */
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsReceivableOverdueRows,
  sumFinanceArOverdueOpenAmount,
} from "./financeAccountsReceivableOverdue.js";
import { filterFinanceArManagementReportRows } from "./financeAccountsReceivableManagement.js";
import {
  isNomusArStaleForReports,
  resolveEffectiveNomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type FinanceArCrossViewConsistencyResult = {
  ok: boolean;
  mismatches: string[];
};

/** AR stale não deve aparecer em dashboard, atrasados nem fluxo de caixa. */
export function auditFinanceArStaleExclusionAcrossViews(
  rows: FinanceArDashboardRow[],
  cashFlowArRows: FinanceCashFlowArRow[],
  filters: FinanceArDashboardFilters,
  cashFlowFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null,
  apSyncCutoff: NomusApReportSyncCutoff | null = null,
  apRows: FinanceCashFlowApRow[] = []
): FinanceArCrossViewConsistencyResult {
  const mismatches: string[] = [];
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(rows, syncCutoff);
  const staleIds = new Set(
    rows
      .filter((row) => effectiveCutoff != null && isNomusArStaleForReports(row, effectiveCutoff))
      .map((row) => row.externalId)
  );

  const managed = filterFinanceArManagementReportRows(rows, filters, referenceDate, syncCutoff);
  for (const id of staleIds) {
    if (managed.some((r) => r.externalId === id)) {
      mismatches.push(`stale ${id} apareceu na base gerencial AR`);
    }

    const overdue = buildFinanceAccountsReceivableOverdueRows(rows, filters, referenceDate, syncCutoff);
    if (overdue.some((r) => r.externalId === id)) {
      mismatches.push(`stale ${id} apareceu em Atrasados`);
    }
  }

  const cashFlow = buildFinanceCashFlowDashboard(
    cashFlowArRows,
    apRows,
    cashFlowFilters,
    referenceDate,
    syncCutoff,
    apSyncCutoff
  );
  for (const block of [...cashFlow.overdueReceivables, ...cashFlow.largestProjectedInflows]) {
    if (staleIds.has(block.externalId)) {
      mismatches.push(`stale ${block.externalId} apareceu no Fluxo de Caixa (${block.personName ?? "—"})`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Total vencido da aba Atrasados deve bater com overdueAmount do dashboard nos mesmos filtros. */
export function auditFinanceArOverdueParityWithDashboard(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null
): FinanceArCrossViewConsistencyResult {
  const dash = buildFinanceAccountsReceivableDashboard(rows, filters, referenceDate, syncCutoff);
  const overdueTotal = sumFinanceArOverdueOpenAmount(rows, filters, referenceDate, syncCutoff);
  const mismatches: string[] = [];
  if (dash.cards.overdueAmount !== overdueTotal) {
    mismatches.push(
      `overdueAmount dashboard=${dash.cards.overdueAmount} atrasados=${overdueTotal}`
    );
  }
  return { ok: mismatches.length === 0, mismatches };
}
