import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { hasPermission } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildNomusPurchaseOrderKpis,
  buildNomusPurchaseOrderWhere,
  parseNomusPurchaseOrderListFilters,
  serializeNomusPurchaseOrderListRow,
} from "@/src/lib/nomus/nomusPurchaseOrderQuery.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

const VIEW_PERMISSIONS = [
  "purchases.nomusPurchaseOrders.view",
  "purchases.view",
  "settings.nomus.view",
];

const RAW_PERMISSIONS = ["settings.nomus.view", "settings.view"];

function canSeeRawPayload(user: AppAuthContext | null): boolean {
  if (!user) return false;
  return RAW_PERMISSIONS.some((key) => hasPermission(user, key));
}

const LIST_SELECT = {
  id: true,
  externalId: true,
  orderNumber: true,
  supplierExternalId: true,
  supplierName: true,
  supplierTaxId: true,
  statusRaw: true,
  canceled: true,
  stage: true,
  issuedAt: true,
  expectedAt: true,
  totalAmount: true,
  itemCount: true,
  orderedQuantity: true,
  receivedQuantity: true,
  remainingQuantity: true,
  syncedAt: true,
  lastSeenAt: true,
} as const;

export function registerNomusPurchaseOrderRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const viewGuard = [requireAppAuth, requireAnyPermission(VIEW_PERMISSIONS)] as const;

  app.get("/api/nomus/purchase-orders/health", ...viewGuard, async (_req, res) => {
    try {
      const [total, last, maxExternal] = await Promise.all([
        prisma.nomusPurchaseOrder.count(),
        prisma.nomusPurchaseOrder.findFirst({
          orderBy: { syncedAt: "desc" },
          select: { syncedAt: true, lastSeenAt: true, externalId: true },
        }),
        prisma.nomusPurchaseOrder.aggregate({ _max: { externalId: true } }),
      ]);
      const lastSync = last?.syncedAt ?? null;
      return res.json({
        total,
        lastSyncedAt: lastSync?.toISOString() ?? null,
        lastSeenAt: last?.lastSeenAt?.toISOString() ?? null,
        maxExternalId: maxExternal._max.externalId,
        lagMs: lastSync ? Date.now() - lastSync.getTime() : null,
        ok: lastSync != null,
      });
    } catch (error) {
      console.error("GET /api/nomus/purchase-orders/health", error);
      return res.status(500).json({ error: "Erro ao consultar saúde dos pedidos Nomus." });
    }
  });

  app.get("/api/nomus/purchase-orders", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const filters = parseNomusPurchaseOrderListFilters(req.query as Record<string, unknown>);
      const now = new Date();
      const where = buildNomusPurchaseOrderWhere(filters, now);
      const skip = ((filters.page ?? 1) - 1) * (filters.pageSize ?? 25);

      const [total, rows, kpiRows, health] = await Promise.all([
        prisma.nomusPurchaseOrder.count({ where }),
        prisma.nomusPurchaseOrder.findMany({
          where,
          select: LIST_SELECT,
          orderBy: [{ issuedAt: "desc" }, { externalId: "desc" }],
          skip,
          take: filters.pageSize ?? 25,
        }),
        prisma.nomusPurchaseOrder.findMany({
          where,
          select: { stage: true, expectedAt: true, totalAmount: true },
        }),
        prisma.nomusPurchaseOrder.findFirst({
          orderBy: { syncedAt: "desc" },
          select: { syncedAt: true },
        }),
      ]);

      return res.json({
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
        total,
        kpis: buildNomusPurchaseOrderKpis(kpiRows, now),
        lastSyncedAt: health?.syncedAt?.toISOString() ?? null,
        items: rows.map((row) => serializeNomusPurchaseOrderListRow(row, now)),
      });
    } catch (error) {
      console.error("GET /api/nomus/purchase-orders", error);
      return res.status(500).json({ error: "Erro ao listar pedidos de compra Nomus." });
    }
  });

  app.get("/api/nomus/purchase-orders/:id", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ error: "Identificador inválido." });

      const byUuid = id.includes("-");
      const row = await prisma.nomusPurchaseOrder.findFirst({
        where: byUuid ? { id } : { OR: [{ id }, { externalId: Number.parseInt(id, 10) || -1 }] },
        include: { items: { orderBy: { lineIndex: "asc" } } },
      });
      if (!row) return res.status(404).json({ error: "Pedido de compra Nomus não encontrado." });

      const includeRaw = String(req.query.includeRaw ?? "").trim() === "1" && canSeeRawPayload(user);
      return res.json({
        ...serializeNomusPurchaseOrderListRow(row),
        paymentTerms: row.paymentTerms,
        comments: row.comments,
        currency: row.currency,
        discountAmount: row.discountAmount ? Number(row.discountAmount.toString()) : null,
        freightAmount: row.freightAmount ? Number(row.freightAmount.toString()) : null,
        createdAtNomus: row.createdAtNomus?.toISOString() ?? null,
        modifiedAtNomus: row.modifiedAtNomus?.toISOString() ?? null,
        firstSeenAt: row.firstSeenAt.toISOString(),
        payloadHash: row.payloadHash,
        receivingAvailable:
          row.receivedQuantity != null || row.items.some((item) => item.receivedQuantity != null),
        items: row.items.map((item) => ({
          id: item.id,
          lineIndex: item.lineIndex,
          lineExternalId: item.lineExternalId,
          productExternalId: item.productExternalId,
          productCode: item.productCode,
          description: item.description,
          unit: item.unit,
          orderedQuantity: item.orderedQuantity ? Number(item.orderedQuantity.toString()) : null,
          receivedQuantity: item.receivedQuantity ? Number(item.receivedQuantity.toString()) : null,
          remainingQuantity: item.remainingQuantity ? Number(item.remainingQuantity.toString()) : null,
          unitPrice: item.unitPrice ? Number(item.unitPrice.toString()) : null,
          totalAmount: item.totalAmount ? Number(item.totalAmount.toString()) : null,
        })),
        rawPayload: includeRaw ? row.rawPayload : undefined,
      });
    } catch (error) {
      console.error("GET /api/nomus/purchase-orders/:id", error);
      return res.status(500).json({ error: "Erro ao carregar pedido de compra Nomus." });
    }
  });
}
