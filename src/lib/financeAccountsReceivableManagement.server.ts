import type { PrismaClient } from "@prisma/client";
import {
  loadFinanceArManagementRowsFromPrisma,
  type FinanceArManagementRowsLoadResult,
} from "./financeAccountsReceivableManagement.js";
import type { FinanceArDashboardFilters } from "./financeAccountsReceivableDashboard.js";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "./financeAccountsReceivableHorizon.js";
import { enrichFinanceArDashboardRowsWithOrderFinancialResolution } from "./nomusArOrderFinancialResolution.server.js";

type ArManagementDb = Pick<PrismaClient, "nomusAccountsReceivable" | "salesOrder" | "salesOrderNfeLink">;

/** Loader AR gerencial com resolução financeira por parcela do pedido Nomus. */
export async function loadEnrichedFinanceArManagementRowsFromPrisma(
  db: ArManagementDb,
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date()
): Promise<FinanceArManagementRowsLoadResult> {
  const loaded = await loadFinanceArManagementRowsFromPrisma(db, filters, referenceDate);
  const rows = await enrichFinanceArDashboardRowsWithOrderFinancialResolution(db, loaded.rows);
  return { rows, syncCutoff: loaded.syncCutoff };
}

/** Horizonte AR aberto com resolução financeira por parcela do pedido. */
export async function loadEnrichedFinanceArOpenHorizonRowsFromPrisma(
  db: ArManagementDb,
  referenceDate: Date = new Date()
) {
  const loaded = await loadFinanceArOpenHorizonRowsFromPrisma(db, referenceDate);
  const rows = await enrichFinanceArDashboardRowsWithOrderFinancialResolution(db, loaded.rows);
  return { rows, syncCutoff: loaded.syncCutoff };
}
