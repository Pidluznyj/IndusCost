/**
 * Agregações e filtros puros do Relatório de descontos comerciais.
 * Desconto % e margem % sempre ponderados (Σ R$ / Σ base) — nunca média simples.
 */
import { roundPricingMoney } from "@/src/lib/pricingCalculations.js";
import {
  DISCOUNT_STATUS_LABEL,
  emptyCommercialDiscountKpis,
  marginStatusLabel,
  monthLabelPtBr,
  weightedCommercialMarginPercent,
  weightedDiscountRate,
  yearMonthKeyFromIssueIso,
  type CommercialDiscountBillingFilter,
  type CommercialDiscountDetailRow,
  type CommercialDiscountDimensionRow,
  type CommercialDiscountMonthlyPoint,
  type CommercialDiscountOrderHighlight,
  type CommercialDiscountPresenceFilter,
  type CommercialDiscountProductRiskRow,
  type CommercialDiscountReportKpis,
  type CommercialDiscountReportSortBy,
  type CommercialDiscountReportViews,
} from "./salesOrderCommercialDiscountReport.js";

export type DiscountReportItemInput = {
  salesOrderId: string;
  orderCode: string;
  issueDate: string | null;
  customerId: string | null;
  customerName: string;
  sellerName: string;
  hasInvoice: boolean;
  itemId: string;
  itemSequence: string | null;
  productId: string;
  sku: string;
  productName: string;
  familyName: string;
  activeQuantity: number;
  grossUnitPrice: number;
  grossActiveValue: number;
  discountValue: number;
  discountRate: number; // 0–1
  netUnitPrice: number | null;
  netActiveValue: number | null;
  commercialAdditionValue: number;
  discountStatus: CommercialDiscountDetailRow["discountStatus"];
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null; // 0–100
  marginCalculated: boolean;
  hasDiscountDivergence: boolean;
  divergenceLabel: string | null;
};

function rateInBand(
  rate01: number | null,
  min: number | null,
  max: number | null
): boolean {
  if (min == null && max == null) return true;
  if (rate01 == null || !Number.isFinite(rate01)) return false;
  if (min != null && rate01 + 1e-12 < min) return false;
  if (max != null && rate01 - 1e-12 > max) return false;
  return true;
}

function percentInBand(
  percent: number | null,
  min: number | null,
  max: number | null
): boolean {
  if (min == null && max == null) return true;
  if (percent == null || !Number.isFinite(percent)) return false;
  if (min != null && percent + 1e-9 < min) return false;
  if (max != null && percent - 1e-9 > max) return false;
  return true;
}

export function itemMatchesPresence(
  item: DiscountReportItemInput,
  presence: CommercialDiscountPresenceFilter
): boolean {
  switch (presence) {
    case "with_discount":
      return item.discountStatus === "DISCOUNT" && item.discountValue > 0;
    case "without_discount":
      return item.discountStatus === "NO_DISCOUNT";
    case "with_addition":
      return item.discountStatus === "ADDITION";
    case "margin_unavailable":
      return item.activeQuantity > 0 && !item.marginCalculated;
    case "all":
    default:
      return true;
  }
}

export function itemMatchesBilling(
  item: DiscountReportItemInput,
  billing: CommercialDiscountBillingFilter
): boolean {
  if (billing === "invoiced") return item.hasInvoice;
  if (billing === "not_invoiced") return !item.hasInvoice;
  return true;
}

