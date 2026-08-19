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
import {
  measureDevPerfPhase,
  measureDevPerfPhaseSync,
  noteDevPerfRowCounts,
} from "@/src/lib/devPerfBaseline.server.js";

export async function loadAnnualComparisonPortfolioRows(
  db: PrismaClient,
  referenceDate = new Date(),
  cashFlowFilters: FinanceCashFlowDashboardFilters = createAnnualComparisonBaseFilters(),
  /** Default legacy: só o handler /cash-flow/annual-comparison passa "light". */
  projectionMode: CashFlowProjectionMode = "legacy"
) {
  return measureDevPerfPhase(
    "loadRows",
    async () => {
      const filters = cashFlowFilters;
      const arFilters = toCashFlowPortfolioArFilters(filters);
      const apFilters = toCashFlowPortfolioApFilters(filters);
      const [{ rows: arManagementRows, syncCutoff: arSyncCutoff }, apSyncCutoff] =
        await Promise.all([
          measureDevPerfPhase("arLoad", () =>
            loadFinanceArManagementRowsFromPrisma(db, arFilters, referenceDate)
          ),
          measureDevPerfPhase("apCutoff", () => resolveNomusApReportSyncCutoffFromPrisma(db)),
        ]);
      const apWhere = buildFinanceApPrismaWhere(apFilters, apSyncCutoff);
      const apPrisma = await measureDevPerfPhase("apLoad", () =>
        db.nomusAccountsPayable.findMany({
          where: apWhere,
          select: FINANCE_CASH_FLOW_AP_SELECT,
          orderBy: { dueDate: "asc" },
        })
      );

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

      noteDevPerfRowCounts({
        ar: arRows.length,
        ap: apPrisma.length,
        orders: orderContexts.length,
      });

      return {
        arRows,
        apRows: measureDevPerfPhaseSync("mapApRows", () =>
          apPrisma.map(mapPrismaRowToFinanceCashFlowApRow)
        ),
        arSyncCutoff,
        apSyncCutoff,
        orderContexts,
        nfeOrderLinks,
      };
    },
    { account: true }
  );
}
