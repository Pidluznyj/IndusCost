/**
 * Assembler — GET /api/crm/customers/:customerId/intelligence
 * Fonte comercial principal: SalesOrder + SalesOrderItem.
 */

import { buildCustomerIntelligenceCrm } from "@/src/lib/customerIntelligenceCrm.js";
import {
  applyCommercialClassificationFromOpportunities,
  buildCustomerIntelligenceScoring,
} from "@/src/lib/customerIntelligenceScoring.js";
import {
  buildCustomerIntelligenceOpportunities,
  hasActionableCommercialOpportunity,
} from "@/src/lib/customerIntelligenceOpportunities.js";
import {
  buildCustomerIntelligenceExecutiveNarrative,
  ensureNarrativeNotEmpty,
} from "@/src/lib/customerIntelligenceNarrative.js";
import { buildCustomerIntelligenceFinancial } from "@/src/lib/customerIntelligenceFinancial.js";
import {
  daysBetweenDates,
  filterCustomerIntelligenceOrders,
  getCustomerIntelligenceMetricsOrders,
  isInternalGroupCustomer,
  resolveCustomerDisplayName,
  resolveCustomerIntelligenceRegion,
  roundMoney,
  safeCommercialNumber,
  safeDivide,
  safeFiniteNumber,
  toIsoDateOnly,
  computeOrderDateBounds,
  collectPurchaseYears,
  describeCustomerIntelligenceFiltersApplied,
  hasActiveCustomerIntelligenceCommercialFilter,
} from "@/src/lib/customerIntelligenceUtils.js";
import {
  buildCustomerProfileFields,
  buildCustomerIntelligenceProfileDataQualityWarnings,
  isNomusSyncedCustomer,
  resolveCustomerRegistrationDate,
} from "@/src/lib/customerIntelligenceProfileSources.js";
import {
  buildCustomerIntelligenceHistory,
  buildCustomerIntelligenceSeasonality,
} from "@/src/lib/customerIntelligenceHistory.js";
import { buildCustomerIntelligenceProducts } from "@/src/lib/customerIntelligenceProducts.js";
import {
  mapPrismaOrderToSalesOrderRulesInput,
  resolveOfficialCustomerIntelligenceOrderMetrics,
  resolveOfficialScopedOrderMetrics,
} from "@/src/lib/salesOrderRulesAdapter.js";
import { aggregateSalesOrderMarginSummaries } from "@/src/lib/salesOrderMarginDisplay.js";
import { resolveSalesOrderMarginSummaryStatusMeta } from "@/src/lib/salesOrderMarginStatus.js";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes.js";
import type {
  CustomerIntelligenceBuildInput,
  CustomerIntelligenceOrderInput,
  CustomerIntelligenceOrderScopeSummary,
  CustomerIntelligenceReport,
} from "@/src/lib/customerIntelligenceTypes.js";
import {
  isCommercialOpenSalesOrder,
  isCommercialMetricsSalesOrder,
} from "@/src/lib/customerCommercialSalesOrderView.js";
import type { SalesOrderLinkStatus } from "@/src/types/commercial.js";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function buildOrderScopeSummary(
  allOrders: CustomerIntelligenceOrderInput[],
  metricsOrders: CustomerIntelligenceOrderInput[],
  now: Date
): CustomerIntelligenceOrderScopeSummary {
  const { firstOrderDate, lastOrderDate } = computeOrderDateBounds(metricsOrders);
  const official = resolveOfficialCustomerIntelligenceOrderMetrics({
    orders: metricsOrders.map((order) =>
      mapPrismaOrderToSalesOrderRulesInput({
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        issueDate: order.issueDate,
        totalNetValue: order.totalNetValue,
        totalItems: order.items.length,
        responsible: order.responsible,
        items: order.items.map((item) => ({
          id: item.productId,
          quantity: item.quantity,
          skuSnapshot: item.Product?.sku ?? null,
          productNameSnapshot: item.Product?.name ?? null,
        })),
      })
    ),
    referenceDate: now,
    managementFilters: { allYears: true },
  });

  return {
    revenue: roundMoney(official.revenue) ?? 0,
    ordersCount: allOrders.length,
    validOrdersCount: official.validOrdersCount,
    billedOrdersCount: official.billedOrdersCount,
    firstOrderDate: toIsoDateOnly(firstOrderDate),
    lastOrderDate: toIsoDateOnly(lastOrderDate),
    daysSinceLastOrder:
      lastOrderDate != null ? daysBetweenDates(lastOrderDate, now) : null,
    purchaseYears: collectPurchaseYears(metricsOrders),
  };
}

