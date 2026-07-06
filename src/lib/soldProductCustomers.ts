/**
 * Assembler — GET /api/commercial/sold-products/:productId/customers
 * Fonte: SalesOrder + SalesOrderItem (mesmas regras de Produtos Vendidos).
 */

import { prisma } from "@/src/lib/prisma.js";
import { buildCustomerIntelligenceFinancial } from "@/src/lib/customerIntelligenceFinancial.js";
import { resolveCustomerIntelligenceRegion } from "@/src/lib/customerIntelligenceUtils.js";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.js";
import {
  computeSoldProductsAverageUnitPrice,
  computeSoldProductsSharePercent,
  loadSoldProductsLineContexts,
  safeSoldProductsNumber,
  type SoldProductsLineContext,
} from "@/src/lib/salesProductRanking.js";
import {
  buildSoldProductsAppliedFiltersLabel,
  normalizeSoldProductsUiFilters,
  parseSalesProductRankingFilters,
} from "@/src/lib/salesProductRankingFilters.js";
import type { SoldProductsUiFilters } from "@/src/lib/salesProductRankingTypes.js";
import { parseSoldProductCustomersQueryFilters } from "@/src/lib/soldProductCustomersFilters.js";
import type {
  SoldProductCustomerProductRef,
  SoldProductCustomerRow,
  SoldProductCustomersPayload,
  SoldProductCustomersQueryFilters,
  SoldProductCustomersSummary,
} from "@/src/lib/soldProductCustomersTypes.js";

export const SOLD_PRODUCT_INACTIVE_DAYS = 180;

export type SoldProductCustomerLineInput = Pick<
  SoldProductsLineContext,
  | "customerId"
  | "customerName"
  | "customerTaxId"
  | "orderId"
  | "orderDate"
  | "quantity"
  | "unitPrice"
  | "lineAmount"
  | "orderStatus"
>;

export type SoldProductCustomerMeta = {
  customerId: string;
  customerCode?: string | null;
  city?: string | null;
  state?: string | null;
  commercialOwner?: string | null;
};

export type SoldProductCustomerFinancialSnapshot = {
  openPortfolioAmount: number | null;
  overdueAmount: number | null;
};

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function toIsoDate(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export function computeAverageDaysBetweenPurchases(orderDates: Date[]): number | null {
  if (orderDates.length < 2) return null;
  const sorted = [...orderDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1]!, sorted[i]!));
  }
  if (intervals.length === 0) return null;
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return Number.isFinite(avg) ? round2(avg) : null;
}

export function resolveLastUnitPrice(
  lines: Array<{ orderDate: Date; unitPrice: number; orderId: string }>
): number | null {
  if (lines.length === 0) return null;
  const sorted = [...lines].sort(
    (a, b) =>
      b.orderDate.getTime() - a.orderDate.getTime() ||
      b.orderId.localeCompare(a.orderId)
  );
  const price = safeSoldProductsNumber(sorted[0]?.unitPrice);
  return price > 0 ? round2(price) : null;
}

export function buildSoldProductSuggestedAction(input: {
  ordersCount: number;
  daysSinceLastPurchase: number | null;
  averageUnitPrice: number | null;
  lastUnitPrice: number | null;
  productAverageUnitPrice: number | null;
  overdueAmount: number | null;
}): string {
  const overdue = (input.overdueAmount ?? 0) > 0;
  if (overdue) return "Avaliar inadimplência antes da abordagem";
  if ((input.daysSinceLastPurchase ?? 0) > SOLD_PRODUCT_INACTIVE_DAYS) {
    return "Cliente inativo para este produto";
  }
  if (input.ordersCount >= 2 && !overdue) return "Bom alvo para promoção";
  if (
    input.productAverageUnitPrice != null &&
    input.lastUnitPrice != null &&
    input.lastUnitPrice > input.productAverageUnitPrice
  ) {
    return "Cliente paga acima da média; possível alvo de campanha";
  }
  if (
    input.productAverageUnitPrice != null &&
    input.averageUnitPrice != null &&
    input.averageUnitPrice < input.productAverageUnitPrice
  ) {
    return "Cliente sensível a preço; revisar margem";
  }
  if (input.ordersCount < 2) return "Histórico insuficiente";
  return "Abordar para recompra";
}

