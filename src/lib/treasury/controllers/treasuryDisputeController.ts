import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryDisputeCreateInput,
  parseTreasuryDisputeUpdateStatusInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryDisputeActor,
  createTreasuryDisputeService,
  type TreasuryDisputeService,
} from "../services/treasuryDisputeService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryDisputeControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryDisputeService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryDisputeControllers(
  deps: TreasuryDisputeControllerDeps
) {
  const service = deps.service ?? createTreasuryDisputeService({ prisma });

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
        const disputes = await service.listByReceivable(
          buildTreasuryDisputeActor(user, requestId),
          titleId
        );
        res.status(200).json({ ok: true, disputes, requestId });
      }),

    createForReceivable: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const input = parseTreasuryDisputeCreateInput(asBody(req));
        const dispute = await service.createForReceivable(
          buildTreasuryDisputeActor(user, requestId),
          titleId,
          input
        );
        res.status(201).json({ ok: true, dispute, requestId });
      }),

    updateStatus: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const disputeId = String(
          req.params.disputeId ?? req.params.id ?? ""
        ).trim();
        const input = parseTreasuryDisputeUpdateStatusInput(asBody(req));
        const dispute = await service.updateStatus(
          buildTreasuryDisputeActor(user, requestId),
          disputeId,
          input
        );
        res.status(200).json({ ok: true, dispute, requestId });
      }),
  };
}