function buildRepurchase(
  metricsOrders: CustomerIntelligenceBuildInput["orders"],
  now: Date
): CustomerIntelligenceReport["repurchase"] {
  const sorted = [...metricsOrders].sort(
    (a, b) => a.issueDate.getTime() - b.issueDate.getTime()
  );

  if (sorted.length < 2) {
    return {
      status: "INSUFICIENTE",
      averageDaysBetweenOrders: null,
      medianDaysBetweenOrders: null,
      estimatedNextPurchaseDate: null,
      daysOverExpected: null,
      confidence: null,
      detail: "É necessário ao menos dois pedidos válidos para estimar intervalo entre compras.",
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetweenDates(sorted[i - 1]!.issueDate, sorted[i]!.issueDate));
  }

  const meanDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const medianDays = median(intervals);
  const lastOrder = sorted[sorted.length - 1]!;
  const daysSinceLast = daysBetweenDates(lastOrder.issueDate, now);

  let estimatedNext: string | null = null;
  if (medianDays != null && medianDays > 0) {
    const d = new Date(lastOrder.issueDate);
    d.setDate(d.getDate() + Math.round(medianDays));
    estimatedNext = d.toISOString();
  }

  let status: CustomerIntelligenceReport["repurchase"]["status"] = "INSUFICIENTE";
  let detail = "";
  let daysOverExpected: number | null = null;

  if (medianDays != null && medianDays > 0) {
    const ratio = daysSinceLast / medianDays;
    if (ratio <= 0.85) {
      status = "DENTRO_JANELA";
      detail = `Último pedido há ${daysSinceLast} dias; mediana histórica ≈ ${Math.round(medianDays)} dias.`;
    } else if (ratio <= 1.15) {
      status = "PROXIMA";
      detail = `Próximo da janela típica (mediana ≈ ${Math.round(medianDays)} dias).`;
    } else {
      status = "ATRASADO";
      detail = "Acima do intervalo típico — priorizar contato comercial.";
      daysOverExpected = Math.max(0, Math.round(daysSinceLast - medianDays));
    }
  }

  const confidence: CustomerIntelligenceReport["repurchase"]["confidence"] =
    sorted.length >= 5 ? "high" : sorted.length >= 3 ? "medium" : "low";

  return {
    status,
    averageDaysBetweenOrders: roundMoney(meanDays),
    medianDaysBetweenOrders: medianDays != null ? roundMoney(medianDays) : null,
    estimatedNextPurchaseDate: estimatedNext,
    daysOverExpected,
    confidence,
    detail,
  };
}

