/**
 * Mapeamento e regras puras do dashboard gerencial CRM (base: SalesOrder).
 */

import { safeCommercialNumber } from "@/src/lib/customerCommercialSalesOrderView";

export const MANAGEMENT_RISK_REASON_CODES = {
  ORDER_WITHOUT_FOLLOW_UP: "ORDER_WITHOUT_FOLLOW_UP",
  NO_PURCHASE_90D: "NO_PURCHASE_90D",
  NO_VALID_PURCHASE: "NO_VALID_PURCHASE",
  OPEN_ORDERS_IN_PORTFOLIO: "OPEN_ORDERS_IN_PORTFOLIO",
  OVERDUE_OPEN_ORDER: "OVERDUE_OPEN_ORDER",
} as const;

export function mgmtToNumber(value: unknown, fallback = 0): number {
  return safeCommercialNumber(value, fallback);
}

export function mgmtDisplayName(companyName: string, tradeName: string | null): string {
  const t = tradeName?.trim();
  return t && t.length > 0 ? t : companyName;
}

export function mgmtDaysSince(d: Date | null | undefined, nowMs: number): number | null {
  if (!d) return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

export function mgmtIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

export function buildManagementRiskReasons(input: {
  riskLevel: string;
  hasOrderNoFollowUp: boolean;
  lastPurchaseAt: Date | null;
  openOrdersCount: number;
  hasOverdueOpenOrder?: boolean;
  since90: Date;
}): string[] {
  const reasons: string[] = [];
  if (input.hasOrderNoFollowUp) reasons.push(MANAGEMENT_RISK_REASON_CODES.ORDER_WITHOUT_FOLLOW_UP);
  if (input.hasOverdueOpenOrder) reasons.push(MANAGEMENT_RISK_REASON_CODES.OVERDUE_OPEN_ORDER);
  if (input.lastPurchaseAt && input.lastPurchaseAt < input.since90) {
    reasons.push(MANAGEMENT_RISK_REASON_CODES.NO_PURCHASE_90D);
  } else if (!input.lastPurchaseAt) {
    reasons.push(MANAGEMENT_RISK_REASON_CODES.NO_VALID_PURCHASE);
  }
  if (input.openOrdersCount > 0 && input.riskLevel === "MEDIUM") {
    reasons.push(MANAGEMENT_RISK_REASON_CODES.OPEN_ORDERS_IN_PORTFOLIO);
  }
  return reasons;
}

export function buildManagementSuggestedAction(input: {
  lastPurchaseAt: Date | null;
  lastContactAt: Date | null;
  openOrdersCount: number;
  tier: number;
  since30: Date;
}): string {
  if (input.tier === 1 || (input.lastPurchaseAt && input.lastPurchaseAt >= input.since30)) {
    return "Realizar pós-venda e identificar nova oportunidade.";
  }
  if (input.openOrdersCount > 0) {
    return "Acompanhar pedido em carteira.";
  }
  if (!input.lastContactAt || input.lastContactAt < input.since30) {
    return "Retomar cliente sem pedido recente.";
  }
  return "Atuar sobre carteira aberta.";
}

export function computeManagementTicketAverage(totalValue: number, count: number): number {
  if (!Number.isFinite(totalValue) || !Number.isFinite(count) || count <= 0) return 0;
  const avg = totalValue / count;
  return Number.isFinite(avg) ? avg : 0;
}
