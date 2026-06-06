import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildBillingDashboardTab } from "@/src/lib/billingDashboardMetrics.js";
import { canSeeSalesOrders } from "@/src/lib/executiveDashboardHelpers.js";
import { buildSalesOrdersDashboardTab } from "@/src/lib/salesOrdersDashboardMetrics.js";
import type { ExecutiveDashboardSummary } from "@/src/lib/executiveDashboardTypes.js";
import { resolveExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";

export async function buildExecutiveDashboardSummary(
  user: AppAuthContext,
  yearParam?: unknown
): Promise<ExecutiveDashboardSummary> {
  const now = new Date();
  const yearCtx = resolveExecutiveDashboardYearContext(yearParam, now);
  const canAccess = canSeeSalesOrders(user);
  const unavailableIndicators: string[] = [];

  if (!canAccess) {
    unavailableIndicators.push(
      "Pedidos de Venda e Faturamento exigem permissão sales_orders.view ou reports.view."
    );
    return {
      generatedAt: now.toISOString(),
      selectedYear: yearCtx.selectedYear,
      previousYear: yearCtx.previousYear,
      permissions: { salesOrders: false, billing: false },
      tabs: { salesOrders: null, billing: null },
      unavailableIndicators,
    };
  }

  const [salesOrders, billing] = await Promise.all([
    buildSalesOrdersDashboardTab(yearCtx),
    buildBillingDashboardTab(yearCtx),
  ]);

  return {
    generatedAt: now.toISOString(),
    selectedYear: yearCtx.selectedYear,
    previousYear: yearCtx.previousYear,
    permissions: { salesOrders: true, billing: true },
    tabs: { salesOrders, billing },
    unavailableIndicators,
  };
}

export { resolveExecutiveDashboardYearContext };
export type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
