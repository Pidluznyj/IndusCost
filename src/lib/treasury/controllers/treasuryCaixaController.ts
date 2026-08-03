/**
 * Controller HTTP — aba "Caixa" da Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  createTreasuryCaixaService,
  type TreasuryCaixaService,
} from "../services/treasuryCaixaService.server.js";
import { TreasuryCaixaFilterError } from "../domain/treasuryCaixaRules.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryCaixaControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryCaixaService;
};

function parseIntParam(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function createTreasuryCaixaControllers(
  deps: TreasuryCaixaControllerDeps
) {
  const service = deps.service ?? createTreasuryCaixaService({ prisma });

  return {
    getBoard: async (req: Request, res: Response) => {
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

        const q = req.query as Record<string, unknown>;
        const year = parseIntParam(q.year);
        if (year == null) {
          sendTreasuryError(res, {
            requestId,
            error: "year é obrigatório.",
            code: "VALIDATION_ERROR",
            field: "year",
          });
          return;
        }
        const month = parseIntParam(q.month);
        const day = parseIntParam(q.day);

        const board = await service.getBoard({ year, month, day });
        res.status(200).json({ ...board, requestId });
      } catch (err) {
        if (err instanceof TreasuryCaixaFilterError) {
          sendTreasuryError(res, {
            requestId,
            error: err.message,
            code: "VALIDATION_ERROR",
          });
          return;
        }
        handleTreasuryRouteError(res, requestId, err);
      }
    },
  };
}
