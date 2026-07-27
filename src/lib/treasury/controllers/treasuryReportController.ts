/**
 * Controllers HTTP — relatórios da Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryReportQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryReportActor,
  createTreasuryReportService,
  type TreasuryReportService,
} from "../services/treasuryReportService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryReportControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryReportService;
};

export function createTreasuryReportControllers(
  deps: TreasuryReportControllerDeps
) {
  const service =
    deps.service ?? createTreasuryReportService({ prisma });

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
    getReport: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryReportQuery(
          req.params.reportKey,
          req.query as Record<string, unknown>
        );
        const payload = await service.getReport(
          buildTreasuryReportActor(user, requestId),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),
  };
}
