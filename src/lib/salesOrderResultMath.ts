/**
 * Margem gerencial de resultado — estende motor oficial de margem com imposto (TaxRule).
 *
 * Receita líquida gerencial = valor vendido − imposto estimado
 * Margem R$ = receita líquida gerencial − custo total
 * Margem % agregada = Σ margem R$ ÷ Σ receita líquida gerencial
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import {
  computeNetSalesAmount,
  computeSalesTaxAmount,
} from "./averageSalesTaxEngine.js";
import type {
  SalesOrderResultItemInput,
  SalesOrderResultMonthlyRow,
  SalesOrderResultTotals,
} from "./salesOrderResultTypes.js";

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type SalesOrderResultComputedItem = {
  salesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number | null;
  quantity: number;
  orderId: string;
  issueMonth: number;
  marginStatus: SalesOrderResultItemInput["marginStatus"];
};

export function computeSalesOrderResultItem(
  input: SalesOrderResultItemInput
): SalesOrderResultComputedItem {
  const salesAmount = roundPricingMoney(Math.max(0, input.salesAmount));
  const costAmount = roundPricingMoney(Math.max(0, input.costAmount));
  const taxAmount = computeSalesTaxAmount(salesAmount, input.taxPercent);
  const netSalesAmount = computeNetSalesAmount(salesAmount, taxAmount);
  const marginAmount = roundPricingMoney(netSalesAmount - costAmount);
  const marginPercent =
    netSalesAmount > 0 ? roundPricingPercent((marginAmount / netSalesAmount) * 100) : null;

  return {
    salesAmount,
    taxAmount,
    netSalesAmount,
    costAmount,
    marginAmount,
    marginPercent,
    quantity: input.quantity,
    orderId: input.orderId,
    issueMonth: input.issueMonth,
    marginStatus: input.marginStatus,
  };
}

export function aggregateSalesOrderResultTotals(
  items: SalesOrderResultComputedItem[],
  opts: {
    taxPercentApplied: number;
    taxSourceLabel: string;
  }
): SalesOrderResultTotals {
  let salesAmount = 0;
  let taxAmount = 0;
  let netSalesAmount = 0;
  let costAmount = 0;
  let marginAmount = 0;
  let totalQuantity = 0;
  let missingCostCount = 0;
  let missingProductCount = 0;
  let negativeMarginCount = 0;
  const orderIds = new Set<string>();

  for (const item of items) {
    orderIds.add(item.orderId);
    salesAmount += item.salesAmount;
    taxAmount += item.taxAmount;
    netSalesAmount += item.netSalesAmount;
    costAmount += item.costAmount;
    marginAmount += item.marginAmount;
    totalQuantity += item.quantity;
    if (item.marginStatus === "SEM_CUSTO") missingCostCount += 1;
    if (item.marginStatus === "SEM_PRODUTO_VINCULADO") missingProductCount += 1;
    if (item.marginStatus === "MARGEM_NEGATIVA" || item.marginAmount < 0) negativeMarginCount += 1;
  }

  salesAmount = roundPricingMoney(salesAmount);
  taxAmount = roundPricingMoney(taxAmount);
  netSalesAmount = roundPricingMoney(netSalesAmount);
  costAmount = roundPricingMoney(costAmount);
  marginAmount = roundPricingMoney(marginAmount);

  const marginPercent =
    netSalesAmount > 0 ? roundPricingPercent((marginAmount / netSalesAmount) * 100) : null;
  const averageUnitMargin =
    totalQuantity > 0 ? roundPricingMoney(marginAmount / totalQuantity) : null;

  return {
    salesAmount,
    taxAmount,
    netSalesAmount,
    costAmount,
    marginAmount,
    marginPercent,
    averageUnitMargin,
    ordersCount: orderIds.size,
    itemsCount: items.length,
    totalQuantity,
    missingCostCount,
    missingProductCount,
    negativeMarginCount,
    taxPercentApplied: opts.taxPercentApplied,
    taxSourceLabel: opts.taxSourceLabel,
  };
}

export function buildSalesOrderResultMonthlyRows(
  items: SalesOrderResultComputedItem[],
  year: number
): SalesOrderResultMonthlyRow[] {
  const buckets = new Map<number, SalesOrderResultMonthlyRow>();

  for (let month = 1; month <= 12; month += 1) {
    buckets.set(month, {
      month,
      monthLabel: MONTH_LABELS[month - 1] ?? String(month),
      salesAmount: 0,
      taxAmount: 0,
      netSalesAmount: 0,
      costAmount: 0,
      marginAmount: 0,
      marginPercent: null,
      ordersCount: 0,
    });
  }

  const ordersByMonth = new Map<number, Set<string>>();

  for (const item of items) {
    if (item.issueMonth < 1 || item.issueMonth > 12) continue;
    const bucket = buckets.get(item.issueMonth)!;
    bucket.salesAmount += item.salesAmount;
    bucket.taxAmount += item.taxAmount;
    bucket.netSalesAmount += item.netSalesAmount;
    bucket.costAmount += item.costAmount;
    bucket.marginAmount += item.marginAmount;
    const monthOrders = ordersByMonth.get(item.issueMonth) ?? new Set<string>();
    monthOrders.add(item.orderId);
    ordersByMonth.set(item.issueMonth, monthOrders);
  }

  return [...buckets.values()].map((row) => {
    row.salesAmount = roundPricingMoney(row.salesAmount);
    row.taxAmount = roundPricingMoney(row.taxAmount);
    row.netSalesAmount = roundPricingMoney(row.netSalesAmount);
    row.costAmount = roundPricingMoney(row.costAmount);
    row.marginAmount = roundPricingMoney(row.marginAmount);
    row.marginPercent =
      row.netSalesAmount > 0
        ? roundPricingPercent((row.marginAmount / row.netSalesAmount) * 100)
        : null;
    row.ordersCount = ordersByMonth.get(row.month)?.size ?? 0;
    return row;
  });
}

/** Anti-padrão documentado — não usar em produção. */
export function naiveAverageResultMarginPercent(items: SalesOrderResultComputedItem[]): number | null {
  const percents = items
    .map((item) => item.marginPercent)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (percents.length === 0) return null;
  return roundPricingPercent(percents.reduce((a, b) => a + b, 0) / percents.length);
}
