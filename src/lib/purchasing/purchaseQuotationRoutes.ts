/**
 * Rotas de coleta de cotações por fornecedor (OP-15).
 * Sem adjudicação / PO / Contas a Pagar.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";
import {
  getPurchaseQuotationDetail,
  inviteSupplierToQuotation,
  listPurchaseQuotations,
  mapPurchasingError,
  markOfferProposalReceived,
  updatePurchaseQuotationMeta,
  upsertSupplierOffer,
} from "@/src/lib/purchasing/purchaseQuotationService.server.js";
import {
  appendNegotiationRoundLines,
  closeNegotiationRound,
  computeOfferRoundSavings,
  listNegotiationRounds,
  mapNegotiationError,
  openNegotiationRound,
} from "@/src/lib/purchasing/negotiationRoundService.server.js";

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

export function registerPurchaseQuotationCollectionRoutes(app: express.Express, auth: AuthGuards) {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;
  const update = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;

  app.get("/api/purchase-quotations/official-refs/suppliers", ...view, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const reads = createOfficialDataProviders(prisma);
      const rows = await reads.suppliers.list({ q: q || undefined, limit: 50, activeOnly: true });
      res.json({ rows });
    } catch (e) {
      console.error("official suppliers list error:", e);
      res.status(500).json({ error: "Erro ao listar fornecedores oficiais." });
    }
  });

  app.get("/api/purchase-quotations", ...view, async (req, res) => {
    try {
      const purchaseRequestId = req.query.purchaseRequestId
        ? String(req.query.purchaseRequestId)
        : undefined;
      if (purchaseRequestId && !isUuid(purchaseRequestId)) {
        return res.status(400).json({ error: "purchaseRequestId inválido." });
      }
      const status = req.query.status ? String(req.query.status) : undefined;
      const rows = await listPurchaseQuotations(prisma, { purchaseRequestId, status });
      res.json({ rows });
    } catch (e) {
      console.error("purchase-quotations list error:", e);
      res.status(500).json({ error: "Erro ao listar cotações." });
    }
  });

  app.get("/api/purchase-quotations/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await getPurchaseQuotationDetail(prisma, id);
      if (!row) return res.status(404).json({ error: "Cotação não encontrada." });
      res.json(row);
    } catch (e) {
      console.error("purchase-quotation detail error:", e);
      res.status(500).json({ error: "Erro ao carregar cotação." });
    }
  });

  app.patch("/api/purchase-quotations/:id", ...update, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await updatePurchaseQuotationMeta(prisma, id, req.body ?? {});
      res.json(row);
    } catch (e) {
      const mapped = mapPurchasingError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-quotations/:id/invite-supplier", ...update, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const supplierId = String(req.body?.supplierId ?? "");
      if (!isUuid(supplierId)) return res.status(400).json({ error: "supplierId inválido." });
      const row = await inviteSupplierToQuotation(
        prisma,
        id,
        supplierId,
        req.body?.notes ?? null
      );
      res.status(201).json(row);
    } catch (e) {
      const mapped = mapPurchasingError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.put(
    "/api/purchase-quotations/:id/suppliers/:quotationSupplierId/offer",
    ...update,
    async (req, res) => {
      try {
        const { id, quotationSupplierId } = req.params;
        if (!isUuid(id) || !isUuid(quotationSupplierId)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const row = await upsertSupplierOffer(prisma, id, quotationSupplierId, {
          currency: req.body?.currency,
          initialPaymentTerms: req.body?.initialPaymentTerms,
          initialDeliveryTerms: req.body?.initialDeliveryTerms,
          initialFreightValue: req.body?.initialFreightValue,
          initialNonRecoverableTaxes: req.body?.initialNonRecoverableTaxes,
          initialExpenses: req.body?.initialExpenses,
          initialDiscounts: req.body?.initialDiscounts,
          initialMinOrderQty: req.body?.initialMinOrderQty,
          initialValidityDate: req.body?.initialValidityDate,
          initialLeadTimeDays: req.body?.initialLeadTimeDays,
          notes: req.body?.notes,
          items: Array.isArray(req.body?.items) ? req.body.items : [],
        });
        res.json(row);
      } catch (e) {
        const mapped = mapPurchasingError(e);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );

  app.post(
    "/api/purchase-quotations/:id/offers/:offerId/mark-received",
    ...update,
    async (req, res) => {
      try {
        const { id, offerId } = req.params;
        if (!isUuid(id) || !isUuid(offerId)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const row = await markOfferProposalReceived(
          prisma,
          id,
          offerId,
          req.body?.notes ?? null
        );
        res.json(row);
      } catch (e) {
        const mapped = mapPurchasingError(e);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );

  app.get("/api/purchase-quotations/:id/rounds", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const rows = await listNegotiationRounds(prisma, id);
      res.json({ rows });
    } catch (e) {
      console.error("negotiation rounds list error:", e);
      res.status(500).json({ error: "Erro ao listar rodadas." });
    }
  });

  app.post("/api/purchase-quotations/:id/rounds", ...update, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await openNegotiationRound(
        prisma,
        id,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        { buyerReport: req.body?.buyerReport, notes: req.body?.notes }
      );
      res.status(201).json(row);
    } catch (e) {
      const mapped = mapNegotiationError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-quotations/:id/rounds/:roundId/lines", ...update, async (req, res) => {
    try {
      const { id, roundId } = req.params;
      if (!isUuid(id) || !isUuid(roundId)) return res.status(400).json({ error: "ID inválido." });
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Autenticação necessária." });
      const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const row = await appendNegotiationRoundLines(
        prisma,
        id,
        roundId,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        lines
      );
      res.status(201).json(row);
    } catch (e) {
      const mapped = mapNegotiationError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-quotations/:id/rounds/:roundId/close", ...update, async (req, res) => {
    try {
      const { id, roundId } = req.params;
      if (!isUuid(id) || !isUuid(roundId)) return res.status(400).json({ error: "ID inválido." });
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await closeNegotiationRound(
        prisma,
        id,
        roundId,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        { buyerReport: req.body?.buyerReport, notes: req.body?.notes }
      );
      res.json(row);
    } catch (e) {
      const mapped = mapNegotiationError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-quotations/:id/offers/:offerId/savings", ...view, async (req, res) => {
    try {
      const { id, offerId } = req.params;
      if (!isUuid(id) || !isUuid(offerId)) return res.status(400).json({ error: "ID inválido." });
      const roundId = req.query.roundId ? String(req.query.roundId) : undefined;
      if (roundId && !isUuid(roundId)) return res.status(400).json({ error: "roundId inválido." });
      const result = await computeOfferRoundSavings(prisma, id, offerId, roundId);
      res.json(result);
    } catch (e) {
      const mapped = mapNegotiationError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });
}
