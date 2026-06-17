/**
 * Assembler — GET /api/crm/customers/:customerId/intelligence
 * Fonte comercial principal: SalesOrder + SalesOrderItem.
 */

import { buildCrmCommercialIntelligenceResponse } from "@/src/lib/crmCommercialIntelligence.js";
import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  isFinanceArReceivedOrSettled,
  roundMoney as roundArMoney,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  applyTopNLimit,
  CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_MONTHS,
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
import { buildCustomerIntelligenceExecutiveNarrative } from "@/src/lib/customerIntelligenceNarrative.js";
import type {
  CustomerIntelligenceBuildInput,
  CustomerIntelligenceOpportunity,
  CustomerIntelligenceProductRow,
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

function buildProductMix(
  metricsOrders: CustomerIntelligenceBuildInput["orders"],
  topN: CustomerIntelligenceBuildInput["filters"]["topN"],
  now: Date
): CustomerIntelligenceReport["products"] {
  const byProduct = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      type: string | null;
      quantity: number;
      revenue: number;
      orderIds: Set<string>;
      lastPurchaseDate: Date | null;
    }
  >();

  for (const order of metricsOrders) {
    for (const item of order.items) {
      const productId = item.productId;
      const product = item.Product;
      const qty = safeCommercialNumber(item.quantity);
      const rev = safeCommercialNumber(item.totalNetValue);
      const prev = byProduct.get(productId);
      if (prev) {
        prev.quantity += qty;
        prev.revenue += rev;
        prev.orderIds.add(order.id);
        if (!prev.lastPurchaseDate || order.issueDate > prev.lastPurchaseDate) {
          prev.lastPurchaseDate = order.issueDate;
        }
      } else {
        byProduct.set(productId, {
          productId,
          sku: product?.sku ?? "—",
          name: product?.name ?? "Produto",
          type: product?.type ?? null,
          quantity: qty,
          revenue: rev,
          orderIds: new Set([order.id]),
          lastPurchaseDate: order.issueDate,
        });
      }
    }
  }

  const toRow = (entry: (typeof byProduct extends Map<string, infer V> ? V : never)): CustomerIntelligenceProductRow => ({
    productId: entry.productId,
    sku: entry.sku,
    name: entry.name,
    type: entry.type,
    quantity: roundMoney(entry.quantity) ?? 0,
    revenue: roundMoney(entry.revenue) ?? 0,
    ordersCount: entry.orderIds.size,
    lastPurchaseDate: toIsoDateOnly(entry.lastPurchaseDate),
  });

  const allRows = [...byProduct.values()].map(toRow);
  const topByRevenue = applyTopNLimit(
    [...allRows].sort((a, b) => b.revenue - a.revenue),
    topN
  );
  const topByQuantity = applyTopNLimit(
    [...allRows].sort((a, b) => b.quantity - a.quantity),
    topN
  );

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_MONTHS);

  const abandonedProducts = applyTopNLimit(
    [...byProduct.values()]
      .filter(
        (p) =>
          p.lastPurchaseDate != null &&
          p.lastPurchaseDate < cutoff &&
          p.orderIds.size >= 1
      )
      .map(toRow)
      .sort((a, b) => b.revenue - a.revenue),
    topN
  );

  const recurringProducts = applyTopNLimit(
    [...byProduct.values()]
      .filter((p) => p.orderIds.size >= 2)
      .map(toRow)
      .sort((a, b) => b.ordersCount - a.ordersCount),
    topN
  );

  const totalRevenue = allRows.reduce((acc, r) => acc + r.revenue, 0);
  const sortedRev = [...allRows].sort((a, b) => b.revenue - a.revenue);
  const top1 = sortedRev[0]?.revenue ?? 0;
  const top3 = sortedRev.slice(0, 3).reduce((acc, r) => acc + r.revenue, 0);

  return {
    topByRevenue,
    topByQuantity,
    abandonedProducts,
    recurringProducts,
    concentration: {
      top1RevenueSharePercent:
        totalRevenue > 0 ? roundMoney(safeDivide(top1, totalRevenue)! * 100) : null,
      top3RevenueSharePercent:
        totalRevenue > 0 ? roundMoney(safeDivide(top3, totalRevenue)! * 100) : null,
      distinctProductsCount: allRows.length,
    },
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

function buildFinancial(
  arRows: CustomerIntelligenceBuildInput["arRows"],
  arLinkedByCnpj: boolean,
  now: Date
): CustomerIntelligenceReport["financial"] {
  if (!arLinkedByCnpj || arRows.length === 0) {
    return {
      receivableOpenAmount: arLinkedByCnpj ? 0 : null,
      overdueAmount: arLinkedByCnpj ? 0 : null,
      upcomingAmount: arLinkedByCnpj ? 0 : null,
      overdueTitlesCount: arLinkedByCnpj ? 0 : null,
      maxDaysOverdue: arLinkedByCnpj ? 0 : null,
      averageDaysOverdue: arLinkedByCnpj ? 0 : null,
      linkedByCnpj: arLinkedByCnpj,
    };
  }

  let receivableOpenAmount = 0;
  let overdueAmount = 0;
  let upcomingAmount = 0;
  let overdueTitlesCount = 0;
  let maxDaysOverdue = 0;
  const overdueDaysList: number[] = [];

  for (const row of arRows) {
    if (isFinanceArReceivedOrSettled(row)) continue;
    const balance = roundArMoney(row.balanceReceivable);
    if (balance <= 0) continue;

    receivableOpenAmount += balance;
    const titleStatus = classifyFinanceArTitle(
      {
        ...row,
        externalId: 0,
        companyName: null,
        personName: null,
        personCnpj: null,
        description: null,
        paymentMethodName: null,
        bankAccountName: null,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        nomusStatus: null,
        syncedAt: now,
      },
      now
    );

    if (titleStatus === "overdue") {
      overdueAmount += balance;
      overdueTitlesCount += 1;
      const days = computeDaysOverdue(row.dueDate, now);
      if (days > maxDaysOverdue) maxDaysOverdue = days;
      if (days > 0) overdueDaysList.push(days);
    } else if (titleStatus === "upcoming" || titleStatus === "dueToday") {
      upcomingAmount += balance;
    }
  }

  const averageDaysOverdue =
    overdueDaysList.length > 0
      ? overdueDaysList.reduce((a, b) => a + b, 0) / overdueDaysList.length
      : 0;

  return {
    receivableOpenAmount: roundMoney(receivableOpenAmount),
    overdueAmount: roundMoney(overdueAmount),
    upcomingAmount: roundMoney(upcomingAmount),
    overdueTitlesCount,
    maxDaysOverdue,
    averageDaysOverdue: roundMoney(averageDaysOverdue),
    linkedByCnpj: true,
  };
}

function buildCrm(
  activities: CustomerIntelligenceBuildInput["activities"],
  now: Date
): CustomerIntelligenceReport["crm"] {
  const openActivities = activities.filter((a) => a.status === "OPEN");
  const overdueTasks = openActivities.filter(
    (a) => a.nextActionAt != null && a.nextActionAt < now
  );

  const contactDates = activities
    .map((a) => a.contactDate ?? a.createdAt)
    .filter((d) => d != null)
    .sort((a, b) => b.getTime() - a.getTime());

  const nextTasks = openActivities
    .filter((a) => a.nextActionAt != null)
    .map((a) => a.nextActionAt!)
    .sort((a, b) => a.getTime() - b.getTime());

  const lastNotes = activities
    .slice()
    .sort((a, b) => (b.contactDate ?? b.createdAt).getTime() - (a.contactDate ?? a.createdAt).getTime())
    .slice(0, 5)
    .map((a) => {
      const parts = [a.subject, a.description, a.outcome].filter(Boolean);
      return parts.join(" — ").trim();
    })
    .filter((s) => s.length > 0);

  return {
    lastContactAt: contactDates[0]?.toISOString() ?? null,
    nextTaskAt: nextTasks[0]?.toISOString() ?? null,
    openTasksCount: openActivities.length,
    overdueTasksCount: overdueTasks.length,
    lastNotes,
  };
}

function buildOpportunities(
  input: CustomerIntelligenceBuildInput,
  commercialSummary: CustomerIntelligenceReport["commercialSummary"],
  repurchase: CustomerIntelligenceReport["repurchase"],
  financial: CustomerIntelligenceReport["financial"]
): CustomerIntelligenceOpportunity[] {
  const crmIntel = buildCrmCommercialIntelligenceResponse({
    customer: {
      id: input.customer.id,
      companyName: input.customer.companyName,
      tradeName: input.customer.tradeName,
      taxId: input.customer.taxId,
    },
    activities: input.activities.map((a) => ({
      contactDate: a.contactDate,
      createdAt: a.createdAt,
      salesOrderId: null,
    })),
    salesOrders: input.orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      issueDate: o.issueDate,
      updatedAt: o.updatedAt,
      status: o.status,
      totalNetValue: o.totalNetValue,
      responsible: o.responsible,
      nomusRawResponse: o.hasInvoicing ? { nfes: [{ dataProcessamento: "1" }] } : { nfes: [] },
    })),
    now: input.now ?? new Date(),
  });

  const opportunities: CustomerIntelligenceOpportunity[] = crmIntel.signals.map((s) => ({
    type: s.type,
    severity: s.severity,
    title: s.title,
    description: s.description,
  }));

  if (repurchase.status === "ATRASADO") {
    opportunities.push({
      type: "OPPORTUNITY",
      severity: "MEDIUM",
      title: "Recompra em atraso",
      description: repurchase.detail ?? "Priorizar contato para novo pedido.",
    });
  }

  if ((financial.overdueAmount ?? 0) > 0) {
    opportunities.push({
      type: "RISK",
      severity: "HIGH",
      title: "Inadimplência financeira",
      description: `Saldo vencido (AR): R$ ${(financial.overdueAmount ?? 0).toFixed(2)}.`,
    });
  }

  if (commercialSummary.validOrdersCount === 0) {
    opportunities.push({
      type: "INFO",
      severity: "MEDIUM",
      title: "Sem pedidos válidos",
      description: "Nenhum pedido de venda válido no escopo filtrado.",
    });
  }

  return opportunities.slice(0, 12);
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

  const products = buildProductMix(metricsOrders, input.filters.topN, now);
  const leadingProduct = products.topByRevenue[0]
    ? {
        productId: products.topByRevenue[0].productId,
        sku: products.topByRevenue[0].sku,
        name: products.topByRevenue[0].name,
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
  const financial = buildFinancial(input.arRows, input.arLinkedByCnpj, now);
  const crm = buildCrm(input.activities, now);

  if (!input.arLinkedByCnpj) {
    warnings.push("Financeiro (AR) não vinculado — CNPJ do cliente ausente ou sem títulos.");
    missingFields.push("financial");
  }

  const opportunities = buildOpportunities(input, commercialSummary, repurchase, financial);

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

  const executiveNarrative = buildCustomerIntelligenceExecutiveNarrative({
    customer,
    commercialSummary,
    repurchase,
    financial,
    opportunities,
  });

  return {
    customer,
    filters: input.filters,
    dataQuality: { warnings, missingFields, sources },
    commercialSummary,
    history,
    seasonality,
    products,
    repurchase,
    financial,
    crm,
    opportunities,
    executiveNarrative,
  };
}

export { isCommercialMetricsSalesOrder };
