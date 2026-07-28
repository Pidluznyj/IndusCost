/**
 * Controllers HTTP — conciliação bancária (listagem ativa + reverse).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryReconciliationAcceptInput,
  parseTreasuryReconciliationReverseInput,
  parseTreasuryReconciliationUnmatchInput,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryReconciliationMatchActor,
  createTreasuryReconciliationMatchService,
  type TreasuryReconciliationMatchService,
} from "../services/treasuryReconciliationMatchService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryReconciliationMatchControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryReconciliationMatchService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryReconciliationMatchControllers(
  deps: TreasuryReconciliationMatchControllerDeps
) {
  const service =
    deps.service ?? createTreasuryReconciliationMatchService({ prisma });

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
    listByBankMovement: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const bankMovementId = String(
          req.query.bankMovementId ?? req.params.bankMovementId ?? ""
        ).trim();
        if (!bankMovementId) {
          sendTreasuryError(res, {
            requestId,
            error: "bankMovementId é obrigatório.",
            code: "VALIDATION_ERROR",
            field: "bankMovementId",
          });
          return;
        }
        const items = await service.listActiveByBankMovement(
          buildTreasuryReconciliationMatchActor(user, requestId),
          bankMovementId
        );
        res.status(200).json({ ok: true, items, requestId });
      }),

    getById: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const match = await service.getById(
          buildTreasuryReconciliationMatchActor(user, requestId),
          id
        );
        res.status(200).json({ ok: true, match, requestId });
      }),

    reverse: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryReconciliationReverseInput(asBody(req));
        const result = await service.reverse(
          buildTreasuryReconciliationMatchActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          match: result.match,
          projectionRecalc: result.projectionRecalc,
          postClosing: result.postClosing,
          requestId,
        });
      }),

    accept: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const input = parseTreasuryReconciliationAcceptInput(asBody(req));
        const result = await service.accept(
          buildTreasuryReconciliationMatchActor(user, requestId),
          input
        );
        res.status(201).json({
          ok: true,
          match: result.match,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    unmatch: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryReconciliationUnmatchInput(asBody(req));
        const result = await service.unmatch(
          buildTreasuryReconciliationMatchActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          match: result.match,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),
  };
}
