import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildBillingDashboardTab } from "@/src/lib/billingDashboardMetrics.js";
import { canSeeSalesOrders } from "@/src/lib/executiveDashboardHelpers.js";
import { buildSalesOrdersDashboardTab } from "@/src/lib/salesOrdersDashboardMetrics.js";
import type { ExecutiveDashboardSummary } from "@/src/lib/executiveDashboardTypes.js";

export async function buildExecutiveDashboardSummary(
  user: AppAuthContext
): Promise<ExecutiveDashboardSummary> {
  const now = new Date();
  const canAccess = canSeeSalesOrders(user);
  const unavailableIndicators: string[] = [];

  if (!canAccess) {
    unavailableIndicators.push(
      "Pedidos de Venda e Faturamento exigem permissão sales_orders.view ou reports.view."
    );
    return {
      generatedAt: now.toISOString(),
      permissions: { salesOrders: false, billing: false },
      tabs: { salesOrders: null, billing: null },
      unavailableIndicators,
    };
  }

  const [salesOrders, billing] = await Promise.all([
    buildSalesOrdersDashboardTab(now),
    buildBillingDashboardTab(now),
  ]);

  return {
    generatedAt: now.toISOString(),
    permissions: { salesOrders: true, billing: true },
    tabs: { salesOrders, billing },
    unavailableIndicators,
  };
}
