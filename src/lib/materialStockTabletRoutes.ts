/**
 * Rotas aditivas — Conferência de Estoque (tablet).
 * Não altera GET/POST/PUT /api/materials.
 */
import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import {
  materialStockConferenceHttpStatus,
  recordMaterialStockConference,
} from "./materialStockConference.server.js";
import { MaterialStockConferenceError } from "./materialStockConferenceRules.js";
import { searchMaterialStockTablet } from "./materialStockTablet.server.js";
import { parseMaterialStockTabletSearchQuery } from "./materialStockTabletQuery.js";
import {
  MATERIAL_STOCK_TABLET_CONFERENCE_PATH,
  MATERIAL_STOCK_TABLET_SEARCH_PATH,
} from "./materialStockTabletTypes.js";

type AuthUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AuthUser | null>;
};

type RouteDeps = {
  prisma: PrismaClient;
};

function resolveIdempotencyKey(req: express.Request): string | null {
  const header =
    req.header("idempotency-key") ?? req.header("Idempotency-Key") ?? null;
  return header?.trim() || null;
}

export function registerMaterialStockTabletRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;

  app.get(
    MATERIAL_STOCK_TABLET_SEARCH_PATH,
    requireAppAuth,
    requireResource(ENGINEERING_RESOURCE_KEYS.materials, "view"),
    async (req, res) => {
      try {
        const query = parseMaterialStockTabletSearchQuery(
          req.query as Record<string, unknown>
        );
        const payload = await searchMaterialStockTablet(deps.prisma, query);
        return res.status(200).json(payload);
      } catch (error) {
        console.error(`GET ${MATERIAL_STOCK_TABLET_SEARCH_PATH}`, error);
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível listar matérias-primas para conferência.",
        });
      }
    }
  );

  app.post(
    MATERIAL_STOCK_TABLET_CONFERENCE_PATH,
    requireAppAuth,
    requireResource(ENGINEERING_RESOURCE_KEYS.materials, "update"),
    async (req, res) => {
      try {
        const actor = await getCurrentAppUser(req);
        if (!actor?.id) {
          return res.status(401).json({
            error: "UNAUTHORIZED",
            message: "Autenticação necessária.",
          });
        }
        // userId do body é ignorado — autoridade é a sessão.
        const result = await recordMaterialStockConference(deps.prisma, {
          body: (req.body ?? {}) as Record<string, unknown>,
          idempotencyKeyHeader: resolveIdempotencyKey(req),
          actor: {
            id: actor.id,
            name: actor.name,
            email: actor.email,
          },
          source: "TABLET_CONFERENCE",
        });
        return res.status(result.created ? 201 : 200).json(result);
      } catch (error) {
        if (error instanceof MaterialStockConferenceError) {
          const status = materialStockConferenceHttpStatus(error);
          return res.status(status).json({
            error: error.code,
            message: error.message,
            field: error.field,
            details: error.details,
          });
        }
        console.error(`POST ${MATERIAL_STOCK_TABLET_CONFERENCE_PATH}`, error);
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível registrar a conferência de estoque.",
        });
      }
    }
  );
}
