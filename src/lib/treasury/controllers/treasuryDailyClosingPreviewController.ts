/**
 * Controllers HTTP — preview do fechamento diário.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryDailyClosingPreviewQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryDailyClosingPreviewActor,
  createTreasuryDailyClosingPreviewService,
  type TreasuryDailyClosingPreviewService,
} from "../services/treasuryDailyClosingPreviewService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryDailyClosingPreviewControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryDailyClosingPreviewService;
};

export function createTreasuryDailyClosingPreviewControllers(
  deps: TreasuryDailyClosingPreviewControllerDeps
) {
  const service =
    deps.service ??
    createTreasuryDailyClosingPreviewService({ prisma });

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
    getPreview: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryDailyClosingPreviewQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.getPreview(
          buildTreasuryDailyClosingPreviewActor(user),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
