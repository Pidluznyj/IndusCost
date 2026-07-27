/**
 * Feature flags da Central de Tesouraria — fail-closed.
 * Padrão alinhado a `salesOrderFlowFeatureFlags.ts` (env), com subflags nomeadas.
 * Sem Prisma.
 */

import type { RequestHandler } from "express";

/** Flag mestra (documental + runtime). */
export const TREASURY_MASTER_FLAG = "treasury.enabled" as const;

/** Catálogo mínimo de flags (Prompt ACL). */
export const TREASURY_FEATURE_FLAG_IDS = [
  "treasury.enabled",
  "treasury.accounts.enabled",
  "treasury.projection.enabled",
  "treasury.promises.enabled",
  "treasury.payablesProgramming.enabled",
  "treasury.transfers.enabled",
  "treasury.exceptions.enabled",
  "treasury.dailyClosing.enabled",
  "treasury.reconciliation.enabled",
  "treasury.ofxImport.enabled",
] as const;

export type TreasuryFeatureFlagId = (typeof TREASURY_FEATURE_FLAG_IDS)[number];

/** Env vars 1:1 (UPPER_SNAKE). `TREASURY_MODULE_ENABLED` permanece alias da mestra. */
export const TREASURY_FEATURE_FLAG_ENV: Record<TreasuryFeatureFlagId, string> = {
  "treasury.enabled": "TREASURY_MODULE_ENABLED",
  "treasury.accounts.enabled": "TREASURY_ACCOUNTS_ENABLED",
  "treasury.projection.enabled": "TREASURY_PROJECTION_ENABLED",
  "treasury.promises.enabled": "TREASURY_PROMISES_ENABLED",
  "treasury.payablesProgramming.enabled": "TREASURY_PAYABLES_PROGRAMMING_ENABLED",
  "treasury.transfers.enabled": "TREASURY_TRANSFERS_ENABLED",
  "treasury.exceptions.enabled": "TREASURY_EXCEPTIONS_ENABLED",
  "treasury.dailyClosing.enabled": "TREASURY_DAILY_CLOSING_ENABLED",
  "treasury.reconciliation.enabled": "TREASURY_RECONCILIATION_ENABLED",
  "treasury.ofxImport.enabled": "TREASURY_OFX_IMPORT_ENABLED",
};

/** @deprecated use TREASURY_MASTER_FLAG / TREASURY_FEATURE_FLAG_ENV */
export const TREASURY_FEATURE_RESOURCE = "finance.treasury.enabled";
/** @deprecated use TREASURY_FEATURE_FLAG_ENV["treasury.enabled"] */
export const TREASURY_ENABLED_ENV = TREASURY_FEATURE_FLAG_ENV["treasury.enabled"];

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function parseEnabled(raw: string | undefined): boolean {
  if (raw == null) return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Fail-closed para uma flag.
 * Subflags exigem `treasury.enabled` ligada (AND).
 * Flag desconhecida → sempre false.
 */
export function isTreasuryFeatureFlagEnabled(
  flagId: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!(TREASURY_FEATURE_FLAG_IDS as readonly string[]).includes(flagId)) {
    return false;
  }
  const id = flagId as TreasuryFeatureFlagId;
  const masterOn = parseEnabled(env[TREASURY_FEATURE_FLAG_ENV["treasury.enabled"]]);
  if (id === "treasury.enabled") return masterOn;
  if (!masterOn) return false;
  return parseEnabled(env[TREASURY_FEATURE_FLAG_ENV[id]]);
}

/** Alias da mestra. */
export function isTreasuryModuleEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTreasuryFeatureFlagEnabled("treasury.enabled", env);
}

export function listEnabledTreasuryFeatureFlags(
  env: Record<string, string | undefined> = process.env
): TreasuryFeatureFlagId[] {
  return TREASURY_FEATURE_FLAG_IDS.filter((id) => isTreasuryFeatureFlagEnabled(id, env));
}

/**
 * Guard HTTP: 404 quando a mestra (ou flag específica) está off.
 */
export function requireTreasuryModuleEnabled(
  env: Record<string, string | undefined> = process.env
): RequestHandler {
  return requireTreasuryFeatureFlag("treasury.enabled", env);
}

export function requireTreasuryFeatureFlag(
  flagId: TreasuryFeatureFlagId,
  env: Record<string, string | undefined> = process.env
): RequestHandler {
  return (_req, res, next) => {
    if (!isTreasuryFeatureFlagEnabled(flagId, env)) {
      return res.status(404).json({ error: "API route not found" });
    }
    return next();
  };
}

/**
 * Nav/UI: flag não substitui autorização.
 */
export function canShowTreasuryNavigation(input: {
  featureEnabled: boolean;
  hasTreasuryViewAccess: boolean;
}): boolean {
  return input.featureEnabled && input.hasTreasuryViewAccess;
}
