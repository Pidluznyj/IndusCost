/**
 * Controllers HTTP — consulta de Contas a Pagar Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryPayablesListQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryPayableQueryActor,
  createTreasuryPayableQueryService,
  type TreasuryPayableQueryService,
} from "../services/treasuryPayableQueryService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryPayableControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryPayableQueryService;
};

export function createTreasuryPayableControllers(
  deps: TreasuryPayableControllerDeps
) {
  const service =
    deps.service ?? createTreasuryPayableQueryService({ prisma });

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
    listPayables: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryPayablesListQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.listPayables(
          buildTreasuryPayableQueryActor(user),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    getPayable: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const payable = await service.getPayable(
          buildTreasuryPayableQueryActor(user),
          titleId
        );
        res.status(200).json({ ok: true, payable, requestId });
      }),
  };
}
