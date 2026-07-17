import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
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
import {
  canManualMaterialMarketQuoteExchange,
  serializeMaterialMarketQuoteForApi,
} from "@/src/lib/materialMarketQuote.js";
import { resolveMaterialMarketQuoteExchange } from "@/src/lib/materialMarketQuoteExchange.js";
import {
  buildMaterialMarketQuotePatchData,
  guardMaterialMarketQuoteDelete,
  guardMaterialMarketQuoteEdit,
  mergeMaterialMarketQuoteEditBody,
  shouldRecalculateMaterialMarketQuoteExchange,
} from "@/src/lib/materialMarketQuoteUpdate.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

type RouteDeps = {
  prisma: PrismaClient;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
  hasPermission?: (user: AppAuthContext, permission: string) => boolean;
  evaluateMarketAlerts?: (materialId: string) => Promise<void>;
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
  const { requireAppAuth, requireResource } = guards;
  const { prisma, getCurrentAppUser, hasPermission, evaluateMarketAlerts } = deps;
  const view360 = requireResource(
    ENGINEERING_RESOURCE_KEYS.marketIntelligenceMaterial360,
    "view"
  );
  const updateQuotes = requireResource(
    ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
    "update"
  );

  app.get(
    "/api/materials/market-intelligence/:materialId/audit",
    requireAppAuth,
    view360,
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
    updateQuotes,
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

        const material = await prisma.material.findUnique({
          where: { id: materialId },
          select: { id: true, unit: true, isMarketMonitored: true },
        });
        if (!material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const existing = await prisma.materialMarketQuote.findFirst({
          where: { id: quoteId, materialId },
        });
        if (!existing) {
          return res.status(404).json({ error: "Cotação não encontrada." });
        }

        const editGuard = guardMaterialMarketQuoteEdit(existing);
        if (editGuard.ok === false) {
          return res.status(editGuard.httpStatus).json({
            error: editGuard.code,
            message: editGuard.message,
          });
        }

        const body = req.body ?? {};
        const parsed = mergeMaterialMarketQuoteEditBody(existing, body, { unit: material.unit });
        if (parsed.ok === false) {
          return res.status(400).json({
            error: "MATERIAL_MARKET_QUOTE_PATCH_INVALID",
            field: parsed.field,
            message: parsed.message,
          });
        }

        if (parsed.value.supplierId) {
          const supplier = await prisma.financialSupplier.findUnique({
            where: { id: parsed.value.supplierId },
          });
          if (!supplier) {
            return res.status(400).json({
              error: "MATERIAL_MARKET_QUOTE_INVALID_SUPPLIER",
              message: "Fornecedor informado não encontrado.",
            });
          }
        }

        const reason =
          typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

        let exchangeFields: Record<string, unknown> = {};
        if (
          shouldRecalculateMaterialMarketQuoteExchange({
            body,
            existing,
          })
        ) {
          const canManualExchange = canManualMaterialMarketQuoteExchange({
            hasPermission: (p) =>
              hasPermission ? hasPermission(authUser, p) : false,
          });
          const exchangeResolved = await resolveMaterialMarketQuoteExchange(
            {
              currency: parsed.value.currency,
              quoteDate: parsed.value.quoteDate,
              price: parsed.value.price,
              netPrice: parsed.value.netPrice,
              manualExchangeRate: body.manualExchangeRate,
              manualExchangeJustification: body.manualExchangeJustification,
              forceManualExchange: body.forceManualExchange,
            },
            { canManualExchange, userId: authUser.id }
          );
          if (exchangeResolved.ok === false) {
            return res.status(400).json({
              error: exchangeResolved.code,
              field: exchangeResolved.field,
              message: exchangeResolved.message,
              ptaxFetchFailureReason: exchangeResolved.ptaxFetchFailureReason,
              canManualExchange,
            });
          }
          exchangeFields = exchangeResolved.value;
        }

        const beforeSnapshot = serializeQuoteAuditSnapshot(existing);
        const updateData = {
          ...buildMaterialMarketQuotePatchData(existing, parsed.value),
          ...exchangeFields,
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
            reason,
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
            include: { _count: { select: { Attachments: true } } },
          });

          for (const eventType of changeEvents) {
            await recordMaterialMarketAuditEvent(tx, {
              materialId,
              entityType: "QUOTE",
              entityId: quoteId,
              eventType,
              userId: authUser.id,
              userName: authUser.name,
              reason,
              beforeJson: beforeSnapshot,
              afterJson: serializeQuoteAuditSnapshot(quote),
              isOfficialQuote: Boolean(existing.isOfficialReference),
            });
          }

          return quote;
        });

        if (material.isMarketMonitored && evaluateMarketAlerts) {
          try {
            await evaluateMarketAlerts(materialId);
          } catch (alertError) {
            console.error("PATCH quote — falha ao avaliar alertas de mercado", alertError);
          }
        }

        return res.json(serializeMaterialMarketQuoteForApi(updated));
      } catch (error) {
        console.error("PATCH material market quote", error);
        return res.status(500).json({
          error: "Erro ao atualizar cotação.",
          message: error instanceof Error ? error.message : "Erro ao atualizar cotação.",
        });
      }
    }
  );

  app.delete(
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId",
    requireAppAuth,
    updateQuotes,
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

        const material = await prisma.material.findUnique({
          where: { id: materialId },
          select: { id: true, isMarketMonitored: true },
        });
        if (!material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const existing = await prisma.materialMarketQuote.findFirst({
          where: { id: quoteId, materialId },
          include: { _count: { select: { purchaseLinks: true } } },
        });
        if (!existing) {
          return res.status(404).json({ error: "Cotação não encontrada." });
        }

        const deleteGuard = guardMaterialMarketQuoteDelete({
          status: existing.status,
          isOfficialReference: existing.isOfficialReference,
          officialStatus: existing.officialStatus,
          purchaseLinkCount: existing._count.purchaseLinks,
        });
        if (deleteGuard.ok === false) {
          return res.status(deleteGuard.httpStatus).json({
            error: deleteGuard.code,
            message: deleteGuard.message,
          });
        }

        const beforeSnapshot = serializeQuoteAuditSnapshot(existing);
        const updated = await prisma.$transaction(async (tx) => {
          const quote = await tx.materialMarketQuote.update({
            where: { id: quoteId },
            data: {
              status: "CANCELLED",
              updatedBy: authUser.id,
            },
            include: { _count: { select: { Attachments: true } } },
          });

          await recordMaterialMarketAuditEvent(tx, {
            materialId,
            entityType: "QUOTE",
            entityId: quoteId,
            eventType: "STATUS_CHANGED",
            userId: authUser.id,
            userName: authUser.name,
            reason: "Cotação removida da inteligência de mercado.",
            beforeJson: beforeSnapshot,
            afterJson: serializeQuoteAuditSnapshot(quote),
            isOfficialQuote: Boolean(existing.isOfficialReference),
          });

          return quote;
        });

        if (material.isMarketMonitored && evaluateMarketAlerts) {
          try {
            await evaluateMarketAlerts(materialId);
          } catch (alertError) {
            console.error("DELETE quote — falha ao avaliar alertas de mercado", alertError);
          }
        }

        return res.json({
          ok: true,
          id: updated.id,
          status: updated.status,
        });
      } catch (error) {
        console.error("DELETE material market quote", error);
        return res.status(500).json({
          error: "Erro ao excluir cotação.",
          message: error instanceof Error ? error.message : "Erro ao excluir cotação.",
        });
      }
    }
  );
}
