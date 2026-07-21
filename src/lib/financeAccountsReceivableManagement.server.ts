/**
 * Loaders gerenciais de Contas a Receber (server-only).
 * Exclui títulos vinculados a pedidos CANCELLED / ERROR / MISSING_CONFIRMED (flag).
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildFinanceArPrismaWhere,
  mapPrismaRowToFinanceArDashboardRow,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { FINANCE_AR_TITLE_SELECT } from "./financeAccountsReceivableTitles.js";
import {
  resolveNomusArReportSyncCutoffFromPrisma,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import { isFinanceArExcludedByCancelledSalesOrder } from "./financeArCancelledSalesOrderExclusion.js";
import { loadFinanceArCancelledSalesOrderExclusionIndex } from "./financeArCancelledSalesOrderExclusion.server.js";
import type { FinanceArManagementRowsLoadResult } from "./financeAccountsReceivableManagement.js";
import { buildFinanceArPrismaWhereForOpenHorizon } from "./financeAccountsReceivableHorizon.js";

export async function loadFinanceArManagementRowsFromPrisma(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "salesOrder" | "salesOrderNfeLink">,
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date()
): Promise<FinanceArManagementRowsLoadResult> {
  const syncCutoff = await resolveNomusArReportSyncCutoffFromPrisma(db);
  const where = buildFinanceArPrismaWhere(filters, referenceDate, syncCutoff);
  const [rawRows, cancelledExclusion] = await Promise.all([
    db.nomusAccountsReceivable.findMany({
      where,
      select: FINANCE_AR_TITLE_SELECT,
      orderBy: { dueDate: "asc" },
    }),
    loadFinanceArCancelledSalesOrderExclusionIndex(db),
  ]);
  const rows = rawRows
    .map(mapPrismaRowToFinanceArDashboardRow)
    .filter((row) => !isFinanceArExcludedByCancelledSalesOrder(row, cancelledExclusion));
  return { rows, syncCutoff };
}

export async function loadFinanceArOpenHorizonRowsFromPrisma(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "salesOrder" | "salesOrderNfeLink">,
  referenceDate: Date = new Date()
): Promise<{ rows: FinanceArDashboardRow[]; syncCutoff: NomusArReportSyncCutoff | null }> {
  void referenceDate;
  const syncCutoff = await resolveNomusArReportSyncCutoffFromPrisma(db);
  const where = buildFinanceArPrismaWhereForOpenHorizon(syncCutoff);
  const [rawRows, cancelledExclusion] = await Promise.all([
    db.nomusAccountsReceivable.findMany({
      where,
      select: FINANCE_AR_TITLE_SELECT,
      orderBy: { dueDate: "asc" },
    }),
    loadFinanceArCancelledSalesOrderExclusionIndex(db),
  ]);
  return {
    rows: rawRows
      .map(mapPrismaRowToFinanceArDashboardRow)
      .filter((row) => !isFinanceArExcludedByCancelledSalesOrder(row, cancelledExclusion)),
    syncCutoff,
  };
}

export { resolveNomusArReportSyncCutoffFromPrisma as getFreshNomusAccountsReceivableCutoff };
