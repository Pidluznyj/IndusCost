import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildMaterialMarketAuditEventData,
  buildMaterialMarketAuditListResponse,
  detectMaterialMarketQuoteChangeEvents,
  parseMaterialMarketAuditListQuery,
  serializeQuoteAuditSnapshot,
} from "@/src/lib/materialMarketAudit.js";
import {
  listMaterialMarketAuditEventsForMaterial,
  recordMaterialMarketAuditEvent,
} from "@/src/lib/materialMarketAudit.server.js";
import { serializeMaterialMarketQuoteForApi } from "@/src/lib/materialMarketQuote.js";
import {
  buildMaterialMarketQuotePatchData,
  parseMaterialMarketQuotePatch,
} from "@/src/lib/materialMarketQuoteUpdate.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

type RouteDeps = {
  prisma: PrismaClient;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function registerMaterialMarketAuditRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requirePermission } = guards;
  const { prisma, getCurrentAppUser } = deps;

  app.get(
    "/api/materials/market-intelligence/:materialId/audit",
    requireAppAuth,
    requirePermission("materials.view"),
    async (req, res) => {
      try {
        const { materialId } = req.params;
        if (!isUuid(materialId)) {
          return res.status(400).json({ error: "ID de material inválido." });
        }

        const material = await prisma.material.findUnique({
          where: { id: materialId },
          select: { id: true },
        });
        if (!material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const pagination = parseMaterialMarketAuditListQuery(req.query ?? {});
        const { items, total } = await listMaterialMarketAuditEventsForMaterial(
          prisma,
          materialId,
          pagination
        );

        return res.json(
          buildMaterialMarketAuditListResponse({
            items,
            total,
            limit: pagination.limit,
            offset: pagination.offset,
          })
        );
      } catch (error) {
        console.error("GET material market audit", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao carregar auditoria.",
        });
      }
    }
  );

  app.patch(
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId",
    requireAppAuth,
    requirePermission("materials.edit"),
    async (req, res) => {
      try {
        const { materialId, quoteId } = req.params;
        if (!isUuid(materialId) || !isUuid(quoteId)) {
          return res.status(400).json({ error: "ID inválido." });
        }

        const authUser = await getCurrentAppUser(req);
        if (!authUser) {
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
        }

        const existing = await prisma.materialMarketQuote.findFirst({
          where: { id: quoteId, materialId },
        });
        if (!existing) {
          return res.status(404).json({ error: "Cotação não encontrada." });
        }

        const parsed = parseMaterialMarketQuotePatch(req.body ?? {});
        if (parsed.ok === false) {
          return res.status(400).json({
            error: "MATERIAL_MARKET_QUOTE_PATCH_INVALID",
            field: parsed.field,
            message: parsed.message,
          });
        }

        const beforeSnapshot = serializeQuoteAuditSnapshot(existing);
        const updateData = {
          ...buildMaterialMarketQuotePatchData(existing, parsed.value),
          updatedBy: authUser.id,
        };
        const afterPreview = { ...existing, ...updateData };
        const afterSnapshot = serializeQuoteAuditSnapshot(afterPreview);
        const changeEvents = detectMaterialMarketQuoteChangeEvents({
          before: beforeSnapshot,
          after: afterSnapshot,
        });

        for (const eventType of changeEvents) {
          const validation = buildMaterialMarketAuditEventData({
            materialId,
            entityType: "QUOTE",
            entityId: quoteId,
            eventType,
            userId: authUser.id,
            userName: authUser.name,
            reason: parsed.value.reason ?? null,
            beforeJson: beforeSnapshot,
            afterJson: afterSnapshot,
            isOfficialQuote: Boolean(existing.isOfficialReference),
          });
          if (validation.ok === false) {
            return res.status(400).json({
              error: validation.code,
              field: validation.field,
              message: validation.message,
            });
          }
        }

        const updated = await prisma.$transaction(async (tx) => {
          const quote = await tx.materialMarketQuote.update({
            where: { id: quoteId },
            data: updateData,
          });

          for (const eventType of changeEvents) {
            await recordMaterialMarketAuditEvent(tx, {
              materialId,
              entityType: "QUOTE",
              entityId: quoteId,
              eventType,
              userId: authUser.id,
              userName: authUser.name,
              reason: parsed.value.reason ?? null,
              beforeJson: beforeSnapshot,
              afterJson: serializeQuoteAuditSnapshot(quote),
              isOfficialQuote: Boolean(existing.isOfficialReference),
            });
          }

          return quote;
        });

        return res.json(serializeMaterialMarketQuoteForApi(updated));
      } catch (error) {
        console.error("PATCH material market quote", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao atualizar cotação.",
        });
      }
    }
  );
}
