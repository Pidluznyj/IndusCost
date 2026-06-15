/**
 * Regras canônicas comerciais baseadas em Pedido de Venda (SalesOrder).
 * Ponto central para CRM, indicadores e dashboards — reutiliza helpers existentes.
 */

import {
  isCancelledSalesOrderStatus,
  isOverdueSalesOrder,
  isOpenPortfolioOrder,
  isSalesOrderInvoiced,
} from "@/src/lib/salesOrderDashboardRules";
import {
  normalizeCustomerDocument,
  salesOrderHasInvoicing,
  salesOrderMatchesCustomer,
  safeCommercialNumber,
} from "@/src/lib/customerCommercialSalesOrderView";

/** Pedidos considerados “compra válida” no CRM (mesma regra do cockpit legado e 360°). */
export const VALID_PURCHASE_ORDER_STATUSES = ["READY_TO_SEND", "SENT_TO_NOMUS"] as const;

export type ValidPurchaseOrderStatus = (typeof VALID_PURCHASE_ORDER_STATUSES)[number];

const VALID_PURCHASE_STATUS_SET = new Set<string>(VALID_PURCHASE_ORDER_STATUSES);

export const CRM_ORDER_FOLLOW_UP_NOTE =
  "Follow-up de pedidos: prioriza CommercialActivity.salesOrderId; fallback por atividade do cliente sem vínculo a pedido.";

export type CommercialSalesOrderSnapshot = {
  status: string;
  totalNetValue?: unknown;
  issueDate?: Date | string | null;
  updatedAt?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
  nomusRawResponse?: unknown;
  hasInvoicing?: boolean;
};

export function isValidCommercialSalesOrder(order: Pick<CommercialSalesOrderSnapshot, "status">): boolean {
  const st = String(order.status ?? "");
  return !isCancelledSalesOrderStatus(st) && st !== "ERROR";
}

export function isPurchaseSalesOrder(order: Pick<CommercialSalesOrderSnapshot, "status">): boolean {
  return VALID_PURCHASE_STATUS_SET.has(String(order.status ?? ""));
}

export function resolveSalesOrderHasInvoicing(order: CommercialSalesOrderSnapshot): boolean {
  if (typeof order.hasInvoicing === "boolean") return order.hasInvoicing;
  return salesOrderHasInvoicing(order.nomusRawResponse);
}

export { salesOrderHasInvoicing, normalizeCustomerDocument, salesOrderMatchesCustomer };

export function isOpenPortfolioSalesOrder(order: CommercialSalesOrderSnapshot): boolean {
  if (!isValidCommercialSalesOrder(order)) return false;
  return isOpenPortfolioOrder({
    status: order.status,
    hasNfeDataProcessamento: resolveSalesOrderHasInvoicing(order),
  });
}

export function isOverdueOpenSalesOrder(
  order: CommercialSalesOrderSnapshot,
  today: Date = new Date()
): boolean {
  if (!isOpenPortfolioSalesOrder(order)) return false;
  const expected = order.expectedDeliveryDate;
  const expectedDate =
    expected == null ? null : expected instanceof Date ? expected : new Date(expected);
  if (!expectedDate || !Number.isFinite(expectedDate.getTime())) return false;
  return isOverdueSalesOrder({
    status: order.status,
    expectedDeliveryDate: expectedDate,
    today,
    hasNfeDataProcessamento: resolveSalesOrderHasInvoicing(order),
  });
}

export function getSalesOrderNetValue(order: Pick<CommercialSalesOrderSnapshot, "totalNetValue">): number {
  return safeCommercialNumber(order.totalNetValue, 0);
}

export function getSalesOrderIssueDate(order: Pick<CommercialSalesOrderSnapshot, "issueDate">): Date | null {
  const raw = order.issueDate;
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function getSalesOrderUpdatedAt(order: Pick<CommercialSalesOrderSnapshot, "updatedAt">): Date | null {
  const raw = order.updatedAt;
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Soma totalNetValue de pedidos válidos por customerId (base ABC). */
export function aggregateValidSalesOrderRevenueByCustomer(
  rows: Array<{ customerId: string; totalNetValue: unknown; status: string }>
): Array<{ customerId: string; revenue: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!isValidCommercialSalesOrder(row)) continue;
    const net = getSalesOrderNetValue(row);
    map.set(row.customerId, (map.get(row.customerId) ?? 0) + net);
  }
  return [...map.entries()].map(([customerId, revenue]) => ({ customerId, revenue }));
}

export function isInvoicedSalesOrder(order: CommercialSalesOrderSnapshot): boolean {
  if (!isValidCommercialSalesOrder(order)) return false;
  return isSalesOrderInvoiced(resolveSalesOrderHasInvoicing(order));
}
