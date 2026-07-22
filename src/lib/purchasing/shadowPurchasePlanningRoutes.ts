/**
 * Rotas do planejamento de compra em modo sombra (OP-25).
 * Feature flag SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED (default off).
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  requireEnvFlagEnabled,
  SUPPLY_CHAIN_FEATURE_ENV,
} from "@/src/lib/supply-chain/supplyChainFeatureFlags.js";
import {
  buildShadowPurchasePlan,
  createDraftPurchaseRequestFromShadowSuggestion,
  mapShadowPurchasePlanningError,
} from "@/src/lib/purchasing/shadowPurchasePlanningService.server.js";

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

export function registerShadowPurchasePlanningRoutes(app: express.Express, auth: AuthGuards) {
  const flag = requireEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.shadowPlanning);
  const view = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;
  const create = [
    auth.requireAppAuth,
    flag,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.create),
  ] as const;

  app.get("/api/shadow-purchase-planning", ...view, async (req, res) => {
    try {
      const result = await buildShadowPurchasePlan(prisma, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (e) {
      const mapped = mapShadowPurchasePlanningError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });

  /**
   * Transforma sugestão em rascunho de SC — somente com confirmHumanAction=true.
   * Nunca auto-cria a partir do GET de planejamento.
   */
  app.post("/api/shadow-purchase-planning/create-draft", ...create, async (req, res) => {
    try {
      const body = req.body ?? {};
      if (body.confirmHumanAction !== true) {
        return res.status(400).json({
          error:
            "Criação de rascunho exige confirmação humana explícita (confirmHumanAction=true).",
          code: "HUMAN_CONFIRMATION_REQUIRED",
        });
      }
      if (!body.materialId || !isUuid(String(body.materialId))) {
        return res.status(400).json({ error: "materialId inválido." });
      }
      if (!body.defaultCostCenterId || !isUuid(String(body.defaultCostCenterId))) {
        return res.status(400).json({ error: "defaultCostCenterId inválido." });
      }

      const user = await auth.getCurrentAppUser(req);
      const result = await createDraftPurchaseRequestFromShadowSuggestion(prisma, {
        confirmHumanAction: true,
        materialId: String(body.materialId),
        quantity: Number(body.quantity),
        unit: body.unit != null ? String(body.unit) : undefined,
        description: body.description != null ? String(body.description) : undefined,
        requester: String(body.requester ?? ""),
        department: String(body.department ?? ""),
        justification: String(body.justification ?? ""),
        defaultCostCenterId: String(body.defaultCostCenterId),
        desiredDate: body.desiredDate != null ? String(body.desiredDate) : null,
        notes: body.notes != null ? String(body.notes) : null,
        projectId: body.projectId != null ? String(body.projectId) : null,
        actor: user
          ? { userId: user.id, userName: user.name ?? user.email ?? null }
          : undefined,
      });
      res.status(201).json(result);
    } catch (e) {
      const mapped = mapShadowPurchasePlanningError(e);
      res.status(mapped.status).json(mapped.body);
    }
  });
}
