/**
 * Controllers HTTP — contas financeiras da Tesouraria.
 * Retorna DTOs (nunca entidades Prisma).
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryAccountsListQuery,
  parseTreasuryCreateAccountInput,
  parseTreasuryDeactivateAccountInput,
  parseTreasuryPutAccountAccessInput,
  parseTreasuryReactivateAccountInput,
  parseTreasuryUpdateAccountInput,
} from "../contracts/treasurySchemas.js";
import type { TreasuryAccountActor } from "../domain/treasuryAccountRules.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  createTreasuryAccountService,
  type TreasuryAccountService,
} from "../services/treasuryAccountService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryAccountControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryAccountService;
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

export function createTreasuryAccountControllers(
  deps: TreasuryAccountControllerDeps
) {
  const service =
    deps.service ?? createTreasuryAccountService({ prisma });

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
    listAccounts: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const query = parseTreasuryAccountsListQuery(asQuery(req));
        const payload = await service.listAccessibleAccounts(actor, query);
        res.status(200).json({ ...payload, requestId });
      }),

    getAccount: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const account = await service.getAccount(actor, id);
        res.status(200).json({ ok: true, account, requestId });
      }),

    createAccount: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const input = parseTreasuryCreateAccountInput(asBody(req));
        const account = await service.createAccount(actor, input);
        res.status(201).json({ ok: true, account, requestId });
      }),

    updateAccount: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryUpdateAccountInput(asBody(req));
        const account = await service.updateAccount(actor, id, input);
        res.status(200).json({ ok: true, account, requestId });
      }),

    deactivateAccount: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryDeactivateAccountInput(asBody(req));
        const account = await service.deactivateAccount(actor, id, input);
        res.status(200).json({ ok: true, account, requestId });
      }),

    reactivateAccount: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryReactivateAccountInput(asBody(req));
        const account = await service.reactivateAccount(actor, id, input);
        res.status(200).json({ ok: true, account, requestId });
      }),

    listAccountAccess: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const access = await service.listAccountAccess(actor, id);
        res.status(200).json({ ok: true, access, requestId });
      }),

    putAccountAccess: (req: Request, res: Response) =>
      withAuth(req, res, async (actor, requestId) => {
        const id = String(req.params.id ?? "").trim();
        const input = parseTreasuryPutAccountAccessInput(asBody(req));
        const access = await service.grantAccountAccess(actor, id, input);
        res.status(200).json({ ok: true, access, requestId });
      }),
  };
}
