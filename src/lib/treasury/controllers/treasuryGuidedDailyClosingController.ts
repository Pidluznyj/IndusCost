/**
 * Controllers HTTP — saldos finais guiados do dia.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryGuidedDailyClosingQuery,
  parseTreasuryGuidedDailyClosingSaveInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryGuidedDailyClosingActor,
  createTreasuryGuidedDailyClosingService,
  type TreasuryGuidedDailyClosingService,
} from "../services/treasuryGuidedDailyClosingService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryGuidedDailyClosingControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryGuidedDailyClosingService;
};

export function createTreasuryGuidedDailyClosingControllers(
  deps: TreasuryGuidedDailyClosingControllerDeps
) {
  const service =
    deps.service ?? createTreasuryGuidedDailyClosingService({ prisma });

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
    getWorkspace: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryGuidedDailyClosingQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.getWorkspace(
          buildTreasuryGuidedDailyClosingActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    saveFinalBalances: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const body =
          req.body && typeof req.body === "object"
            ? (req.body as Record<string, unknown>)
            : {};
        const input = parseTreasuryGuidedDailyClosingSaveInput(body);
        const payload = await service.saveFinalBalances(
          buildTreasuryGuidedDailyClosingActor(user, requestId),
          input
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
