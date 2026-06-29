/**
 * Adapter fino — transforma o motor oficial de Pedidos de Venda para DTOs existentes.
 * Sem regra de negócio: apenas mapeamento, renomeação e compatibilidade de payload.
 */
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import {
  computeTicketAverage,
  isCancelledSalesOrderStatus,
} from "./salesOrderDashboardRules.js";
import type { FinanceSalesOrdersDashboardFilters } from "./financeSalesOrdersDashboardTypes.js";
import type { FinanceSalesOrdersTopCustomerRow } from "./financeSalesOrdersDashboardTypes.js";
import type { SalesOrderListFilters } from "./salesOrdersListSummary.js";
import type { SalesOrderManagementFilters } from "./salesOrderManagement.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import {
  buildSalesOrderRulesResult,
  filterSalesOrderListRows,
  normalizeSalesOrderListFilters,
  SALES_ORDER_RULES_ENGINE_VERSION,
  type SalesOrderRulesBuildInput,
  type SalesOrderRulesOrderInput,
  type SalesOrderRulesResult,
} from "./salesOrderRulesEngine.js";
import type { SalesOrderListSummary } from "./salesOrdersListSummary.js";
import type { SalesOrderMetrics, SalesOrderMonthlyTimelinePoint } from "./salesOrderRulesEngine.types.js";

export const OFFICIAL_SO_RULES_SOURCE = "official-sales-order-rules-engine" as const;

export type OfficialSalesOrderRulesBuildInput = {
  orders: SalesOrderRulesOrderInput[];
  listFilters?: Partial<SalesOrderListFilters>;
  managementFilters?: Partial<SalesOrderManagementFilters>;
  referenceDate?: Date;
  year?: number;
  month?: number;
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>;
  scope?: SalesOrderRulesBuildInput["scope"];
};

function toRulesBuildInput(input: OfficialSalesOrderRulesBuildInput): SalesOrderRulesBuildInput {
  return {
    listFilters: input.listFilters,
    managementFilters: input.managementFilters,
    referenceDate: input.referenceDate,
    year: input.year,
    month: input.month,
    scope: input.scope,
    linkedNfeContextMap: input.linkedNfeContextMap,
  };
}

/** Executa o motor oficial de regras de Pedidos de Venda. */
export function buildOfficialSalesOrderRulesResult(
  input: OfficialSalesOrderRulesBuildInput
): SalesOrderRulesResult & {
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  rulesEngineVersion: string;
} {
  const result = buildSalesOrderRulesResult(input.orders, toRulesBuildInput(input));
  return {
    ...result,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: SALES_ORDER_RULES_ENGINE_VERSION,
  };
}

export type OfficialSalesOrderListPayload = {
  summary: SalesOrderListSummary;
  metrics: SalesOrderMetrics;
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  rulesEngineVersion: string;
};

