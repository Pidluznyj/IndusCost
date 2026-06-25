import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import { buildSalesOrderIntelligencePayload } from "./salesOrderIntelligence.js";
import { loadSalesOrderLinkedNfeContextMap } from "./salesOrderLinkedNfe.js";
import { buildSalesOrderNfeLinkDiagnostic } from "./salesOrderNfeLink.js";
import {
  buildFulfillmentAudit,
  countRawNfesInPayload,
  type SalesOrderFulfillmentAudit,
} from "./salesOrderManagementFulfillment.js";
import {
  buildSalesOrderManagementWhere,
  buildManagementRowsFromOrders,
  parseSalesOrderManagementFilters,
  type SalesOrderManagementResponse,
} from "./salesOrderManagement.js";
import {
  attachMarginsToSalesOrders,
  calculateSalesOrderMarginsForOrders,
} from "./salesOrderMarginService.server.js";
import {
  buildSalesOrderManagementMarginEconomics,
  countMarginItemStatuses,
  matchesSalesOrderMarginStatusFilter,
} from "./salesOrderManagementMargin.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  requireUserAdminOrBootstrap?: RequestHandler;
};

const SALES_ORDER_VIEW_PERMISSIONS = ["sales_orders.view"];
const SALES_ORDER_DETAIL_PERMISSIONS = ["sales_orders.detail.view", "sales_orders.view"];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export async function loadSalesOrderIntelligence(orderId: string) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
      items: {
        select: {
          id: true,
          productId: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
          unit: true,
        },
      },
    },
  });
  if (!order) return null;
  const linkedNfeContextMap = await loadSalesOrderLinkedNfeContextMap([
    {
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    },
  ]);
  return buildSalesOrderIntelligencePayload({
    order: {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      externalSalesOrderId: order.externalSalesOrderId,
      externalSalesOrderCode: order.externalSalesOrderCode,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      totalNetValue: order.totalNetValue,
      responsible: order.responsible,
      companyIssuer: order.companyIssuer,
      nomusRawResponse: order.nomusRawResponse,
      customer: order.Customer,
      items: order.items,
    },
    linkedNfeContext: linkedNfeContextMap.get(order.id) ?? null,
  });
}

export async function loadSalesOrderManagementPage(
  query: Record<string, unknown>
): Promise<SalesOrderManagementResponse> {
  const filters = parseSalesOrderManagementFilters(query);
  const page = parsePositiveInt(query.page, 1);
  const pageSize = Math.min(parsePositiveInt(query.pageSize, 20), 100);
  const where = buildSalesOrderManagementWhere(filters);

  const orders = await prisma.salesOrder.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    include: {
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
      items: {
        select: {
          id: true,
          salesOrderId: true,
          productId: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
          negotiatedPrice: true,
          totalNetValue: true,
          unitCost: true,
        },
      },
    },
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

  const { rows, cards, summary, cardAmounts, dashboardCards, fulfillmentKpis, fulfillmentCharts } =
    buildManagementRowsFromOrders(
    orders,
    filters,
    undefined,
    linkedNfeContextMap
  );

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    orders.map((order) => ({
      id: order.id,
      nomusRawResponse: order.nomusRawResponse,
      items: order.items,
    }))
  );

  const itemResultsByOrderId = new Map<string, import("./salesOrderMarginTypes.js").SalesOrderMarginItemResult[]>();
  for (const row of rows) {
    const marginResult = marginByOrder.get(row.id);
    row.marginSummary = marginResult?.marginSummary;
    if (marginResult) {
      row.marginDetail = countMarginItemStatuses(marginResult.itemResults);
      itemResultsByOrderId.set(row.id, marginResult.itemResults);
    }
  }

  const marginFilteredRows = filters.marginStatus
    ? rows.filter((row) =>
        matchesSalesOrderMarginStatusFilter(row.marginSummary, filters.marginStatus!)
      )
    : rows;

  const marginEconomics = buildSalesOrderManagementMarginEconomics(
    marginFilteredRows,
    itemResultsByOrderId
  );

  const total = marginFilteredRows.length;
  const start = (page - 1) * pageSize;
  const pageRows = marginFilteredRows.slice(start, start + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    cards,
    cardAmounts,
    dashboardCards,
    summary,
    fulfillmentKpis,
    fulfillmentCharts,
    marginEconomics,
    rows: pageRows,
  };
}

