/**
 * Router principal da Central de Tesouraria.
 * Scaffold: apenas availability técnica protegida — sem regras financeiras.
 *
 * ACL `requireResource(finance.treasury)` entra no prompt de permissões.
 * Nesta etapa: sessão autenticada + feature flag fail-closed.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { treasuryAvailabilityHandler } from "./controllers/treasuryAvailabilityController.js";
import { TREASURY_AVAILABILITY_PATH } from "./contracts/treasuryContracts.js";
import { requireTreasuryModuleEnabled } from "./treasuryFeatureFlags.js";

export type TreasuryAuthGuards = {
  requireAppAuth: RequestHandler;
  /** Reservado para wiring futuro (prompt ACL); aceito para simetria com outros register*. */
  requireResource?: (resourceKey: string, action?: string) => RequestHandler;
};

/**
 * Registra rotas do módulo. Lógica de negócio permanece fora de server.ts.
 */
export function registerTreasuryRoutes(
  app: express.Express,
  auth: TreasuryAuthGuards
): void {
  const { requireAppAuth } = auth;

  app.get(
    TREASURY_AVAILABILITY_PATH,
    requireAppAuth,
    requireTreasuryModuleEnabled(),
    treasuryAvailabilityHandler
  );
}
