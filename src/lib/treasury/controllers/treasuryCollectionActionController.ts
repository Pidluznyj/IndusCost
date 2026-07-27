import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryCollectionActionCancelInput,
  parseTreasuryCollectionActionCreateInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryCollectionActor,
  createTreasuryCollectionActionService,
  type TreasuryCollectionActionService,
} from "../services/treasuryCollectionActionService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryCollectionActionControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryCollectionActionService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryCollectionActionControllers(
  deps: TreasuryCollectionActionControllerDeps
) {
  const service =
    deps.service ?? createTreasuryCollectionActionService({ prisma });

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
    listByReceivable: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const actions = await service.listByReceivable(
          buildTreasuryCollectionActor(user, requestId),
          titleId
        );
        res.status(200).json({ ok: true, actions, requestId });
      }),

    createForReceivable: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const input = parseTreasuryCollectionActionCreateInput(asBody(req));
        const action = await service.createForReceivable(
          buildTreasuryCollectionActor(user, requestId),
          titleId,
          input
        );
        res.status(201).json({ ok: true, action, requestId });
      }),

    cancel: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const actionId = String(
          req.params.actionId ?? req.params.id ?? ""
        ).trim();
        const input = parseTreasuryCollectionActionCancelInput(asBody(req));
        const action = await service.cancel(
          buildTreasuryCollectionActor(user, requestId),
          actionId,
          input
        );
        res.status(200).json({ ok: true, action, requestId });
      }),
  };
}
