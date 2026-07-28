/**
 * Rotas do Pedido de Compra formal (OP-20).
 * Sem Contas a Pagar / estoque.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  createPurchaseOrdersFromAward,
  getPurchaseOrderDetail,
  listPurchaseOrderHistory,
  listPurchaseOrders,
  mapPurchaseOrderError,
  transitionPurchaseOrder,
} from "@/src/lib/purchasing/purchaseOrderService.server.js";
import { buildPurchaseOrderSavingsComparison } from "@/src/lib/purchasing/realizedSavingsService.server.js";
import { buildPurchaseOrderPdfBuffer } from "@/src/lib/purchasing/purchaseOrderPdf.js";
import type { PurchaseOrderAction } from "@/src/lib/purchasing/purchaseOrderWorkflow.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{
    id: string;
    name?: string | null;
    email?: string | null;
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

export function registerPurchaseOrderRoutes(app: express.Express, auth: AuthGuards) {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;
  const update = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;
  const approve = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve),
  ] as const;

  app.get("/api/purchase-orders", ...view, async (req, res) => {
    try {
      const quotationId = req.query.quotationId ? String(req.query.quotationId) : undefined;
      const awardId = req.query.awardId ? String(req.query.awardId) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      if (quotationId && !isUuid(quotationId)) {
        return res.status(400).json({ error: "quotationId inválido." });
      }
      if (awardId && !isUuid(awardId)) {
        return res.status(400).json({ error: "awardId inválido." });
      }
      const rows = await listPurchaseOrders(prisma, { quotationId, awardId, status });
      res.json({ rows });
    } catch (e) {
      console.error("purchase-orders list error:", e);
      res.status(500).json({ error: "Erro ao listar pedidos de compra." });
    }
  });

  app.get("/api/purchase-orders/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await getPurchaseOrderDetail(prisma, id);
      res.json(row);
    } catch (e) {
      const mapped = mapPurchaseOrderError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-orders/:id/history", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const events = await listPurchaseOrderHistory(prisma, id);
      res.json({ events });
    } catch (e) {
      const mapped = mapPurchaseOrderError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-orders/:id/savings-comparison", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await buildPurchaseOrderSavingsComparison(prisma, id);
      res.setHeader("Cache-Control", "no-store");
      res.json(row);
    } catch (e) {
      const mapped = mapPurchaseOrderError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-orders/:id/pdf", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await getPurchaseOrderDetail(prisma, id);
      const buffer = buildPurchaseOrderPdfBuffer({
        code: row.code,
        status: row.status,
        supplierName: row.supplierDisplayNameSnapshot,
        supplierDocument: row.supplierDocumentSnapshot,
        currency: row.currency,
        quotationCode: row.quotationCodeSnapshot,
        paymentTerms: row.paymentTermsSnapshot,
        deliveryTerms: row.deliveryTermsSnapshot,
        freightValue: num(row.freightValueSnapshot),
        taxes: num(row.nonRecoverableTaxesSnapshot),
        discounts: num(row.discountsSnapshot),
        leadTimeDays: row.leadTimeDaysSnapshot,
        totalAmount: num(row.totalAmountSnapshot),
        initialComparable: num(row.initialComparableTotalSnapshot),
        negotiatedComparable: num(row.negotiatedComparableTotalSnapshot),
        totalGain: num(row.totalGainSnapshot),
        awardJustification: row.awardJustificationSnapshot,
        evidenceCount: row.evidenceCountSnapshot,
        operationalCommitmentAt: row.operationalCommitmentAt
          ? row.operationalCommitmentAt.toISOString()
          : null,
        futureEntryPending: row.futureEntryPending,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        approvedBy: row.approvedByUserName,
        notes: row.notes,
        items: row.items.map((it) => ({
          lineNumber: it.lineNumber,
          description: it.description,
          materialCode: it.materialCodeSnapshot,
          quantity: Number(it.quantityOrdered),
          unit: it.unit,
          initialUnitPrice: num(it.initialUnitPriceSnapshot),
          negotiatedUnitPrice: Number(it.unitPriceSnapshot),
          lineTotal: Number(it.lineTotalSnapshot),
          lineGain: num(it.lineGainSnapshot),
        })),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${row.code.replace(/[^\w.-]+/g, "_")}.pdf"`
      );
      res.send(buffer);
    } catch (e) {
      const mapped = mapPurchaseOrderError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-orders/from-award/:awardId", ...update, async (req, res) => {
    try {
      const { awardId } = req.params;
      if (!isUuid(awardId)) return res.status(400).json({ error: "awardId inválido." });
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Autenticação necessária." });
      const rows = await createPurchaseOrdersFromAward(
        prisma,
        awardId,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        { notes: req.body?.notes ?? null }
      );
      res.status(201).json({ rows });
    } catch (e) {
      const mapped = mapPurchaseOrderError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  async function transition(req: express.Request, res: express.Response, action: PurchaseOrderAction) {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await transitionPurchaseOrder(
        prisma,
        id,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        action,
        { reason: req.body?.reason ?? null, notes: req.body?.notes ?? null }
      );
      res.json(row);
    } catch (e) {
      const mapped = mapPurchaseOrderError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  }

  app.post("/api/purchase-orders/:id/approve", ...approve, (req, res) =>
    void transition(req, res, "APPROVE")
  );
  app.post("/api/purchase-orders/:id/send", ...update, (req, res) =>
    void transition(req, res, "SEND")
  );
  app.post("/api/purchase-orders/:id/confirm", ...update, (req, res) =>
    void transition(req, res, "CONFIRM")
  );
  app.post("/api/purchase-orders/:id/cancel", ...update, (req, res) =>
    void transition(req, res, "CANCEL")
  );
}
