/**
 * Pedido Nomus ↔ Contas a Pagar — rotas de reconciliação, confirmação e desvínculo.
 *
 * Fica fora de `nomusPurchaseOrderRoutes.ts` de propósito: aquele módulo é
 * somente-leitura por contrato (guarda estática em nomusPurchaseOrder360Ui.test).
 * Aqui as escritas são 100% locais (NomusPurchaseOrderPayableLink); nada é
 * escrito no Nomus.
 */
import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { OPERATIONS_ACTIONS, OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { NOMUS_PURCHASE_ORDER_VIEW_PERMISSIONS } from "@/src/lib/purchasing/nomusPurchaseOrderAccess.js";
import {
  buildPurchaseOrderPayableReconciliationForOrder,
  confirmPurchaseOrderPayableLink,
  mapPayableLinkError,
  removePurchaseOrderPayableLink,
} from "@/src/lib/nomus/nomusPurchaseOrderPayableLink.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  /** Autoridade canônica para escrita (vínculo com Contas a Pagar). */
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** Mesmas permissões de leitura da listagem de Pedidos Nomus. */
const VIEW_PERMISSIONS = [...NOMUS_PURCHASE_ORDER_VIEW_PERMISSIONS];

/**
 * Pedido Nomus ↔ Contas a Pagar — reconciliação, confirmação e desvínculo.
 * Leitura: mesmas permissões da listagem. Escrita: operations.purchases:update.
 * 100% local (NomusPurchaseOrderPayableLink); nada é escrito no Nomus.
 */
export function registerNomusPurchaseOrderPayableLinkRoutes(
  app: express.Express,
  auth: AuthGuards,
  options: { db?: PrismaClient } = {}
) {
  const { requireAppAuth, requireAnyPermission, requireResource, getCurrentAppUser } = auth;
  const serviceOptions = options.db ? { db: options.db } : {};
  const viewGuard = [requireAppAuth, requireAnyPermission(VIEW_PERMISSIONS)] as const;
  const linkGuard = [
    requireAppAuth,
    requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;

  const readOrderId = (req: express.Request): string | null => {
    const id = String(req.params.id ?? "").trim();
    return id && id.includes("-") ? id : null;
  };

  app.get("/api/nomus/purchase-orders/:id/payables", ...viewGuard, async (req, res) => {
    try {
      const id = readOrderId(req);
      if (!id) return res.status(400).json({ error: "Identificador inválido.", code: "INVALID_ID" });
      const payload = await buildPurchaseOrderPayableReconciliationForOrder(id, serviceOptions);
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      const mapped = mapPayableLinkError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/nomus/purchase-orders/:id/payables/links", ...linkGuard, async (req, res) => {
    try {
      const id = readOrderId(req);
      if (!id) return res.status(400).json({ error: "Identificador inválido.", code: "INVALID_ID" });
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const payload = await confirmPurchaseOrderPayableLink(
        id,
        { userId: user.id, userName: user.name ?? user.email ?? null },
        (req.body ?? {}) as Record<string, unknown>,
        serviceOptions
      );
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json(payload);
    } catch (error) {
      const mapped = mapPayableLinkError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.delete(
    "/api/nomus/purchase-orders/:id/payables/links/:payableExternalId",
    ...linkGuard,
    async (req, res) => {
      try {
        const id = readOrderId(req);
        if (!id) return res.status(400).json({ error: "Identificador inválido.", code: "INVALID_ID" });
        const payableRaw = String(req.params.payableExternalId ?? "").trim();
        if (!/^\d+$/.test(payableRaw)) {
          return res.status(400).json({ error: "Título inválido.", code: "INVALID_PAYABLE_EXTERNAL_ID" });
        }
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });
        const payload = await removePurchaseOrderPayableLink(
          id,
          Number(payableRaw),
          { userId: user.id, userName: user.name ?? user.email ?? null },
          (req.body ?? {}) as Record<string, unknown>,
          serviceOptions
        );
        res.setHeader("Cache-Control", "no-store");
        return res.json(payload);
      } catch (error) {
        const mapped = mapPayableLinkError(error);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );
}
