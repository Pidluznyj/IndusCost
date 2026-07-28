/**
 * Controllers HTTP — configuração de alertas da Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildTreasuryAlertSettingsActor,
  createTreasuryAlertSettingsService,
  type TreasuryAlertSettingsService,
} from "../services/treasuryAlertSettingsService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryAlertSettingsControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryAlertSettingsService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryAlertSettingsControllers(
  deps: TreasuryAlertSettingsControllerDeps
) {
  const service =
    deps.service ?? createTreasuryAlertSettingsService({ prisma });

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
    get: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const settings = await service.get(
          buildTreasuryAlertSettingsActor(user, { requestId })
        );
        res.status(200).json({ ok: true, settings, requestId });
      }),

    put: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const settings = await service.update(
          buildTreasuryAlertSettingsActor(user, { requestId }),
          asBody(req)
        );
        res.status(200).json({ ok: true, settings, requestId });
      }),
  };
}
