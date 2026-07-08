/**
 * Carga de portfólio AR/AP completo para comparativo anual do Relatório Executivo.
 * Mesma base do gráfico anual de Fluxo de Caixa (aberto + liquidado, sem recorte de mês).
 */
import type { PrismaClient } from "@prisma/client";
import { buildFinanceApPrismaWhere } from "./financeAccountsPayableDashboard.js";
import { buildFinanceArPrismaWhere } from "./financeAccountsReceivableDashboard.js";
import {
  createAnnualComparisonBaseFilters,
} from "./financeCashFlowAnnualComparison.js";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "./financeNomusArReportFreshness.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "./financeNomusApReportFreshness.js";
import { enrichFinanceArDashboardRowsWithOrderFinancialResolution } from "./nomusArOrderFinancialResolution.server.js";

export async function loadAnnualComparisonPortfolioRows(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusAccountsPayable">,
  referenceDate = new Date(),
  cashFlowFilters: FinanceCashFlowDashboardFilters = createAnnualComparisonBaseFilters()
) {
  const filters = cashFlowFilters;
  const [arSyncCutoff, apSyncCutoff] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(db),
    resolveNomusApReportSyncCutoffFromPrisma(db),
  ]);
  const arFilters = toCashFlowPortfolioArFilters(filters);
  const apFilters = toCashFlowPortfolioApFilters(filters);
  const arWhere = buildFinanceArPrismaWhere(arFilters, referenceDate, arSyncCutoff);
  const apWhere = buildFinanceApPrismaWhere(apFilters, apSyncCutoff);

  const [arPrisma, apPrisma] = await Promise.all([
    db.nomusAccountsReceivable.findMany({
      where: arWhere,
      select: FINANCE_CASH_FLOW_AR_SELECT,
      orderBy: { dueDate: "asc" },
    }),
    db.nomusAccountsPayable.findMany({
      where: apWhere,
      select: FINANCE_CASH_FLOW_AP_SELECT,
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const arMapped = arPrisma.map(mapPrismaRowToFinanceCashFlowArRow);
  const arRows = await enrichFinanceArDashboardRowsWithOrderFinancialResolution(
    db as Parameters<typeof enrichFinanceArDashboardRowsWithOrderFinancialResolution>[0],
    arMapped
  );

  return {
    arRows,
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff,
    apSyncCutoff,
  };
}
