/**
 * Carga de portfólio AR/AP completo para comparativo anual do Relatório Executivo.
 * Mesma base do gráfico anual de Fluxo de Caixa (aberto + liquidado, sem recorte de mês).
 */
import type { PrismaClient } from "@prisma/client";
import { buildFinanceApPrismaWhere } from "./financeAccountsPayableDashboard.js";
import { buildFinanceArPrismaWhere } from "./financeAccountsReceivableDashboard.js";
import { createAnnualComparisonBaseFilters } from "./financeCashFlowAnnualComparison.js";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "./financeCashFlowDashboard.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "./financeNomusArReportFreshness.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "./financeNomusApReportFreshness.js";

export async function loadAnnualComparisonPortfolioRows(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusAccountsPayable">,
  referenceDate = new Date()
) {
  const filters = createAnnualComparisonBaseFilters();
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

  return {
    arRows: arPrisma.map(mapPrismaRowToFinanceCashFlowArRow),
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff,
    apSyncCutoff,
  };
}
