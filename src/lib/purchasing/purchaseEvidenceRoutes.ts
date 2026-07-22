/**
 * Rotas de evidências de Compras SC (OP-17).
 * Reutiliza multer + appLocalFileStorage.
 */
import type express from "express";
import type { RequestHandler } from "express";
import multer from "multer";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import {
  downloadPurchaseEvidence,
  listPurchaseEvidences,
  mapEvidenceError,
  softDeletePurchaseEvidence,
  uploadPurchaseEvidence,
} from "@/src/lib/purchasing/purchaseEvidenceService.server.js";
import {
  isPurchaseEvidenceEntityType,
  PURCHASE_EVIDENCE_MAX_BYTES,
} from "@/src/lib/purchasing/purchaseEvidenceRules.js";
import { markOfferAsWinner } from "@/src/lib/purchasing/negotiationRoundService.server.js";
import { mapNegotiationError } from "@/src/lib/purchasing/negotiationRoundService.server.js";
import {
  resolveEvidenceExceptionPermission,
  safePurchasingLogError,
} from "@/src/lib/purchasing/purchasingSecurity.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{
    id: string;
    name?: string | null;
    email?: string | null;
    effectivePermissions?: string[];
    permissions?: string[];
  } | null>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PURCHASE_EVIDENCE_MAX_BYTES },
});

export function registerPurchaseEvidenceRoutes(app: express.Express, auth: AuthGuards) {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;
  const update = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;

  async function actorFromReq(req: express.Request) {
    const user = await auth.getCurrentAppUser(req);
    if (!user) return null;
    return { userId: user.id, userName: user.name ?? user.email ?? null };
  }

  app.get("/api/purchase-evidences", ...view, async (req, res) => {
    try {
      const entityType = String(req.query.entityType ?? "");
      const entityId = String(req.query.entityId ?? "");
      if (!isPurchaseEvidenceEntityType(entityType) || !isUuid(entityId)) {
        return res.status(400).json({ error: "entityType/entityId inválidos." });
      }
      const includeDeleted = String(req.query.includeDeleted ?? "") === "1";
      // Histórico soft-deleted exige update (dados comerciais sensíveis).
      if (includeDeleted) {
        // re-check via update gate: viewer puro não lista excluídos
        const user = await auth.getCurrentAppUser(req);
        const perms = user?.effectivePermissions ?? user?.permissions ?? [];
        const canSeeDeleted =
          perms.includes("purchases.edit") ||
          perms.includes("operations.purchases.update") ||
          perms.includes("purchases.approve") ||
          perms.includes("operations.purchases.approve");
        if (!canSeeDeleted) {
          return res.status(403).json({
            error: "Sem permissão para listar evidências excluídas.",
            code: "FORBIDDEN_INCLUDE_DELETED",
          });
        }
      }
      const rows = await listPurchaseEvidences(prisma, entityType, entityId, { includeDeleted });
      res.json({ rows });
    } catch (e) {
      const mapped = mapEvidenceError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-evidences", ...update, upload.single("file"), async (req, res) => {
    try {
      const entityType = String(req.body?.entityType ?? "");
      const entityId = String(req.body?.entityId ?? "");
      if (!isPurchaseEvidenceEntityType(entityType) || !isUuid(entityId)) {
        return res.status(400).json({ error: "entityType/entityId inválidos." });
      }
      const file = req.file;
      if (!file?.buffer?.length) return res.status(400).json({ error: "Arquivo obrigatório." });
      const actor = await actorFromReq(req);
      const evidence = await uploadPurchaseEvidence(prisma, {
        entityType,
        entityId,
        buffer: file.buffer,
        originalName: file.originalname || "anexo",
        mimeType: file.mimetype || "application/octet-stream",
        description: req.body?.description ?? null,
        notes: req.body?.notes ?? null,
        evidenceType: req.body?.evidenceType ?? null,
        replacesId: req.body?.replacesId && isUuid(String(req.body.replacesId))
          ? String(req.body.replacesId)
          : null,
        actor,
      });
      res.status(201).json({ evidence });
    } catch (e) {
      const mapped = mapEvidenceError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/api/purchase-evidences/:evidenceId/download", ...view, async (req, res) => {
    try {
      const { evidenceId } = req.params;
      if (!isUuid(evidenceId)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      const { evidence, buffer } = await downloadPurchaseEvidence(prisma, evidenceId, actor);
      res.setHeader("Content-Type", evidence.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(evidence.originalFileName)}"`
      );
      res.send(buffer);
    } catch (e) {
      const mapped = mapEvidenceError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-evidences/:evidenceId/soft-delete", ...update, async (req, res) => {
    try {
      const { evidenceId } = req.params;
      if (!isUuid(evidenceId)) return res.status(400).json({ error: "ID inválido." });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "Motivo obrigatório.", code: "DELETE_REASON_REQUIRED" });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const evidence = await softDeletePurchaseEvidence(prisma, evidenceId, actor, reason);
      res.json({ evidence });
    } catch (e) {
      const mapped = mapEvidenceError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post(
    "/api/purchase-quotations/:id/offers/:offerId/mark-winner",
    ...update,
    async (req, res) => {
      try {
        const { id, offerId } = req.params;
        if (!isUuid(id) || !isUuid(offerId)) return res.status(400).json({ error: "ID inválido." });
        const user = await auth.getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Autenticação necessária." });
        const actor = { userId: user.id, userName: user.name ?? user.email ?? null };
        const row = await markOfferAsWinner(prisma, id, offerId, actor, {
          buyerReport: String(req.body?.buyerReport ?? ""),
          selectionJustification: req.body?.selectionJustification ?? null,
          autoPickByLowestPrice: Boolean(req.body?.autoPickByLowestPrice),
          exceptionJustification: req.body?.exceptionJustification ?? null,
          // Nunca confiar em body.useException — só approve real (OP-27).
          hasExceptionPermission: resolveEvidenceExceptionPermission({
            effectivePermissions: user.effectivePermissions ?? user.permissions ?? [],
            clientClaimedUseException: Boolean(req.body?.useException),
          }),
        });
        res.json(row);
      } catch (e) {
        safePurchasingLogError("mark-winner", e);
        const mapped = mapNegotiationError(e);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );
}
