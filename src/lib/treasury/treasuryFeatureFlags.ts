/**
 * Feature flag da Central de Tesouraria — fail-closed.
 * Espelha o padrão de `salesOrderFlowFeatureFlags.ts`.
 * Sem Prisma — seguro para checagens server-side e testes.
 */

import type { RequestHandler } from "express";

/** Nome conceitual / documental. */
export const TREASURY_FEATURE_RESOURCE = "finance.treasury.enabled";

/** Mecanismo oficial: flag de ambiente. */
export const TREASURY_ENABLED_ENV = "TREASURY_MODULE_ENABLED";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

/**
 * Fail closed: ausente, vazia ou valor desconhecido = desabilitada.
 */
export function isTreasuryModuleEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[TREASURY_ENABLED_ENV]?.trim().toLowerCase();
  return raw != null && ENABLED_VALUES.has(raw);
}

/**
 * Guard HTTP: 404 quando desabilitada (não expor superfície).
 */
export function requireTreasuryModuleEnabled(
  env: Record<string, string | undefined> = process.env
): RequestHandler {
  return (_req, res, next) => {
    if (!isTreasuryModuleEnabled(env)) {
      return res.status(404).json({ error: "API route not found" });
    }
    return next();
  };
}

/**
 * Nav/UI: flag não substitui autorização (ACL em prompt dedicado).
 */
export function canShowTreasuryNavigation(input: {
  featureEnabled: boolean;
  hasTreasuryViewAccess: boolean;
}): boolean {
  return input.featureEnabled && input.hasTreasuryViewAccess;
}
