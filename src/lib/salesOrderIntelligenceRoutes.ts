import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import { buildSalesOrderIntelligencePayload } from "./salesOrderIntelligence.js";
import {
  buildSalesOrderManagementWhere,
  buildManagementRowsFromOrders,
  parseSalesOrderManagementFilters,
  type SalesOrderManagementResponse,
} from "./salesOrderManagement.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
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
  return buildSalesOrderIntelligencePayload({
    order: {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      totalNetValue: order.totalNetValue,
      responsible: order.responsible,
      companyIssuer: order.companyIssuer,
      nomusRawResponse: order.nomusRawResponse,
      customer: order.Customer,
      items: order.items,
    },
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
      Customer: { select: { companyName: true, tradeName: true } },
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

  const { rows, cards } = buildManagementRowsFromOrders(orders, filters);
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    cards,
    rows: pageRows,
  };
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
}

export { SALES_ORDER_VIEW_PERMISSIONS, SALES_ORDER_DETAIL_PERMISSIONS };
