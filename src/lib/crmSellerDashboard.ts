/**
 * Regras puras do dashboard por vendedor (base: SalesOrder).
 */

import { safeCommercialNumber } from "@/src/lib/customerCommercialSalesOrderView";

export function sellerDashToNumber(value: unknown, fallback = 0): number {
  return safeCommercialNumber(value, fallback);
}

export function computeSellerTicketAverage(totalValue: number, orderCount: number): number {
  if (!Number.isFinite(totalValue) || !Number.isFinite(orderCount) || orderCount <= 0) return 0;
  const avg = totalValue / orderCount;
  return Number.isFinite(avg) ? avg : 0;
}

export function sellerDashIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}
