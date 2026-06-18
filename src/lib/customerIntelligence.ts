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
} from "@/src/lib/customerIntelligenceUtils.js";
import {
  buildCustomerIntelligenceHistory,
  buildCustomerIntelligenceSeasonality,
} from "@/src/lib/customerIntelligenceHistory.js";
import { buildCustomerIntelligenceProducts } from "@/src/lib/customerIntelligenceProducts.js";
import type {
  CustomerIntelligenceBuildInput,
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
  const metricsOrders = getCustomerIntelligenceMetricsOrders(filteredOrders);

  if (input.activities.length > 0) sources.push("CommercialActivity");
  if (input.arLinkedByCnpj) sources.push("NomusAccountsReceivable");

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

  const sortedMetrics = [...metricsOrders].sort(
    (a, b) => a.issueDate.getTime() - b.issueDate.getTime()
  );
  const firstOrderDate = sortedMetrics[0]?.issueDate ?? null;
  const lastOrderDate = sortedMetrics[sortedMetrics.length - 1]?.issueDate ?? null;

  const revenue = metricsOrders.reduce(
    (acc, o) => acc + safeCommercialNumber(o.totalNetValue),
    0
  );
  const validOrdersCount = metricsOrders.length;
  const billedOrdersCount = metricsOrders.filter((o) => o.hasInvoicing).length;
  const openPortfolioAmount = metricsOrders
    .filter((o) =>
      isCommercialOpenSalesOrder({
        status: o.status as SalesOrderLinkStatus,
        hasInvoicing: o.hasInvoicing,
      })
    )
    .reduce((acc, o) => acc + safeCommercialNumber(o.totalNetValue), 0);

  const marginPercSamples = metricsOrders
    .map((o) => safeFiniteNumber(o.totalMarginPerc))
    .filter((v): v is number => v != null);
  const marginValueSamples = metricsOrders
    .map((o) => safeFiniteNumber(o.totalMarginValue))
    .filter((v): v is number => v != null);

  let averageMarginPercent: number | null = null;
  let totalMarginAmount: number | null = null;

  if (marginPercSamples.length > 0 && marginPercSamples.some((v) => v !== 0)) {
    averageMarginPercent = roundMoney(
      marginPercSamples.reduce((a, b) => a + b, 0) / marginPercSamples.length
    );
  } else if (validOrdersCount > 0) {
    warnings.push("Margem percentual média indisponível ou não confiável nos pedidos.");
    averageMarginPercent = null;
  }

  if (marginValueSamples.length > 0) {
    totalMarginAmount = roundMoney(marginValueSamples.reduce((a, b) => a + b, 0));
  } else if (validOrdersCount > 0) {
    warnings.push("Margem total indisponível nos pedidos.");
    totalMarginAmount = null;
  }

  const averageTicket = safeDivide(revenue, validOrdersCount);
  const daysSinceLastOrder =
    lastOrderDate != null ? daysBetweenDates(lastOrderDate, now) : null;

  const productsResult = buildCustomerIntelligenceProducts(
    metricsOrders,
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
    lastOrderDate: toIsoDateOnly(lastOrderDate),
    daysSinceLastOrder,
    leadingProduct,
  };

  const history = buildCustomerIntelligenceHistory(metricsOrders, now);
  const seasonality = buildCustomerIntelligenceSeasonality(history);
  const repurchase = buildRepurchase(metricsOrders, now);
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

  const customer: CustomerIntelligenceReport["customer"] = {
    id: input.customer.id,
    code: input.customer.taxId?.trim() || null,
    name: resolveCustomerDisplayName(input.customer),
    legalName: input.customer.companyName,
    cnpj: input.customer.taxId?.trim() || null,
    city: input.customer.city?.trim() || null,
    state: input.customer.state?.trim() || null,
    region,
    registrationDate: toIsoDateOnly(input.customer.createdAt),
    firstOrderDate: toIsoDateOnly(firstOrderDate),
    lastOrderDate: toIsoDateOnly(lastOrderDate),
    commercialOwner: input.customer.accountOwner?.trim() || null,
  };

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
    dataQuality,
    commercialSummary,
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
