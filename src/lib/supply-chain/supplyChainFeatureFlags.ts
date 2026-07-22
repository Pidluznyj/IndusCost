/**
 * OP-05 — Feature flags da Cadeia de Suprimentos (casca controlada).
 * Fail closed: ausente/inválida = desligada. Permissão ≠ flag.
 */

import type { RequestHandler } from "express";

export const SUPPLY_CHAIN_MODULE_IDS = [
  "sc-purchases",
  "sc-inventory",
  "sc-receiving",
] as const;

export type SupplyChainModuleId = (typeof SUPPLY_CHAIN_MODULE_IDS)[number];

/** Nomes conceituais/documentais das features. */
export const SUPPLY_CHAIN_FEATURE_RESOURCES = {
  purchases: "operations.supply_chain.purchases.enabled",
  inventory: "operations.supply_chain.inventory.enabled",
  receiving: "operations.supply_chain.receiving.enabled",
  shadowPlanning: "operations.supply_chain.shadow_planning.enabled",
} as const;

/** Env vars oficiais (server-side). */
export const SUPPLY_CHAIN_FEATURE_ENV = {
  purchases: "SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED",
  inventory: "SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED",
  receiving: "SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED",
  shadowPlanning: "SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED",
} as const;

export type SupplyChainFeatureKey = keyof typeof SUPPLY_CHAIN_FEATURE_ENV;

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

export function isEnvFlagEnabled(
  envName: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[envName]?.trim().toLowerCase();
  return raw != null && ENABLED_VALUES.has(raw);
}

export function isSupplyChainPurchasesModuleEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.purchases, env);
}

export function isSupplyChainInventoryModuleEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.inventory, env);
}

export function isSupplyChainReceivingModuleEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.receiving, env);
}

export function isSupplyChainShadowPlanningEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isEnvFlagEnabled(SUPPLY_CHAIN_FEATURE_ENV.shadowPlanning, env);
}

export function isSupplyChainModuleEnabled(
  moduleId: SupplyChainModuleId,
  env: Record<string, string | undefined> = process.env
): boolean {
  switch (moduleId) {
    case "sc-purchases":
      return isSupplyChainPurchasesModuleEnabled(env);
    case "sc-inventory":
      return isSupplyChainInventoryModuleEnabled(env);
    case "sc-receiving":
      return isSupplyChainReceivingModuleEnabled(env);
    default:
      return false;
  }
}

export type SupplyChainFeatureFlagsSnapshot = {
  purchases: boolean;
  inventory: boolean;
  receiving: boolean;
  shadowPlanning: boolean;
  resources: typeof SUPPLY_CHAIN_FEATURE_RESOURCES;
  defaultWhenAbsent: false;
};

export function getSupplyChainFeatureFlags(
  env: Record<string, string | undefined> = process.env
): SupplyChainFeatureFlagsSnapshot {
  return {
    purchases: isSupplyChainPurchasesModuleEnabled(env),
    inventory: isSupplyChainInventoryModuleEnabled(env),
    receiving: isSupplyChainReceivingModuleEnabled(env),
    shadowPlanning: isSupplyChainShadowPlanningEnabled(env),
    resources: SUPPLY_CHAIN_FEATURE_RESOURCES,
    defaultWhenAbsent: false,
  };
}

/** Flag ∧ permissão — regra única de navegação. */
export function canShowSupplyChainModuleNavigation(input: {
  featureEnabled: boolean;
  hasViewAccess: boolean;
}): boolean {
  return input.featureEnabled && input.hasViewAccess;
}

export function requireSupplyChainModuleEnabled(
  moduleId: SupplyChainModuleId,
  env: Record<string, string | undefined> = process.env
): RequestHandler {
  return (_req, res, next) => {
    if (!isSupplyChainModuleEnabled(moduleId, env)) {
      return res.status(404).json({ error: "API route not found" });
    }
    return next();
  };
}

/** Guard genérico por env var (ex.: planejamento sombra OP-25). */
export function requireEnvFlagEnabled(
  envName: string,
  env: Record<string, string | undefined> = process.env
): RequestHandler {
  return (_req, res, next) => {
    if (!isEnvFlagEnabled(envName, env)) {
      return res.status(404).json({ error: "API route not found" });
    }
    return next();
  };
}
