/**
 * Router principal da Central de Tesouraria.
 * Scaffold: availability técnica protegida por sessão + flag + requireResource.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { treasuryAvailabilityHandler } from "./controllers/treasuryAvailabilityController.js";
import { TREASURY_AVAILABILITY_PATH } from "./contracts/treasuryContracts.js";
import { TREASURY_ACTIONS, TREASURY_RESOURCE_KEY } from "./treasuryAccess.js";
import { requireTreasuryModuleEnabled } from "./treasuryFeatureFlags.js";

export type TreasuryAuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

/**
 * Registra rotas do módulo. Lógica de negócio permanece fora de server.ts.
 */
export function registerTreasuryRoutes(
  app: express.Express,
  auth: TreasuryAuthGuards
): void {
  const { requireAppAuth, requireResource } = auth;

  app.get(
    TREASURY_AVAILABILITY_PATH,
    requireAppAuth,
    requireTreasuryModuleEnabled(),
    requireResource(TREASURY_RESOURCE_KEY, TREASURY_ACTIONS.view),
    treasuryAvailabilityHandler
  );
}
