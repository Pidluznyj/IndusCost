/**
 * Variantes semânticas e formatação para cards KPI da Gestão de Pedidos de Venda.
 * Apenas apresentação — sem cálculo de negócio.
 */
import type { MetricCardVariant } from "@/src/components/ui/MetricCard";
import { formatFullCurrency } from "@/src/lib/formatFinancialMetric";
import type { ManagementStatusCardId } from "@/src/lib/salesOrderManagementStatus";

export function toFiniteMetricNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatOrderCountLabel(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return "—";
  return `${count} pedido${count === 1 ? "" : "s"}`;
}

export function resolveLogisticStatusCardVariant(
  key: ManagementStatusCardId | "total"
): MetricCardVariant {
  switch (key) {
    case "total":
      return "info";
    case "deliveredOnTime":
    case "onTimePending":
      return "success";
    case "deliveredLate":
    case "overduePending":
      return "danger";
    case "reviewData":
      return "warning";
    case "finishedOrCancelled":
    default:
      return "neutral";
  }
}

export function resolveMarginMoneyVariant(value: unknown): MetricCardVariant {
  const n = toFiniteMetricNumber(value);
  if (n == null) return "neutral";
  if (n < 0) return "danger";
  if (n > 0) return "success";
  return "neutral";
}

export function resolveMarginPercentVariant(value: unknown): MetricCardVariant {
  const n = toFiniteMetricNumber(value);
  if (n == null) return "neutral";
  if (n < 0) return "danger";
  if (n < 10) return "warning";
  if (n > 0) return "success";
  return "neutral";
}

export function resolveAlertCountVariant(count: unknown): MetricCardVariant {
  const n = toFiniteMetricNumber(count);
  if (n == null) return "neutral";
  return n > 0 ? "warning" : "neutral";
}

export function resolveNegativeMarginCountVariant(count: unknown): MetricCardVariant {
  const n = toFiniteMetricNumber(count);
  if (n == null) return "neutral";
  return n > 0 ? "danger" : "neutral";
}

export function resolveFulfillmentKpiVariant(
  key: string,
  numericValue: number | null
): MetricCardVariant {
  if (numericValue == null) return "neutral";

  switch (key) {
    case "totalOrders":
    case "totalSold":
    case "totalInvoiced":
      return "info";
    case "withNfe":
    case "onTime":
    case "pendingOnTime":
    case "onTimePct":
      return numericValue > 0 ? "success" : "neutral";
    case "withoutNfe":
    case "partial":
    case "cut":
    case "review":
    case "gap":
      return numericValue > 0 ? "warning" : "neutral";
    case "late":
    case "pendingLate":
      return numericValue > 0 ? "danger" : "neutral";
    case "sla":
    case "avgFulfillment":
    case "avgInvoiced":
    default:
      return "neutral";
  }
}

export function metricCurrencySubtitle(value: unknown): string | undefined {
  const n = toFiniteMetricNumber(value);
  if (n == null) return undefined;
  return formatFullCurrency(n);
}
