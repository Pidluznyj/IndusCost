import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import {
  buildMaterialMarketQuoteGovernanceAuditRecord,
  validateApproveMaterialMarketQuote,
  validateRejectMaterialMarketQuote,
  validateSetMaterialMarketQuoteOfficial,
  validateSubmitMaterialQuoteForApproval,
} from "@/src/lib/materialMarketQuoteGovernance.js";
import { buildMaterialOfficialQuoteSummary } from "@/src/lib/materialOfficialQuote.js";
import { serializeMaterialMarketQuoteForApi } from "@/src/lib/materialMarketQuote.js";
import { validateMaterialMarketAuditReason } from "@/src/lib/materialMarketAudit.js";
import { recordGovernanceAuditEvent } from "@/src/lib/materialMarketAudit.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
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

async function loadGovernanceContext(
  prisma: PrismaClient,
  materialId: string,
  quoteId: string
) {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { id: true, marketCriticality: true },
  });
  if (!material) return null;

  const quotes = await prisma.materialMarketQuote.findMany({
    where: { materialId },
    select: {
      id: true,
      materialId: true,
      officialStatus: true,
      isOfficialReference: true,
      rejectionReason: true,
      submittedForApprovalBy: true,
      submittedForApprovalAt: true,
      approvedBy: true,
      approvedAt: true,
      setOfficialBy: true,
      setOfficialAt: true,
    },
  });

  const quote = quotes.find((row) => row.id === quoteId);
  return { material, quotes, quote };
}

export function registerMaterialMarketQuoteGovernanceRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requireResource } = guards;
  const { prisma, getCurrentAppUser } = deps;
  const updateQuotes = requireResource(
    ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
    "update"
  );
  const approveQuotes = requireResource(
    ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
    "approve"
  );

  app.post(
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId/submit-approval",
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

        const ctx = await loadGovernanceContext(prisma, materialId, quoteId);
        if (!ctx?.material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const validated = validateSubmitMaterialQuoteForApproval({
          materialId,
          quoteId,
          marketCriticality: ctx.material.marketCriticality,
          quotes: ctx.quotes,
        });
        if (validated.ok === false) {
          const status = validated.code === "QUOTE_NOT_FOUND" ? 404 : 400;
          return res.status(status).json({
            error: validated.code,
            message: validated.message,
          });
        }

        const now = new Date();
        const updated = await prisma.$transaction(async (tx) => {
          const quote = await tx.materialMarketQuote.update({
            where: { id: quoteId },
            data: {
              officialStatus: "PENDING_APPROVAL",
              rejectionReason: null,
              submittedForApprovalBy: authUser.id,
              submittedForApprovalAt: now,
              updatedBy: authUser.id,
            },
          });

          await tx.materialOfficialQuoteAudit.create({
            data: buildMaterialMarketQuoteGovernanceAuditRecord({
              materialId,
              quoteId,
              action: "SUBMITTED",
              changedBy: authUser.id,
              changedAt: now,
            }),
          });

          await recordGovernanceAuditEvent(tx, {
            materialId,
            quoteId,
            action: "SUBMITTED",
            userId: authUser.id,
            userName: authUser.name,
          });

          return quote;
        });

        return res.json(serializeMaterialMarketQuoteForApi(updated));
      } catch (error) {
        console.error("POST submit-approval", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao enviar cotação para aprovação.",
        });
      }
    }
  );

  app.post(
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId/approve",
    requireAppAuth,
    approveQuotes,
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

        const ctx = await loadGovernanceContext(prisma, materialId, quoteId);
        if (!ctx?.material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const validated = validateApproveMaterialMarketQuote({
          materialId,
          quoteId,
          quotes: ctx.quotes,
        });
        if (validated.ok === false) {
          const status = validated.code === "QUOTE_NOT_FOUND" ? 404 : 400;
          return res.status(status).json({
            error: validated.code,
            message: validated.message,
          });
        }

        const now = new Date();
        const updated = await prisma.$transaction(async (tx) => {
          if (validated.plan.previousQuoteId) {
            await tx.materialMarketQuote.update({
              where: { id: validated.plan.previousQuoteId },
              data: {
                isOfficialReference: false,
                officialStatus: "REPLACED",
                updatedBy: authUser.id,
              },
            });
            await tx.materialOfficialQuoteAudit.create({
              data: buildMaterialMarketQuoteGovernanceAuditRecord({
                materialId,
                quoteId: validated.plan.previousQuoteId,
                action: "REPLACED",
                changedBy: authUser.id,
                changedAt: now,
                previousQuoteId: validated.plan.previousQuoteId,
                newQuoteId: quoteId,
              }),
            });
            await recordGovernanceAuditEvent(tx, {
              materialId,
              quoteId: validated.plan.previousQuoteId,
              action: "REPLACED",
              userId: authUser.id,
              userName: authUser.name,
              previousQuoteId: validated.plan.previousQuoteId,
              newQuoteId: quoteId,
            });
          }

          const quote = await tx.materialMarketQuote.update({
            where: { id: quoteId },
            data: {
              isOfficialReference: true,
              officialStatus: "OFFICIAL",
              approvedBy: authUser.id,
              approvedAt: now,
              setOfficialBy: authUser.id,
              setOfficialAt: now,
              updatedBy: authUser.id,
            },
          });

          await tx.materialOfficialQuoteAudit.create({
            data: buildMaterialMarketQuoteGovernanceAuditRecord({
              materialId,
              quoteId,
              action: "APPROVED",
              changedBy: authUser.id,
              changedAt: now,
              previousQuoteId: validated.plan.previousQuoteId,
              newQuoteId: quoteId,
            }),
          });

          await recordGovernanceAuditEvent(tx, {
            materialId,
            quoteId,
            action: "APPROVED",
            userId: authUser.id,
            userName: authUser.name,
            previousQuoteId: validated.plan.previousQuoteId,
            newQuoteId: quoteId,
          });

          await tx.materialOfficialQuoteAudit.create({
            data: buildMaterialMarketQuoteGovernanceAuditRecord({
              materialId,
              quoteId,
              action: "SET_OFFICIAL",
              changedBy: authUser.id,
              changedAt: now,
              previousQuoteId: validated.plan.previousQuoteId,
              newQuoteId: quoteId,
            }),
          });

          await recordGovernanceAuditEvent(tx, {
            materialId,
            quoteId,
            action: "SET_OFFICIAL",
            userId: authUser.id,
            userName: authUser.name,
            previousQuoteId: validated.plan.previousQuoteId,
            newQuoteId: quoteId,
          });

          return quote;
        });

        return res.json(serializeMaterialMarketQuoteForApi(updated));
      } catch (error) {
        console.error("POST approve", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao aprovar cotação.",
        });
      }
    }
  );

  app.post(
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId/reject",
    requireAppAuth,
    approveQuotes,
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

        const ctx = await loadGovernanceContext(prisma, materialId, quoteId);
        if (!ctx?.material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const body = req.body ?? {};
        const validated = validateRejectMaterialMarketQuote({
          materialId,
          quoteId,
          reason: body.reason,
          quotes: ctx.quotes,
        });
        if (validated.ok === false) {
          const status =
            validated.code === "QUOTE_NOT_FOUND"
              ? 404
              : validated.code === "REJECTION_REASON_REQUIRED"
                ? 400
                : 400;
          return res.status(status).json({
            error: validated.code,
            field: validated.field,
            message: validated.message,
          });
        }

        const now = new Date();
        const updated = await prisma.$transaction(async (tx) => {
          const quote = await tx.materialMarketQuote.update({
            where: { id: quoteId },
            data: {
              officialStatus: "REJECTED",
              rejectionReason: validated.reason,
              updatedBy: authUser.id,
            },
          });

          await tx.materialOfficialQuoteAudit.create({
            data: buildMaterialMarketQuoteGovernanceAuditRecord({
              materialId,
              quoteId,
              action: "REJECTED",
              changedBy: authUser.id,
              changedAt: now,
              rejectionReason: validated.reason,
            }),
          });

          await recordGovernanceAuditEvent(tx, {
            materialId,
            quoteId,
            action: "REJECTED",
            userId: authUser.id,
            userName: authUser.name,
            rejectionReason: validated.reason,
          });

          return quote;
        });

        return res.json(serializeMaterialMarketQuoteForApi(updated));
      } catch (error) {
        console.error("POST reject", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao rejeitar cotação.",
        });
      }
    }
  );

  app.post(
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId/set-official",
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

        const ctx = await loadGovernanceContext(prisma, materialId, quoteId);
        if (!ctx?.material) {
          return res.status(404).json({ error: "Material não encontrado." });
        }

        const validated = validateSetMaterialMarketQuoteOfficial({
          materialId,
          quoteId,
          marketCriticality: ctx.material.marketCriticality,
          quotes: ctx.quotes,
        });
        if (validated.ok === false) {
          const status = validated.code === "QUOTE_NOT_FOUND" ? 404 : 400;
          return res.status(status).json({
            error: validated.code,
            message: validated.message,
          });
        }

        const now = new Date();
        const updated = await prisma.$transaction(async (tx) => {
          if (validated.plan.previousQuoteId) {
            await tx.materialMarketQuote.update({
              where: { id: validated.plan.previousQuoteId },
              data: {
                isOfficialReference: false,
                officialStatus: "REPLACED",
                updatedBy: authUser.id,
              },
            });
            await tx.materialOfficialQuoteAudit.create({
              data: buildMaterialMarketQuoteGovernanceAuditRecord({
                materialId,
                quoteId: validated.plan.previousQuoteId,
                action: "REPLACED",
                changedBy: authUser.id,
                changedAt: now,
                previousQuoteId: validated.plan.previousQuoteId,
                newQuoteId: quoteId,
              }),
            });
            await recordGovernanceAuditEvent(tx, {
              materialId,
              quoteId: validated.plan.previousQuoteId,
              action: "REPLACED",
              userId: authUser.id,
              userName: authUser.name,
              previousQuoteId: validated.plan.previousQuoteId,
              newQuoteId: quoteId,
            });
          }

          const quote = await tx.materialMarketQuote.update({
            where: { id: quoteId },
            data: {
              isOfficialReference: true,
              officialStatus: "OFFICIAL",
              setOfficialBy: authUser.id,
              setOfficialAt: now,
              updatedBy: authUser.id,
            },
          });

          await tx.materialOfficialQuoteAudit.create({
            data: buildMaterialMarketQuoteGovernanceAuditRecord({
              materialId,
              quoteId,
              action: "SET_OFFICIAL",
              changedBy: authUser.id,
              changedAt: now,
              previousQuoteId: validated.plan.previousQuoteId,
              newQuoteId: quoteId,
              reason,
            }),
          });

          await recordGovernanceAuditEvent(tx, {
            materialId,
            quoteId,
            action: "SET_OFFICIAL",
            userId: authUser.id,
            userName: authUser.name,
            reason,
            previousQuoteId: validated.plan.previousQuoteId,
            newQuoteId: quoteId,
          });

          return quote;
        });

        return res.json({
          ...serializeMaterialMarketQuoteForApi(updated),
          officialQuote: buildMaterialOfficialQuoteSummary(updated),
          previousQuoteId: validated.plan.previousQuoteId,
        });
      } catch (error) {
        console.error("POST set-official", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao definir cotação oficial.",
        });
      }
    }
  );
}
