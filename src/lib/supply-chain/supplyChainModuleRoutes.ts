/**
 * Rotas HTTP da casca SC — feature-status + stubs protegidos por flag.
 */

import type express from "express";
import type { RequestHandler } from "express";
import {
  getSupplyChainFeatureFlags,
  requireSupplyChainModuleEnabled,
  SUPPLY_CHAIN_FEATURE_RESOURCES,
  type SupplyChainModuleId,
} from "./supplyChainFeatureFlags.js";
import { SUPPLY_CHAIN_CONTRACT_KEYS } from "./supplyChainAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export function registerSupplyChainModuleRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  /** Status das flags para menu — sem require flag (senão 404 permanente). */
  app.get(
    "/api/supply-chain/feature-status",
    auth.requireAppAuth,
    (_req, res) => {
      const flags = getSupplyChainFeatureFlags();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        enabled: {
          purchases: flags.purchases,
          inventory: flags.inventory,
          receiving: flags.receiving,
          shadowPlanning: flags.shadowPlanning,
          indicators: flags.indicators,
        },
        resources: SUPPLY_CHAIN_FEATURE_RESOURCES,
        defaultWhenAbsent: false as const,
      });
    }
  );

  const shells: Array<{
    moduleId: SupplyChainModuleId;
    path: string;
    contractKey: string;
    title: string;
  }> = [
    {
      moduleId: "sc-purchases",
      path: "/api/supply-chain/purchases/shell",
      contractKey: SUPPLY_CHAIN_CONTRACT_KEYS.purchases,
      title: "Compras SC",
    },
    {
      moduleId: "sc-inventory",
      path: "/api/supply-chain/inventory/shell",
      contractKey: SUPPLY_CHAIN_CONTRACT_KEYS.inventory,
      title: "Estoque SC",
    },
    {
      moduleId: "sc-receiving",
      path: "/api/supply-chain/receiving/shell",
      contractKey: SUPPLY_CHAIN_CONTRACT_KEYS.receiving,
      title: "Recebimentos",
    },
  ];

  for (const shell of shells) {
    app.get(
      shell.path,
      auth.requireAppAuth,
      requireSupplyChainModuleEnabled(shell.moduleId),
      auth.requireResource(shell.contractKey, "view"),
      (_req, res) => {
        res.json({
          moduleId: shell.moduleId,
          title: shell.title,
          status: "shell",
          message:
            "Casca informativa — operações de negócio ainda não implementadas neste módulo.",
          businessOperationsEnabled: false,
        });
      }
    );
  }
}
