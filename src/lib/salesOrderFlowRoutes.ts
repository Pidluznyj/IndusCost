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
import {
  isSalesOrderFlowEnabled,
  requireSalesOrderFlowEnabled,
  SALES_ORDER_FLOW_FEATURE_RESOURCE,
} from "@/src/lib/sales/salesOrderFlowFeatureFlags.js";
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
  recomputeSalesOrderFlow,
  SalesOrderFlowOrderNotFoundError,
} from "@/src/lib/sales/salesOrderFlowRecompute.server.js";
import { assertSalesOrderFlowDetailId } from "@/src/lib/sales/salesOrderFlowDetail.js";
import {
  resolveSalesOrderFlowCapabilitiesWith,
  resolveSalesOrderFlowManagementRequirements,
  SALES_ORDER_FLOW_RESOURCE_MATRIX,
} from "@/src/lib/sales/salesOrderFlowPermissions.js";
import { resolveSalesOrderFlowAccessScope } from "@/src/lib/sales/salesOrderFlowAccessScope.js";
import type { RequireResourceDecision } from "@/src/lib/security/requireResource.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  authorizeResource: (
    req: express.Request,
    resourceKey: string,
    action?: string
  ) => Promise<RequireResourceDecision>;
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

  /** Status da feature para menu/rota — sem requireSalesOrderFlowEnabled (senão 404). */
  app.get(
    "/api/commercial/sales-order-flow/feature-status",
    requireAppAuth,
    (_req, res) => {
      res.json({
        enabled: isSalesOrderFlowEnabled(),
        resource: SALES_ORDER_FLOW_FEATURE_RESOURCE,
      });
    }
  );

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
      capabilities: await resolveSalesOrderFlowCapabilitiesWith(
        async (requirement) =>
          (
            await auth.authorizeResource(
              req,
              requirement.resourceKey,
              requirement.action
            )
          ).ok
      ),
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
    "/api/commercial/sales-order-flow/lookup/responsible-users",
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
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowResponsibility,
      COMMERCIAL_ACTIONS.manage
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
        if (!scoped.capabilities.canAssignResponsible) {
          return res.status(403).json({
            error: "Sem permissão para atribuir responsável.",
            code: "FORBIDDEN",
          });
        }
        const query = String(req.query.q ?? req.query.query ?? "").trim();
        if (query.length < 2) {
          return res.json({ rows: [] });
        }
        const rows = await scoped.prisma.appUser.findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          },
          take: 20,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            email: true,
            person: { select: { displayName: true, socialName: true } },
            employee: { select: { name: true, socialName: true } },
          },
        });
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          rows: rows.map((row) => {
            const fromPerson =
              row.person?.socialName?.trim() ||
              row.person?.displayName?.trim();
            const fromEmployee =
              row.employee?.socialName?.trim() ||
              row.employee?.name?.trim();
            return {
              id: row.id,
              name: fromPerson || fromEmployee || row.name,
              email: row.email ?? null,
            };
          }),
        });
      } catch (error) {
        console.error(
          "GET /api/commercial/sales-order-flow/lookup/responsible-users:",
          error
        );
        return res.status(500).json({
          error: "Não foi possível buscar responsáveis do Fluxo de Pedidos.",
        });
      }
    }
  );

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
            canViewTimeline: scoped.capabilities.canViewTimeline,
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

  app.post(
    "/api/commercial/sales-order-flow/:salesOrderId/recompute",
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
      SALES_ORDER_FLOW_RESOURCE_MATRIX.rebuild.resourceKey,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.rebuild.action
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
        if (!scoped.capabilities.canExecuteRebuild) {
          return res.status(403).json({
            error: "Sem permissão para recomputar o Fluxo de Pedidos.",
            code: "SALES_ORDER_FLOW_RECOMPUTE_FORBIDDEN",
          });
        }

        const salesOrderId = assertSalesOrderFlowDetailId(
          String(req.params.salesOrderId ?? "")
        );
        const orderMeta = await scoped.prisma.salesOrder.findUnique({
          where: { id: salesOrderId },
          select: { id: true, customerId: true },
        });
        if (!orderMeta) {
          return res.status(404).json({
            error: "Pedido não encontrado.",
            code: "SALES_ORDER_NOT_FOUND",
          });
        }
        if (
          scoped.scopeCustomerIds &&
          !scoped.scopeCustomerIds.includes(orderMeta.customerId)
        ) {
          return res.status(403).json({
            error: "Pedido fora do escopo comercial do usuário.",
            code: "SALES_ORDER_OUT_OF_SCOPE",
          });
        }

        const result = await recomputeSalesOrderFlow(
          scoped.prisma,
          salesOrderId
        );
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          salesOrderId: result.salesOrderId,
          action: result.action,
          reason: result.reason,
          currentOrderStage: result.currentOrderStage,
          previousOrderStage: result.previousOrderStage,
          skippedWrite: result.skippedWrite,
          computedAt: result.computedAt,
        });
      } catch (error) {
        if (error instanceof SalesOrderFlowOrderNotFoundError) {
          return res.status(404).json({
            error: "Pedido não encontrado.",
            code: "SALES_ORDER_NOT_FOUND",
          });
        }
        if (error instanceof SalesOrderFlowDetailQueryError) {
          return res.status(400).json({ error: error.message });
        }
        console.error(
          "POST /api/commercial/sales-order-flow/:salesOrderId/recompute:",
          error
        );
        return res.status(500).json({
          error: "Não foi possível recomputar o Fluxo de Pedidos.",
        });
      }
    }
  );
}
