/**
 * OP-59..OP-63 — Rotas HTTP do Fluxo de Pedidos (Kanban).
 */

import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { requireSalesOrderFlowEnabled } from "@/src/lib/sales/salesOrderFlowFeatureFlags.js";
import { loadSalesOrderFlowSummary } from "@/src/lib/sales/salesOrderFlowSummary.server.js";
import { SalesOrderFlowSummaryQueryError } from "@/src/lib/sales/salesOrderFlowSummary.js";
import { loadSalesOrderFlowList } from "@/src/lib/sales/salesOrderFlowList.server.js";
import { SalesOrderFlowListQueryError } from "@/src/lib/sales/salesOrderFlowList.js";
import {
  loadSalesOrderFlowDetail,
  loadSalesOrderFlowEvents,
  SalesOrderFlowDetailQueryError,
} from "@/src/lib/sales/salesOrderFlowDetail.server.js";
import { applySalesOrderFlowManagement } from "@/src/lib/sales/salesOrderFlowManagement.server.js";
import {
  resolveSalesOrderFlowCapabilities,
  resolveSalesOrderFlowManagementRequirements,
} from "@/src/lib/sales/salesOrderFlowPermissions.js";
import { resolveSalesOrderFlowAccessScope } from "@/src/lib/sales/salesOrderFlowAccessScope.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerSalesOrderFlowRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;

  const guards = [
    requireSalesOrderFlowEnabled(),
    requireAppAuth,
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      COMMERCIAL_ACTIONS.view
    ),
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
      COMMERCIAL_ACTIONS.view
    ),
  ] as const;

  async function resolveScopedUser(req: express.Request) {
    const user = await getCurrentAppUser(req);
    if (!user) return { ok: false as const, status: 401 as const };
    const { prisma } = await import("@/src/lib/prisma.js");
    const scope = await resolveSalesOrderFlowAccessScope(user, prisma);
    if (!scope.ok) {
      return {
        ok: false as const,
        status: scope.status,
        body: scope.body,
        user,
        prisma,
      };
    }
    return {
      ok: true as const,
      user,
      prisma,
      capabilities: resolveSalesOrderFlowCapabilities(user),
      scopeCustomerIds:
        scope.mode === "own_portfolio" ? scope.allowedCustomerIds : null,
    };
  }

  app.get(
    "/api/commercial/sales-order-flow/summary",
    ...guards,
    async (req, res) => {
      try {
        const scoped = await resolveScopedUser(req);
        if (!scoped.ok) {
          if (scoped.status === 401) {
            return res.status(401).json({ error: "Não autenticado." });
          }
          return res.status(scoped.status).json(scoped.body);
        }

        const payload = await loadSalesOrderFlowSummary(
          req.query as Record<string, unknown>,
          {
            prisma: scoped.prisma,
            scopeCustomerIds: scoped.scopeCustomerIds,
            canViewValues: scoped.capabilities.canViewValues,
            canViewInconsistencies:
              scoped.capabilities.canViewInconsistencies,
          }
        );
        res.setHeader("Cache-Control", "no-store");
        return res.json(payload);
      } catch (error) {
        if (error instanceof SalesOrderFlowSummaryQueryError) {
          return res.status(400).json({ error: error.message });
        }
        console.error(
          "GET /api/commercial/sales-order-flow/summary:",
          error
        );
        return res.status(500).json({
          error: "Não foi possível carregar o resumo do Fluxo de Pedidos.",
        });
      }
    }
  );

  app.get("/api/commercial/sales-order-flow", ...guards, async (req, res) => {
    try {
      const scoped = await resolveScopedUser(req);
      if (!scoped.ok) {
        if (scoped.status === 401) {
          return res.status(401).json({ error: "Não autenticado." });
        }
        return res.status(scoped.status).json(scoped.body);
      }

      const payload = await loadSalesOrderFlowList(
        req.query as Record<string, unknown>,
        {
          prisma: scoped.prisma,
          scopeCustomerIds: scoped.scopeCustomerIds,
          canViewValues: scoped.capabilities.canViewValues,
          canViewProduction: scoped.capabilities.canViewProduction,
          canViewInconsistencies:
            scoped.capabilities.canViewInconsistencies,
        }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      if (
        error instanceof SalesOrderFlowListQueryError ||
        error instanceof SalesOrderFlowSummaryQueryError
      ) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/commercial/sales-order-flow:", error);
      return res.status(500).json({
        error: "Não foi possível carregar o Kanban de Pedidos.",
      });
    }
  });

  app.get(
    "/api/commercial/sales-order-flow/:salesOrderId/events",
    requireSalesOrderFlowEnabled(),
    requireAppAuth,
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      COMMERCIAL_ACTIONS.view
    ),
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
      COMMERCIAL_ACTIONS.view
    ),
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowTimeline,
      COMMERCIAL_ACTIONS.view
    ),
    async (req, res) => {
      try {
        const scoped = await resolveScopedUser(req);
        if (!scoped.ok) {
          if (scoped.status === 401) {
            return res.status(401).json({ error: "Não autenticado." });
          }
          return res.status(scoped.status).json(scoped.body);
        }

        const result = await loadSalesOrderFlowEvents(
          String(req.params.salesOrderId ?? ""),
          req.query as Record<string, unknown>,
          {
            prisma: scoped.prisma,
            scopeCustomerIds: scoped.scopeCustomerIds,
          }
        );
        if (!result.ok) {
          return res.status(result.status).json(result.body);
        }
        res.setHeader("Cache-Control", "no-store");
        return res.json(result.payload);
      } catch (error) {
        if (error instanceof SalesOrderFlowDetailQueryError) {
          return res.status(400).json({ error: error.message });
        }
        console.error(
          "GET /api/commercial/sales-order-flow/:salesOrderId/events:",
          error
        );
        return res.status(500).json({
          error: "Não foi possível carregar a timeline do Fluxo de Pedidos.",
        });
      }
    }
  );

  app.get(
    "/api/commercial/sales-order-flow/:salesOrderId",
    ...guards,
    async (req, res) => {
      try {
        const scoped = await resolveScopedUser(req);
        if (!scoped.ok) {
          if (scoped.status === 401) {
            return res.status(401).json({ error: "Não autenticado." });
          }
          return res.status(scoped.status).json(scoped.body);
        }

        const result = await loadSalesOrderFlowDetail(
          String(req.params.salesOrderId ?? ""),
          {
            prisma: scoped.prisma,
            scopeCustomerIds: scoped.scopeCustomerIds,
            canViewValues: scoped.capabilities.canViewValues,
            canViewProduction: scoped.capabilities.canViewProduction,
            canViewFiscal: scoped.capabilities.canViewFiscal,
            canViewFinancial: scoped.capabilities.canViewFinancial,
            canViewInconsistencies:
              scoped.capabilities.canViewInconsistencies,
          }
        );
        if (!result.ok) {
          return res.status(result.status).json(result.body);
        }
        res.setHeader("Cache-Control", "no-store");
        return res.json(result.payload);
      } catch (error) {
        if (error instanceof SalesOrderFlowDetailQueryError) {
          return res.status(400).json({ error: error.message });
        }
        console.error(
          "GET /api/commercial/sales-order-flow/:salesOrderId:",
          error
        );
        return res.status(500).json({
          error: "Não foi possível carregar o detalhe do Fluxo de Pedidos.",
        });
      }
    }
  );

  app.patch(
    "/api/commercial/sales-order-flow/:salesOrderId/management",
    requireSalesOrderFlowEnabled(),
    requireAppAuth,
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      COMMERCIAL_ACTIONS.view
    ),
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
      COMMERCIAL_ACTIONS.view
    ),
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowManagement,
      COMMERCIAL_ACTIONS.manage
    ),
    (req, res, next) => {
      const requirements = resolveSalesOrderFlowManagementRequirements(
        req.body
      );
      let index = 0;
      const runNext = (error?: unknown): void => {
        if (error) {
          next(error);
          return;
        }
        const requirement = requirements[index++];
        if (!requirement) {
          next();
          return;
        }
        requireResource(requirement.resourceKey, requirement.action)(
          req,
          res,
          runNext
        );
      };
      runNext();
    },
    async (req, res) => {
      try {
        const scoped = await resolveScopedUser(req);
        if (!scoped.ok) {
          if (scoped.status === 401) {
            return res.status(401).json({ error: "Não autenticado." });
          }
          return res.status(scoped.status).json(scoped.body);
        }

        const result = await applySalesOrderFlowManagement({
          prisma: scoped.prisma,
          salesOrderId: String(req.params.salesOrderId ?? ""),
          body: req.body,
          actor: { id: scoped.user.id, name: scoped.user.name },
          scopeCustomerIds: scoped.scopeCustomerIds,
        });
        if (!result.ok) {
          return res.status(result.status).json(result.body);
        }
        res.setHeader("Cache-Control", "no-store");
        return res.json(result.payload);
      } catch (error) {
        console.error(
          "PATCH /api/commercial/sales-order-flow/:salesOrderId/management:",
          error
        );
        return res.status(500).json({
          error: "Não foi possível atualizar a gestão do Fluxo de Pedidos.",
        });
      }
    }
  );
}
