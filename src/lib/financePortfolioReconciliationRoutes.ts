import type express from "express";
import type { RequestHandler } from "express";
import { financeApiErrorJson } from "./financeTabLoadError.js";
import { PortfolioReconciliationApiParseError } from "./finance/portfolioReconciliationApi.js";
import { PermissionResourceKeys } from "./security/permissionsCatalog.js";
import {
  listPortfolioReconciliationRuns,
  loadPortfolioIntelligenceList,
  loadPortfolioIntelligenceOrderDetail,
  loadPortfolioReconciliationList,
  loadPortfolioReconciliationOrderDetail,
  loadPortfolioReconciliationRunSummary,
} from "./financePortfolioReconciliationApi.server.js";
import {
  listOrderToCashAuditRuns,
  loadOrderToCashAuditFactById,
  loadOrderToCashAuditList,
} from "./financeOrderToCashAuditApi.server.js";
import { OrderToCashAuditApiParseError } from "./finance/orderToCashAuditApi.js";
import { PortfolioIntelligenceApiParseError } from "./finance/portfolioMaturityIntelligenceApi.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  /** Motor relacional: requirePermission(resourceKey, action) */
  requirePermission: (resourceKey: string, action?: "view" | "execute" | "manage" | "admin") => RequestHandler;
};

export function registerFinancePortfolioReconciliationRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const moduleGuard = [
    auth.requireAppAuth,
    auth.requirePermission(PermissionResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA, "view"),
  ];
  const conciliationGuard = [
    auth.requireAppAuth,
    auth.requirePermission(
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
      "view"
    ),
  ];
  const intelligenceGuard = [
    auth.requireAppAuth,
    auth.requirePermission(
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
      "view"
    ),
  ];
  const orderToCashAuditGuard = [
    auth.requireAppAuth,
    auth.requirePermission(
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
      "view"
    ),
  ];

  app.get("/api/finance/portfolio-reconciliation", ...conciliationGuard, async (req, res) => {
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
    ...conciliationGuard,
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

  app.get("/api/finance/portfolio-reconciliation/runs", ...moduleGuard, async (_req, res) => {
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
    "/api/finance/portfolio-reconciliation/intelligence",
    ...intelligenceGuard,
    async (req, res) => {
      try {
        const payload = await loadPortfolioIntelligenceList(
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        if (
          error instanceof PortfolioReconciliationApiParseError ||
          error instanceof PortfolioIntelligenceApiParseError
        ) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error("GET /api/finance/portfolio-reconciliation/intelligence", error);
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar a central de inteligência da carteira.",
              new Error("Falha interna ao consultar maturidade da carteira.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId",
    ...intelligenceGuard,
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
        const payload = await loadPortfolioIntelligenceOrderDetail(
          salesOrderId,
          req.query as Record<string, unknown>
        );
        if (!payload.ok) {
          res.status(404).json(payload);
          return;
        }
        res.json(payload);
      } catch (error) {
        if (
          error instanceof PortfolioReconciliationApiParseError ||
          error instanceof PortfolioIntelligenceApiParseError
        ) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar detalhe de maturidade do pedido.",
              new Error("Falha interna ao consultar maturidade do pedido.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/runs/:runId/summary",
    ...conciliationGuard,
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

  app.get(
    "/api/finance/portfolio-reconciliation/order-to-cash-audit",
    ...orderToCashAuditGuard,
    async (req, res) => {
      try {
        const payload = await loadOrderToCashAuditList(
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        if (error instanceof OrderToCashAuditApiParseError) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/finance/portfolio-reconciliation/order-to-cash-audit",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar auditoria Pedido → Caixa.",
              new Error("Falha interna ao consultar fatos materializados.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/order-to-cash-audit/runs",
    ...orderToCashAuditGuard,
    async (_req, res) => {
      try {
        const payload = await listOrderToCashAuditRuns();
        res.json(payload);
      } catch (error) {
        console.error(
          "GET /api/finance/portfolio-reconciliation/order-to-cash-audit/runs",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao listar runs da auditoria Pedido → Caixa.",
              new Error("Falha interna ao consultar runs.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/order-to-cash-audit/:factId",
    ...orderToCashAuditGuard,
    async (req, res) => {
      try {
        const factId = String(req.params.factId ?? "").trim();
        if (!factId || factId === "runs") {
          res.status(400).json({
            error: "factId obrigatório.",
            message: "factId obrigatório.",
          });
          return;
        }
        const payload = await loadOrderToCashAuditFactById(factId);
        if (!payload.ok) {
          res.status(404).json(payload);
          return;
        }
        res.json(payload);
      } catch (error) {
        console.error(
          "GET /api/finance/portfolio-reconciliation/order-to-cash-audit/:factId",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar fato da auditoria Pedido → Caixa.",
              new Error("Falha interna ao consultar fato materializado.")
            )
          );
      }
    }
  );
}
