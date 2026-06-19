import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import { computeTicketAverage } from "./salesOrderDashboardRules.js";
import { getSalesOrderNetValue } from "./crmCommercialOrderRules.js";
import {
  buildBiLogisticStatusCardMetrics,
  buildSalesOrderBiLogisticStatus,
  BI_LOGISTIC_STATUS_CARDS,
  emptyBiLogisticStatusCardAmounts,
  emptyBiLogisticStatusCardCounts,
  isBiLogisticStatusCardId,
  type BiLogisticStatusCardId,
} from "./salesOrderLogisticStatus.js";
import {
  emptyManufacturingStatusBreakdown,
  MANUFACTURING_STATUS_LABELS,
  MANUFACTURING_STATUS_POWER_BI_CODES,
  resolveOrderManufacturingStatusCode,
  type ManufacturingStatusPowerBiCode,
} from "./financeSalesOrdersManufacturingStatus.js";
import type {
  FinanceSalesOrdersCriticalOrderRow,
  FinanceSalesOrdersDashboardFilters,
  FinanceSalesOrdersLogisticStatusBreakdownRow,
  FinanceSalesOrdersManufacturingStatusBreakdownRow,
  FinanceSalesOrdersOpenPortfolioEvolutionRow,
  FinanceSalesOrdersTopSellerRow,
} from "./financeSalesOrdersDashboardTypes.js";
import { FINANCE_SALES_ORDERS_MONTH_LABELS } from "./financeSalesOrdersDashboardTypes.js";

export type FinanceSalesOrdersDashboardOrderRow = {
  id: string;
  orderCode: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: number;
  responsible: string | null;
  customerId: string;
  customerName: string;
  nomusRawResponse: unknown;
  updatedAt: Date;
  sentToNomusAt: Date | null;
};

export function mapPrismaOrderToDashboardRow(order: {
  id: string;
  orderCode: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: unknown;
  responsible: string | null;
  nomusRawResponse: unknown;
  updatedAt: Date;
  sentToNomusAt: Date | null;
  Customer: { id: string; companyName: string; tradeName: string | null };
}): FinanceSalesOrdersDashboardOrderRow {
  return {
    id: order.id,
    orderCode: order.orderCode,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    totalNetValue: getSalesOrderNetValue(order),
    responsible: order.responsible,
    customerId: order.Customer.id,
    customerName:
      order.Customer.tradeName?.trim() || order.Customer.companyName?.trim() || "—",
    nomusRawResponse: order.nomusRawResponse,
    updatedAt: order.updatedAt,
    sentToNomusAt: order.sentToNomusAt,
  };
}

export function filterOrdersByLogisticStatus(
  rows: Array<FinanceSalesOrdersDashboardOrderRow & { logisticStatusCardId: BiLogisticStatusCardId }>,
  logisticStatus: string | null | undefined
): Array<FinanceSalesOrdersDashboardOrderRow & { logisticStatusCardId: BiLogisticStatusCardId }> {
  if (!logisticStatus || !isBiLogisticStatusCardId(logisticStatus)) return rows;
  return rows.filter((row) => row.logisticStatusCardId === logisticStatus);
}

export function enrichOrdersWithLogisticStatus(
  rows: FinanceSalesOrdersDashboardOrderRow[],
  referenceDate = new Date()
): Array<FinanceSalesOrdersDashboardOrderRow & { logisticStatusCardId: BiLogisticStatusCardId }> {
  return rows.map((row) => {
    const logistic = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: row.expectedDeliveryDate,
      nomusRawResponse: row.nomusRawResponse,
      referenceDate,
    });
    return { ...row, logisticStatusCardId: logistic.cardId };
  });
}

export function buildManufacturingStatusBreakdown(
  rows: FinanceSalesOrdersDashboardOrderRow[]
): FinanceSalesOrdersManufacturingStatusBreakdownRow[] {
  const buckets = new Map<ManufacturingStatusPowerBiCode, { amount: number; count: number }>();
  for (const code of MANUFACTURING_STATUS_POWER_BI_CODES) {
    buckets.set(code, { amount: 0, count: 0 });
  }

  for (const row of rows) {
    const code = resolveOrderManufacturingStatusCode(row.nomusRawResponse);
    if (code === "unknown") continue;
    const bucket = buckets.get(code)!;
    bucket.amount += row.totalNetValue;
    bucket.count += 1;
  }

  return MANUFACTURING_STATUS_POWER_BI_CODES.map((code) => ({
    code,
    label: MANUFACTURING_STATUS_LABELS[code],
    amount: buckets.get(code)?.amount ?? 0,
    orderCount: buckets.get(code)?.count ?? 0,
  }));
}