/** Payload resumo da listagem Pedidos de Venda — cards/totais do motor oficial. */
export function buildOfficialSalesOrderListPayload(
  input: OfficialSalesOrderRulesBuildInput
): OfficialSalesOrderListPayload {
  const rules = buildOfficialSalesOrderRulesResult({
    ...input,
    scope: input.scope ?? "list",
  });
  return {
    summary: rules.listSummary,
    metrics: rules.metrics,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Núcleo gestão — cards, KPIs e linhas do motor oficial (sem paginação/margem). */
export function buildOfficialSalesOrderManagementCore(input: OfficialSalesOrderRulesBuildInput) {
  const rules = buildOfficialSalesOrderRulesResult({
    ...input,
    scope: input.scope ?? "management",
  });
  return {
    cards: rules.managementBundle.cards,
    cardAmounts: rules.managementBundle.cardAmounts,
    dashboardCards: rules.managementBundle.dashboardCards,
    summary: rules.managementSummary,
    fulfillmentKpis: rules.fulfillmentKpis,
    fulfillmentCharts: rules.managementBundle.fulfillmentCharts,
    rows: rules.managementBundle.rows,
    metrics: rules.metrics,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Métricas executivas (Relatório / aba Pedidos) — motor oficial. */
export function resolveOfficialSalesOrderExecutiveMetrics(
  orders: SalesOrderRulesOrderInput[],
  referenceDate: Date,
  year: number,
  month: number,
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>
) {
  const rules = buildOfficialSalesOrderRulesResult({
    orders,
    referenceDate,
    year,
    month,
    linkedNfeContextMap,
    scope: "executive",
  });
  return {
    metrics: rules.metrics,
    monthlyTimeline: rules.monthlyTimeline,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Mapeia registro Prisma mínimo para entrada do motor oficial. */
export function mapPrismaOrderToSalesOrderRulesInput(order: {
  id: string;
  orderCode: string;
  status: string;
  customerId?: string | null;
  issueDate: Date;
  expectedDeliveryDate?: Date | null;
  totalNetValue: unknown;
  totalGrossValue?: unknown;
  totalItems: number;
  responsible?: string | null;
  nomusRawResponse?: unknown;
  companyIssuer?: string | null;
  externalSalesOrderId?: number | null;
  Customer?: { companyName?: string | null; tradeName?: string | null; taxId?: string | null };
  items: Array<{
    id: string;
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity: unknown;
  }>;
  marginSummary?: import("./salesOrderMarginTypes.js").SalesOrderMarginSummaryPayload | null;
}): SalesOrderRulesOrderInput {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    customerId: order.customerId,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate ?? null,
    totalNetValue: order.totalNetValue,
    totalGrossValue: order.totalGrossValue,
    totalItems: order.totalItems,
    responsible: order.responsible ?? null,
    nomusRawResponse: order.nomusRawResponse ?? null,
    companyIssuer: order.companyIssuer ?? null,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    Customer: order.Customer,
    items: order.items.map((item) => ({
      id: item.id,
      externalProductId: item.externalProductId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
    })),
    marginSummary: order.marginSummary ?? null,
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function safeOrderNet(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Mapeia filtros do dashboard Financeiro → Pedidos para entrada do motor oficial. */
export function mapFinanceSalesOrdersFiltersToRulesInput(
  filters: FinanceSalesOrdersDashboardFilters
): Pick<OfficialSalesOrderRulesBuildInput, "listFilters" | "managementFilters"> {
  const hasInvoice =
    filters.invoiceStatus === "with_invoice"
      ? true
      : filters.invoiceStatus === "without_invoice"
        ? false
        : null;

  return {
    listFilters: {
      year: filters.year,
      month: filters.month ?? null,
      status: filters.status ?? undefined,
      customerId: filters.customerId ?? undefined,
      responsible: filters.sellerName ?? undefined,
    },
    managementFilters: {
      year: filters.year,
      month: filters.month ?? undefined,
      customerId: filters.customerId ?? undefined,
      responsible: filters.sellerName ?? undefined,
      companyIssuer: filters.company ?? undefined,
      status: filters.status ?? undefined,
      hasInvoice,
      logisticStatus: filters.logisticStatus ?? "",
    },
  };
}

export type OfficialFinancePortfolioSnapshot = {
  open: { count: number; net: number };
  invoiced: { count: number; net: number };
  overdue: { count: number; net: number };
};

/** Carteira NF/aberta/atrasada — agregação de linhas já classificadas pelo motor. */
export function mapOfficialFinancePortfolioFromManagementRows(
  rows: SalesOrderManagementRow[]
): OfficialFinancePortfolioSnapshot {
  const open = { count: 0, net: 0 };
  const invoiced = { count: 0, net: 0 };
  const overdue = { count: 0, net: 0 };

  for (const row of rows) {
    const val = row.totalNetValue ?? 0;
    if (row.hasInvoice) {
      invoiced.count += 1;
      invoiced.net += val;
    } else {
      open.count += 1;
      open.net += val;
    }
    if (row.logisticStatusCardId === "overduePending") {
      overdue.count += 1;
      overdue.net += val;
    }
  }

  return {
    open: { count: open.count, net: roundMoney(open.net) },
    invoiced: { count: invoiced.count, net: roundMoney(invoiced.net) },
    overdue: { count: overdue.count, net: roundMoney(overdue.net) },
  };
}

/** Ranking top clientes — agrupa pedidos já filtrados pelo motor (sem recalcular regra). */
export function buildOfficialTopCustomersFromRulesOrders(
  orders: SalesOrderRulesOrderInput[],
  listFilters: Partial<SalesOrderListFilters>,
  limit = 10
): FinanceSalesOrdersTopCustomerRow[] {
  const filtered = filterSalesOrderListRows(orders, normalizeSalesOrderListFilters(listFilters));
  const byCustomer = new Map<
    string,
    { customerName: string; orderCount: number; amount: number }
  >();

  for (const order of filtered) {
    if (isCancelledSalesOrderStatus(order.status) || order.status === "ERROR") continue;
    const customerId = order.customerId?.trim() || order.id;
    const customerName =
      order.Customer?.tradeName?.trim() ||
      order.Customer?.companyName?.trim() ||
      "—";
    const current = byCustomer.get(customerId) ?? {
      customerName,
      orderCount: 0,
      amount: 0,
    };
    current.orderCount += 1;
    current.amount += safeOrderNet(order.totalNetValue);
    byCustomer.set(customerId, current);
  }

  const ranked = [...byCustomer.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, limit);
  const totalAll = ranked.reduce((sum, [, row]) => sum + row.amount, 0);

  return ranked.map(([customerId, row]) => {
    const amount = roundMoney(row.amount);
    return {
      customerId,
      customerName: row.customerName,
      amount,
      orderCount: row.orderCount,
      averageTicketAmount: computeTicketAverage(amount, row.orderCount),
      sharePercent: totalAll > 0 ? roundMoney((amount / totalAll) * 100) : null,
    };
  });
}

export type OfficialFinancePeriodAgg = {
  count: number;
  net: number;
  items: number;
};

/** Totais do período filtrado — paridade com listSummary do motor. */
export function mapOfficialFinancePeriodAgg(
  rules: Pick<SalesOrderRulesResult, "listSummary" | "metrics">
): OfficialFinancePeriodAgg {
  return {
    count: rules.listSummary.totalOrders,
    net: rules.metrics.soldAmount,
    items: rules.listSummary.totalItems,
  };
}

/** Séries mensais corrente e ano anterior a partir do motor oficial. */
export function buildOfficialMonthlyAmountMaps(
  currentTimeline: SalesOrderMonthlyTimelinePoint[],
  previousTimeline: SalesOrderMonthlyTimelinePoint[]
): { current: Map<number, number>; previous: Map<number, number> } {
  return {
    current: new Map(currentTimeline.map((p) => [p.month, p.soldAmount])),
    previous: new Map(previousTimeline.map((p) => [p.month, p.soldAmount])),
  };
}

export type OfficialSalesOrderResultSalesBundle = {
  metrics: SalesOrderMetrics;
  monthlyTimeline: SalesOrderMonthlyTimelinePoint[];
  previousYearTimeline: SalesOrderMonthlyTimelinePoint[];
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  rulesEngineVersion: string;
};

/** Valor vendido / pedidos / timeline para aba Resultado — motor oficial de pedidos. */
export function buildOfficialSalesOrderResultSalesBundle(input: {
  orders: SalesOrderRulesOrderInput[];
  year: number;
  month?: number;
  referenceDate: Date;
  customerId?: string;
  sellerId?: string;
  companyId?: string;
  productId?: string;
}): OfficialSalesOrderResultSalesBundle {
  let scopedOrders = input.orders;
  if (input.productId?.trim()) {
    const productId = input.productId.trim();
    scopedOrders = input.orders.filter((order) =>
      order.items.some(
        (item) =>
          item.id === productId ||
          (item.externalProductId != null && String(item.externalProductId) === productId) ||
          item.skuSnapshot === productId
      )
    );
  }

  const listFilters: Partial<SalesOrderListFilters> = {
    year: input.year,
    month: input.month ?? null,
    customerId: input.customerId,
    responsible: input.sellerId,
  };
  const managementFilters: Partial<SalesOrderManagementFilters> = {
    year: input.year,
    month: input.month,
    customerId: input.customerId,
    responsible: input.sellerId,
    companyIssuer: input.companyId,
  };

  const month = input.month ?? input.referenceDate.getMonth() + 1;
  const rules = buildOfficialSalesOrderRulesResult({
    orders: scopedOrders,
    listFilters,
    managementFilters,
    referenceDate: input.referenceDate,
    year: input.year,
    month,
    scope: "executive",
  });

  const prevYearRef = new Date(
    input.year - 1,
    input.referenceDate.getMonth(),
    input.referenceDate.getDate(),
    23,
    59,
    59,
    999
  );
  const prevRules = buildOfficialSalesOrderRulesResult({
    orders: scopedOrders,
    listFilters: { ...listFilters, year: input.year - 1 },
    managementFilters: { ...managementFilters, year: input.year - 1 },
    referenceDate: prevYearRef,
    year: input.year - 1,
    month,
    scope: "executive",
  });

  return {
    metrics: rules.metrics,
    monthlyTimeline: rules.monthlyTimeline,
    previousYearTimeline: prevRules.monthlyTimeline,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Receita e contagem de pedidos válidos para Cliente 360 / CRM — motor oficial. */
export function resolveOfficialCustomerIntelligenceOrderMetrics(input: {
  orders: SalesOrderRulesOrderInput[];
  referenceDate: Date;
  year?: number;
  month?: number;
  listFilters?: Partial<SalesOrderListFilters>;
  managementFilters?: Partial<SalesOrderManagementFilters>;
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>;
}): {
  revenue: number;
  validOrdersCount: number;
  billedOrdersCount: number;
  openPortfolioAmount: number;
  openPortfolioCount: number;
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
} {
  const scoped = resolveOfficialScopedOrderMetrics(input);
  return {
    revenue: scoped.soldAmount,
    validOrdersCount: scoped.filteredOrders,
    billedOrdersCount: scoped.withNfeCount,
    openPortfolioAmount: scoped.openPortfolioAmount,
    openPortfolioCount: scoped.openPortfolioCount,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
  };
}

export type OfficialScopedOrderMetrics = {
  soldAmount: number;
  filteredOrders: number;
  uniqueOrders: number;
  totalItems: number;
  averageTicket: number;
  invoicedAmount: number;
  soldInvoicedGap: number;
  withNfeCount: number;
  withoutNfeCount: number;
  openPortfolioAmount: number;
  openPortfolioCount: number;
  invoicedPortfolioAmount: number;
  invoicedPortfolioCount: number;
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  rulesEngineVersion: string;
};

/** Métricas completas de pedidos para escopos CRM/seller/relatórios — motor oficial. */
export function resolveOfficialScopedOrderMetrics(
  input: OfficialSalesOrderRulesBuildInput
): OfficialScopedOrderMetrics {
  const rules = buildOfficialSalesOrderRulesResult({
    ...input,
    scope: input.scope ?? "unified",
  });
  const portfolio = mapOfficialFinancePortfolioFromManagementRows(rules.managementBundle.rows);
  return {
    soldAmount: rules.metrics.soldAmount,
    filteredOrders: rules.metrics.filteredOrders,
    uniqueOrders: rules.metrics.uniqueOrders,
    totalItems: rules.metrics.totalItems,
    averageTicket: rules.metrics.averageTicket,
    invoicedAmount: rules.metrics.invoicedAmount,
    soldInvoicedGap: rules.metrics.soldInvoicedGap,
    withNfeCount: rules.metrics.withNfeCount,
    withoutNfeCount: rules.metrics.withoutNfeCount,
    openPortfolioAmount: portfolio.open.net,
    openPortfolioCount: portfolio.open.count,
    invoicedPortfolioAmount: portfolio.invoiced.net,
    invoicedPortfolioCount: portfolio.invoiced.count,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

export type OfficialSellerBreakdownRow = {
  sellerKey: string;
  sellerLabel: string;
  ordersCount: number;
  ordersValue: number;
  invoicedOrdersCount: number;
  invoicedOrdersValue: number;
  openOrdersCount: number;
  openOrdersValue: number;
};

function sellerRowKey(row: SalesOrderManagementRow): string {
  const name = row.sellerName?.trim() || row.responsible?.trim() || "";
  return name ? name.toLowerCase() : "—";
}

/** Breakdown por vendedor — agrega linhas de gestão já classificadas pelo motor. */
export function buildOfficialSellerBreakdownFromManagementRows(
  rows: SalesOrderManagementRow[]
): OfficialSellerBreakdownRow[] {
  const bySeller = new Map<string, OfficialSellerBreakdownRow>();

  for (const row of rows) {
    const sellerKey = sellerRowKey(row);
    const sellerLabel = row.sellerName?.trim() || row.responsible?.trim() || "—";
    const current = bySeller.get(sellerKey) ?? {
      sellerKey,
      sellerLabel,
      ordersCount: 0,
      ordersValue: 0,
      invoicedOrdersCount: 0,
      invoicedOrdersValue: 0,
      openOrdersCount: 0,
      openOrdersValue: 0,
    };
    const val = row.totalNetValue ?? 0;
    current.ordersCount += 1;
    current.ordersValue += val;
    if (row.hasInvoice) {
      current.invoicedOrdersCount += 1;
      current.invoicedOrdersValue += val;
    } else {
      current.openOrdersCount += 1;
      current.openOrdersValue += val;
    }
    bySeller.set(sellerKey, current);
  }

  return [...bySeller.values()]
    .map((row) => ({
      ...row,
      ordersValue: roundMoney(row.ordersValue),
      invoicedOrdersValue: roundMoney(row.invoicedOrdersValue),
      openOrdersValue: roundMoney(row.openOrdersValue),
    }))
    .sort((a, b) => b.ordersCount - a.ordersCount);
}

/** Mapeia pedido CRM comercial mínimo para entrada do motor. */
export function mapCrmCommercialOrderToRulesInput(order: {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date;
  totalNetValue: unknown;
  responsible?: string | null;
  expectedDeliveryDate?: Date | null;
  nomusRawResponse?: unknown;
  totalItems?: number;
}): SalesOrderRulesOrderInput {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate ?? null,
    totalNetValue: order.totalNetValue,
    totalItems: order.totalItems ?? 0,
    responsible: order.responsible ?? null,
    nomusRawResponse: order.nomusRawResponse ?? null,
    items: [],
  };
}

export const SALES_ORDER_RULES_PRISMA_SELECT = {
  id: true,
  orderCode: true,
  status: true,
  customerId: true,
  issueDate: true,
  expectedDeliveryDate: true,
  totalNetValue: true,
  totalGrossValue: true,
  totalItems: true,
  responsible: true,
  nomusRawResponse: true,
  companyIssuer: true,
  externalSalesOrderId: true,
  Customer: { select: { companyName: true, tradeName: true, taxId: true } },
  items: {
    select: {
      id: true,
      externalProductId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
    },
  },
} as const;