export function resolveSoldProductCommercialHealth(input: {
  daysSinceLastPurchase: number | null;
  overdueAmount: number | null;
  ordersCount: number;
}): string {
  if ((input.overdueAmount ?? 0) > 0) return "Risco financeiro";
  if ((input.daysSinceLastPurchase ?? 0) > SOLD_PRODUCT_INACTIVE_DAYS) return "Inativo para o produto";
  if (input.ordersCount >= 2) return "Recorrente";
  if (input.ordersCount < 2) return "Histórico insuficiente";
  return "Ativo";
}

type CustomerAgg = {
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  orderIds: Set<string>;
  orderDates: Date[];
  quantity: number;
  totalRevenue: number;
  unitPrices: number[];
  lines: Array<{ orderDate: Date; unitPrice: number; orderId: string }>;
};

type AggregatedCustomerRow = Omit<
  SoldProductCustomerRow,
  "customerCode" | "city" | "state" | "region" | "commercialOwner" | "openPortfolioAmount" | "overdueAmount"
>;

export function aggregateSoldProductCustomers(
  productLines: SoldProductCustomerLineInput[],
  allCustomerRevenue: Map<string, number>,
  referenceDate: Date
): {
  summary: SoldProductCustomersSummary;
  rows: AggregatedCustomerRow[];
} {
  const byCustomer = new Map<string, CustomerAgg>();
  let totalQuantity = 0;
  let totalRevenue = 0;
  let globalMinUnit: number | null = null;
  let globalMaxUnit: number | null = null;
  let lastSaleDate: Date | null = null;

  for (const line of productLines) {
    if (!line.customerId) continue;
    totalQuantity += line.quantity;
    totalRevenue += line.lineAmount;

    const unit = safeSoldProductsNumber(line.unitPrice);
    if (unit > 0) {
      globalMinUnit = globalMinUnit == null ? unit : Math.min(globalMinUnit, unit);
      globalMaxUnit = globalMaxUnit == null ? unit : Math.max(globalMaxUnit, unit);
    }

    if (!lastSaleDate || line.orderDate > lastSaleDate) {
      lastSaleDate = line.orderDate;
    }

    let agg = byCustomer.get(line.customerId);
    if (!agg) {
      agg = {
        customerId: line.customerId,
        customerName: line.customerName,
        customerTaxId: line.customerTaxId,
        orderIds: new Set(),
        orderDates: [],
        quantity: 0,
        totalRevenue: 0,
        unitPrices: [],
        lines: [],
      };
      byCustomer.set(line.customerId, agg);
    }
    agg.orderIds.add(line.orderId);
    agg.orderDates.push(line.orderDate);
    agg.quantity += line.quantity;
    agg.totalRevenue += line.lineAmount;
    if (unit > 0) agg.unitPrices.push(unit);
    agg.lines.push({ orderDate: line.orderDate, unitPrice: unit, orderId: line.orderId });
  }

  const productAverageUnitPrice = computeSoldProductsAverageUnitPrice(totalQuantity, totalRevenue);
  let inactiveCustomersCount = 0;
  let recurringCustomersCount = 0;

  const rows = [...byCustomer.values()].map((agg) => {
    const sortedDates = [...agg.orderDates].sort((a, b) => a.getTime() - b.getTime());
    const firstPurchaseDate = sortedDates[0] ?? null;
    const lastPurchaseDate = sortedDates[sortedDates.length - 1] ?? null;
    const daysSinceLastPurchase =
      lastPurchaseDate != null ? daysBetween(lastPurchaseDate, referenceDate) : null;
    const distinctOrderDates = [
      ...new Map(agg.orderDates.map((d) => [toIsoDate(d), d] as const)).values(),
    ];
    const avgDaysDistinct = computeAverageDaysBetweenPurchases(distinctOrderDates);

    const averageUnitPrice = computeSoldProductsAverageUnitPrice(agg.quantity, agg.totalRevenue);
    const minUnitPrice =
      agg.unitPrices.length > 0 ? round2(Math.min(...agg.unitPrices)) : null;
    const maxUnitPrice =
      agg.unitPrices.length > 0 ? round2(Math.max(...agg.unitPrices)) : null;
    const lastUnitPrice = resolveLastUnitPrice(agg.lines);
    const customerTotal = allCustomerRevenue.get(agg.customerId) ?? agg.totalRevenue;

    if ((daysSinceLastPurchase ?? 0) > SOLD_PRODUCT_INACTIVE_DAYS) inactiveCustomersCount += 1;
    if (agg.orderIds.size >= 2) recurringCustomersCount += 1;

    const suggestedAction = buildSoldProductSuggestedAction({
      ordersCount: agg.orderIds.size,
      daysSinceLastPurchase,
      averageUnitPrice,
      lastUnitPrice,
      productAverageUnitPrice,
      overdueAmount: 0,
    });

    return {
      customerId: agg.customerId,
      customerName: agg.customerName,
      customerCnpj: agg.customerTaxId,
      ordersCount: agg.orderIds.size,
      quantity: round2(agg.quantity),
      totalRevenue: round2(agg.totalRevenue),
      averageUnitPrice: averageUnitPrice != null ? round2(averageUnitPrice) : null,
      minUnitPrice,
      maxUnitPrice,
      lastUnitPrice,
      firstPurchaseDate: toIsoDate(firstPurchaseDate),
      lastPurchaseDate: toIsoDate(lastPurchaseDate),
      daysSinceLastPurchase,
      averageDaysBetweenPurchases: avgDaysDistinct,
      averageDaysBetweenPurchasesLabel:
        avgDaysDistinct == null ? "Histórico insuficiente" : `${avgDaysDistinct} dias`,
      shareOfProductRevenue: computeSoldProductsSharePercent(agg.totalRevenue, totalRevenue),
      shareOfCustomerRevenue: computeSoldProductsSharePercent(agg.totalRevenue, customerTotal),
      commercialHealth: resolveSoldProductCommercialHealth({
        daysSinceLastPurchase,
        overdueAmount: 0,
        ordersCount: agg.orderIds.size,
      }),
      suggestedAction,
    };
  });

  return {
    summary: {
      customersCount: rows.length,
      totalQuantity: round2(totalQuantity),
      totalRevenue: round2(totalRevenue),
      averageUnitPrice: productAverageUnitPrice != null ? round2(productAverageUnitPrice) : null,
      minUnitPrice: globalMinUnit != null ? round2(globalMinUnit) : null,
      maxUnitPrice: globalMaxUnit != null ? round2(globalMaxUnit) : null,
      lastSaleDate: toIsoDate(lastSaleDate),
      inactiveCustomersCount,
      recurringCustomersCount,
    },
    rows,
  };
}

