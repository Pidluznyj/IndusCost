/**
 * Ponto único da base saneada de Contas a Receber gerencial.
 * Dashboard, Atrasados, Fluxo de Caixa, Calendário e exportações devem consumir estas funções.
 */
import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  buildFinanceArPrismaWhere,
  filterFinanceArManagementReportRows,
  filterFinanceArRows,
  FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
  isFinanceArAllowedInManagementReport,
  isFinanceArOverdueWithoutFiscalDocument,
  mapPrismaRowToFinanceArDashboardRow,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { FINANCE_AR_TITLE_SELECT } from "./financeAccountsReceivableTitles.js";
import {
  buildNomusArReportSyncCutoff,
  isFinanceArExcludedFromReports,
  mergeFinanceArPrismaWhereWithSyncCutoff,
  resolveEffectiveNomusArReportSyncCutoff,
  resolveNomusArReportSyncCutoffFromPrisma,
  resolveNomusArReportSyncCutoffFromRows,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";

export type FinanceArManagementRowsLoadResult = {
  rows: FinanceArDashboardRow[];
  syncCutoff: NomusArReportSyncCutoff | null;
};

/** Alias documentado — cutoff global MAX(syncedAt) − 1h via Prisma. */
export const getFreshNomusAccountsReceivableCutoff = resolveNomusArReportSyncCutoffFromPrisma;

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

export async function loadFinanceArManagementRowsFromPrisma(
  db: Pick<PrismaClient, "nomusAccountsReceivable">,
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date()
): Promise<FinanceArManagementRowsLoadResult> {
  const syncCutoff = await resolveNomusArReportSyncCutoffFromPrisma(db);
  const where = buildFinanceArPrismaWhere(filters, referenceDate, syncCutoff);
  const rows = await db.nomusAccountsReceivable.findMany({
    where,
    select: FINANCE_AR_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return {
    rows: rows.map(mapPrismaRowToFinanceArDashboardRow),
    syncCutoff,
  };
}

export {
  buildFinanceArPrismaWhereForOpenHorizon,
  loadFinanceArOpenHorizonRowsFromPrisma,
} from "./financeAccountsReceivableHorizon.js";

export {
  consolidateFinanceArReceivableRows,
  auditNomusAccountsReceivableCurrentState,
} from "./nomusAccountsReceivableCurrent.js";

export {
  buildNomusArReportSyncCutoff,
  isFinanceArExcludedFromReports,
  mergeFinanceArPrismaWhereWithSyncCutoff,
  resolveEffectiveNomusArReportSyncCutoff,
  resolveNomusArReportSyncCutoffFromRows,
  type NomusArReportSyncCutoff,
};
