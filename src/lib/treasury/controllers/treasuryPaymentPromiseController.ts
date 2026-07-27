/**
 * Controllers HTTP — promessas de pagamento (CR).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryPromiseCancelInput,
  parseTreasuryPromiseMarkFulfilledInput,
  parseTreasuryReceivablePromiseCreateInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryPaymentPromiseActor,
  createTreasuryPaymentPromiseService,
  type TreasuryPaymentPromiseService,
} from "../services/treasuryPaymentPromiseService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryPaymentPromiseControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryPaymentPromiseService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryPaymentPromiseControllers(
  deps: TreasuryPaymentPromiseControllerDeps
) {
  const service =
    deps.service ?? createTreasuryPaymentPromiseService({ prisma });

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
        const titleId = String(req.params.titleId ?? req.params.id ?? "").trim();
        const payload = await service.listByReceivable(
          buildTreasuryPaymentPromiseActor(user, requestId),
          titleId
        );
        res.status(200).json({ ok: true, ...payload, requestId });
      }),

    createForReceivable: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? req.params.id ?? "").trim();
        const input = parseTreasuryReceivablePromiseCreateInput(asBody(req));
        const result = await service.createForReceivable(
          buildTreasuryPaymentPromiseActor(user, requestId),
          titleId,
          input
        );
        res.status(201).json({
          ok: true,
          promise: result.promise,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    cancel: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const promiseId = String(
          req.params.promiseId ?? req.params.id ?? ""
        ).trim();
        const input = parseTreasuryPromiseCancelInput(asBody(req));
        const result = await service.cancel(
          buildTreasuryPaymentPromiseActor(user, requestId),
          promiseId,
          input
        );
        res.status(200).json({
          ok: true,
          promise: result.promise,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    markFulfilled: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const promiseId = String(
          req.params.promiseId ?? req.params.id ?? ""
        ).trim();
        const input = parseTreasuryPromiseMarkFulfilledInput(asBody(req));
        const result = await service.markFulfilled(
          buildTreasuryPaymentPromiseActor(user, requestId),
          promiseId,
          input
        );
        res.status(200).json({
          ok: true,
          promise: result.promise,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),
  };
}
