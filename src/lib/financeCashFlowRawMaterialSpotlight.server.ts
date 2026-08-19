/**
 * Carrega o spotlight de Matéria-prima para o dashboard de Fluxo de Caixa.
 * Reutiliza as regras canônicas de alocação de centros de custo + mapa de papéis DRE.
 * Não reconstrói o dashboard completo de CC (gráfico anual, fornecedores, diagnóstico).
 */

import { buildFinanceApPrismaWhere } from "@/src/lib/financeAccountsPayableDashboard.js";
import { buildExecutiveReportCostCenterDashboardFilters } from "@/src/lib/financeCostCenterAnnualSpendingChart.js";
import {
  collectFinanceCostCenterMonthlyByCostCenter,
  createDefaultFinanceCostCenterDashboardDeps,
} from "@/src/lib/financeCostCenterDashboard.js";
import { loadDreCostCenterRoleMap } from "@/src/lib/financeDreCostCenterMapping.server.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  measureDevPerfPhase,
  measureDevPerfPhaseSync,
} from "@/src/lib/devPerfBaseline.server.js";
import {
  addCashFlowCalendarMonths,
  buildRawMaterialCostCenterSpotlight,
  emptyRawMaterialCostCenterSpotlight,
  resolveRawMaterialSpotlightAnchor,
  type FinanceCashFlowRawMaterialCcSpendRow,
  type FinanceCashFlowRawMaterialSpotlight,
} from "@/src/lib/financeCashFlowRawMaterialSpotlight.js";

export type LoadRawMaterialCostCenterSpotlightInput = {
  ytdYear: number;
  companyName?: string;
  referenceDate?: Date;
};

function yearsNeededForSpotlight(ytdYear: number, referenceDate: Date): number[] {
  const anchor = resolveRawMaterialSpotlightAnchor(referenceDate);
  const next2 = addCashFlowCalendarMonths(anchor, 2);
  return [...new Set([ytdYear, anchor.year, next2.year])].sort((a, b) => a - b);
}

export async function loadRawMaterialCostCenterSpotlight(
  input: LoadRawMaterialCostCenterSpotlightInput
): Promise<FinanceCashFlowRawMaterialSpotlight> {
  return measureDevPerfPhase(
    "spotlight",
    async () => {
      const referenceDate = input.referenceDate ?? new Date();
      const ytdYear = Number.isFinite(input.ytdYear)
        ? Math.trunc(input.ytdYear)
        : referenceDate.getFullYear();

      try {
        const years = yearsNeededForSpotlight(ytdYear, referenceDate);
        const roleMap = await measureDevPerfPhase("spotlightRoleMap", () =>
          loadDreCostCenterRoleMap(prisma)
        );
        const byCostCenter = await measureDevPerfPhase("spotlightCcDashboard", async () => {
          const deps = createDefaultFinanceCostCenterDashboardDeps();
          const syncCutoff = await deps.resolveSyncCutoff();
          const [costCenters, suppliers] = await Promise.all([
            deps.loadCostCenters(),
            deps.loadSuppliers(),
          ]);

          const yearLoads = [];
          for (const year of years) {
            const filters = buildExecutiveReportCostCenterDashboardFilters({
              year,
              month: null,
              companyName: input.companyName,
            });
            const rows = await deps.loadApRows(buildFinanceApPrismaWhere(filters, syncCutoff));
            yearLoads.push({ filters, rows });
          }

          const allocationIds = [
            ...new Set(yearLoads.flatMap((load) => load.rows.map((row) => row.externalId))),
          ];
          const allocations = await deps.loadAllocations(allocationIds);

          const collected: FinanceCashFlowRawMaterialCcSpendRow[] = [];
          for (const load of yearLoads) {
            const monthly = collectFinanceCostCenterMonthlyByCostCenter(
              load.rows,
              allocations,
              costCenters,
              suppliers,
              load.filters,
              referenceDate,
              syncCutoff
            );
            for (const row of monthly) {
              collected.push({
                month: row.month,
                year: row.year,
                costCenterId: row.costCenterId,
                code: row.code,
                name: row.name,
                amount: row.amount,
              });
            }
          }
          return collected;
        });

        return measureDevPerfPhaseSync("spotlightBuild", () =>
          buildRawMaterialCostCenterSpotlight({
            byCostCenter,
            ytdYear,
            referenceDate,
            mappingByCcId: roleMap,
          })
        );
      } catch (error) {
        console.error(
          "[loadRawMaterialCostCenterSpotlight] Falha ao carregar centros de custo de matéria-prima:",
          error
        );
        return emptyRawMaterialCostCenterSpotlight(referenceDate, ytdYear);
      }
    },
    { account: true }
  );
}
