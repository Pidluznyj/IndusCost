/**
 * Controller HTTP — Apoio ao Caixa (CS-006). Somente leitura.
 *
 * Toda leitura passa pelo orquestrador (`cashSupportService.server.ts`);
 * este controller não consulta tabela financeira diretamente, não calcula
 * dinheiro e não reconstrói o read model.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  createCashSupportService,
  type CashSupportService,
} from "../services/cashSupportService.server.js";
import type { CashSupportFilters } from "../contracts/cashSupportContracts.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type CashSupportControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: CashSupportService;
};

function parseIntOr(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lança TreasuryDomainError (VALIDATION_ERROR) — mesmo padrão do resto do módulo. */
function parseCashSupportFilters(q: Record<string, unknown>): CashSupportFilters {
  const civilDateFrom = parseStringOrNull(q.civilDateFrom);
  const civilDateTo = parseStringOrNull(q.civilDateTo);
  if (!civilDateFrom || !CIVIL_DATE_RE.test(civilDateFrom)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "civilDateFrom é obrigatório (YYYY-MM-DD).",
      "civilDateFrom"
    );
  }
  if (!civilDateTo || !CIVIL_DATE_RE.test(civilDateTo)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "civilDateTo é obrigatório (YYYY-MM-DD).",
      "civilDateTo"
    );
  }
  if (civilDateTo < civilDateFrom) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "civilDateTo não pode ser anterior a civilDateFrom.",
      "civilDateTo"
    );
  }
  return {
    civilDateFrom,
    civilDateTo,
    companyCode: parseStringOrNull(q.companyCode),
    accountId: parseStringOrNull(q.accountId),
    direction: q.direction === "IN" || q.direction === "OUT" ? q.direction : null,
    search: parseStringOrNull(q.search),
    onlyPending: q.onlyPending === "true",
    onlyWarnings: q.onlyWarnings === "true",
    page: parseIntOr(q.page, 1),
    pageSize: Math.min(200, parseIntOr(q.pageSize, 50)),
  };
}

export function createCashSupportControllers(deps: CashSupportControllerDeps) {
  const service = deps.service ?? createCashSupportService({ prisma });

  async function requireUser(
    req: Request,
    res: Response,
    requestId: string
  ): Promise<AppAuthContext | null> {
    const user = await deps.getCurrentAppUser(req);
    if (!user) {
      sendTreasuryError(res, {
        requestId,
        error: "Autenticação necessária.",
        code: "UNAUTHORIZED",
      });
      return null;
    }
    return user;
  }

  return {
    getReadModel: async (req: Request, res: Response) => {
      const requestId = resolveTreasuryRequestId(req);
      res.setHeader("x-request-id", requestId);
      try {
        const user = await requireUser(req, res, requestId);
        if (!user) return;

        const filters = parseCashSupportFilters(req.query as Record<string, unknown>);
        const readModel = await service.getReadModel(
          { appUser: user, requestId },
          filters
        );
        res.status(200).json({ ...readModel, requestId });
      } catch (err) {
        handleTreasuryRouteError(res, requestId, err);
      }
    },

    getSummary: async (req: Request, res: Response) => {
      const requestId = resolveTreasuryRequestId(req);
      res.setHeader("x-request-id", requestId);
      try {
        const user = await requireUser(req, res, requestId);
        if (!user) return;

        const filters = parseCashSupportFilters(req.query as Record<string, unknown>);
        const readModel = await service.getReadModel(
          { appUser: user, requestId },
          filters
        );
        res.status(200).json({
          summary: readModel.summary,
          analysisAsOfDateTime: readModel.analysisAsOfDateTime,
          warnings: readModel.warnings,
          requestId,
        });
      } catch (err) {
        handleTreasuryRouteError(res, requestId, err);
      }
    },
  };
}
