/**
 * Controllers HTTP — transferências internas.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryTransferCancelInput,
  parseTreasuryTransferCreateInput,
  parseTreasuryTransferTransitionInput,
  parseTreasuryTransfersListQuery,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryTransferActor,
  createTreasuryTransferService,
  type TreasuryTransferService,
} from "../services/treasuryTransferService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryTransferControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryTransferService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

function asQuery(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export function createTreasuryTransferControllers(
  deps: TreasuryTransferControllerDeps
) {
  const service =
    deps.service ?? createTreasuryTransferService({ prisma });

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
        const query = parseTreasuryTransfersListQuery(asQuery(req));
        const payload = await service.list(
          buildTreasuryTransferActor(user, requestId),
          query
        );
        res.status(200).json({ ok: true, ...payload, requestId });
      }),

    getById: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const transfer = await service.getById(
          buildTreasuryTransferActor(user, requestId),
          id
        );
        res.status(200).json({ ok: true, transfer, requestId });
      }),

    create: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const input = parseTreasuryTransferCreateInput(asBody(req));
        const result = await service.create(
          buildTreasuryTransferActor(user, requestId),
          input
        );
        res.status(201).json({
          ok: true,
          transfer: result.transfer,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    schedule: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryTransferTransitionInput(asBody(req));
        const result = await service.schedule(
          buildTreasuryTransferActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          transfer: result.transfer,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    send: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryTransferTransitionInput(asBody(req));
        const result = await service.send(
          buildTreasuryTransferActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          transfer: result.transfer,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    receive: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryTransferTransitionInput(asBody(req));
        const result = await service.receive(
          buildTreasuryTransferActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          transfer: result.transfer,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    reconcile: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryTransferTransitionInput(asBody(req));
        const result = await service.reconcile(
          buildTreasuryTransferActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          transfer: result.transfer,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    cancel: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryTransferCancelInput(asBody(req));
        const result = await service.cancel(
          buildTreasuryTransferActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          transfer: result.transfer,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),
  };
}
