import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildBillingDashboardTab } from "@/src/lib/billingDashboardMetrics.js";
import { canSeeSalesOrders } from "@/src/lib/executiveDashboardHelpers.js";
import { buildSalesFunnelDashboardTab } from "@/src/lib/salesFunnelDashboardMetrics.js";
import { buildSalesOrdersDashboardTab } from "@/src/lib/salesOrdersDashboardMetrics.js";
import type {
  BillingDashboardTab,
  ExecutiveDashboardSummary,
  SalesFunnelDashboardTab,
  SalesOrdersDashboardTab,
} from "@/src/lib/executiveDashboardTypes.js";
import { resolveExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";

async function loadExecutiveTab<T>(
  tabName: string,
  build: () => Promise<T>
): Promise<T | null> {
  try {
    return await build();
  } catch (error) {
    console.error(`executive dashboard tab ${tabName}`, error);
    return null;
  }
}

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
    loadExecutiveTab("salesOrders", () => buildSalesOrdersDashboardTab(yearCtx)),
    loadExecutiveTab("billing", () => buildBillingDashboardTab(yearCtx)),
    loadExecutiveTab("salesFunnel", () => buildSalesFunnelDashboardTab(yearCtx)),
  ]);

  if (!salesOrders) {
    unavailableIndicators.push("Pedidos de Venda indisponíveis no momento.");
  }
  if (!billing) {
    unavailableIndicators.push("Faturamento indisponível no momento.");
  }
  if (!salesFunnel) {
    unavailableIndicators.push("Funil de Vendas indisponível no momento.");
  }

  if (!salesOrders && !billing) {
    throw new Error("Não foi possível montar Pedidos de Venda nem Faturamento.");
  }

  return {
    generatedAt: now.toISOString(),
    selectedYear: yearCtx.selectedYear,
    previousYear: yearCtx.previousYear,
    currentMonth: yearCtx.referenceDate.getMonth() + 1,
    permissions: {
      salesOrders: salesOrders != null,
      billing: billing != null,
      salesFunnel: salesFunnel != null,
    },
    tabs: {
      salesOrders: salesOrders as SalesOrdersDashboardTab | null,
      billing: billing as BillingDashboardTab | null,
      salesFunnel: salesFunnel as SalesFunnelDashboardTab | null,
    },
    unavailableIndicators,
  };
}

export { resolveExecutiveDashboardYearContext };
export type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
