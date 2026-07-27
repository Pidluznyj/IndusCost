/**
 * Controllers HTTP — consulta e mutação de expectativa CR Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseTreasuryReceivableExpectationInput,
  parseTreasuryReceivablesListQuery,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryReceivableQueryActor,
  createTreasuryReceivableQueryService,
  type TreasuryReceivableQueryService,
} from "../services/treasuryReceivableQueryService.server.js";
import {
  buildTreasuryReceivableExpectationActor,
  createTreasuryReceivableExpectationService,
  type TreasuryReceivableExpectationService,
} from "../services/treasuryReceivableExpectationService.server.js";
import {
  buildTreasuryCustomerSummaryActor,
  createTreasuryCustomerFinancialSummaryService,
  type TreasuryCustomerFinancialSummaryService,
} from "../services/treasuryCustomerFinancialSummaryService.server.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryReceivableControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryReceivableQueryService;
  expectationService?: TreasuryReceivableExpectationService;
  customerSummaryService?: TreasuryCustomerFinancialSummaryService;
};

function asBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
}

export function createTreasuryReceivableControllers(
  deps: TreasuryReceivableControllerDeps
) {
  const service =
    deps.service ?? createTreasuryReceivableQueryService({ prisma });
  const expectationService =
    deps.expectationService ??
    createTreasuryReceivableExpectationService({ prisma });
  const customerSummaryService =
    deps.customerSummaryService ??
    createTreasuryCustomerFinancialSummaryService({ prisma });

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
    listReceivables: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryReceivablesListQuery(
          req.query as Record<string, unknown>
        );
        const payload = await service.listReceivables(
          buildTreasuryReceivableQueryActor(user),
          query
        );
        res.status(200).json({ ...payload, requestId });
      }),

    getReceivable: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const receivable = await service.getReceivable(
          buildTreasuryReceivableQueryActor(user),
          titleId
        );
        res.status(200).json({ ok: true, receivable, requestId });
      }),

    putExpectation: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const input = parseTreasuryReceivableExpectationInput(asBody(req));
        const result = await expectationService.putExpectation(
          buildTreasuryReceivableExpectationActor(user, requestId),
          titleId,
          input
        );
        res.status(200).json({
          ok: true,
          receivable: result.receivable,
          projectionRecalc: result.projectionRecalc,
          requestId,
        });
      }),

    getCustomerSummary: (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const titleId = String(req.params.titleId ?? "").trim();
        const summary = await customerSummaryService.getByReceivableTitleId(
          buildTreasuryCustomerSummaryActor(user),
          titleId
        );
        res.status(200).json({ ok: true, summary, requestId });
      }),
  };
}
