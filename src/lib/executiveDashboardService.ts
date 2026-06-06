import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildBillingDashboardTab } from "@/src/lib/billingDashboardMetrics.js";
import { canSeeSalesOrders } from "@/src/lib/executiveDashboardHelpers.js";
import { buildSalesFunnelDashboardTab } from "@/src/lib/salesFunnelDashboardMetrics.js";
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
      "Pedidos de Venda, Faturamento e Funil exigem permissão sales_orders.view ou reports.view."
    );
    return {
      generatedAt: now.toISOString(),
      selectedYear: yearCtx.selectedYear,
      previousYear: yearCtx.previousYear,
      currentMonth: now.getMonth() + 1,
      permissions: { salesOrders: false, billing: false, salesFunnel: false },
      tabs: { salesOrders: null, billing: null, salesFunnel: null },
      unavailableIndicators,
    };
  }

  const [salesOrders, billing, salesFunnel] = await Promise.all([
    buildSalesOrdersDashboardTab(yearCtx),
    buildBillingDashboardTab(yearCtx),
    buildSalesFunnelDashboardTab(yearCtx),
  ]);

  return {
    generatedAt: now.toISOString(),
    selectedYear: yearCtx.selectedYear,
    previousYear: yearCtx.previousYear,
    currentMonth: yearCtx.referenceDate.getMonth() + 1,
    permissions: { salesOrders: true, billing: true, salesFunnel: true },
    tabs: { salesOrders, billing, salesFunnel },
    unavailableIndicators,
  };
}

export { resolveExecutiveDashboardYearContext };
export type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
