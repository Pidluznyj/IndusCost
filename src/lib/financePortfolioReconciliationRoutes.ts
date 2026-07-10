import type express from "express";
import type { RequestHandler } from "express";
import { financeApiErrorJson } from "./financeTabLoadError.js";
import { PortfolioReconciliationApiParseError } from "./finance/portfolioReconciliationApi.js";
import { FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS } from "./financePortfolioReconciliationPermissions.js";
import {
  listPortfolioReconciliationRuns,
  loadPortfolioReconciliationList,
  loadPortfolioReconciliationOrderDetail,
  loadPortfolioReconciliationRunSummary,
} from "./financePortfolioReconciliationApi.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export { FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS };

export function registerFinancePortfolioReconciliationRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS]),
  ];

  app.get("/api/finance/portfolio-reconciliation", ...guard, async (req, res) => {
    try {
      const payload = await loadPortfolioReconciliationList(
        req.query as Record<string, unknown>
      );
      res.json(payload);
    } catch (error) {
      if (error instanceof PortfolioReconciliationApiParseError) {
        res.status(400).json({ error: error.message, message: error.message });
        return;
      }
      console.error("GET /api/finance/portfolio-reconciliation", error);
      res
        .status(500)
        .json(
          financeApiErrorJson(
            "Erro ao carregar conciliação de carteira.",
            new Error("Falha interna ao consultar fatos materializados.")
          )
        );
    }
  });

  app.get(
    "/api/finance/portfolio-reconciliation/orders/:salesOrderId",
    ...guard,
    async (req, res) => {
      try {
        const salesOrderId = String(req.params.salesOrderId ?? "").trim();
        if (!salesOrderId) {
          res.status(400).json({
            error: "salesOrderId obrigatório.",
            message: "salesOrderId obrigatório.",
          });
          return;
        }
        const payload = await loadPortfolioReconciliationOrderDetail(
          salesOrderId,
          req.query as Record<string, unknown>
        );
        if (!payload.ok) {
          res.status(404).json(payload);
          return;
        }
        res.json(payload);
      } catch (error) {
        if (error instanceof PortfolioReconciliationApiParseError) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/finance/portfolio-reconciliation/orders/:salesOrderId",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar detalhe do pedido na conciliação.",
              new Error("Falha interna ao consultar fatos materializados.")
            )
          );
      }
    }
  );

  app.get("/api/finance/portfolio-reconciliation/runs", ...guard, async (_req, res) => {
    try {
      const payload = await listPortfolioReconciliationRuns();
      res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/portfolio-reconciliation/runs", error);
      res
        .status(500)
        .json(
          financeApiErrorJson(
            "Erro ao listar runs de conciliação.",
            new Error("Falha interna ao consultar runs.")
          )
        );
    }
  });

  app.get(
    "/api/finance/portfolio-reconciliation/runs/:runId/summary",
    ...guard,
    async (req, res) => {
      try {
        const runId = String(req.params.runId ?? "").trim();
        if (!runId) {
          res.status(400).json({
            error: "runId obrigatório.",
            message: "runId obrigatório.",
          });
          return;
        }
        const payload = await loadPortfolioReconciliationRunSummary(runId);
        if (!payload.ok) {
          res.status(404).json(payload);
          return;
        }
        res.json(payload);
      } catch (error) {
        console.error(
          "GET /api/finance/portfolio-reconciliation/runs/:runId/summary",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar resumo do run de conciliação.",
              new Error("Falha interna ao consultar resumo.")
            )
          );
      }
    }
  );
}
