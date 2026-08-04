/**
 * Controller HTTP — GET /api/treasury/caixa/scenarios
 * Devolve os três cenários (Otimista/Realista/Pessimista) numa única resposta.
 * Não chama outro endpoint HTTP: consome services diretos.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  createTreasuryCaixaScenariosService,
  type TreasuryCaixaScenariosService,
} from "../services/treasuryCaixaScenariosService.server.js";
import { TreasuryCaixaFilterError } from "../domain/treasuryCaixaRules.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryCaixaScenariosControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryCaixaScenariosService;
};

function parseIntParam(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseStringParam(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

export function createTreasuryCaixaScenariosControllers(
  deps: TreasuryCaixaScenariosControllerDeps
) {
  const service =
    deps.service ?? createTreasuryCaixaScenariosService({ prisma });

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
        const asOfCivilDate = parseStringParam(q.asOfCivilDate);
        const horizonDays = parseIntParam(q.horizonDays);
        const year = parseIntParam(q.year);
        const month = parseIntParam(q.month);
        const day = parseIntParam(q.day);

        const result = await service.getBoard({
          asOfCivilDate: asOfCivilDate ?? null,
          horizonDays: horizonDays ?? null,
          year: year ?? null,
          month: month ?? null,
          day: day ?? null,
        });
        res.status(200).json({ ...result, requestId });
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
