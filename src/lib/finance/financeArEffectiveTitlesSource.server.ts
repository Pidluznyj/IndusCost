/**
 * Carga server-side compartilhada — fonte canônica AR (Títulos × Fluxo de Caixa).
 */

import type { PrismaClient } from "@prisma/client";
import type { FinanceArDashboardFilters } from "@/src/lib/financeAccountsReceivableDashboard.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.server.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";
import {
  enrichFinanceCashFlowArLoadBundle,
  type FinanceCashFlowArEnrichInput,
} from "./financeCashFlowEffectiveAr.server.js";

export type FinanceArTitlesSourceBundle = {
  rows: Awaited<ReturnType<typeof loadFinanceArManagementRowsFromPrisma>>["rows"];
  arRows: FinanceCashFlowArRow[];
  syncCutoff: NomusArReportSyncCutoff | null;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
};

/** Carrega carteira gerencial Nomus + contextos FIN-05 + vínculos NF→Pedido. */
export async function loadFinanceArTitlesSourceBundle(
  prisma: PrismaClient,
  arFilters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  enrichInput?: FinanceCashFlowArEnrichInput
): Promise<FinanceArTitlesSourceBundle> {
  const { rows, syncCutoff } = await loadFinanceArManagementRowsFromPrisma(
    prisma,
    arFilters,
    referenceDate
  );
  const arRows = rows as FinanceCashFlowArRow[];
  const { orderContexts, nfeOrderLinks } = await enrichFinanceCashFlowArLoadBundle(
    prisma,
    arRows,
    referenceDate,
    enrichInput
  );
  return { rows, arRows, syncCutoff, orderContexts, nfeOrderLinks };
}