export function buildAllCustomerRevenueMap(lines: SoldProductCustomerLineInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (!line.customerId) continue;
    map.set(line.customerId, (map.get(line.customerId) ?? 0) + line.lineAmount);
  }
  return map;
}

export function applySoldProductCustomerPostFilters(
  rows: SoldProductCustomerRow[],
  filters: SoldProductCustomersQueryFilters
): SoldProductCustomerRow[] {
  return rows.filter((row) => {
    if (filters.minQuantity != null && row.quantity < filters.minQuantity) return false;
    if (filters.minRevenue != null && row.totalRevenue < filters.minRevenue) return false;
    if (
      filters.minDaysSinceLastPurchase != null &&
      (row.daysSinceLastPurchase ?? -1) < filters.minDaysSinceLastPurchase
    ) {
      return false;
    }
    if (
      filters.maxDaysSinceLastPurchase != null &&
      (row.daysSinceLastPurchase ?? Number.MAX_SAFE_INTEGER) > filters.maxDaysSinceLastPurchase
    ) {
      return false;
    }
    if (filters.state && (row.state ?? "").toUpperCase() !== filters.state.toUpperCase()) {
      return false;
    }
    if (filters.region && (row.region ?? "") !== filters.region) return false;
    if (filters.activityFilter === "active") {
      if ((row.daysSinceLastPurchase ?? 0) > SOLD_PRODUCT_INACTIVE_DAYS) return false;
    }
    if (filters.activityFilter === "inactive") {
      if ((row.daysSinceLastPurchase ?? 0) <= SOLD_PRODUCT_INACTIVE_DAYS) return false;
    }
    if (filters.onlyWithoutOverdue && (row.overdueAmount ?? 0) > 0) return false;
    return true;
  });
}

