/**
 * Controllers HTTP — consulta de lotes e movimentos bancários.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryBankImportsListQuery,
  parseTreasuryBankMovementsListQuery,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryBankMovementQueryActor,
  createTreasuryBankMovementQueryService,
  type TreasuryBankMovementQueryService,
} from "../services/treasuryBankMovementQueryService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryBankMovementQueryControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryBankMovementQueryService;
};

function asQuery(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export function createTreasuryBankMovementQueryControllers(
  deps: TreasuryBankMovementQueryControllerDeps
) {
  const service =
    deps.service ?? createTreasuryBankMovementQueryService({ prisma });

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
    listBatches: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryBankImportsListQuery(asQuery(req));
        const payload = await service.listBatches(
          buildTreasuryBankMovementQueryActor(user, requestId),
          query
        );
        res.status(200).json({ ok: true, ...payload, requestId });
      }),

    listMovements: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryBankMovementsListQuery(asQuery(req));
        const payload = await service.listMovements(
          buildTreasuryBankMovementQueryActor(user, requestId),
          query
        );
        res.status(200).json({ ok: true, ...payload, requestId });
      }),

    getMovement: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const movement = await service.getMovement(
          buildTreasuryBankMovementQueryActor(user, requestId),
          id
        );
        res.status(200).json({ ok: true, movement, requestId });
      }),
  };
}
