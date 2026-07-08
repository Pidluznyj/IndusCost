import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import multer from "multer";
import {
  deleteMaterialMarketQuoteAttachment,
  listMaterialMarketQuoteAttachments,
  readMaterialMarketQuoteAttachmentFile,
  uploadMaterialMarketQuoteAttachment,
} from "./materialMarketQuoteAttachment.server.js";
import { MaterialMarketQuoteAttachmentError } from "./materialMarketQuoteAttachment.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{ id: string } | null>;
  hasPermission: (user: { id: string }, permission: string) => boolean;
};

type RouteDeps = { prisma: PrismaClient; isUuid: (value: unknown) => value is string };

const quoteAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function handleAttachmentRouteError(res: express.Response, error: unknown, label: string): void {
  if (error instanceof MaterialMarketQuoteAttachmentError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Erro inesperado.";
  console.error(label, error);
  res.status(500).json({ error: "ATTACHMENT_INTERNAL_ERROR", message });
}

function parseQuoteScope(req: express.Request, deps: RouteDeps) {
  const { materialId, quoteId } = req.params;
  if (!deps.isUuid(materialId)) {
    return { ok: false as const, status: 400, message: "ID de material inválido." };
  }
  if (!deps.isUuid(quoteId)) {
    return { ok: false as const, status: 400, message: "ID de cotação inválido." };
  }
  return { ok: true as const, materialId, quoteId };
}

export function registerMaterialMarketQuoteAttachmentRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requirePermission, getCurrentAppUser, hasPermission } = guards;
  const base =
    "/api/materials/market-intelligence/:materialId/quotes/:quoteId/attachments";

  app.get(base, requireAppAuth, requirePermission("materials.view"), async (req, res) => {
    try {
      const scope = parseQuoteScope(req, deps);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: "INVALID_ID", message: scope.message });
      }
      const payload = await listMaterialMarketQuoteAttachments(deps.prisma, {
        materialId: scope.materialId,
        quoteId: scope.quoteId,
      });
      return res.json(payload);
    } catch (error) {
      handleAttachmentRouteError(res, error, `GET ${base}`);
    }
  });

  app.post(
    base,
    requireAppAuth,
    requirePermission("materials.edit"),
    quoteAttachmentUpload.single("file"),
    async (req, res) => {
      try {
        const scope = parseQuoteScope(req, deps);
        if (!scope.ok) {
          return res.status(scope.status).json({ error: "INVALID_ID", message: scope.message });
        }

        const file = req.file;
        if (!file) {
          return res.status(400).json({
            error: "ATTACHMENT_FILE_REQUIRED",
            message: "Selecione um arquivo para enviar.",
          });
        }

        const authUser = await getCurrentAppUser(req);
        const body = req.body ?? {};
        const notes = typeof body.notes === "string" ? body.notes : null;

        const created = await uploadMaterialMarketQuoteAttachment(
          deps.prisma,
          { materialId: scope.materialId, quoteId: scope.quoteId },
          {
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            notes,
            attachmentType: body.attachmentType,
            userId: authUser?.id ?? null,
          }
        );

        return res.status(201).json(created);
      } catch (error) {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error: "ATTACHMENT_FILE_TOO_LARGE",
            message: "Arquivo muito grande. O limite é 20 MB.",
          });
        }
        handleAttachmentRouteError(res, error, `POST ${base}`);
      }
    }
  );

  app.get(
    `${base}/:attachmentId/download`,
    requireAppAuth,
    requirePermission("materials.view"),
    async (req, res) => {
      try {
        const scope = parseQuoteScope(req, deps);
        if (!scope.ok) {
          return res.status(scope.status).json({ error: "INVALID_ID", message: scope.message });
        }
        const { attachmentId } = req.params;
        if (!deps.isUuid(attachmentId)) {
          return res.status(400).json({ error: "INVALID_ID", message: "ID de anexo inválido." });
        }

        const file = await readMaterialMarketQuoteAttachmentFile(deps.prisma, {
          materialId: scope.materialId,
          quoteId: scope.quoteId,
          attachmentId,
        });

        res.setHeader("Content-Type", file.mimeType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(file.originalFileName)}"`
        );
        return res.send(file.buffer);
      } catch (error) {
        handleAttachmentRouteError(res, error, `GET ${base}/:attachmentId/download`);
      }
    }
  );

  app.delete(`${base}/:attachmentId`, requireAppAuth, async (req, res) => {
    try {
      const scope = parseQuoteScope(req, deps);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: "INVALID_ID", message: scope.message });
      }
      const { attachmentId } = req.params;
      if (!deps.isUuid(attachmentId)) {
        return res.status(400).json({ error: "INVALID_ID", message: "ID de anexo inválido." });
      }

      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }

      const canEdit = hasPermission(authUser, "materials.edit");
      if (!canEdit && !hasPermission(authUser, "materials.view")) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Você não tem permissão para acessar anexos.",
        });
      }

      await deleteMaterialMarketQuoteAttachment(
        deps.prisma,
        { materialId: scope.materialId, quoteId: scope.quoteId, attachmentId },
        { userId: authUser.id, canEdit }
      );

      return res.json({ ok: true });
    } catch (error) {
      handleAttachmentRouteError(res, error, `DELETE ${base}/:attachmentId`);
    }
  });
}
