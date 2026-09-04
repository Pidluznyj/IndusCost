/**
 * PURCH-MIRROR-01 — API de leitura do mirror de Pedido de Compra Nomus.
 * Só GET; reaproveita a permissão de visualização de Compras já existente
 * (OPERATIONS_RESOURCE_KEYS.purchases / view) — nenhuma taxonomia de
 * permissão nova criada para esta primeira versão (mirror ainda sem UI
 * dedicada). rawPayload nunca é exposto aqui (não há endpoint
 * administrativo/auditoria nesta entrega — ver docs, "API interna").
 *
 * GET /api/nomus/purchase-orders
 * GET /api/nomus/purchase-orders/:id   (UUID local OU externalId numérico)
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  getNomusPurchaseOrderDetail,
  listNomusPurchaseOrders,
} from "@/src/lib/nomus/nomusPurchaseOrderReadService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
};

export function registerNomusPurchaseOrderReadRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;

  app.get("/api/nomus/purchase-orders", ...view, async (req, res) => {
    try {
      const result = await listNomusPurchaseOrders(
        prisma,
        req.query as Record<string, unknown>
      );
      res.json(result);
    } catch (error) {
      console.error("[nomus-purchase-orders-read] list failed", error);
      res.status(500).json({ error: "Falha ao listar Pedidos de Compra Nomus." });
    }
  });

  app.get("/api/nomus/purchase-orders/:id", ...view, async (req, res) => {
    try {
      const detail = await getNomusPurchaseOrderDetail(prisma, req.params.id);
      if (!detail) {
        res.status(404).json({ error: "Pedido de Compra Nomus não encontrado." });
        return;
      }
      res.json(detail);
    } catch (error) {
      console.error("[nomus-purchase-orders-read] detail failed", error);
      res.status(500).json({ error: "Falha ao carregar Pedido de Compra Nomus." });
    }
  });
}
