/**
 * Status administrativo das flags SC (settings).
 */

import type express from "express";
import type { RequestHandler } from "express";
import {
  ADMIN_SETTINGS_ACTIONS,
  ADMIN_SETTINGS_RESOURCE_KEYS,
} from "@/src/lib/adminSettingsAccess.js";
import { buildSupplyChainModulesAdminStatus } from "./supplyChainModuleStatus.server.js";

type AuthGuards = {
  requireBootstrapOrResource: (
    isBootstrap: (req: express.Request) => boolean,
    resourceKey: string,
    action?: string
  ) => RequestHandler;
  isBootstrapAdminRequest?: (req: express.Request) => boolean;
};

export function registerSettingsSupplyChainRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const isBootstrap = auth.isBootstrapAdminRequest ?? (() => false);
  const settingsView = auth.requireBootstrapOrResource(
    isBootstrap,
    ADMIN_SETTINGS_RESOURCE_KEYS.settings,
    ADMIN_SETTINGS_ACTIONS.view
  );

  app.get(
    "/api/settings/system/supply-chain/status",
    settingsView,
    (_req, res) => {
      try {
        const status = buildSupplyChainModulesAdminStatus();
        res.setHeader("Cache-Control", "no-store");
        return res.json(status);
      } catch (error) {
        console.error("GET /api/settings/system/supply-chain/status:", error);
        return res.status(500).json({
          error: "Erro ao carregar status da Cadeia de Suprimentos.",
        });
      }
    }
  );
}
