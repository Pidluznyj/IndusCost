/**
 * Payload da aba Relatórios — pedidos via motor oficial; custo industrial orquestrado à parte.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { buildCustomerAbcRanking } from "./customerCommercialShared.js";
import {
  buildOfficialCustomerRevenueByCustomer,
  buildOfficialReportsCommercialPayload,
  buildOfficialReportsPreviousPeriodPayload,
  buildOfficialReportsProductMixFromOrders,
  mapPrismaOrderToSalesOrderRulesInput,
  OFFICIAL_SO_RULES_SOURCE,
  type OfficialReportsProductMixRow,
} from "./salesOrderRulesAdapter.js";
import { calculateSalesOrderMarginsForOrders } from "./salesOrderMarginService.server.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";
import type { SalesOrderListFilters } from "./salesOrdersListSummary.js";
import {
  extractOfficialProductFinalUnitCost,
} from "./productOfficialFinalCost.js";
import { isCostAnalysisFailure } from "./productCostSnapshot.js";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import { aggregateCommercialMarginPayloads } from "./salesOrderCommercialMarginReadModel.js";

export type ReportsDataQuery = {
  dateFrom: string | null;
  dateTo: string | null;
  customerId: string | null;
  responsible: string | null;
  status: string | null;
  minNet: number | null;
  maxNet: number | null;
  productId: string | null;
};

export type ReportsDataPayload = {
  generatedAt: string;
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  filters: ReportsDataQuery;
  disclaimers: string[];
  commercial: ReturnType<typeof buildOfficialReportsCommercialPayload> & {
    staleOrders: Array<{
      id: string;
      orderCode: string;
      status: string;
      customerName: string;
      responsible: string;
      totalNetValue: number;
      daysSinceUpdate: number;
      stale: boolean;
    }>;
  };
  customers: {
    abc: ReturnType<typeof buildCustomerAbcRanking>;
    repurchaseLate: Array<{
      customerId: string;
      companyName: string;
      medianDays: number | null;
      lastApprovedAt: string | null;
      daysSinceLast: number | null;
      lateVsMedian: boolean | null;
    }>;
    inactiveInPeriod: Array<{
      customerId: string;
      companyName: string;
      orderCount: number;
      lastOrderAt: string;
    }>;
  };
  products: {
    mixByProduct: OfficialReportsProductMixRow[];
  };
  costing: {
    productsAnalyzed: Array<{
      productId: string;
      sku: string;
      name: string;
      totalIndustrialCost: number | null;
      suggestedPricePremissa: number | null;
      avgNegotiatedInPeriod: number | null;
      linesInPeriod: number;
      error?: string;
    }>;
    costProductLimit: number;
    totalDistinctProductsInFilter: number;
  };
  executive: {
    previousPeriod: ReturnType<typeof buildOfficialReportsPreviousPeriodPayload> | null;
  };
  marginPortfolio: SalesOrderMarginSummaryPayload | null;
};

const STALE_DAYS = 14;
const MAX_COST_PRODUCTS = 50;

export type ReportsDataServiceDeps = {
  getProductCostAnalysis: (productId: string) => Promise<unknown>;
};

type ReportsOrderRow = {
  id: string;
  orderCode: string;
  status: string;
  customerId: string;
  issueDate: Date;
  updatedAt: Date;
  totalNetValue: unknown;
  responsible: string | null;
  nomusRawResponse: unknown;
  Customer: { id: string; companyName: string } | null;
  items: Array<{
    id: string;
    productId: string;
    skuSnapshot: string | null;
    productNameSnapshot: string | null;
    quantity: unknown;
    totalNetValue: unknown;
    marginValue: unknown;
    negotiatedPrice: unknown;
    Product: {
      id: string;
      sku: string | null;
      name: string | null;
      type: string | null;
    } | null;
  }>;
};

function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
}

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function parseReportsDataQuery(q: Record<string, unknown>): ReportsDataQuery {
  return {
    dateFrom: typeof q.dateFrom === "string" && q.dateFrom ? q.dateFrom : null,
    dateTo: typeof q.dateTo === "string" && q.dateTo ? q.dateTo : null,
    customerId: typeof q.customerId === "string" && q.customerId ? q.customerId : null,
    responsible:
      typeof q.responsible === "string" && q.responsible.trim() ? q.responsible.trim() : null,
    status: typeof q.status === "string" && q.status && q.status !== "ALL" ? q.status : null,
    minNet: q.minNet != null && q.minNet !== "" ? Number(q.minNet) : null,
    maxNet: q.maxNet != null && q.maxNet !== "" ? Number(q.maxNet) : null,
    productId: typeof q.productId === "string" && q.productId ? q.productId : null,
  };
}

function buildReportsPrismaWhere(query: ReportsDataQuery): Prisma.SalesOrderWhereInput {
  const where: Prisma.SalesOrderWhereInput = {};
  if (query.dateFrom || query.dateTo) {
    where.issueDate = {};
    if (query.dateFrom) where.issueDate.gte = new Date(query.dateFrom);
    if (query.dateTo) where.issueDate.lte = endOfDay(query.dateTo);
  }
  if (query.customerId) where.customerId = query.customerId;
  if (query.responsible) where.responsible = query.responsible;
  if (query.status) where.status = query.status;
  if (query.productId) where.items = { some: { productId: query.productId } };
  if (
    (query.minNet != null && Number.isFinite(query.minNet)) ||
    (query.maxNet != null && Number.isFinite(query.maxNet))
  ) {
    where.totalNetValue = {};
    if (query.minNet != null && Number.isFinite(query.minNet)) {
      where.totalNetValue.gte = query.minNet;
    }
    if (query.maxNet != null && Number.isFinite(query.maxNet)) {
      where.totalNetValue.lte = query.maxNet;
    }
  }
  return where;
}

function toListFilters(query: ReportsDataQuery): SalesOrderListFilters {
  return {
    status: query.status ?? undefined,
    customerId: query.customerId ?? undefined,
    responsible: query.responsible ?? undefined,
    startDate: query.dateFrom ? new Date(query.dateFrom) : null,
    endDate: query.dateTo ? endOfDay(query.dateTo) : null,
  };
}

function mapReportsOrderToRulesInput(order: ReportsOrderRow) {
  return {
    ...mapPrismaOrderToSalesOrderRulesInput({
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      customerId: order.customerId,
      issueDate: order.issueDate,
      totalNetValue: order.totalNetValue,
      totalGrossValue: order.totalNetValue,
      totalItems: order.items.length,
      responsible: order.responsible,
      Customer: order.Customer ?? undefined,
      items: order.items.map((item) => ({
        id: item.id,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        quantity: item.quantity,
      })),
    }),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      totalNetValue: item.totalNetValue,
      officialMarginValue: null as number | null,
      Product: item.Product,
    })),
  };
}

function medianIntervals(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.floor((dates[i]!.getTime() - dates[i - 1]!.getTime()) / 86400000));
  }
  const s = [...gaps].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}

function isLegacyOpenWorkflowStatus(status: string): boolean {
  return status === "DRAFT" || status === "READY_TO_SEND";
}

export async function buildReportsDataPayload(
  db: Pick<PrismaClient, "salesOrder" | "customer" | "productPricing">,
  rawQuery: Record<string, unknown>,
  deps: ReportsDataServiceDeps
): Promise<ReportsDataPayload> {
  const query = parseReportsDataQuery(rawQuery);
  const now = new Date();
  const listFilters = toListFilters(query);
  const where = buildReportsPrismaWhere(query);

  const orders = (await db.salesOrder.findMany({
    where,
    include: {
      Customer: { select: { id: true, companyName: true, tradeName: true } },
      items: {
        include: {
          Product: { select: { id: true, sku: true, name: true, type: true } },
        },
      },
    },
    orderBy: { issueDate: "desc" },
  })) as ReportsOrderRow[];

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    db as PrismaClient,
    orders.map((order) => ({
      id: order.id,
      issueDate: order.issueDate,
      nomusRawResponse: order.nomusRawResponse,
      items: order.items,
    }))
  );

  const rulesOrders = orders.map((order) => {
    const base = mapReportsOrderToRulesInput(order);
    const marginResult = marginByOrder.get(order.id);
    const itemOfficialById = new Map(
      (marginResult?.itemResults ?? [])
        .filter((row) => row.salesOrderItemId)
        .map((row) => [row.salesOrderItemId!, row.marginValue])
    );
    return {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        officialMarginValue:
          item.id != null && itemOfficialById.has(item.id)
            ? itemOfficialById.get(item.id)!
            : null,
      })),
    };
  });
  const nameMap = new Map<string, string>();
  for (const order of orders) {
    if (order.customerId) {
      nameMap.set(
        order.customerId,
        order.Customer?.companyName?.trim() || "—"
      );
    }
  }

  const commercialCore = buildOfficialReportsCommercialPayload({
    orders: rulesOrders,
    listFilters,
    referenceDate: now,
    customerNames: nameMap,
  });

  const abcRevenue = buildOfficialCustomerRevenueByCustomer(rulesOrders, { abcEligibleOnly: true });
  const abcRows = buildCustomerAbcRanking(
    abcRevenue.map((row) => ({ customerId: row.customerId, revenue: row.revenue })),
    nameMap
  );

  const staleOrders = orders
    .filter((o) => isLegacyOpenWorkflowStatus(o.status))
    .map((o) => {
      const daysSinceUpd = Math.floor(
        (now.getTime() - new Date(o.updatedAt).getTime()) / 86400000
      );
      return {
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        customerName: o.Customer?.companyName || "—",
        responsible: (o.responsible || "").trim() || "—",
        totalNetValue: num(o.totalNetValue),
        daysSinceUpdate: daysSinceUpd,
        stale: daysSinceUpd >= STALE_DAYS,
      };
    })
    .filter((x) => x.stale)
    .slice(0, 100);

  const mixByProduct = buildOfficialReportsProductMixFromOrders(rulesOrders, listFilters);

  const managerialPortfolio = aggregateSalesOrderMarginSummaries(
    [...marginByOrder.values()].map((row) => row.marginSummary)
  ) ?? null;
  const commercialPayloads = [...marginByOrder.values()]
    .map((row) => row.marginSummary?.commercialMargin)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const commercialPortfolio =
    commercialPayloads.length > 0
      ? aggregateCommercialMarginPayloads(commercialPayloads)
      : null;
  const marginPortfolio = managerialPortfolio
    ? {
        ...managerialPortfolio,
        marginValue:
          commercialPortfolio?.commercialMarginTotalValue ??
          managerialPortfolio.marginValue,
        marginPercent:
          commercialPortfolio?.commercialMarginTotalPercent ??
          managerialPortfolio.marginPercent,
        marginRevenueCovered:
          commercialPortfolio?.commercialSoldTotalValue ??
          managerialPortfolio.marginRevenueCovered,
        marginCoveragePercent:
          commercialPortfolio?.commercialMarginCoveragePercent ??
          managerialPortfolio.marginCoveragePercent,
        costCoverageStatus: commercialPortfolio
          ? commercialPortfolio.isComplete
            ? ("FULL" as const)
            : commercialPortfolio.itemsCalculated > 0
              ? ("PARTIAL" as const)
              : ("NONE" as const)
          : managerialPortfolio.costCoverageStatus,
        commercialMargin: commercialPortfolio,
      }
    : null;

  const allOrdersForRepurchase = await db.salesOrder.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { customerId: true, issueDate: true },
    orderBy: { issueDate: "asc" },
  });
  const datesByCustomer = new Map<string, Date[]>();
  for (const row of allOrdersForRepurchase) {
    const arr = datesByCustomer.get(row.customerId) || [];
    arr.push(row.issueDate);
    datesByCustomer.set(row.customerId, arr);
  }

  const customers = await db.customer.findMany({ select: { id: true, companyName: true } });
  customers.forEach((c) => nameMap.set(c.id, c.companyName));

  const repurchaseRows: ReportsDataPayload["customers"]["repurchaseLate"] = [];
  for (const [cid, dates] of datesByCustomer) {
    if (dates.length < 2) continue;
    const med = medianIntervals(dates);
    const last = dates[dates.length - 1]!;
    const daysSince = Math.floor((now.getTime() - last.getTime()) / 86400000);
    const late = med != null && med > 0 ? daysSince > med * 1.15 : null;
    repurchaseRows.push({
      customerId: cid,
      companyName: nameMap.get(cid) || "—",
      medianDays: med,
      lastApprovedAt: last.toISOString(),
      daysSinceLast: daysSince,
      lateVsMedian: late,
    });
  }
  repurchaseRows.sort((a, b) => (b.daysSinceLast || 0) - (a.daysSinceLast || 0));
  const repurchaseLate = repurchaseRows.filter((r) => r.lateVsMedian === true).slice(0, 40);

  const customerAgg = buildOfficialCustomerRevenueByCustomer(rulesOrders);
  const inactiveCustomers = customerAgg
    .filter((v) => v.orderCount > 0)
    .map((row) => ({
      customerId: row.customerId,
      companyName: nameMap.get(row.customerId) || "—",
      orderCount: row.orderCount,
      lastOrderAt: row.lastIssueDate.toISOString(),
    }))
    .sort((a, b) => new Date(a.lastOrderAt).getTime() - new Date(b.lastOrderAt).getTime())
    .slice(0, 30);

  const uniqueProductIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
  const costSampleIds = uniqueProductIds.slice(0, MAX_COST_PRODUCTS);
  const mixMap = new Map(mixByProduct.map((row) => [row.productId, row]));

  const negPriceByProduct = new Map<string, { sum: number; w: number }>();
  for (const order of orders) {
    for (const it of order.items) {
      const q = num(it.quantity);
      const price = num(it.negotiatedPrice);
      const agg = negPriceByProduct.get(it.productId) || { sum: 0, w: 0 };
      agg.sum += price * q;
      agg.w += q;
      negPriceByProduct.set(it.productId, agg);
    }
  }

  const productCostRows: ReportsDataPayload["costing"]["productsAnalyzed"] = [];
  for (const pid of costSampleIds) {
    const mix = mixMap.get(pid);
    const analysis = await deps.getProductCostAnalysis(pid);
    let totalIndustrial: number | null = null;
    let suggested = 0;
    let err: string | undefined;
    if (isCostAnalysisFailure(analysis)) {
      err = analysis.error;
    } else {
      totalIndustrial = extractOfficialProductFinalUnitCost(analysis);
      if (totalIndustrial != null) {
        const pricing = await db.productPricing.findFirst({
          where: { productId: pid },
          include: { TaxRule: { include: { TaxComponent: true } } },
        });
        if (pricing) {
          const taxRate =
            pricing.TaxRule?.TaxComponent?.reduce((acc, c) => acc + Number(c.percentage), 0) /
              100 || 0;
          const commRate = Number(pricing.commission) / 100;
          const marginRate = Number(pricing.desiredMargin) / 100;
          const otherRate = Number(pricing.otherVariables) / 100;
          const freight = Number(pricing.freightOut);
          const divisor = 1 - taxRate - commRate - otherRate - marginRate;
          suggested =
            divisor > 0 && totalIndustrial != null
              ? (totalIndustrial + freight) / divisor
              : 0;
        }
      } else {
        err = "INVALID_COST_VALUE";
      }
    }
    const nw = negPriceByProduct.get(pid);
    const avgNeg = nw && nw.w > 0 ? nw.sum / nw.w : null;
    productCostRows.push({
      productId: pid,
      sku: mix?.sku || "—",
      name: mix?.name || "—",
      totalIndustrialCost: totalIndustrial,
      suggestedPricePremissa: err ? null : suggested,
      avgNegotiatedInPeriod: avgNeg,
      linesInPeriod: mix?.lines ?? 0,
      error: err,
    });
  }
  productCostRows.sort((a, b) => {
    const ga =
      a.suggestedPricePremissa != null && a.avgNegotiatedInPeriod != null
        ? a.avgNegotiatedInPeriod - a.suggestedPricePremissa
        : 0;
    const gb =
      b.suggestedPricePremissa != null && b.avgNegotiatedInPeriod != null
        ? b.avgNegotiatedInPeriod - b.suggestedPricePremissa
        : 0;
    return gb - ga;
  });

  let previousPeriod: ReportsDataPayload["executive"]["previousPeriod"] = null;
  if (query.dateFrom && query.dateTo) {
    const df = new Date(query.dateFrom);
    const dt = endOfDay(query.dateTo);
    const ms = dt.getTime() - df.getTime();
    const prevEnd = new Date(df.getTime() - 86400000);
    prevEnd.setHours(23, 59, 59, 999);
    const prevStart = new Date(prevEnd.getTime() - ms);
    prevStart.setHours(0, 0, 0, 0);
    const prevWhere = buildReportsPrismaWhere({
      ...query,
      dateFrom: prevStart.toISOString().slice(0, 10),
      dateTo: prevEnd.toISOString().slice(0, 10),
    });
    const prevOrders = (await db.salesOrder.findMany({
      where: prevWhere,
      include: {
        Customer: { select: { id: true, companyName: true, tradeName: true } },
        items: {
          include: {
            Product: { select: { id: true, sku: true, name: true, type: true } },
          },
        },
      },
    })) as ReportsOrderRow[];
    previousPeriod = buildOfficialReportsPreviousPeriodPayload({
      orders: prevOrders.map(mapReportsOrderToRulesInput),
      listFilters: {
        ...listFilters,
        startDate: prevStart,
        endDate: prevEnd,
      },
    });
  }

  return {
    generatedAt: now.toISOString(),
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    filters: query,
    disclaimers: [
      `Pedidos de venda via motor oficial (${OFFICIAL_SO_RULES_SOURCE}), filtrados por issueDate.`,
      "Pedidos de venda representam vendas registradas no IndusCost/Nomus; não necessariamente faturamento fiscal/NF.",
      "Curva ABC usa pedidos do período/filtro (exceto cancelados/erro). Recompra usa histórico global de pedidos não cancelados.",
      uniqueProductIds.length > MAX_COST_PRODUCTS
        ? `Custo industrial: amostra de ${MAX_COST_PRODUCTS} produtos entre os do período (${uniqueProductIds.length} distintos).`
        : "",
    ].filter(Boolean),
    commercial: {
      ...commercialCore,
      staleOrders,
    },
    customers: {
      abc: abcRows,
      repurchaseLate,
      inactiveInPeriod: inactiveCustomers,
    },
    products: { mixByProduct },
    costing: {
      productsAnalyzed: productCostRows,
      costProductLimit: MAX_COST_PRODUCTS,
      totalDistinctProductsInFilter: uniqueProductIds.length,
    },
    executive: { previousPeriod },
    marginPortfolio,
  };
}
