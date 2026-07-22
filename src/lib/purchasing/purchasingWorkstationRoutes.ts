/**
 * Rotas da estação operacional de Compras (OP-21).
 * Cards/totais no backend. Feature flag SC permanece off por padrão (casca /supply-chain/purchases).
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  buildPurchasingWorkstation,
  type WorkstationQuery,
} from "@/src/lib/purchasing/purchasingWorkstationService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
};

export function registerPurchasingWorkstationRoutes(app: express.Express, auth: AuthGuards) {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;

  app.get("/api/purchase-workstation", ...view, async (req, res) => {
    try {
      const query: WorkstationQuery = {
        q: req.query.q ? String(req.query.q) : undefined,
        stage: req.query.stage ? (String(req.query.stage) as WorkstationQuery["stage"]) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        responsible: req.query.responsible ? String(req.query.responsible) : undefined,
        supplierId: req.query.supplierId ? String(req.query.supplierId) : undefined,
        materialId: req.query.materialId ? String(req.query.materialId) : undefined,
        priority: req.query.priority ? String(req.query.priority) : undefined,
        periodFrom: req.query.periodFrom ? String(req.query.periodFrom) : undefined,
        periodTo: req.query.periodTo ? String(req.query.periodTo) : undefined,
        neededByFrom: req.query.neededByFrom ? String(req.query.neededByFrom) : undefined,
        neededByTo: req.query.neededByTo ? String(req.query.neededByTo) : undefined,
        kind: req.query.kind ? (String(req.query.kind) as WorkstationQuery["kind"]) : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      };
      const result = await buildPurchasingWorkstation(prisma, query);
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (e) {
      console.error("purchase-workstation error:", e);
      res.status(500).json({ error: "Erro ao montar estação de compras." });
    }
  });
}
