/**
 * Controller HTTP — leitura leve do saldo do dia de UMA conta.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryAccountDailyBalanceQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryAccountDailyBalanceActor,
  createTreasuryAccountDailyBalanceService,
  type TreasuryAccountDailyBalanceService,
} from "../services/treasuryAccountDailyBalanceService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryAccountDailyBalanceControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryAccountDailyBalanceService;
};

export function createTreasuryAccountDailyBalanceControllers(
  deps: TreasuryAccountDailyBalanceControllerDeps
) {
  const service =
    deps.service ?? createTreasuryAccountDailyBalanceService({ prisma });

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
    getDailyBalance: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const accountId = String(req.params.id ?? "").trim();
        const query = parseTreasuryAccountDailyBalanceQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.getDailyBalance(
          buildTreasuryAccountDailyBalanceActor(user, requestId),
          accountId,
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
