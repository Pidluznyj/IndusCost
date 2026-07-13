/**
 * Ponte Gestão Geral ↔ crmSalesOrderMetricsService (motor oficial Pedidos).
 */

import type { ManagementDashboardSourceInfo } from "@/src/components/crmManagementTypes";
import type { CrmSalesOrderMetricsResult } from "@/src/lib/commercial/crmSalesOrderMetricsService.js";
import type { ManagementDashboardSummary } from "@/src/components/crmManagementTypes";

export type CrmManagementDashboardRequest = {
  dateFrom?: string | null;
  dateTo?: string | null;
};

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Default: últimos 30 dias (inclui hoje). */
export function resolveManagementDashboardPeriod(
  input: CrmManagementDashboardRequest,
  now = new Date()
): { dateFrom: string; dateTo: string } {
  const to =
    input.dateTo?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo.trim())
      ? input.dateTo.trim()
      : formatYmd(now);
  if (input.dateFrom?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom.trim())) {
    return { dateFrom: input.dateFrom.trim(), dateTo: to };
  }
  const start = new Date(`${to}T12:00:00`);
  start.setDate(start.getDate() - 29);
  return { dateFrom: formatYmd(start), dateTo: to };
}

export function buildManagementDashboardSourceInfo(args: {
  dateFrom: string | null;
  dateTo: string | null;
  metrics: Pick<CrmSalesOrderMetricsResult, "debug">;
}): ManagementDashboardSourceInfo {
  return {
    pedidosFonte: "SalesOrder",
    itensFonte: "SalesOrderItem",
    eixoCarteira: "Responsável Comercial do Cliente",
    vendedorComissionavel: "Vendedor do Pedido/Nomus, somente auditoria",
    propostasUsadas: false,
    metricsSource: args.metrics.debug.metricsSource,
    rulesEngineVersion: args.metrics.debug.rulesEngineVersion,
    period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
  };
}

export function mergeOfficialOrderMetricsIntoManagementSummary(args: {
  base: ManagementDashboardSummary;
  metrics: CrmSalesOrderMetricsResult;
  totalCustomers: number;
}): ManagementDashboardSummary {
  const withoutOrder = Math.max(0, args.totalCustomers - args.metrics.customersWithOrders);
  return {
    ...args.base,
    openOrdersCount: args.metrics.openPortfolioOrders,
    openOrdersValue: args.metrics.openPortfolioValue,
    ordersIssued: args.metrics.totalOrders,
    ordersValue: args.metrics.totalOrderValue,
    invoicedOrdersCount: args.metrics.invoicedOrders,
    invoicedOrdersValue: args.metrics.invoicedValue,
    canceledOrdersCount: args.metrics.canceledOrders,
    averageTicket: args.metrics.averageTicket,
    customersWithOrders: args.metrics.customersWithOrders,
    customersWithoutOrderInPeriod: withoutOrder,
    ordersWithoutNomusSeller: args.metrics.ordersWithoutNomusSeller,
    customersWithoutCommercialResponsible: args.metrics.customersWithoutCommercialResponsible,
    ordersWithResponsibleDifferentFromOrderSeller:
      args.metrics.ordersWithResponsibleDifferentFromOrderSeller,
  };
}