export function itemMatchesBandFilters(
  item: DiscountReportItemInput,
  opts: {
    discountRateMin: number | null;
    discountRateMax: number | null;
    marginPercentMin: number | null;
    marginPercentMax: number | null;
    productId: string | null;
    productQuery: string | null;
    family: string | null;
  }
): boolean {
  if (opts.productId && item.productId !== opts.productId) return false;
  if (opts.family) {
    const fam = opts.family.trim().toLocaleLowerCase("pt-BR");
    if (item.familyName.trim().toLocaleLowerCase("pt-BR") !== fam) return false;
  }
  if (opts.productQuery) {
    const q = opts.productQuery.trim().toLocaleLowerCase("pt-BR");
    const hay = `${item.sku} ${item.productName}`.toLocaleLowerCase("pt-BR");
    if (!hay.includes(q)) return false;
  }
  if (!rateInBand(item.discountRate, opts.discountRateMin, opts.discountRateMax)) {
    return false;
  }
  if (
    !percentInBand(
      item.commercialMarginPercent,
      opts.marginPercentMin,
      opts.marginPercentMax
    )
  ) {
    return false;
  }
  return true;
}

export function toDetailRow(item: DiscountReportItemInput): CommercialDiscountDetailRow {
  const marginStatus: CommercialDiscountDetailRow["marginStatus"] =
    item.activeQuantity <= 0
      ? "NO_ACTIVE_VALUE"
      : item.marginCalculated
        ? "CALCULATED"
        : "UNAVAILABLE";
  return {
    salesOrderId: item.salesOrderId,
    orderCode: item.orderCode,
    issueDate: item.issueDate,
    customerId: item.customerId,
    customerName: item.customerName,
    sellerName: item.sellerName,
    hasInvoice: item.hasInvoice,
    itemId: item.itemId,
    itemSequence: item.itemSequence,
    productId: item.productId,
    sku: item.sku,
    productName: item.productName,
    familyName: item.familyName,
    activeQuantity: item.activeQuantity,
    grossUnitPrice: item.grossUnitPrice,
    grossActiveValue: item.grossActiveValue,
    discountValue: item.discountValue,
    discountRate: item.activeQuantity > 0 ? item.discountRate : null,
    netUnitPrice: item.netUnitPrice,
    netActiveValue: item.netActiveValue,
    commercialMarginValue: item.marginCalculated ? item.commercialMarginValue : null,
    commercialMarginPercent: item.marginCalculated
      ? item.commercialMarginPercent
      : null,
    marginStatus,
    marginStatusLabel: marginStatusLabel(marginStatus),
    discountStatus: item.discountStatus,
    discountStatusLabel: DISCOUNT_STATUS_LABEL[item.discountStatus],
    hasDiscountDivergence: item.hasDiscountDivergence,
    divergenceLabel: item.divergenceLabel,
  };
}

export function computeCommercialDiscountKpis(
  items: ReadonlyArray<DiscountReportItemInput>
): CommercialDiscountReportKpis {
  let gross = 0;
  let discount = 0;
  let net = 0;
  let addition = 0;
  let marginValueSum = 0;
  let marginCoveredNet = 0;
  let itemsActive = 0;
  let itemsWithDiscount = 0;
  let itemsWithAddition = 0;
  let itemsMarginUnavailable = 0;
  let itemsWithDiscountDivergence = 0;
  const orders = new Set<string>();
  const ordersWithDiscount = new Set<string>();

  for (const item of items) {
    if (item.activeQuantity <= 0) continue;
    itemsActive += 1;
    orders.add(item.salesOrderId);
    gross += item.grossActiveValue;
    discount += item.discountValue;
    addition += item.commercialAdditionValue;
    if (item.netActiveValue != null) net += item.netActiveValue;
    if (item.discountStatus === "DISCOUNT" && item.discountValue > 0) {
      itemsWithDiscount += 1;
      ordersWithDiscount.add(item.salesOrderId);
    }
    if (item.discountStatus === "ADDITION") itemsWithAddition += 1;
    if (!item.marginCalculated) {
      itemsMarginUnavailable += 1;
    } else if (item.commercialMarginValue != null && item.netActiveValue != null) {
      marginValueSum += item.commercialMarginValue;
      marginCoveredNet += item.netActiveValue;
    }
    if (item.hasDiscountDivergence) itemsWithDiscountDivergence += 1;
  }

  gross = roundPricingMoney(gross);
  discount = roundPricingMoney(discount);
  net = roundPricingMoney(net);
  addition = roundPricingMoney(addition);
  marginValueSum = roundPricingMoney(marginValueSum);
  marginCoveredNet = roundPricingMoney(marginCoveredNet);

  const hasMargin = marginCoveredNet > 0;
  return emptyCommercialDiscountKpis({
    grossActiveTotalValue: gross,
    discountTotalValue: discount,
    discountTotalRate: weightedDiscountRate(discount, gross),
    netActiveTotalValue: net,
    commercialAdditionTotalValue: addition,
    commercialMarginTotalValue: hasMargin ? marginValueSum : null,
    commercialMarginTotalPercent: weightedCommercialMarginPercent(
      hasMargin ? marginValueSum : null,
      marginCoveredNet
    ),
    commercialMarginCoveragePercent:
      net > 0 ? roundPricingMoney((marginCoveredNet / net) * 100) : null,
    ordersInScope: orders.size,
    ordersWithDiscount: ordersWithDiscount.size,
    itemsActive,
    itemsWithDiscount,
    itemsWithAddition,
    itemsMarginUnavailable,
    itemsWithDiscountDivergence,
  });
}

