/**
 * Controllers HTTP — CR/CP do Fluxo Gerencial agrupados por conta.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  createTreasuryPredictiveCrCpByAccountService,
  type TreasuryPredictiveCrCpByAccountService,
} from "../services/treasuryPredictiveCrCpByAccountService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryPredictiveCrCpByAccountControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryPredictiveCrCpByAccountService;
};

function asQuery(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

function readCivilDate(value: unknown, field: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  void field;
  return trimmed;
}

export function createTreasuryPredictiveCrCpByAccountControllers(
  deps: TreasuryPredictiveCrCpByAccountControllerDeps
) {
  const service =
    deps.service ?? createTreasuryPredictiveCrCpByAccountService({ prisma });

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
      handleTreasuryRouteError(res, err, requestId);
    }
  }

  return {
    getBoard: (req: Request, res: Response) =>
      withAuth(req, res, async (_user, requestId) => {
        const q = asQuery(req);
        const companyCode =
          typeof q.companyCode === "string" ? q.companyCode.trim() : "";
        const fromDate = readCivilDate(q.fromDate ?? q.baseDate, "fromDate");
        const toDate = readCivilDate(q.toDate ?? q.endDate, "toDate");
        if (!companyCode) {
          sendTreasuryError(res, {
            requestId,
            error: "companyCode é obrigatório.",
            code: "VALIDATION_ERROR",
            field: "companyCode",
          });
          return;
        }
        if (!fromDate || !toDate) {
          sendTreasuryError(res, {
            requestId,
            error: "fromDate e toDate (YYYY-MM-DD) são obrigatórios.",
            code: "VALIDATION_ERROR",
            field: "fromDate",
          });
          return;
        }
        if (fromDate > toDate) {
          sendTreasuryError(res, {
            requestId,
            error: "fromDate não pode ser posterior a toDate.",
            code: "VALIDATION_ERROR",
            field: "fromDate",
          });
          return;
        }
        const board = await service.getBoard({
          companyCode,
          fromDate,
          toDate,
        });
        res.status(200).json({ ...board, requestId });
      }),
  };
}
