/**
 * PERF 3.1B — cronômetros no caminho compartilhado HTTP + runner de serviço.
 *
 * Causa das fases ausentes no benchmark: o script chamava os builders
 * (e o spotlight) direto, sem passar pelos wraps do handler Express.
 * Estes wrappers são a única fonte de buildDashboard / buildAnnual /
 * filterRadarPortfolio / buildRadar / assemblePayload.
 *
 * Não altera builders, queries nem regra financeira — só envolve a chamada.
 */
import { buildCashFlowAnnualComparison } from "@/src/lib/financeCashFlowAnnualComparison.js";
import { buildFinanceCashFlowDashboard } from "@/src/lib/financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowDailyRadar,
  filterDailyRadarPortfolioRows,
} from "@/src/lib/financeCashFlowDailyRadar.js";
import { measureDevPerfPhaseSync } from "@/src/lib/devPerfBaseline.server.js";

export function timedBuildDashboard(
  ...args: Parameters<typeof buildFinanceCashFlowDashboard>
): ReturnType<typeof buildFinanceCashFlowDashboard> {
  return measureDevPerfPhaseSync(
    "buildDashboard",
    () => buildFinanceCashFlowDashboard(...args),
    { account: true }
  );
}

export function timedBuildAnnual(
  ...args: Parameters<typeof buildCashFlowAnnualComparison>
): ReturnType<typeof buildCashFlowAnnualComparison> {
  return measureDevPerfPhaseSync(
    "buildAnnual",
    () => buildCashFlowAnnualComparison(...args),
    { account: true }
  );
}

export function timedFilterRadarPortfolio(
  ...args: Parameters<typeof filterDailyRadarPortfolioRows>
): ReturnType<typeof filterDailyRadarPortfolioRows> {
  return measureDevPerfPhaseSync(
    "filterRadarPortfolio",
    () => filterDailyRadarPortfolioRows(...args),
    { account: true }
  );
}

export function timedBuildRadar(
  ...args: Parameters<typeof buildFinanceCashFlowDailyRadar>
): ReturnType<typeof buildFinanceCashFlowDailyRadar> {
  return measureDevPerfPhaseSync(
    "buildRadar",
    () => buildFinanceCashFlowDailyRadar(...args),
    { account: true }
  );
}

export function timedAssembleDashboardPayload<
  TPayload extends object,
  TSpotlight,
>(
  payload: TPayload,
  rawMaterialCostCenterSpotlight: TSpotlight
): TPayload & { rawMaterialCostCenterSpotlight: TSpotlight } {
  return measureDevPerfPhaseSync(
    "assemblePayload",
    () => ({ ...payload, rawMaterialCostCenterSpotlight }),
    { account: true }
  );
}
