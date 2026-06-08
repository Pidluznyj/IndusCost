/** Regras puras do funil operacional de pedidos — testáveis sem banco. */

import {
  isCancelledSalesOrderStatus,
  isOverdueSalesOrderInSelectedYear,
  isSalesOrderInvoiced,
} from "@/src/lib/salesOrderDashboardRules.js";

export type SalesFunnelOrderSnapshot = {
  status: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: number;
  hasNfeDataProcessamento: boolean;
  selectedYear: number;
  today: Date;
};

export function isOrderIssuedInYear(issueDate: Date, selectedYear: number): boolean {
  return issueDate.getFullYear() === selectedYear;
}

export function isValidSalesFunnelOrder(status: string): boolean {
  return !isCancelledSalesOrderStatus(status);
}

export function isInvoicedSalesFunnelOrder(hasNfeDataProcessamento: boolean): boolean {
  return isSalesOrderInvoiced(hasNfeDataProcessamento);
}

export function isOpenPortfolioSalesFunnelOrder(input: {
  status: string;
  hasNfeDataProcessamento: boolean;
}): boolean {
  return isValidSalesFunnelOrder(input.status) && !isInvoicedSalesFunnelOrder(input.hasNfeDataProcessamento);
}

export function classifySalesFunnelOrder(order: SalesFunnelOrderSnapshot): {
  emitted: boolean;
  valid: boolean;
  invoiced: boolean;
  openPortfolio: boolean;
  overdue: boolean;
  cancelled: boolean;
} {
  const emitted = isOrderIssuedInYear(order.issueDate, order.selectedYear);
  const cancelled = isCancelledSalesOrderStatus(order.status);
  const valid = emitted && !cancelled;
  const invoiced = valid && isInvoicedSalesFunnelOrder(order.hasNfeDataProcessamento);
  const openPortfolio = valid && !invoiced;
  const overdue =
    openPortfolio &&
    isOverdueSalesOrderInSelectedYear({
      status: order.status,
      issueDate: order.issueDate,
      selectedYear: order.selectedYear,
      expectedDeliveryDate: order.expectedDeliveryDate,
      today: order.today,
      hasNfeDataProcessamento: order.hasNfeDataProcessamento,
    });

  return { emitted, valid, invoiced, openPortfolio, overdue, cancelled: emitted && cancelled };
}

export function computeFunnelPercent(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return (part / total) * 100;
}

export function computeDaysOpen(issueDate: Date, today: Date): number {
  const issueDay = new Date(issueDate.getFullYear(), issueDate.getMonth(), issueDate.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = todayDay.getTime() - issueDay.getTime();
  return diff > 0 ? Math.floor(diff / (24 * 60 * 60 * 1000)) : 0;
}

export const SALES_FUNNEL_STAGE_DESCRIPTIONS = {
  emitted:
    "Todos os pedidos com data de emissão no ano selecionado, incluindo cancelados.",
  valid: "Pedidos emitidos no ano selecionado que não estão cancelados.",
  openPortfolio:
    "Pedidos válidos ainda sem nota fiscal processada — compõem a carteira comercial.",
  invoiced: "Pedidos válidos com nota fiscal processada no ano selecionado.",
  overdue:
    "Pedidos emitidos no ano selecionado, não cancelados, com entrega prevista vencida e sem NF processada.",
  cancelled: "Pedidos emitidos no ano selecionado com status cancelado.",
} as const;
