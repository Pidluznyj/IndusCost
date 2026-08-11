/**
 * Carrega o spotlight de Matéria-prima para o dashboard de Fluxo de Caixa.
 * Reutiliza o motor oficial de centros de custo + mapa de papéis DRE.
 */

import { buildFinanceCostCenterDashboardDefault } from "@/src/lib/financeCostCenterDashboard.js";
import { buildExecutiveReportCostCenterDashboardFilters } from "@/src/lib/financeCostCenterAnnualSpendingChart.js";
import { loadDreCostCenterRoleMap } from "@/src/lib/financeDreCostCenterMapping.server.js";
import { prisma } from "@/src/lib/prisma.js";
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
  const referenceDate = input.referenceDate ?? new Date();
  const ytdYear = Number.isFinite(input.ytdYear) ? Math.trunc(input.ytdYear) : referenceDate.getFullYear();

  try {
    const years = yearsNeededForSpotlight(ytdYear, referenceDate);
    const [roleMap, ...dashboards] = await Promise.all([
      loadDreCostCenterRoleMap(prisma),
      ...years.map((year) =>
        buildFinanceCostCenterDashboardDefault(
          buildExecutiveReportCostCenterDashboardFilters({
            year,
            month: null,
            companyName: input.companyName,
          }),
          referenceDate
        )
      ),
    ]);

    const byCostCenter: FinanceCashFlowRawMaterialCcSpendRow[] = [];
    for (const dashboard of dashboards) {
      for (const row of dashboard.monthlySeries.byCostCenter) {
        byCostCenter.push({
          month: row.month,
          year: row.year,
          costCenterId: row.costCenterId,
          code: row.code,
          name: row.name,
          amount: row.amount,
        });
      }
    }

    return buildRawMaterialCostCenterSpotlight({
      byCostCenter,
      ytdYear,
      referenceDate,
      mappingByCcId: roleMap,
    });
  } catch (error) {
    console.error("[loadRawMaterialCostCenterSpotlight] Falha ao carregar centros de custo de matéria-prima:", error);
    return emptyRawMaterialCostCenterSpotlight(referenceDate, ytdYear);
  }
}