function accumulateDimension(
  map: Map<string, CommercialDiscountDimensionRow & { coveredNet: number; marginSum: number }>,
  key: string,
  label: string,
  item: DiscountReportItemInput
) {
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      label,
      orderCount: 0,
      itemCount: 0,
      grossActiveValue: 0,
      discountValue: 0,
      discountRate: null,
      netActiveValue: 0,
      commercialMarginValue: null,
      commercialMarginPercent: null,
      commercialMarginCoveragePercent: null,
      coveredNet: 0,
      marginSum: 0,
    };
    map.set(key, row);
  }
  row.itemCount += 1;
  row.grossActiveValue = roundPricingMoney(row.grossActiveValue + item.grossActiveValue);
  row.discountValue = roundPricingMoney(row.discountValue + item.discountValue);
  row.netActiveValue = roundPricingMoney(
    row.netActiveValue + (item.netActiveValue ?? 0)
  );
  if (item.marginCalculated && item.commercialMarginValue != null) {
    row.marginSum = roundPricingMoney(row.marginSum + item.commercialMarginValue);
    row.coveredNet = roundPricingMoney(
      row.coveredNet + (item.netActiveValue ?? 0)
    );
  }
}

function finalizeDimensions(
  map: Map<string, CommercialDiscountDimensionRow & { coveredNet: number; marginSum: number }>,
  orderIdsByKey: Map<string, Set<string>>
): CommercialDiscountDimensionRow[] {
  const rows: CommercialDiscountDimensionRow[] = [];
  for (const [key, row] of map) {
    const orders = orderIdsByKey.get(key);
    rows.push({
      key: row.key,
      label: row.label,
      orderCount: orders?.size ?? 0,
      itemCount: row.itemCount,
      grossActiveValue: row.grossActiveValue,
      discountValue: row.discountValue,
      discountRate: weightedDiscountRate(row.discountValue, row.grossActiveValue),
      netActiveValue: row.netActiveValue,
      commercialMarginValue: row.coveredNet > 0 ? row.marginSum : null,
      commercialMarginPercent: weightedCommercialMarginPercent(
        row.coveredNet > 0 ? row.marginSum : null,
        row.coveredNet
      ),
      commercialMarginCoveragePercent:
        row.netActiveValue > 0
          ? roundPricingMoney((row.coveredNet / row.netActiveValue) * 100)
          : null,
    });
  }
  rows.sort((a, b) => b.discountValue - a.discountValue || b.grossActiveValue - a.grossActiveValue);
  return rows;
}

