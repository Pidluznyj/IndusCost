/**
 * Controllers HTTP — saldos iniciais guiados do dia.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryGuidedDailyOpeningQuery,
  parseTreasuryGuidedDailyOpeningSaveInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryGuidedDailyOpeningActor,
  createTreasuryGuidedDailyOpeningService,
  type TreasuryGuidedDailyOpeningService,
} from "../services/treasuryGuidedDailyOpeningService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryGuidedDailyOpeningControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryGuidedDailyOpeningService;
};

export function createTreasuryGuidedDailyOpeningControllers(
  deps: TreasuryGuidedDailyOpeningControllerDeps
) {
  const service =
    deps.service ?? createTreasuryGuidedDailyOpeningService({ prisma });

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
        const query = parseTreasuryGuidedDailyOpeningQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.getWorkspace(
          buildTreasuryGuidedDailyOpeningActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    saveOpenings: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const body =
          req.body && typeof req.body === "object"
            ? (req.body as Record<string, unknown>)
            : {};
        const input = parseTreasuryGuidedDailyOpeningSaveInput(body);
        const payload = await service.saveOpenings(
          buildTreasuryGuidedDailyOpeningActor(user, requestId),
          input
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
