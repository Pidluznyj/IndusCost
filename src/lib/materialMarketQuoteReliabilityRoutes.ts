import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  canAdjustMaterialMarketQuoteReliability,
  parseMaterialMarketQuoteReliabilityPatch,
} from "./materialMarketQuoteReliability.js";
import { overrideMaterialMarketQuoteReliability } from "./materialMarketQuoteReliability.server.js";
import { serializeMaterialMarketQuoteForApi } from "./materialMarketQuote.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  getCurrentAppUser: (
    req: express.Request
  ) => Promise<{ id: string; role: string; permissions: string[]; effectivePermissions?: string[] } | null>;
};

type RouteDeps = { prisma: PrismaClient; isUuid: (value: unknown) => value is string };

export function registerMaterialMarketQuoteReliabilityRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, getCurrentAppUser } = guards;
  const path =
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId/reliability";

  app.patch(path, requireAppAuth, async (req, res) => {
    try {
      const { materialId, quoteId } = req.params;
      if (!deps.isUuid(materialId) || !deps.isUuid(quoteId)) {
        return res.status(400).json({ error: "INVALID_ID", message: "IDs inválidos." });
      }

      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }

      if (!canAdjustMaterialMarketQuoteReliability(authUser)) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Você não tem permissão para ajustar a confiabilidade.",
        });
      }

      const parsed = parseMaterialMarketQuoteReliabilityPatch(req.body);
      if (parsed.ok === false) {
        return res.status(400).json({ error: parsed.code, message: parsed.message });
      }

      let change;
      try {
        change = await overrideMaterialMarketQuoteReliability(deps.prisma, {
          materialId,
          quoteId,
          level: parsed.level,
          justification: parsed.justification,
          userId: authUser.id,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "QUOTE_NOT_FOUND") {
          return res.status(404).json({
            error: "QUOTE_NOT_FOUND",
            message: "Cotação não encontrada.",
          });
        }
        throw error;
      }

      const quote = await deps.prisma.materialMarketQuote.findUnique({
        where: { id: quoteId },
        include: { _count: { select: { Attachments: true } } },
      });
      if (!quote) {
        return res.status(404).json({ error: "QUOTE_NOT_FOUND", message: "Cotação não encontrada." });
      }

      return res.json({
        ...serializeMaterialMarketQuoteForApi(quote),
        reliabilityChange: change,
      });
    } catch (error) {
      console.error(`PATCH ${path}`, error);
      return res.status(500).json({
        error: "RELIABILITY_UPDATE_FAILED",
        message: "Erro ao ajustar confiabilidade da cotação.",
      });
    }
  });
}
