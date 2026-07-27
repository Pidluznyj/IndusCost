/**
 * Controllers HTTP — consulta CR Tesouraria (oficial + complemento).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryReceivablesListQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryReceivableQueryActor,
  createTreasuryReceivableQueryService,
  type TreasuryReceivableQueryService,
} from "../services/treasuryReceivableQueryService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryReceivableControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryReceivableQueryService;
};

export function createTreasuryReceivableControllers(
  deps: TreasuryReceivableControllerDeps
) {
  const service =
    deps.service ?? createTreasuryReceivableQueryService({ prisma });

  async function withAuth(
    req: Request,
    res: Response,
    fn: (
      actor: ReturnType<typeof buildTreasuryReceivableQueryActor>,
      requestId: string
    ) => Promise<void>
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
      await fn(buildTreasuryReceivableQueryActor(user), requestId);
    } catch (err) {
      handleTreasuryRouteError(res, requestId, err);
    }
  }

  return {
    listReceivables: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const query = parseTreasuryReceivablesListQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.listReceivables(actor, query);
        res.status(200).json({ ...payload, requestId });
      }),

    getReceivable: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const receivable = await service.getReceivable(actor, titleId);
        res.status(200).json({ ok: true, receivable, requestId });
      }),
  };
}
