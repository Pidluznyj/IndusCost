/**
 * OP-58 — Status administrativo read-only do Fluxo de Pedidos.
 * A rota administrativa permanece disponível mesmo com a UI do Kanban desligada.
 */

import type express from "express";
import type { RequestHandler } from "express";
import {
  ADMIN_SETTINGS_ACTIONS,
  ADMIN_SETTINGS_RESOURCE_KEYS,
} from "./adminSettingsAccess.js";
import type { SalesOrderFlowEngineStatus } from "./sales/salesOrderFlowStatus.server.js";

type AuthGuards = {
  requireBootstrapOrResource: (
    isBootstrap: (req: express.Request) => boolean,
    resourceKey: string,
    action?: string
  ) => RequestHandler;
  isBootstrapAdminRequest?: (req: express.Request) => boolean;
};

export type SettingsSalesOrderFlowRoutesDeps = {
  buildStatus: () => Promise<SalesOrderFlowEngineStatus>;
};

export function registerSettingsSalesOrderFlowRoutes(
  app: express.Express,
  auth: AuthGuards,
  deps: SettingsSalesOrderFlowRoutesDeps
): void {
  const isBootstrap = auth.isBootstrapAdminRequest ?? (() => false);
  const settingsView = auth.requireBootstrapOrResource(
    isBootstrap,
    ADMIN_SETTINGS_RESOURCE_KEYS.settings,
    ADMIN_SETTINGS_ACTIONS.view
  );

  app.get(
    "/api/settings/system/sales-order-flow/status",
    settingsView,
    async (_req, res) => {
      try {
        const status = await deps.buildStatus();
        res.setHeader("Cache-Control", "no-store");
        return res.json(status);
      } catch (error) {
        console.error(
          "GET /api/settings/system/sales-order-flow/status:",
          error
        );
        return res.status(500).json({
          error: "Erro ao carregar status do Fluxo de Pedidos.",
        });
      }
    }
  );
}
