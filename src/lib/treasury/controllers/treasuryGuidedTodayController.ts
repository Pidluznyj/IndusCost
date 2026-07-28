/**
 * Controllers HTTP — Tesouraria de hoje (agregado).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryDashboardQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryGuidedTodayActor,
  createTreasuryGuidedTodayService,
  type TreasuryGuidedTodayService,
} from "../services/treasuryGuidedTodayService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryGuidedTodayControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryGuidedTodayService;
};

export function createTreasuryGuidedTodayControllers(
  deps: TreasuryGuidedTodayControllerDeps
) {
  const service =
    deps.service ?? createTreasuryGuidedTodayService({ prisma });

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
    getToday: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryDashboardQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.getToday(
          buildTreasuryGuidedTodayActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