export function sortSoldProductCustomerRows(
  rows: SoldProductCustomerRow[],
  filters: SoldProductCustomersQueryFilters
): SoldProductCustomerRow[] {
  const dir = filters.sortDirection === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    switch (filters.sortBy) {
      case "customerName":
        return a.customerName.localeCompare(b.customerName, "pt-BR") * dir;
      case "quantity":
        return (a.quantity - b.quantity) * dir;
      case "lastPurchaseDate":
        return (
          ((a.lastPurchaseDate ?? "").localeCompare(b.lastPurchaseDate ?? "") || 0) * dir
        );
      case "averageUnitPrice":
        return ((a.averageUnitPrice ?? 0) - (b.averageUnitPrice ?? 0)) * dir;
      case "daysSinceLastPurchase":
        return ((a.daysSinceLastPurchase ?? -1) - (b.daysSinceLastPurchase ?? -1)) * dir;
      case "totalRevenue":
      default:
        return (a.totalRevenue - b.totalRevenue) * dir;
    }
  });
  if (filters.topN != null) return sorted.slice(0, filters.topN);
  return sorted;
}

export function enrichSoldProductCustomerRows(input: {
  rows: AggregatedCustomerRow[];
  metaById: Map<string, SoldProductCustomerMeta>;
  financialById: Map<string, SoldProductCustomerFinancialSnapshot>;
  productAverageUnitPrice: number | null;
}): SoldProductCustomerRow[] {
  return input.rows.map((row) => {
    const meta = input.metaById.get(row.customerId);
    const financial = input.financialById.get(row.customerId);
    const overdueAmount = financial?.overdueAmount ?? null;
    const openPortfolioAmount = financial?.openPortfolioAmount ?? null;
    const suggestedAction = buildSoldProductSuggestedAction({
      ordersCount: row.ordersCount,
      daysSinceLastPurchase: row.daysSinceLastPurchase,
      averageUnitPrice: row.averageUnitPrice,
      lastUnitPrice: row.lastUnitPrice,
      productAverageUnitPrice: input.productAverageUnitPrice,
      overdueAmount,
    });
    return {
      ...row,
      customerCode: meta?.customerCode ?? row.customerCnpj,
      city: meta?.city ?? null,
      state: meta?.state ?? null,
      region: meta?.state ? resolveCustomerIntelligenceRegion(meta.state) : null,
      commercialOwner: meta?.commercialOwner ?? null,
      openPortfolioAmount,
      overdueAmount,
      commercialHealth: resolveSoldProductCommercialHealth({
        daysSinceLastPurchase: row.daysSinceLastPurchase,
        overdueAmount,
        ordersCount: row.ordersCount,
      }),
      suggestedAction,
    };
  });
}

function resolveProductRef(
  productId: string,
  lines: SoldProductsLineContext[]
): SoldProductCustomerProductRef {
  const sample = lines.find((l) => l.productId === productId);
  return {
    id: productId,
    code: sample?.productCode ?? null,
    name: sample?.productName ?? "Produto",
    description: null,
  };
}