export async function loadSalesOrderFulfillmentAudit(
  query: Record<string, unknown>
): Promise<SalesOrderFulfillmentAudit> {
  const filters = parseSalesOrderManagementFilters(query);
  const where = buildSalesOrderManagementWhere(filters);

  const orders = await prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      status: true,
      issueDate: true,
      expectedDeliveryDate: true,
      totalNetValue: true,
      responsible: true,
      nomusRawResponse: true,
      companyIssuer: true,
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
    },
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

  const { rows } = buildManagementRowsFromOrders(
    orders,
    filters,
    undefined,
    linkedNfeContextMap
  );

  const orderIds = orders.map((o) => o.id);
  const links =
    orderIds.length > 0
      ? await prisma.salesOrderNfeLink.findMany({
          where: { salesOrderId: { in: orderIds } },
          select: { salesOrderId: true, nomusNfeId: true },
        })
      : [];

  const linkCountsByOrderId = new Map<string, number>();
  const unmatchedLinkCountsByOrderId = new Map<string, number>();
  for (const link of links) {
    linkCountsByOrderId.set(link.salesOrderId, (linkCountsByOrderId.get(link.salesOrderId) ?? 0) + 1);
    if (!link.nomusNfeId) {
      unmatchedLinkCountsByOrderId.set(
        link.salesOrderId,
        (unmatchedLinkCountsByOrderId.get(link.salesOrderId) ?? 0) + 1
      );
    }
  }

  const rawNfeCountsByOrderId = new Map<string, number>();
  for (const order of orders) {
    rawNfeCountsByOrderId.set(order.id, countRawNfesInPayload(order.nomusRawResponse));
  }

  return buildFulfillmentAudit({
    rows,
    linkCountsByOrderId,
    rawNfeCountsByOrderId,
    unmatchedLinkCountsByOrderId,
  });
}

export function registerSalesOrderIntelligenceRoutes(app: express.Express, auth: AuthGuards) {
  app.get(
    "/api/sales-orders/management",
    auth.requireAppAuth,
    auth.requireAnyPermission(SALES_ORDER_VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        const payload = await loadSalesOrderManagementPage(
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/management", error);
        res.status(500).json({ error: "Erro ao carregar gestão de pedidos." });
      }
    }
  );

  app.get(
    "/api/sales-orders/:id/intelligence",
    auth.requireAppAuth,
    auth.requireAnyPermission(SALES_ORDER_DETAIL_PERMISSIONS),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          res.status(400).json({ error: "ID de pedido inválido." });
          return;
        }
        const payload = await loadSalesOrderIntelligence(id);
        if (!payload) {
          res.status(404).json({ error: "Pedido não encontrado." });
          return;
        }
        res.json(payload);
      } catch (error) {
        console.error("GET /api/sales-orders/:id/intelligence", error);
        res.status(500).json({ error: "Erro ao carregar inteligência do pedido." });
      }
    }
  );

  if (auth.requireUserAdminOrBootstrap) {
    app.get(
      "/api/admin/sales-orders/nfe-links/diagnostic",
      auth.requireUserAdminOrBootstrap,
      async (_req, res) => {
        try {
          const payload = await buildSalesOrderNfeLinkDiagnostic();
          res.json(payload);
        } catch (error) {
          console.error("GET /api/admin/sales-orders/nfe-links/diagnostic", error);
          res.status(500).json({ error: "Erro ao gerar diagnóstico de vínculos NF-e." });
        }
      }
    );

    app.get(
      "/api/admin/sales-orders/fulfillment/audit",
      auth.requireUserAdminOrBootstrap,
      async (req, res) => {
        try {
          const payload = await loadSalesOrderFulfillmentAudit(req.query as Record<string, unknown>);
          res.json(payload);
        } catch (error) {
          console.error("GET /api/admin/sales-orders/fulfillment/audit", error);
          res.status(500).json({ error: "Erro ao gerar auditoria de fulfillment." });
        }
      }
    );
  }
}

export { SALES_ORDER_VIEW_PERMISSIONS, SALES_ORDER_DETAIL_PERMISSIONS };
