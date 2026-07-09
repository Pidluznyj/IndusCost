/**
 * Loader oficial — Gestão de Pedidos de Venda (cards, tabela, margem, auditoria).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { loadCommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.server.js";
import { loadSalesOrderLinkedNfeContextMap } from "./salesOrderLinkedNfe.js";
import {
  buildSalesOrderManagementWhere,
  parseSalesOrderManagementFilters,
  type SalesOrderManagementFilters,
  type SalesOrderManagementResponse,
} from "./salesOrderManagement.js";
import {
  countMarginItemStatuses,
  matchesSalesOrderMarginStatusFilter,
} from "./salesOrderManagementMargin.js";
import {
  buildOfficialManagementMetricsBundle,
  resolveManagementScopeLastNomusSyncAt,
} from "./salesOrderManagementMetrics.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import { calculateSalesOrderMarginsForOrders } from "./salesOrderMarginService.server.js";
import { resolveSalesOrderListSellerWhere } from "./salesOrderListQuery.server.js";
import {
  buildOfficialSalesOrderManagementCore,
  mapPrismaOrderToSalesOrderRulesInput,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "./salesOrderRulesAdapter.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

const MANAGEMENT_ORDER_SELECT = {
  ...SALES_ORDER_RULES_PRISMA_SELECT,
  updatedAt: true,
  sentToNomusAt: true,
} as const;

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export async function resolveSalesOrderManagementWhere(
  prisma: PrismaClient,
  filters: SalesOrderManagementFilters
): Promise<Prisma.SalesOrderWhereInput> {
  const sellerText = filters.responsible?.trim() ?? "";
  const sellerWhere = sellerText
    ? await resolveSalesOrderListSellerWhere(prisma, {
        sellerKeyRaw: "",
        sellerText,
      })
    : null;

  const base = buildSalesOrderManagementWhere(
    sellerWhere ? { ...filters, responsible: undefined } : filters,
    { sellerWhere }
  );
  return base;
}

export type SalesOrderManagementMetricsLoadResult = {
  filters: SalesOrderManagementFilters;
  rows: SalesOrderManagementRow[];
  itemResultsByOrderId: Map<string, SalesOrderMarginItemResult[]>;
  metricsBundle: ReturnType<typeof buildOfficialManagementMetricsBundle>;
  metricsSource: string;
  rulesEngineVersion: string;
};

/** Carrega pedidos filtrados, margem oficial e métricas consolidadas (mesmo dataset para cards e tabela). */
export async function loadSalesOrderManagementMetrics(
  prisma: PrismaClient,
  query: Record<string, unknown>
): Promise<SalesOrderManagementMetricsLoadResult> {
  const filters = parseSalesOrderManagementFilters(query);
  const where = await resolveSalesOrderManagementWhere(prisma, filters);

  const orders = await prisma.salesOrder.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    select: MANAGEMENT_ORDER_SELECT,
  });

  const linkedNfeContextMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    }))
  );

  const sellerIdentityCtx = await loadCommissionSellerIdentityContext(prisma);
  const rulesOrders = orders.map(mapPrismaOrderToSalesOrderRulesInput);
  const officialCore = buildOfficialSalesOrderManagementCore({
    orders: rulesOrders,
    managementFilters: filters,
    linkedNfeContextMap,
    sellerIdentityCtx,
  });

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    orders.map((order) => ({
      id: order.id,
      issueDate: order.issueDate,
      nomusRawResponse: order.nomusRawResponse,
    }))
  );

  const rows = officialCore.rows.map((row) => ({ ...row }));
  const itemResultsByOrderId = new Map<string, SalesOrderMarginItemResult[]>();

  for (const row of rows) {
    const marginResult = marginByOrder.get(row.id);
    row.marginSummary = marginResult?.marginSummary;
    if (marginResult) {
      row.marginDetail = countMarginItemStatuses(marginResult.itemResults);
      row.marginItems = Array.from(marginResult.itemMargins.values());
      itemResultsByOrderId.set(row.id, marginResult.itemResults);
    }
  }

  const activeRows = filters.marginStatus
    ? rows.filter((row) =>
        matchesSalesOrderMarginStatusFilter(row.marginSummary, filters.marginStatus!)
      )
    : rows;

  const lastNomusSyncAt = resolveManagementScopeLastNomusSyncAt(orders);
  const metricsBundle = buildOfficialManagementMetricsBundle(
    activeRows,
    itemResultsByOrderId,
    { lastNomusSyncAt }
  );

  return {
    filters,
    rows: activeRows,
    itemResultsByOrderId,
    metricsBundle,
    metricsSource: officialCore.metricsSource,
    rulesEngineVersion: officialCore.rulesEngineVersion,
  };
}

export async function loadSalesOrderManagementPage(
  prisma: PrismaClient,
  query: Record<string, unknown>
): Promise<SalesOrderManagementResponse> {
  const page = parsePositiveInt(query.page, 1);
  const pageSize = Math.min(parsePositiveInt(query.pageSize, 20), 100);

  const loaded = await loadSalesOrderManagementMetrics(prisma, query);
  const { metricsBundle, rows: activeRows } = loaded;
  const total = activeRows.length;
  const start = (page - 1) * pageSize;
  const pageRows = activeRows.slice(start, start + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    cards: metricsBundle.cards,
    cardAmounts: metricsBundle.cardAmounts,
    dashboardCards: metricsBundle.dashboardCards,
    summary: metricsBundle.summary,
    fulfillmentKpis: metricsBundle.fulfillmentKpis,
    fulfillmentCharts: metricsBundle.fulfillmentCharts,
    marginEconomics: metricsBundle.marginEconomics,
    officialMetrics: metricsBundle.officialMetrics,
    sourceAudit: metricsBundle.sourceAudit,
    metricsSource: loaded.metricsSource,
    rulesEngineVersion: loaded.rulesEngineVersion,
    rows: pageRows,
  };
}