export async function buildSoldProductCustomers(
  productId: string,
  query: Record<string, unknown>,
  options?: {
    referenceDate?: Date;
    sellerScope?: { externalSellerId: number | null; responsible: string | null };
  }
): Promise<SoldProductCustomersPayload | null> {
  const referenceDate = options?.referenceDate ?? new Date();
  const customerFilters = parseSoldProductCustomersQueryFilters(query);
  const rankingQuery = { ...query, productId };
  const filters = parseSalesProductRankingFilters(rankingQuery, referenceDate);
  filters.productId = productId;

  const ui = normalizeSoldProductsUiFilters({
    startDate: typeof query.startDate === "string" ? query.startDate : "",
    endDate: typeof query.endDate === "string" ? query.endDate : "",
    year: typeof query.year === "string" ? query.year : String(referenceDate.getFullYear()),
    month: typeof query.month === "string" ? query.month : "",
    dateBasis: filters.dateBasis,
    customerName: filters.customerName ?? "",
    customerTaxId: filters.customerTaxId ?? "",
    customerId: filters.customerId ?? "",
    productId,
    productCode: filters.productCode ?? "",
    productName: filters.productName ?? "",
    sellerKey: typeof query.sellerKey === "string" ? query.sellerKey : "",
    company: filters.company,
    orderStatus: filters.orderStatus,
    customerScope: filters.customerScope,
    sortBy: filters.sortBy,
    topN: filters.topN == null ? "all" : (String(filters.topN) as SoldProductsUiFilters["topN"]),
  });

  const allLines = await loadSoldProductsLineContexts(filters, options?.sellerScope);
  const productLines = allLines.filter((l) => l.productId === productId);

  const productFromDb = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, description: true },
  });

  if (productLines.length === 0 && !productFromDb) {
    return null;
  }

  const allCustomerRevenue = buildAllCustomerRevenueMap(allLines);
  const { summary, rows: baseRows } = aggregateSoldProductCustomers(
    productLines,
    allCustomerRevenue,
    referenceDate
  );

  const customerIds = [...new Set(baseRows.map((r) => r.customerId))];
  const customers =
    customerIds.length > 0
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: {
            id: true,
            taxId: true,
            city: true,
            state: true,
            accountOwner: true,
          },
        })
      : [];

  const metaById = new Map<string, SoldProductCustomerMeta>(
    customers.map((c) => [
      c.id,
      {
        customerId: c.id,
        customerCode: c.taxId?.trim() || null,
        city: c.city?.trim() || null,
        state: c.state?.trim() || null,
        commercialOwner: c.accountOwner?.trim() || null,
      },
    ])
  );

  const hasTaxId = customers.some((c) => (c.taxId ?? "").trim().length > 0);
  const arLoad = hasTaxId
    ? await loadFinanceArManagementRowsFromPrisma(prisma, { status: "all" })
    : { rows: [], syncCutoff: null };

  const financialById = new Map<string, SoldProductCustomerFinancialSnapshot>();
  for (const customer of customers) {
    const fin = buildCustomerIntelligenceFinancial({
      customerTaxId: customer.taxId,
      arRows: arLoad.rows,
      arSyncCutoff: arLoad.syncCutoff,
      referenceDate,
    });
    financialById.set(customer.id, {
      openPortfolioAmount: fin.receivableOpenAmount,
      overdueAmount: fin.overdueAmount,
    });
  }

  let customersRows = enrichSoldProductCustomerRows({
    rows: baseRows,
    metaById,
    financialById,
    productAverageUnitPrice: summary.averageUnitPrice,
  });

  customersRows = applySoldProductCustomerPostFilters(customersRows, customerFilters);
  customersRows = sortSoldProductCustomerRows(customersRows, customerFilters);

  const product: SoldProductCustomerProductRef = productFromDb
    ? {
        id: productFromDb.id,
        code: productFromDb.sku?.trim() || null,
        name: productFromDb.name,
        description: productFromDb.description?.trim() || null,
      }
    : resolveProductRef(productId, productLines);

  const warnings: string[] = [];
  if (productLines.length === 0) {
    warnings.push("Nenhuma compra válida do produto no período/filtros aplicados.");
  }
  if (!hasTaxId) {
    warnings.push("Carteira e inadimplência indisponíveis — clientes sem CNPJ vinculado.");
  }

  return {
    generatedAt: referenceDate.toISOString(),
    product,
    filters: {
      ...buildSoldProductsAppliedFiltersLabel(ui, referenceDate),
      minQuantity: customerFilters.minQuantity,
      minRevenue: customerFilters.minRevenue,
      minDaysSinceLastPurchase: customerFilters.minDaysSinceLastPurchase,
      maxDaysSinceLastPurchase: customerFilters.maxDaysSinceLastPurchase,
      state: customerFilters.state,
      region: customerFilters.region,
      activityFilter: customerFilters.activityFilter,
      onlyWithoutOverdue: customerFilters.onlyWithoutOverdue,
      customerSortBy: customerFilters.sortBy,
      customerSortDirection: customerFilters.sortDirection,
      customerTopN: customerFilters.topN,
    },
    summary: {
      ...summary,
      customersCount: customersRows.length,
      inactiveCustomersCount: customersRows.filter(
        (r) => (r.daysSinceLastPurchase ?? 0) > SOLD_PRODUCT_INACTIVE_DAYS
      ).length,
      recurringCustomersCount: customersRows.filter((r) => r.ordersCount >= 2).length,
    },
    customers: customersRows,
    dataQuality: {
      warnings,
      sources: ["SalesOrder", "SalesOrderItem", "Customer", "FinanceAccountsReceivable"],
    },
  };
}