export function buildLogisticStatusBreakdown(
  rows: Array<FinanceSalesOrdersDashboardOrderRow & { logisticStatusCardId: BiLogisticStatusCardId }>
): FinanceSalesOrdersLogisticStatusBreakdownRow[] {
  const { counts, amounts } = buildBiLogisticStatusCardMetrics(
    rows.map((row) => ({
      logisticStatusCardId: row.logisticStatusCardId,
      totalNetValue: row.totalNetValue,
    }))
  );
  const totalAmount = rows.reduce((sum, row) => sum + row.totalNetValue, 0);

  return BI_LOGISTIC_STATUS_CARDS.map((card) => ({
    cardId: card.id,
    label: card.label,
    amount: amounts[card.id],
    orderCount: counts[card.id],
    sharePercent: totalAmount > 0 ? (amounts[card.id] / totalAmount) * 100 : null,
    hint: card.hint,
  }));
}

export function buildTopSellersFromOrders(
  rows: FinanceSalesOrdersDashboardOrderRow[],
  limit = 10
): FinanceSalesOrdersTopSellerRow[] {
  const bySeller = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const name = row.responsible?.trim() || "Sem vendedor";
    const current = bySeller.get(name) ?? { amount: 0, count: 0 };
    current.amount += row.totalNetValue;
    current.count += 1;
    bySeller.set(name, current);
  }

  const totalAmount = rows.reduce((sum, row) => sum + row.totalNetValue, 0);
  return [...bySeller.entries()]
    .map(([sellerName, agg]) => ({
      sellerName,
      amount: agg.amount,
      orderCount: agg.count,
      averageTicketAmount: computeTicketAverage(agg.amount, agg.count),
      sharePercent: totalAmount > 0 ? (agg.amount / totalAmount) * 100 : null,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export type CriticalOrderReason =
  | "overdue_pending"
  | "high_open_portfolio"
  | "without_invoice"
  | "review_data";

export function buildCriticalOrders(
  rows: Array<FinanceSalesOrdersDashboardOrderRow & { logisticStatusCardId: BiLogisticStatusCardId }>,
  limit = 15
): FinanceSalesOrdersCriticalOrderRow[] {
  const candidates: FinanceSalesOrdersCriticalOrderRow[] = [];

  for (const row of rows) {
    const hasInvoice = salesOrderHasInvoicing(row.nomusRawResponse);
    const reasons: CriticalOrderReason[] = [];

    if (row.logisticStatusCardId === "overduePending") {
      reasons.push("overdue_pending");
    }
    if (row.logisticStatusCardId === "reviewData") {
      reasons.push("review_data");
    }
    if (!hasInvoice) {
      reasons.push("without_invoice");
      if (row.totalNetValue >= 0) {
        reasons.push("high_open_portfolio");
      }
    }

    if (reasons.length === 0) continue;

    candidates.push({
      orderId: row.id,
      orderCode: row.orderCode,
      customerName: row.customerName,
      sellerName: row.responsible?.trim() || "—",
      amount: row.totalNetValue,
      logisticStatusLabel:
        BI_LOGISTIC_STATUS_CARDS.find((c) => c.id === row.logisticStatusCardId)?.label ??
        row.logisticStatusCardId,
      logisticStatusCardId: row.logisticStatusCardId,
      hasProcessedInvoice: hasInvoice,
      expectedDeliveryDate: row.expectedDeliveryDate?.toISOString().slice(0, 10) ?? null,
      reasons: [...new Set(reasons)],
    });
  }

  return candidates
    .sort((a, b) => {
      const score = (r: FinanceSalesOrdersCriticalOrderRow) => {
        let s = 0;
        if (r.reasons.includes("overdue_pending")) s += 1000;
        if (r.reasons.includes("review_data")) s += 500;
        if (r.reasons.includes("without_invoice")) s += 100;
        return s;
      };
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return b.amount - a.amount;
    })
    .slice(0, limit);
}

export function buildOpenPortfolioEvolution(
  rows: FinanceSalesOrdersDashboardOrderRow[],
  selectedYear: number
): FinanceSalesOrdersOpenPortfolioEvolutionRow[] {
  const byMonth = new Map<number, { openAmount: number; openCount: number; totalAmount: number }>();
  for (let m = 1; m <= 12; m += 1) {
    byMonth.set(m, { openAmount: 0, openCount: 0, totalAmount: 0 });
  }

  for (const row of rows) {
    if (row.issueDate.getFullYear() !== selectedYear) continue;
    const month = row.issueDate.getMonth() + 1;
    const bucket = byMonth.get(month)!;
    bucket.totalAmount += row.totalNetValue;
    if (!salesOrderHasInvoicing(row.nomusRawResponse)) {
      bucket.openAmount += row.totalNetValue;
      bucket.openCount += 1;
    }
  }

  return FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, index) => {
    const month = index + 1;
    const data = byMonth.get(month)!;
    return {
      month,
      monthLabel,
      openAmount: data.openAmount,
      openCount: data.openCount,
      issuedAmount: data.totalAmount,
    };
  });
}

export function resolveLastNomusSyncAt(
  rows: FinanceSalesOrdersDashboardOrderRow[]
): string | null {
  let latest: Date | null = null;
  for (const row of rows) {
    const candidates = [row.updatedAt, row.sentToNomusAt].filter((d): d is Date => d != null);
    for (const d of candidates) {
      if (latest == null || d > latest) latest = d;
    }
  }
  return latest?.toISOString() ?? null;
}

export function buildExtendedMetricsFromOrders(input: {
  orders: FinanceSalesOrdersDashboardOrderRow[];
  filters: FinanceSalesOrdersDashboardFilters;
  referenceDate?: Date;
}): {
  manufacturingStatusBreakdown: FinanceSalesOrdersManufacturingStatusBreakdownRow[];
  logisticStatusBreakdown: FinanceSalesOrdersLogisticStatusBreakdownRow[];
  topSellers: FinanceSalesOrdersTopSellerRow[];
  criticalOrders: FinanceSalesOrdersCriticalOrderRow[];
  openPortfolioEvolution: FinanceSalesOrdersOpenPortfolioEvolutionRow[];
  lastNomusSyncAt: string | null;
  logisticCounts: Record<BiLogisticStatusCardId, number>;
  logisticAmounts: Record<BiLogisticStatusCardId, number>;
} {
  const referenceDate = input.referenceDate ?? new Date();
  const enriched = enrichOrdersWithLogisticStatus(input.orders, referenceDate);
  const filtered = filterOrdersByLogisticStatus(enriched, input.filters.logisticStatus);

  const { counts: logisticCounts, amounts: logisticAmounts } = buildBiLogisticStatusCardMetrics(
    filtered.map((row) => ({
      logisticStatusCardId: row.logisticStatusCardId,
      totalNetValue: row.totalNetValue,
    }))
  );

  return {
    manufacturingStatusBreakdown: buildManufacturingStatusBreakdown(filtered),
    logisticStatusBreakdown: buildLogisticStatusBreakdown(filtered),
    topSellers: buildTopSellersFromOrders(filtered),
    criticalOrders: buildCriticalOrders(filtered),
    openPortfolioEvolution: buildOpenPortfolioEvolution(filtered, input.filters.year),
    lastNomusSyncAt: resolveLastNomusSyncAt(input.orders),
    logisticCounts,
    logisticAmounts,
  };
}

export function financeSalesOrdersExtendedMetricsAreFinite(metrics: {
  manufacturingStatusBreakdown: FinanceSalesOrdersManufacturingStatusBreakdownRow[];
  logisticStatusBreakdown: FinanceSalesOrdersLogisticStatusBreakdownRow[];
  topSellers: FinanceSalesOrdersTopSellerRow[];
  criticalOrders: FinanceSalesOrdersCriticalOrderRow[];
  openPortfolioEvolution: FinanceSalesOrdersOpenPortfolioEvolutionRow[];
}): boolean {
  const nums: Array<number | null | undefined> = [
    ...metrics.manufacturingStatusBreakdown.flatMap((r) => [r.amount, r.orderCount]),
    ...metrics.logisticStatusBreakdown.flatMap((r) => [r.amount, r.orderCount, r.sharePercent]),
    ...metrics.topSellers.flatMap((r) => [r.amount, r.orderCount, r.averageTicketAmount, r.sharePercent]),
    ...metrics.criticalOrders.map((r) => r.amount),
    ...metrics.openPortfolioEvolution.flatMap((r) => [
      r.openAmount,
      r.openCount,
      r.issuedAmount,
    ]),
  ];
  return nums.every((v) => v == null || Number.isFinite(v));
}

/** Agrupa pedidos por mês de emissão para carteira aberta (sem histórico de snapshot). */
export const OPEN_PORTFOLIO_EVOLUTION_NOTE =
  "Evolução por mês de emissão do pedido: valor em carteira = pedidos emitidos no mês ainda sem NF processada. Não há série histórica de snapshot diário.";

export { emptyBiLogisticStatusCardCounts, emptyBiLogisticStatusCardAmounts, emptyManufacturingStatusBreakdown };
