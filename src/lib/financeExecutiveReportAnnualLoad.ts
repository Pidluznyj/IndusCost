/**
 * Carga de portfólio AR/AP completo para comparativo anual do Relatório Executivo.
 * Mesma base do gráfico anual de Fluxo de Caixa (aberto + liquidado, sem recorte de mês).
 */
import type { PrismaClient } from "@prisma/client";
import { buildFinanceApPrismaWhere } from "./financeAccountsPayableDashboard.js";
import {
  createAnnualComparisonBaseFilters,
} from "./financeCashFlowAnnualComparison.js";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
  type FinanceCashFlowArRow,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "./financeNomusApReportFreshness.js";
import { enrichFinanceCashFlowArLoadBundle } from "./finance/financeCashFlowEffectiveAr.server.js";
import type { CashFlowProjectionMode } from "./finance/cashFlowLightProjectionFlag.js";
import { loadFinanceArManagementRowsFromPrisma } from "./financeAccountsReceivableManagement.server.js";

export async function loadAnnualComparisonPortfolioRows(
  db: PrismaClient,
  referenceDate = new Date(),
  cashFlowFilters: FinanceCashFlowDashboardFilters = createAnnualComparisonBaseFilters(),
  /** Default legacy: só o handler /cash-flow/annual-comparison passa "light". */
  projectionMode: CashFlowProjectionMode = "legacy"
) {
  const filters = cashFlowFilters;
  const arFilters = toCashFlowPortfolioArFilters(filters);
  const apFilters = toCashFlowPortfolioApFilters(filters);
  const [{ rows: arManagementRows, syncCutoff: arSyncCutoff }, apSyncCutoff] =
    await Promise.all([
      loadFinanceArManagementRowsFromPrisma(db, arFilters, referenceDate),
      resolveNomusApReportSyncCutoffFromPrisma(db),
    ]);
  const apWhere = buildFinanceApPrismaWhere(apFilters, apSyncCutoff);
  const apPrisma = await db.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_CASH_FLOW_AP_SELECT,
    orderBy: { dueDate: "asc" },
  });

  const arRows = arManagementRows as FinanceCashFlowArRow[];
  const { orderContexts, nfeOrderLinks } = await enrichFinanceCashFlowArLoadBundle(
    db,
    arRows,
    referenceDate,
    {
      customerName: filters.customerName,
      personCnpj: filters.personCnpj,
      projectionMode,
    }
  );

  return {
    arRows,
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff,
    apSyncCutoff,
    orderContexts,
    nfeOrderLinks,
  };
}
