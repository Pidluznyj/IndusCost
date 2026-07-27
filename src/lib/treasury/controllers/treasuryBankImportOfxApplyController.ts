/**
 * Controllers HTTP — apply de importação OFX.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryBankImportOfxApplyInput } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryBankImportOfxApplyActor,
  createTreasuryBankImportOfxApplyService,
  type TreasuryBankImportOfxApplyService,
} from "../services/treasuryBankImportOfxApplyService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryBankImportOfxApplyControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryBankImportOfxApplyService;
};

export function createTreasuryBankImportOfxApplyControllers(
  deps: TreasuryBankImportOfxApplyControllerDeps
) {
  const service =
    deps.service ?? createTreasuryBankImportOfxApplyService({ prisma });

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
    apply: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const input = parseTreasuryBankImportOfxApplyInput(
          (req.body ?? {}) as Record<string, unknown>
        );
        const result = await service.apply(
          buildTreasuryBankImportOfxApplyActor(user, requestId),
          input
        );
        res.status(result.idempotent ? 200 : 201).json({
          ...result,
          requestId,
        });
      }),
  };
}
