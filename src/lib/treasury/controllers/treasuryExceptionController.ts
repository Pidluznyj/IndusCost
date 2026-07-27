/**
 * Controllers HTTP — Central de Exceções.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryExceptionAcknowledgeInput,
  parseTreasuryExceptionAssignInput,
  parseTreasuryExceptionCancelInput,
  parseTreasuryExceptionIgnoreInput,
  parseTreasuryExceptionResolveInput,
  parseTreasuryExceptionSetDueAtInput,
  parseTreasuryExceptionSetStatusInput,
  parseTreasuryExceptionsListQuery,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryExceptionActor,
  createTreasuryExceptionService,
  type TreasuryExceptionService,
} from "../services/treasuryExceptionService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryExceptionControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryExceptionService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

function asQuery(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export function createTreasuryExceptionControllers(
  deps: TreasuryExceptionControllerDeps
) {
  const service =
    deps.service ?? createTreasuryExceptionService({ prisma });

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
        const query = parseTreasuryExceptionsListQuery(asQuery(req));
        const payload = await service.list(
          buildTreasuryExceptionActor(user, requestId),
          query
        );
        res.status(200).json({ ok: true, ...payload, requestId });
      }),

    getById: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const exception = await service.getById(
          buildTreasuryExceptionActor(user, requestId),
          id
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    acknowledge: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionAcknowledgeInput(asBody(req));
        const exception = await service.acknowledge(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    assign: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionAssignInput(asBody(req));
        const exception = await service.assign(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    setDueAt: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionSetDueAtInput(asBody(req));
        const exception = await service.setDueAt(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    setStatus: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionSetStatusInput(asBody(req));
        const exception = await service.setStatus(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    resolve: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionResolveInput(asBody(req));
        const exception = await service.resolve(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    ignore: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionIgnoreInput(asBody(req));
        const exception = await service.ignore(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),

    cancel: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryExceptionCancelInput(asBody(req));
        const exception = await service.cancel(
          buildTreasuryExceptionActor(user, requestId),
          id,
          input
        );
        res.status(200).json({ ok: true, exception, requestId });
      }),
  };
}
