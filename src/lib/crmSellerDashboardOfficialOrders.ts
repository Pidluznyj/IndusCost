/**
 * Ponte Gestão por Vendedor ↔ eixo Responsável Comercial + SalesOrder metrics.
 * Não usa Proposal. Não altera comissão (vendedor Nomus permanece só auditoria).
 */

import type { CrmSalesOrderMetricsResult } from "@/src/lib/commercial/crmSalesOrderMetricsService.js";
import type {
  SellerDashboardSourceInfo,
  SellerDashboardSummary,
} from "@/src/components/crmSellerDashboardTypes";

export const SELLER_DASHBOARD_PORTFOLIO_AXIS = "RESPONSAVEL_COMERCIAL_CLIENTE" as const;

export function buildSellerDashboardSourceInfo(args?: {
  metricsSource?: string;
  rulesEngineVersion?: string;
  period?: { dateFrom: string | null; dateTo: string | null };
}): SellerDashboardSourceInfo {
  return {
    eixo: SELLER_DASHBOARD_PORTFOLIO_AXIS,
    pedidosFonte: "SalesOrder",
    itensFonte: "SalesOrderItem",
    vendedorPedidoFonte: "Nomus/SalesOrder seller field",
    comissionamentoAfetado: false,
    metricsSource: args?.metricsSource,
    rulesEngineVersion: args?.rulesEngineVersion,
    period: args?.period,
  };
}

export function mergeOfficialMetricsIntoSellerSummary(args: {
  metrics: CrmSalesOrderMetricsResult;
  ordersWithoutLinkedProposalCount?: number;
}): SellerDashboardSummary {
  const m = args.metrics;
  const leading = m.leadingProduct;
  return {
    ordersCount: m.totalOrders,
    ordersValue: m.totalOrderValue,
    invoicedOrdersCount: m.invoicedOrders,
    invoicedOrdersValue: m.invoicedValue,
    openOrdersCount: m.openPortfolioOrders,
    openOrdersValue: m.openPortfolioValue,
    cancelledOrdersCount: m.canceledOrders,
    uniqueCustomersCount: m.customersWithOrders,
    ticketAverage: m.averageTicket,
    metricsSource: m.debug.metricsSource,
    topProduct: leading
      ? {
          productId: leading.productId ?? "",
          productName: leading.productName ?? leading.sku ?? "—",
          sku: leading.sku ?? "",
          revenue: leading.revenue,
          quantity: leading.quantity,
        }
      : null,
    ordersWithoutLinkedProposalCount: args.ordersWithoutLinkedProposalCount ?? 0,
    totalOrders: m.totalOrders,
    totalOrderValue: m.totalOrderValue,
    openPortfolioOrders: m.openPortfolioOrders,
    openPortfolioValue: m.openPortfolioValue,
    invoicedOrders: m.invoicedOrders,
    invoicedValue: m.invoicedValue,
    canceledOrders: m.canceledOrders,
    averageTicket: m.averageTicket,
    customersWithOrders: m.customersWithOrders,
    ordersWithoutNomusSeller: m.ordersWithoutNomusSeller,
    ordersWithDifferentNomusSeller: m.ordersWithResponsibleDifferentFromOrderSeller,
  };
}

export function resolveSelectedCommercialOwnerLabel(args: {
  responsible: string | null;
  sellerIdentityKey: string | null;
  externalSellerId: number | null;
}): string | null {
  if (args.responsible?.trim()) return args.responsible.trim();
  if (args.sellerIdentityKey?.trim() && !args.sellerIdentityKey.startsWith("__ID_ONLY__:")) {
    return args.sellerIdentityKey.trim();
  }
  if (args.externalSellerId != null) return `ID Nomus ${args.externalSellerId}`;
  return null;
}
