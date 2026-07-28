/**
 * Rotas de Recebimento de Compra (OP-22).
 * Feature flag SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED (default off).
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import { requireSupplyChainModuleEnabled } from "@/src/lib/supply-chain/supplyChainFeatureFlags.js";
import {
  cancelPurchaseReceiptDraft,
  confirmPurchaseReceipt,
  createPurchaseReceiptDraft,
  getPurchaseReceiptDetail,
  listPurchaseReceipts,
  mapPurchaseReceiptError,
  reversePurchaseReceipt,
} from "@/src/lib/purchasing/purchaseReceiptService.server.js";
import {
  getReceivingStationOrderDetail,
  listReceivingStationBoard,
} from "@/src/lib/purchasing/receivingStationService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{
    id: string;
    name?: string | null;
    email?: string | null;
    effectivePermissions?: string[];
    permissions?: string[];
  } | null>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function registerPurchaseReceiptRoutes(app: express.Express, auth: AuthGuards) {
  const flag = requireSupplyChainModuleEnabled("sc-receiving");
  const view = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;
  const update = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;
  const approve = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve),
  ] as const;

  app.get("/api/receiving-station", ...view, async (req, res) => {
    try {
      const result = await listReceivingStationBoard(prisma, {
        q: req.query.q ? String(req.query.q) : undefined,
        poStatus: req.query.poStatus ? String(req.query.poStatus) : undefined,
        supplierId: req.query.supplierId ? String(req.query.supplierId) : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/receiving-station/orders/:orderId", ...view, async (req, res) => {
    try {
      const orderId = String(req.params.orderId);
      if (!isUuid(orderId)) return res.status(400).json({ error: "orderId inválido." });
      const row = await getReceivingStationOrderDetail(prisma, orderId);
      res.setHeader("Cache-Control", "no-store");
      res.json(row);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-receipts", ...view, async (req, res) => {
    try {
      const purchaseOrderId = req.query.purchaseOrderId
        ? String(req.query.purchaseOrderId)
        : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      if (purchaseOrderId && !isUuid(purchaseOrderId)) {
        return res.status(400).json({ error: "purchaseOrderId inválido." });
      }
      const rows = await listPurchaseReceipts(prisma, { purchaseOrderId, status });
      res.setHeader("Cache-Control", "no-store");
      res.json({ rows });
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-receipts/:id", ...view, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(400).json({ error: "id inválido." });
      const row = await getPurchaseReceiptDetail(prisma, id);
      res.setHeader("Cache-Control", "no-store");
      res.json(row);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-receipts", ...update, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user?.id) return res.status(401).json({ error: "Não autenticado." });
      const body = req.body ?? {};
      if (!isUuid(String(body.purchaseOrderId ?? ""))) {
        return res.status(400).json({ error: "purchaseOrderId inválido." });
      }
      if (!isUuid(String(body.warehouseId ?? ""))) {
        return res.status(400).json({ error: "warehouseId inválido." });
      }
      const items = Array.isArray(body.items) ? body.items : [];
      const row = await createPurchaseReceiptDraft(
        prisma,
        {
          purchaseOrderId: String(body.purchaseOrderId),
          warehouseId: String(body.warehouseId),
          locationId: body.locationId ? String(body.locationId) : null,
          receivedAt: body.receivedAt ?? null,
          documentNumber: body.documentNumber ?? null,
          entryDocumentRef: body.entryDocumentRef ?? null,
          nfeNumber: body.nfeNumber ?? null,
          nfeId: body.nfeId ?? null,
          freightValueActual: num(body.freightValueActual),
          expensesActual: num(body.expensesActual),
          notes: body.notes ?? null,
          responsibleUserId: body.responsibleUserId ?? user.id,
          responsibleUserName: body.responsibleUserName ?? user.name ?? user.email,
          items: items.map((it: Record<string, unknown>) => ({
            purchaseOrderItemId: String(it.purchaseOrderItemId ?? ""),
            quantityReceived: Number(it.quantityReceived),
            quantityAccepted: Number(it.quantityAccepted),
            quantityRejected: Number(it.quantityRejected ?? 0),
            lotNumber: it.lotNumber != null ? String(it.lotNumber) : null,
            unitCostSnapshot: num(it.unitCostSnapshot),
            effectiveUnitCost: num(it.effectiveUnitCost),
            notes: it.notes != null ? String(it.notes) : null,
          })),
        },
        { userId: user.id, userName: user.name ?? user.email }
      );
      res.status(201).json(row);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-receipts/:id/confirm", ...approve, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user?.id) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(400).json({ error: "id inválido." });
      const idempotencyKey =
        (req.headers["idempotency-key"] as string | undefined) ??
        req.body?.idempotencyKey ??
        null;
      const result = await confirmPurchaseReceipt(
        prisma,
        id,
        {
          userId: user.id,
          userName: user.name ?? user.email,
          // OP-27: permissões reais do usuário — sem forjar inventory.*.
          permissions: user.effectivePermissions ?? user.permissions ?? [],
        },
        { idempotencyKey }
      );
      res.json(result);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-receipts/:id/reverse", ...approve, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user?.id) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(400).json({ error: "id inválido." });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "Motivo obrigatório.", code: "REASON_REQUIRED" });
      const result = await reversePurchaseReceipt(
        prisma,
        id,
        {
          userId: user.id,
          userName: user.name ?? user.email,
          permissions: user.effectivePermissions ?? user.permissions ?? [],
        },
        reason
      );
      res.json(result);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-receipts/:id/cancel", ...update, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user?.id) return res.status(401).json({ error: "Não autenticado." });
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(400).json({ error: "id inválido." });
      const row = await cancelPurchaseReceiptDraft(
        prisma,
        id,
        { userId: user.id, userName: user.name ?? user.email },
        req.body?.reason ? String(req.body.reason) : null
      );
      res.json(row);
    } catch (e) {
      const mapped = mapPurchaseReceiptError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });
}
