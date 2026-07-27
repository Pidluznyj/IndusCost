/**
 * Controllers HTTP — preview de importação OFX.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildTreasuryBankImportOfxPreviewActor,
  createTreasuryBankImportOfxPreviewService,
  type TreasuryBankImportOfxPreviewService,
} from "../services/treasuryBankImportOfxPreviewService.server.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryBankImportOfxPreviewControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryBankImportOfxPreviewService;
};

type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

function readUploadedFile(req: Request): UploadedFile | null {
  const file = (req as Request & { file?: UploadedFile }).file;
  if (!file?.buffer) return null;
  return file;
}

export function createTreasuryBankImportOfxPreviewControllers(
  deps: TreasuryBankImportOfxPreviewControllerDeps
) {
  const service =
    deps.service ??
    createTreasuryBankImportOfxPreviewService({ prisma });

  async function withAuth(
    req: Request,
    res: Response,
    fn: (user: AppAuthContext, requestId: string) => Promise<void>
  ): Promise<void> {
    const requestId = resolveTreasuryRequestId(req);
    res.setHeader("x-request-id", requestId);
    try {
      const user = await deps.getCurrentAppUser(req);
      if (!user) {
        sendTreasuryError(res, {
          requestId,
          error: "Autenticação necessária.",
          code: "UNAUTHORIZED",
        });
        return;
      }
      await fn(user, requestId);
    } catch (err) {
      handleTreasuryRouteError(res, requestId, err);
    }
  }

  return {
    preview: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const file = readUploadedFile(req);
        if (!file) {
          throw new TreasuryDomainError(
            "REQUIRED_FIELD",
            "Arquivo OFX não enviado.",
            "file"
          );
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const accountId = String(body.accountId ?? "").trim();
        const result = await service.preview(
          buildTreasuryBankImportOfxPreviewActor(user, requestId),
          {
            accountId,
            buffer: file.buffer,
            originalName: file.originalname || "upload.ofx",
            mimeType: file.mimetype || "application/octet-stream",
          }
        );
        res.status(200).json({ ...result, requestId });
      }),
  };
}
