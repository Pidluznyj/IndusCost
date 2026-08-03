/**
 * Controllers HTTP — projeções e agenda da Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryAgendaQuery,
  parseTreasuryProjectionCalculateInput,
  parseTreasuryProjectionCompareQuery,
  parseTreasuryProjectionCompositionQuery,
  parseTreasuryProjectionGetQuery,
  parseTreasuryProjectionLatestQuery,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryProjectionApiActor,
  createTreasuryProjectionApiDeps,
  createTreasuryProjectionApiService,
  type TreasuryProjectionApiService,
} from "../services/treasuryProjectionApiService.server.js";
import { createTreasuryProjectionEngineInputLoaderFromPrisma } from "../services/treasuryProjectionEngineInputLoader.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryProjectionControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryProjectionApiService;
};

function resolveIdempotencyKey(req: Request): string | null {
  const header =
    req.header("idempotency-key") ?? req.header("Idempotency-Key") ?? null;
  return header?.trim() || null;
}

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

function asQuery(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export function createTreasuryProjectionControllers(
  deps: TreasuryProjectionControllerDeps
) {
  const service =
    deps.service ??
    createTreasuryProjectionApiService(
      createTreasuryProjectionApiDeps(prisma, {
        loadEngineInput:
          createTreasuryProjectionEngineInputLoaderFromPrisma(prisma),
      })
    );

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
    calculate: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const input = parseTreasuryProjectionCalculateInput(
          asBody(req),
          resolveIdempotencyKey(req)
        );
        const payload = await service.calculate(
          buildTreasuryProjectionApiActor(user, requestId),
          input
        );
        res.status(201).json({ ...payload, requestId });
      }),

    getLatest: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryProjectionLatestQuery(asQuery(req));
        const payload = await service.getLatest(
          buildTreasuryProjectionApiActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    getById: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "");
        const query = parseTreasuryProjectionGetQuery(asQuery(req));
        const payload = await service.getById(
          buildTreasuryProjectionApiActor(user, requestId),
          id,
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    getComposition: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "");
        const query = parseTreasuryProjectionCompositionQuery(asQuery(req));
        const payload = await service.getComposition(
          buildTreasuryProjectionApiActor(user, requestId),
          id,
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    getAgenda: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryAgendaQuery(asQuery(req));
        const payload = await service.getAgenda(
          buildTreasuryProjectionApiActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    compareScenarios: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryProjectionCompareQuery(asQuery(req));
        const payload = await service.compareScenarios(
          buildTreasuryProjectionApiActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
