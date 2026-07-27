/**
 * Controllers HTTP — fechamento / reabertura / consulta.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryDailyClosingCloseInput,
  parseTreasuryDailyClosingListQuery,
  parseTreasuryDailyClosingReopenInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryDailyClosingActor,
  createTreasuryDailyClosingService,
  type TreasuryDailyClosingService,
} from "../services/treasuryDailyClosingService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryDailyClosingControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryDailyClosingService;
};

export function createTreasuryDailyClosingControllers(
  deps: TreasuryDailyClosingControllerDeps
) {
  const service =
    deps.service ?? createTreasuryDailyClosingService({ prisma });

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
    list: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryDailyClosingListQuery(
          req.query as Record<string, unknown>
        );
        const result = await service.list(
          buildTreasuryDailyClosingActor(user, requestId),
          query
        );
        res.status(200).json({ ok: true, ...result, requestId });
      }),

    getById: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const payload = await service.getById(
          buildTreasuryDailyClosingActor(user, requestId),
          id
        );
        res.status(200).json({ ok: true, closing: payload, requestId });
      }),

    close: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const input = parseTreasuryDailyClosingCloseInput(
          (req.body ?? {}) as Record<string, unknown>
        );
        const result = await service.close(
          buildTreasuryDailyClosingActor(user, requestId),
          input
        );
        res.status(201).json({ ok: true, ...result, requestId });
      }),

    reopen: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryDailyClosingReopenInput(
          (req.body ?? {}) as Record<string, unknown>
        );
        const result = await service.reopen(
          buildTreasuryDailyClosingActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, ...result, requestId });
      }),
  };
}
