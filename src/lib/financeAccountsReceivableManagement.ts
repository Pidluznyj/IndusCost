/**
 * Ponto único da base saneada de Contas a Receber gerencial.
 * Dashboard, Atrasados, Fluxo de Caixa, Calendário e exportações devem consumir estas funções.
 *
 * Loaders Prisma com exclusão de pedidos cancelados: ver
 * `financeAccountsReceivableManagement.server.ts` (não importar no frontend).
 */
import type { Prisma } from "@prisma/client";
import {
  buildFinanceArPrismaWhere,
  filterFinanceArManagementReportRows,
  filterFinanceArRows,
  FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
  isFinanceArAllowedInManagementReport,
  isFinanceArOverdueWithoutFiscalDocument,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildNomusArReportSyncCutoff,
  isFinanceArExcludedFromReports,
  mergeFinanceArPrismaWhereWithSyncCutoff,
  resolveEffectiveNomusArReportSyncCutoff,
  resolveNomusArReportSyncCutoffFromRows,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";

export type FinanceArManagementRowsLoadResult = {
  rows: FinanceArDashboardRow[];
  syncCutoff: NomusArReportSyncCutoff | null;
};

/** Alias documentado — where Prisma da base gerencial AR (inclui freshness quando cutoff existe). */
export function buildAccountsReceivableManagementWhere(
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): Prisma.NomusAccountsReceivableWhereInput {
  return buildFinanceArPrismaWhere(filters, referenceDate, syncCutoff);
}

/** Alias documentado — filtro em memória da base gerencial AR. */
export const filterFreshManagementReceivables = filterFinanceArManagementReportRows;

export {
  buildFinanceArPrismaWhere,
  filterFinanceArManagementReportRows,
  filterFinanceArRows,
  FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
  isFinanceArAllowedInManagementReport,
  isFinanceArOverdueWithoutFiscalDocument,
};

export {
  buildFinanceArPrismaWhereForOpenHorizon,
} from "./financeAccountsReceivableHorizon.js";

export {
  buildNomusArReportSyncCutoff,
  isFinanceArExcludedFromReports,
  mergeFinanceArPrismaWhereWithSyncCutoff,
  resolveEffectiveNomusArReportSyncCutoff,
  resolveNomusArReportSyncCutoffFromRows,
  type NomusArReportSyncCutoff,
};

/** @deprecated use financeAccountsReceivableManagement.server — mantido para tipagem de testes. */
export type { FinanceArDashboardRow };
