/**
 * Controllers HTTP — snapshots de saldo da Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryBalancesListQuery,
  parseTreasuryCreateBalanceSnapshotInput,
} from "../contracts/treasurySchemas.js";
import type { TreasuryAccountActor } from "../domain/treasuryAccountRules.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  createTreasuryBalanceService,
  type TreasuryBalanceService,
} from "../services/treasuryBalanceService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryBalanceControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryBalanceService;
};

function buildActor(
  user: AppAuthContext,
  requestId: string
): TreasuryAccountActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
    canManageBalances: canTreasuryCapability(user, "manageBalances"),
  };
}

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

function asQuery(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

function resolveIdempotencyKey(req: Request): string | null {
  const header =
    req.header("idempotency-key") ??
    req.header("Idempotency-Key") ??
    null;
  return header?.trim() || null;
}

export function createTreasuryBalanceControllers(
  deps: TreasuryBalanceControllerDeps
) {
  const service =
    deps.service ?? createTreasuryBalanceService({ prisma });

  async function withAuth(
    req: Request,
    res: Response,
    fn: (actor: TreasuryAccountActor, requestId: string) => Promise<void>
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
      await fn(buildActor(user, requestId), requestId);
    } catch (err) {
      handleTreasuryRouteError(res, requestId, err);
    }
  }

  return {
    listBalances: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const query = parseTreasuryBalancesListQuery(asQuery(req));
        const payload = await service.listBalances(actor, id, query);
        res.status(200).json({ ...payload, requestId });
      }),

    getLatestBalance: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const snapshot = await service.getLatestBalance(actor, id);
        res.status(200).json({ ok: true, snapshot, requestId });
      }),

    createBalanceSnapshot: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryCreateBalanceSnapshotInput(
          asBody(req),
          resolveIdempotencyKey(req)
        );
        const result = await service.createBalanceSnapshot(actor, id, input);
        res.status(result.created ? 201 : 200).json({
          ok: true,
          created: result.created,
          snapshot: result.snapshot,
          requestId,
        });
      }),
  };
}