export function buildCustomerIntelligenceReport(
  input: CustomerIntelligenceBuildInput
): CustomerIntelligenceReport {
  const now = input.now ?? new Date();
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const sources = ["SalesOrder", "SalesOrderItem", "Customer"];

  const filteredOrders = filterCustomerIntelligenceOrders(input.orders, input.filters);
  const lifetimeMetricsOrders = getCustomerIntelligenceMetricsOrders(input.orders);
  const filteredMetricsOrders = getCustomerIntelligenceMetricsOrders(filteredOrders);
  const filtersApplied = describeCustomerIntelligenceFiltersApplied(input.filters);
  const hasActiveCommercialFilter = hasActiveCustomerIntelligenceCommercialFilter(input.filters);
  const isNomusSynced = isNomusSyncedCustomer(input.customer.notes);

  if (input.activities.length > 0) sources.push("CommercialActivity");
  if (input.arLinkedByCnpj) sources.push("NomusAccountsReceivable");
  if (isNomusSynced) sources.push("NomusCustomer");

  if (isInternalGroupCustomer(input.customer) && input.filters.customerType === "external") {
    warnings.push(
      "Cliente do grupo econômico — métricas de mercado externo podem não se aplicar."
    );
  }

  if (!input.customer.accountOwner?.trim()) {
    missingFields.push("commercialOwner");
  }
  if (!input.customer.city?.trim()) missingFields.push("city");
  if (!input.customer.state?.trim()) missingFields.push("state");

  const region = resolveCustomerIntelligenceRegion(input.customer.state);
  if (!region && input.customer.state?.trim()) {
    warnings.push("UF não reconhecida para derivar região macro.");
  } else if (!input.customer.state?.trim()) {
    missingFields.push("region");
  }

  const sortedFilteredMetrics = [...filteredMetricsOrders].sort(
    (a, b) => a.issueDate.getTime() - b.issueDate.getTime()
  );
  const filteredLastOrderDate =
    sortedFilteredMetrics[sortedFilteredMetrics.length - 1]?.issueDate ?? null;

  const lifetimeSummary = buildOrderScopeSummary(
    input.orders,
    lifetimeMetricsOrders,
    now
  );
  const filteredSummary = buildOrderScopeSummary(
    filteredOrders,
    filteredMetricsOrders,
    now
  );

  const revenue = filteredSummary.revenue;
  const validOrdersCount = filteredSummary.validOrdersCount;
  const billedOrdersCount = filteredSummary.billedOrdersCount;

  const filteredOfficialMetrics = resolveOfficialScopedOrderMetrics({
    orders: filteredMetricsOrders.map((order) =>
      mapPrismaOrderToSalesOrderRulesInput({
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        issueDate: order.issueDate,
        totalNetValue: order.totalNetValue,
        totalItems: order.items.length,
        responsible: order.responsible,
        items: order.items.map((item) => ({
          id: item.productId,
          quantity: item.quantity,
          skuSnapshot: item.Product?.sku ?? null,
          productNameSnapshot: item.Product?.name ?? null,
        })),
      })
    ),
    referenceDate: now,
    listFilters: {
      year: input.filters.year ?? null,
      month: input.filters.month ?? null,
      startDate: input.filters.startDate ? new Date(input.filters.startDate) : null,
      endDate: input.filters.endDate ? new Date(input.filters.endDate) : null,
    },
    managementFilters: {
      allYears: input.filters.year == null && input.filters.month == null,
      year: input.filters.year ?? undefined,
      month: input.filters.month ?? undefined,
    },
  });
  const openPortfolioAmount = filteredOfficialMetrics.openPortfolioAmount;
  const averageTicket = filteredOfficialMetrics.averageTicket || safeDivide(revenue, validOrdersCount);


  let averageMarginPercent: number | null = null;
  let totalMarginAmount: number | null = null;
  let marginCoverage: SalesOrderMarginSummaryPayload | null = null;

  const marginSummaries: SalesOrderMarginSummaryPayload[] = [];
  for (const order of filteredMetricsOrders) {
    const marginValue = safeFiniteNumber(order.totalMarginValue);
    if (marginValue == null) continue;
    const marginRevenueCovered =
      safeFiniteNumber(order.marginRevenueCovered) ?? safeCommercialNumber(order.totalNetValue);
    const totalSalesRevenueInScope =
      safeFiniteNumber(order.totalSalesRevenueInScope) ?? safeCommercialNumber(order.totalNetValue);
    const marginRevenueUncovered = Math.max(0, totalSalesRevenueInScope - marginRevenueCovered);
    const statusMeta = resolveSalesOrderMarginSummaryStatusMeta("OK");
    marginSummaries.push({
      netRevenue: marginRevenueCovered,
      totalCost: 0,
      marginValue,
      marginPercent: safeFiniteNumber(order.totalMarginPerc),
      markup: null,
      itemsCount: order.items.length,
      validItemsCount: order.items.length,
      ignoredItemsCount: 0,
      hasMissingCost: order.costCoverageStatus === "PARTIAL" || order.costCoverageStatus === "NONE",
      hasMissingProduct: false,
      hasNegativeMargin: marginValue < 0,
      hasInvalidRevenue: false,
      status: order.costCoverageStatus === "NONE" ? "SEM_CUSTO" : "OK",
      statusLabel: statusMeta.statusLabel,
      statusSeverity: statusMeta.statusSeverity,
      totalSalesRevenueInScope,
      marginRevenueCovered,
      marginRevenueUncovered,
      marginCoveragePercent:
        totalSalesRevenueInScope > 0
          ? roundMoney((marginRevenueCovered / totalSalesRevenueInScope) * 100)
          : null,
      itemsTotal: order.items.length,
      itemsWithCost: order.costCoverageStatus === "NONE" ? 0 : order.items.length,
      itemsWithoutCost: order.costCoverageStatus === "FULL" ? 0 : order.items.length,
      costCoverageStatus: order.costCoverageStatus ?? "NONE",
    });
  }

  if (marginSummaries.length > 0) {
    marginCoverage = aggregateSalesOrderMarginSummaries(marginSummaries) ?? null;
    totalMarginAmount = marginCoverage?.marginValue ?? null;
    averageMarginPercent = marginCoverage?.marginPercent ?? null;
    if (marginCoverage?.costCoverageStatus === "PARTIAL") {
      warnings.push(
        `Margem parcial: calculada sobre ${marginCoverage.marginRevenueCovered.toFixed(2)} de ${marginCoverage.totalSalesRevenueInScope.toFixed(2)} vendidos (${marginCoverage.marginCoveragePercent ?? 0}% da receita).`
      );
    } else if (marginCoverage?.costCoverageStatus === "NONE") {
      warnings.push("Margem indisponível — nenhuma linha com custo no filtro.");
      totalMarginAmount = null;
      averageMarginPercent = null;
    }
  } else if (validOrdersCount > 0) {
    warnings.push("Margem indisponível nos pedidos do filtro.");
    totalMarginAmount = null;
    averageMarginPercent = null;
  }


  const daysSinceLastOrder =
    filteredLastOrderDate != null ? daysBetweenDates(filteredLastOrderDate, now) : null;

  const productsResult = buildCustomerIntelligenceProducts(
    filteredMetricsOrders,
    input.filters.topN,
    now
  );
  const products = productsResult.products;
  for (const w of productsResult.warnings) {
    warnings.push(w);
  }

  const leadingProduct = products.topByRevenue[0]
    ? {
        productId: products.topByRevenue[0].productId,
        sku: products.topByRevenue[0].productCode,
        name: products.topByRevenue[0].productName,
        revenue: products.topByRevenue[0].revenue,
      }
    : null;

  const commercialSummary: CustomerIntelligenceReport["commercialSummary"] = {
    revenue: roundMoney(revenue) ?? 0,
    ordersCount: filteredOrders.length,
    validOrdersCount,
    billedOrdersCount,
    openPortfolioAmount: roundMoney(openPortfolioAmount) ?? 0,
    averageTicket: averageTicket != null ? roundMoney(averageTicket) : null,
    averageMarginPercent,
    totalMarginAmount,
    marginCoverage,
    lastOrderDate: toIsoDateOnly(filteredLastOrderDate),
    daysSinceLastOrder,
    leadingProduct,
  };

  const lifetimeHistory = buildCustomerIntelligenceHistory(lifetimeMetricsOrders, now);
  const filteredHistory = buildCustomerIntelligenceHistory(filteredMetricsOrders, now);
  const history: CustomerIntelligenceReport["history"] = {
    byYear: lifetimeHistory.byYear,
    byMonth: filteredHistory.byMonth,
    strongestMonths: lifetimeHistory.strongestMonths,
    analysis: filteredHistory.analysis,
    lifetimeAnalysis: lifetimeHistory.analysis,
    scopeNotice: hasActiveCommercialFilter
      ? "Cards acima respeitam o filtro. Histórico por ano mostra toda a base disponível."
      : null,
  };
  const seasonality = buildCustomerIntelligenceSeasonality(lifetimeHistory);
  const repurchase = buildRepurchase(lifetimeMetricsOrders, now);
  const financial = buildCustomerIntelligenceFinancial({
    customerTaxId: input.customer.taxId,
    arRows: input.arRows,
    arSyncCutoff: input.arSyncCutoff,
    referenceDate: now,
  });

  if (!financial.linkedByCnpj) {
    warnings.push("Financeiro (AR) não vinculado — CNPJ do cliente ausente ou sem títulos.");
    missingFields.push("financial");
  } else {
    for (const w of financial.dataQuality.warnings) {
      warnings.push(w);
    }
  }

  const crm = buildCustomerIntelligenceCrm({
    customerId: input.customer.id,
    commercialOwner: input.customer.accountOwner?.trim() || null,
    activities: input.activities,
    crmProfile: input.crmProfile,
    hasPurchaseHistory: validOrdersCount > 0,
    referenceDate: now,
  });

  let scoring = buildCustomerIntelligenceScoring({
    commercialSummary,
    history,
    repurchase,
    financial,
    crm,
  });

  const registration = resolveCustomerRegistrationDate({
    nomusRegistrationDate: input.customer.nomusRegistrationDate ?? null,
    createdAt: input.customer.createdAt,
    isNomusSynced,
  });

  for (const warning of buildCustomerIntelligenceProfileDataQualityWarnings({
    customer: input.customer,
    registration,
    isNomusSynced,
    hasActiveCommercialFilter,
    financialLinkedByCnpj: financial.linkedByCnpj,
  })) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const customer: CustomerIntelligenceReport["customer"] = {
    id: input.customer.id,
    code: input.customer.taxId?.trim() || null,
    name: resolveCustomerDisplayName(input.customer),
    legalName: input.customer.companyName,
    cnpj: input.customer.taxId?.trim() || null,
    city: input.customer.city?.trim() || null,
    state: input.customer.state?.trim() || null,
    region,
    registrationDate: registration.date,
    registrationDateSource: registration.source,
    registrationSourceLabel: registration.sourceLabel,
    registrationHeaderLabel: registration.headerLabel,
    isNomusSynced,
    firstOrderDate: lifetimeSummary.firstOrderDate,
    lastOrderDate: lifetimeSummary.lastOrderDate,
    commercialOwner: input.customer.accountOwner?.trim() || null,
  };

  const profileFields = buildCustomerProfileFields({
    customer: input.customer,
    registration,
    region,
  });

  const dataQuality = { warnings, missingFields, sources };

  const opportunities = buildCustomerIntelligenceOpportunities({
    customer,
    commercialSummary,
    products,
    repurchase,
    financial,
    crm,
    dataQuality,
    scoring,
  });

  scoring = applyCommercialClassificationFromOpportunities(scoring, {
    validOrdersCount: commercialSummary.validOrdersCount,
    revenue: commercialSummary.revenue,
    daysSinceLastOrder: commercialSummary.daysSinceLastOrder,
    financialStatus: financial.financialStatus,
    overdueAmount: financial.overdueAmount ?? 0,
    crmRelationshipStatus: crm.relationshipStatus,
    repurchaseStatus: repurchase.status,
    hasActionableOpportunity: hasActionableCommercialOpportunity(opportunities),
  });

  const executiveNarrative = ensureNarrativeNotEmpty(
    buildCustomerIntelligenceExecutiveNarrative({
      customer,
      commercialSummary,
      repurchase,
      financial,
      crm,
      products,
      scoring,
      opportunities,
    }),
    scoring.summary
  );

  return {
    customer,
    filters: input.filters,
    filtersApplied,
    dataQuality,
    filteredSummary,
    lifetimeSummary,
    commercialSummary,
    profileFields,
    history,
    seasonality,
    products,
    repurchase,
    financial,
    crm,
    scoring,
    opportunities,
    executiveNarrative,
  };
}

export { isCommercialMetricsSalesOrder };
