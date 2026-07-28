/**
 * Controllers HTTP — lançamentos manuais (ledger local).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryManualLedgerEntryInput,
  parseTreasuryManualLedgerReverseInput,
} from "../contracts/treasurySchemas.js";
import { parseTreasuryPagination } from "../contracts/treasuryPagination.js";
import {
  buildTreasuryManualLedgerActor,
  createTreasuryManualLedgerService,
  type TreasuryManualLedgerService,
} from "../services/treasuryManualLedgerService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryManualLedgerControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryManualLedgerService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryManualLedgerControllers(
  deps: TreasuryManualLedgerControllerDeps
) {
  const service =
    deps.service ?? createTreasuryManualLedgerService({ prisma });

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
        const q = req.query as Record<string, unknown>;
        const pagination = parseTreasuryPagination(q);
        const statusRaw = String(q.status ?? "").trim().toUpperCase();
        const status =
          statusRaw === "ACTIVE" || statusRaw === "REVERSED"
            ? statusRaw
            : null;
        const payload = await service.list(
          buildTreasuryManualLedgerActor(user, requestId),
          {
            companyCode: q.companyCode
              ? String(q.companyCode).trim()
              : null,
            accountId: q.accountId ? String(q.accountId).trim() : null,
            status,
            from: q.from ? String(q.from).trim() : null,
            to: q.to ? String(q.to).trim() : null,
            page: pagination.page,
            pageSize: pagination.pageSize,
          }
        );
        res.status(200).json({ ok: true, ...payload, requestId });
      }),

    getById: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const entry = await service.getById(
          buildTreasuryManualLedgerActor(user, requestId),
          id
        );
        res.status(200).json({ ok: true, entry, requestId });
      }),

    create: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const input = parseTreasuryManualLedgerEntryInput(asBody(req));
        const result = await service.create(
          buildTreasuryManualLedgerActor(user, requestId),
          input
        );
        res.status(201).json({
          ok: true,
          entry: result.entry,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    reverse: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryManualLedgerReverseInput(asBody(req));
        const result = await service.reverse(
          buildTreasuryManualLedgerActor(user, requestId),
          id,
          input
        );
        res.status(200).json({
          ok: true,
          entry: result.entry,
          reversal: result.reversal,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),
  };
}