function buildOrderHighlights(
  items: ReadonlyArray<DiscountReportItemInput>
): Map<string, CommercialDiscountOrderHighlight & { coveredNet: number; marginSum: number }> {
  const map = new Map<
    string,
    CommercialDiscountOrderHighlight & { coveredNet: number; marginSum: number }
  >();
  for (const item of items) {
    if (item.activeQuantity <= 0) continue;
    let row = map.get(item.salesOrderId);
    if (!row) {
      row = {
        salesOrderId: item.salesOrderId,
        orderCode: item.orderCode,
        issueDate: item.issueDate,
        customerName: item.customerName,
        sellerName: item.sellerName,
        grossActiveValue: 0,
        discountValue: 0,
        discountRate: null,
        netActiveValue: 0,
        commercialMarginValue: null,
        commercialMarginPercent: null,
        commercialMarginCoveragePercent: null,
        hasInvoice: item.hasInvoice,
        coveredNet: 0,
        marginSum: 0,
      };
      map.set(item.salesOrderId, row);
    }
    row.grossActiveValue = roundPricingMoney(row.grossActiveValue + item.grossActiveValue);
    row.discountValue = roundPricingMoney(row.discountValue + item.discountValue);
    row.netActiveValue = roundPricingMoney(
      row.netActiveValue + (item.netActiveValue ?? 0)
    );
    if (item.marginCalculated && item.commercialMarginValue != null) {
      row.marginSum = roundPricingMoney(row.marginSum + item.commercialMarginValue);
      row.coveredNet = roundPricingMoney(
        row.coveredNet + (item.netActiveValue ?? 0)
      );
    }
  }
  for (const row of map.values()) {
    row.discountRate = weightedDiscountRate(row.discountValue, row.grossActiveValue);
    row.commercialMarginValue = row.coveredNet > 0 ? row.marginSum : null;
    row.commercialMarginPercent = weightedCommercialMarginPercent(
      row.coveredNet > 0 ? row.marginSum : null,
      row.coveredNet
    );
    row.commercialMarginCoveragePercent =
      row.netActiveValue > 0
        ? roundPricingMoney((row.coveredNet / row.netActiveValue) * 100)
        : null;
  }
  return map;
}

