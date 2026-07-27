/**
 * Controllers HTTP — programação de pagamentos (CP).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryPayableProgramPaymentCancelInput,
  parseTreasuryPayableProgramPaymentInput,
  parseTreasuryPayableProgramPaymentUpdateInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryPayableProgrammingActor,
  createTreasuryPayableProgrammingService,
  type TreasuryPayableProgrammingService,
} from "../services/treasuryPayableProgrammingService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryPayableProgrammingControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryPayableProgrammingService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryPayableProgrammingControllers(
  deps: TreasuryPayableProgrammingControllerDeps
) {
  const service =
    deps.service ?? createTreasuryPayableProgrammingService({ prisma });

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
    programPayment: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const input = parseTreasuryPayableProgramPaymentInput(asBody(req));
        const result = await service.programPayment(
          buildTreasuryPayableProgrammingActor(user, requestId),
          titleId,
          input
        );
        res.status(201).json({
          ok: true,
          payable: result.payable,
          programming: result.programming,
          impact: result.impact,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    updateProgramPayment: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const input = parseTreasuryPayableProgramPaymentUpdateInput(asBody(req));
        const result = await service.updateProgramPayment(
          buildTreasuryPayableProgrammingActor(user, requestId),
          titleId,
          input
        );
        res.status(200).json({
          ok: true,
          payable: result.payable,
          programming: result.programming,
          impact: result.impact,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    cancelProgramPayment: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const input = parseTreasuryPayableProgramPaymentCancelInput(asBody(req));
        const result = await service.cancelProgramPayment(
          buildTreasuryPayableProgrammingActor(user, requestId),
          titleId,
          input
        );
        res.status(200).json({
          ok: true,
          payable: result.payable,
          impact: result.impact,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),
  };
}
