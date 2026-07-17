/**
 * OP-59/OP-60 — Rotas HTTP do Fluxo de Pedidos (Kanban).
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
import { resolveSalesOrderFlowAccessScope } from "@/src/lib/sales/salesOrderFlowAccessScope.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function canViewSalesOrderFlowMonetaryValues(
  user: AppAuthContext
): boolean {
  return authorizeRequireResource(
    user,
    COMMERCIAL_RESOURCE_KEYS.salesOrders,
    COMMERCIAL_ACTIONS.view,
    { legacyCompatMode: true }
  ).ok;
}

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
  ] as const;

  app.get(
    "/api/commercial/sales-order-flow/summary",
    ...guards,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }

        const { prisma } = await import("@/src/lib/prisma.js");
        const scope = await resolveSalesOrderFlowAccessScope(user, prisma);
        if (!scope.ok) {
          return res.status(scope.status).json(scope.body);
        }

        const scopeCustomerIds =
          scope.mode === "own_portfolio" ? scope.allowedCustomerIds : null;

        const payload = await loadSalesOrderFlowSummary(
          req.query as Record<string, unknown>,
          {
            prisma,
            scopeCustomerIds,
            canViewValues: canViewSalesOrderFlowMonetaryValues(user),
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
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const { prisma } = await import("@/src/lib/prisma.js");
      const scope = await resolveSalesOrderFlowAccessScope(user, prisma);
      if (!scope.ok) {
        return res.status(scope.status).json(scope.body);
      }

      const scopeCustomerIds =
        scope.mode === "own_portfolio" ? scope.allowedCustomerIds : null;

      const payload = await loadSalesOrderFlowList(
        req.query as Record<string, unknown>,
        {
          prisma,
          scopeCustomerIds,
          canViewValues: canViewSalesOrderFlowMonetaryValues(user),
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
}