export function buildCommercialDiscountViews(
  filteredItems: ReadonlyArray<DiscountReportItemInput>,
  baseItemsBeforeBands: ReadonlyArray<DiscountReportItemInput>
): CommercialDiscountReportViews {
  const bySeller = new Map<
    string,
    CommercialDiscountDimensionRow & { coveredNet: number; marginSum: number }
  >();
  const byCustomer = new Map<
    string,
    CommercialDiscountDimensionRow & { coveredNet: number; marginSum: number }
  >();
  const byProduct = new Map<
    string,
    CommercialDiscountDimensionRow & { coveredNet: number; marginSum: number }
  >();
  const byFamily = new Map<
    string,
    CommercialDiscountDimensionRow & { coveredNet: number; marginSum: number }
  >();
  const sellerOrders = new Map<string, Set<string>>();
  const customerOrders = new Map<string, Set<string>>();
  const productOrders = new Map<string, Set<string>>();
  const familyOrders = new Map<string, Set<string>>();

  const monthly = new Map<
    string,
    CommercialDiscountMonthlyPoint & { coveredNet: number; marginSum: number; orderIds: Set<string> }
  >();

  for (const item of filteredItems) {
    if (item.activeQuantity <= 0) continue;
    const sellerKey = item.sellerName || "Sem vendedor";
    accumulateDimension(bySeller, sellerKey, sellerKey, item);
    (sellerOrders.get(sellerKey) ?? sellerOrders.set(sellerKey, new Set()).get(sellerKey)!).add(
      item.salesOrderId
    );

    const customerKey = item.customerId || item.customerName || "Sem cliente";
    accumulateDimension(byCustomer, customerKey, item.customerName || "Sem cliente", item);
    (
      customerOrders.get(customerKey) ??
      customerOrders.set(customerKey, new Set()).get(customerKey)!
    ).add(item.salesOrderId);

    accumulateDimension(
      byProduct,
      item.productId,
      `${item.sku} — ${item.productName}`,
      item
    );
    (
      productOrders.get(item.productId) ??
      productOrders.set(item.productId, new Set()).get(item.productId)!
    ).add(item.salesOrderId);

    const familyKey = item.familyName || "Sem família";
    accumulateDimension(byFamily, familyKey, familyKey, item);
    (
      familyOrders.get(familyKey) ?? familyOrders.set(familyKey, new Set()).get(familyKey)!
    ).add(item.salesOrderId);

    const mk = yearMonthKeyFromIssueIso(item.issueDate);
    if (mk) {
      let point = monthly.get(mk);
      if (!point) {
        point = {
          monthKey: mk,
          label: monthLabelPtBr(mk),
          orderCount: 0,
          grossActiveValue: 0,
          discountValue: 0,
          discountRate: null,
          netActiveValue: 0,
          commercialMarginValue: null,
          commercialMarginPercent: null,
          coveredNet: 0,
          marginSum: 0,
          orderIds: new Set(),
        };
        monthly.set(mk, point);
      }
      point.orderIds.add(item.salesOrderId);
      point.grossActiveValue = roundPricingMoney(
        point.grossActiveValue + item.grossActiveValue
      );
      point.discountValue = roundPricingMoney(point.discountValue + item.discountValue);
      point.netActiveValue = roundPricingMoney(
        point.netActiveValue + (item.netActiveValue ?? 0)
      );
      if (item.marginCalculated && item.commercialMarginValue != null) {
        point.marginSum = roundPricingMoney(point.marginSum + item.commercialMarginValue);
        point.coveredNet = roundPricingMoney(
          point.coveredNet + (item.netActiveValue ?? 0)
        );
      }
    }
  }

  const monthlyEvolution: CommercialDiscountMonthlyPoint[] = [...monthly.values()]
    .map((p) => ({
      monthKey: p.monthKey,
      label: p.label,
      orderCount: p.orderIds.size,
      grossActiveValue: p.grossActiveValue,
      discountValue: p.discountValue,
      discountRate: weightedDiscountRate(p.discountValue, p.grossActiveValue),
      netActiveValue: p.netActiveValue,
      commercialMarginValue: p.coveredNet > 0 ? p.marginSum : null,
      commercialMarginPercent: weightedCommercialMarginPercent(
        p.coveredNet > 0 ? p.marginSum : null,
        p.coveredNet
      ),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const orderMap = buildOrderHighlights(filteredItems);
  const orderList = [...orderMap.values()].map(
    ({ coveredNet: _c, marginSum: _m, ...rest }) => rest
  );
  const topOrdersByDiscountValue = [...orderList]
    .filter((o) => o.discountValue > 0)
    .sort((a, b) => b.discountValue - a.discountValue)
    .slice(0, 20);
  const topOrdersByDiscountRate = [...orderList]
    .filter((o) => (o.discountRate ?? 0) > 0)
    .sort((a, b) => (b.discountRate ?? 0) - (a.discountRate ?? 0))
    .slice(0, 20);

  const productRiskMap = new Map<
    string,
    CommercialDiscountProductRiskRow & { coveredNet: number; marginSum: number }
  >();
  for (const item of filteredItems) {
    if (item.activeQuantity <= 0) continue;
    if (!(item.discountRate >= 0.05)) continue;
    let row = productRiskMap.get(item.productId);
    if (!row) {
      row = {
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        familyName: item.familyName,
        itemCount: 0,
        grossActiveValue: 0,
        discountValue: 0,
        discountRate: null,
        netActiveValue: 0,
        commercialMarginValue: null,
        commercialMarginPercent: null,
        coveredNet: 0,
        marginSum: 0,
      };
      productRiskMap.set(item.productId, row);
    }
    row.itemCount += 1;
    row.grossActiveValue = roundPricingMoney(row.grossActiveValue + item.grossActiveValue);
    row.discountValue = roundPricingMoney(row.discountValue + item.discountValue);
    row.netActiveValue = roundPricingMoney(
      row.netActiveValue + (item.netActiveValue ?? 0)
    );
    if (item.marginCalculated && item.commercialMarginValue != null) {
      row.marginSum = roundPricingMoney(row.marginSum + item.commercialMarginValue);
      row.coveredNet = roundPricingMoney(
        row.coveredNet + (item.netActiveValue ?? 0)
      );
    }
  }
  const highDiscountLowMarginProducts = [...productRiskMap.values()]
    .map(({ coveredNet, marginSum, ...rest }) => {
      const commercialMarginPercent = weightedCommercialMarginPercent(
        coveredNet > 0 ? marginSum : null,
        coveredNet
      );
      return {
        ...rest,
        discountRate: weightedDiscountRate(rest.discountValue, rest.grossActiveValue),
        commercialMarginValue: coveredNet > 0 ? marginSum : null,
        commercialMarginPercent,
      };
    })
    .filter(
      (r) =>
        (r.discountRate ?? 0) >= 0.05 &&
        (r.commercialMarginPercent == null || r.commercialMarginPercent < 15)
    )
    .sort(
      (a, b) =>
        (b.discountRate ?? 0) - (a.discountRate ?? 0) ||
        (a.commercialMarginPercent ?? 999) - (b.commercialMarginPercent ?? 999)
    )
    .slice(0, 30);

  const divergenceItemCount = filteredItems.filter(
    (i) => i.activeQuantity > 0 && i.hasDiscountDivergence
  ).length;

  return {
    monthlyEvolution,
    bySeller: finalizeDimensions(bySeller, sellerOrders).slice(0, 50),
    byCustomer: finalizeDimensions(byCustomer, customerOrders).slice(0, 50),
    byProduct: finalizeDimensions(byProduct, productOrders).slice(0, 50),
    byFamily: finalizeDimensions(byFamily, familyOrders).slice(0, 50),
    topOrdersByDiscountValue,
    topOrdersByDiscountRate,
    highDiscountLowMarginProducts,
    kpisBeforeBandFilters: computeCommercialDiscountKpis(baseItemsBeforeBands),
    divergenceItemCount,
  };
}

export function compareDetailRows(
  a: CommercialDiscountDetailRow,
  b: CommercialDiscountDetailRow,
  sortBy: CommercialDiscountReportSortBy,
  sortDir: "asc" | "desc"
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  const str = (x: string | null | undefined) => (x ?? "").toLocaleLowerCase("pt-BR");
  switch (sortBy) {
    case "orderCode":
      return dir * str(a.orderCode).localeCompare(str(b.orderCode), "pt-BR");
    case "customer":
      return dir * str(a.customerName).localeCompare(str(b.customerName), "pt-BR");
    case "seller":
      return dir * str(a.sellerName).localeCompare(str(b.sellerName), "pt-BR");
    case "discountValue":
      return dir * (a.discountValue - b.discountValue);
    case "discountRate":
      return dir * ((a.discountRate ?? -1) - (b.discountRate ?? -1));
    case "grossValue":
      return dir * (a.grossActiveValue - b.grossActiveValue);
    case "netValue":
      return dir * ((a.netActiveValue ?? 0) - (b.netActiveValue ?? 0));
    case "commercialMarginValue":
      return dir * ((a.commercialMarginValue ?? 0) - (b.commercialMarginValue ?? 0));
    case "commercialMarginPercent":
      return (
        dir * ((a.commercialMarginPercent ?? -999) - (b.commercialMarginPercent ?? -999))
      );
    case "issueDate":
    default: {
      const ta = a.issueDate ? new Date(a.issueDate).getTime() : 0;
      const tb = b.issueDate ? new Date(b.issueDate).getTime() : 0;
      return dir * (ta - tb);
    }
  }
}

export function paginateSortedRows(
  rows: CommercialDiscountDetailRow[],
  page: number,
  pageSize: number
): { pageRows: CommercialDiscountDetailRow[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), totalPages };
}
