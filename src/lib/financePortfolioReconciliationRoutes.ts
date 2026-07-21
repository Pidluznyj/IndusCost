import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { financeApiErrorJson } from "./financeTabLoadError.js";
import { PortfolioReconciliationApiParseError } from "./finance/portfolioReconciliationApi.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "./financeModulesAccess.js";
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
import {
  loadOrderStatusPedidosList,
  loadOrderStatusPedidosOrderDetail,
} from "./financeOrderStatusPedidosApi.server.js";
import {
  loadPortfolioOrderStatusList,
  PortfolioOrderStatusApiParseError,
} from "./financePortfolioOrderStatusApi.server.js";
import { getOrderFullAudit } from "./finance/orderFullAuditService.js";
import { isSalesOrderVisibleInPortfolioReconciliation } from "./finance/financePortfolioOperationalOrderGate.server.js";
import { prisma } from "@/src/lib/prisma.js";
import { OrderToCashAuditApiParseError } from "./finance/orderToCashAuditApi.js";
import { OrderStatusPedidosApiParseError } from "./finance/orderStatusPedidosApi.js";
import { PortfolioIntelligenceApiParseError } from "./finance/portfolioMaturityIntelligenceApi.js";
import {
  decideOutputDocumentRawAccess,
  parseIncludeRawFlag,
} from "./output-documents/outputDocumentsRawAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerFinancePortfolioReconciliationRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { getCurrentAppUser } = auth;
  const moduleGuard = [
    auth.requireAppAuth,
    auth.requireResource(FINANCE_MODULE_RESOURCE_KEYS.portfolio, FINANCE_MODULE_ACTIONS.view),
  ];
  const conciliationGuard = [
    auth.requireAppAuth,
    auth.requireResource(FINANCE_MODULE_RESOURCE_KEYS.portfolio, FINANCE_MODULE_ACTIONS.view),
  ];
  const intelligenceGuard = [
    auth.requireAppAuth,
    auth.requireResource(FINANCE_MODULE_RESOURCE_KEYS.portfolio, FINANCE_MODULE_ACTIONS.view),
  ];
  const orderToCashAuditGuard = [
    auth.requireAppAuth,
    auth.requireResource(
      FINANCE_MODULE_RESOURCE_KEYS.portfolioOrderToCashAudit,
      FINANCE_MODULE_ACTIONS.view
    ),
  ];
  const orderStatusPedidosGuard = [
    auth.requireAppAuth,
    auth.requireResource(
      FINANCE_MODULE_RESOURCE_KEYS.portfolioOrderStatus,
      FINANCE_MODULE_ACTIONS.view
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

  app.get(
    "/api/finance/portfolio-reconciliation/order-status",
    ...orderStatusPedidosGuard,
    async (req, res) => {
      try {
        const payload = await loadPortfolioOrderStatusList(
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        if (
          error instanceof PortfolioOrderStatusApiParseError ||
          error instanceof OrderToCashAuditApiParseError
        ) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/finance/portfolio-reconciliation/order-status",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar Status Pedidos.",
              new Error("Falha interna ao agregar pedidos materializados.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/order-status-pedidos",
    ...orderStatusPedidosGuard,
    async (req, res) => {
      try {
        const payload = await loadOrderStatusPedidosList(
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        if (
          error instanceof OrderStatusPedidosApiParseError ||
          error instanceof OrderToCashAuditApiParseError
        ) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/finance/portfolio-reconciliation/order-status-pedidos",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar Status Pedidos.",
              new Error("Falha interna ao agregar pedidos materializados.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/order-status-pedidos/orders/:orderKey",
    ...orderStatusPedidosGuard,
    async (req, res) => {
      try {
        const orderKey = String(req.params.orderKey ?? "").trim();
        if (!orderKey) {
          res.status(400).json({
            error: "orderKey obrigatório.",
            message: "orderKey obrigatório.",
          });
          return;
        }
        const payload = await loadOrderStatusPedidosOrderDetail(
          orderKey,
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        if (
          error instanceof OrderStatusPedidosApiParseError ||
          error instanceof OrderToCashAuditApiParseError
        ) {
          res.status(400).json({ error: error.message, message: error.message });
          return;
        }
        console.error(
          "GET /api/finance/portfolio-reconciliation/order-status-pedidos/orders/:orderKey",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Erro ao carregar detalhe do Status Pedidos.",
              new Error("Falha interna ao consultar evidências do pedido.")
            )
          );
      }
    }
  );

  app.get(
    "/api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full",
    ...orderStatusPedidosGuard,
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
        const visible = await isSalesOrderVisibleInPortfolioReconciliation(
          prisma,
          salesOrderId
        );
        if (!visible) {
          res.status(404).json({
            error:
              "Pedido fora do universo operacional da Conciliação de Carteira (ausente confirmado, cancelado ou erro).",
            message:
              "Pedido fora do universo operacional da Conciliação de Carteira (ausente confirmado, cancelado ou erro).",
            code: "PORTFOLIO_ORDER_EXCLUDED",
          });
          return;
        }
        const runId = typeof req.query.runId === "string"
          ? req.query.runId.trim() || null
          : null;
        const orderCode = typeof req.query.orderCode === "string"
          ? req.query.orderCode.trim() || null
          : null;
        const includeRawRequested = parseIncludeRawFlag(req.query.includeRaw);
        let includeRaw = false;
        if (includeRawRequested) {
          const user = await getCurrentAppUser(req);
          if (!user) {
            res.status(401).json({
              error: "Não autenticado.",
              code: "UNAUTHORIZED",
            });
            return;
          }
          const rawDecision = decideOutputDocumentRawAccess({
            user,
            includeRaw: true,
          });
          if (rawDecision.allowed === false) {
            res.status(rawDecision.status).json(rawDecision.body);
            return;
          }
          includeRaw = true;
        }
        const appAuth = (
          req as { appAuth?: { userId?: string; permissions?: string[] } }
        ).appAuth;
        const payload = await getOrderFullAudit({
          salesOrderId,
          runId,
          orderCode,
          includeRaw,
          userContext: appAuth
            ? {
                userId: appAuth.userId ?? null,
                permissions: appAuth.permissions ?? [],
              }
            : null,
        });
        if ("ok" in payload && payload.ok) {
          res.json(payload);
          return;
        }
        res.status(payload.status).json({
          error: payload.error,
          message: payload.error,
        });
      } catch (error) {
        console.error(
          "GET /api/finance/portfolio-reconciliation/orders/:salesOrderId/audit-full",
          error
        );
        res
          .status(500)
          .json(
            financeApiErrorJson(
              "Não foi possível carregar a auditoria do pedido.",
              new Error("Falha interna ao consultar auditoria completa do pedido.")
            )
          );
      }
    }
  );
}
