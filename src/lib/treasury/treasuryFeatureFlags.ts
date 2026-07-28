/**
 * Feature flags da Central de Tesouraria.
 * - Catálogo conhecido: default **ligado** (ativação operacional); opt-out via env `0`/`false`.
 * - Flag desconhecida: sempre **fail-closed** (false).
 * - Subflags exigem mestra ON (AND).
 * Sem Prisma.
 */

import type { RequestHandler } from "express";

/** Flag mestra (documental + runtime). */
export const TREASURY_MASTER_FLAG = "treasury.enabled" as const;

/**
 * Default de ativação para flags do catálogo quando a env está ausente.
 * Desligamento emergencial: `TREASURY_MODULE_ENABLED=0` (e/ou subflag=0).
 */
export const TREASURY_FEATURE_FLAG_DEFAULT_ENABLED = true;

/** Catálogo de flags de rollout por submódulo (+ auxiliares). */
export const TREASURY_FEATURE_FLAG_IDS = [
  "treasury.enabled",
  "treasury.accounts.enabled",
  "treasury.balances.enabled",
  "treasury.dashboard.enabled",
  "treasury.receivables.enabled",
  "treasury.payables.enabled",
  "treasury.projection.enabled",
  "treasury.promises.enabled",
  "treasury.payablesProgramming.enabled",
  "treasury.transfers.enabled",
  "treasury.exceptions.enabled",
  "treasury.dailyClosing.enabled",
  "treasury.reconciliation.enabled",
  "treasury.ofxImport.enabled",
  "treasury.reports.enabled",
] as const;

export type TreasuryFeatureFlagId = (typeof TREASURY_FEATURE_FLAG_IDS)[number];

/** Env vars 1:1 (UPPER_SNAKE). `TREASURY_MODULE_ENABLED` permanece alias da mestra. */
export const TREASURY_FEATURE_FLAG_ENV: Record<TreasuryFeatureFlagId, string> = {
  "treasury.enabled": "TREASURY_MODULE_ENABLED",
  "treasury.accounts.enabled": "TREASURY_ACCOUNTS_ENABLED",
  "treasury.balances.enabled": "TREASURY_BALANCES_ENABLED",
  "treasury.dashboard.enabled": "TREASURY_DASHBOARD_ENABLED",
  "treasury.receivables.enabled": "TREASURY_RECEIVABLES_ENABLED",
  "treasury.payables.enabled": "TREASURY_PAYABLES_ENABLED",
  "treasury.projection.enabled": "TREASURY_PROJECTION_ENABLED",
  "treasury.promises.enabled": "TREASURY_PROMISES_ENABLED",
  "treasury.payablesProgramming.enabled": "TREASURY_PAYABLES_PROGRAMMING_ENABLED",
  "treasury.transfers.enabled": "TREASURY_TRANSFERS_ENABLED",
  "treasury.exceptions.enabled": "TREASURY_EXCEPTIONS_ENABLED",
  "treasury.dailyClosing.enabled": "TREASURY_DAILY_CLOSING_ENABLED",
  "treasury.reconciliation.enabled": "TREASURY_RECONCILIATION_ENABLED",
  "treasury.ofxImport.enabled": "TREASURY_OFX_IMPORT_ENABLED",
  "treasury.reports.enabled": "TREASURY_REPORTS_ENABLED",
};

/** @deprecated use TREASURY_MASTER_FLAG / TREASURY_FEATURE_FLAG_ENV */
export const TREASURY_FEATURE_RESOURCE = "finance.treasury.enabled";
/** @deprecated use TREASURY_FEATURE_FLAG_ENV["treasury.enabled"] */
export const TREASURY_ENABLED_ENV = TREASURY_FEATURE_FLAG_ENV["treasury.enabled"];

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

/**
 * Parse de env para flags do catálogo.
 * Ausente/vazio → `defaultWhenAbsent` (ativação).
 * Valor explícito truthy/falsy → respeitado.
 */
function parseEnabled(
  raw: string | undefined,
  defaultWhenAbsent: boolean = TREASURY_FEATURE_FLAG_DEFAULT_ENABLED
): boolean {
  if (raw == null) return defaultWhenAbsent;
  const v = raw.trim().toLowerCase();
  if (v === "") return defaultWhenAbsent;
  if (DISABLED_VALUES.has(v)) return false;
  if (ENABLED_VALUES.has(v)) return true;
  // Valor desconhecido em env conhecida → fail-closed (não ativa).
  return false;
}

/**
 * Resolve uma flag do catálogo.
 * Subflags exigem `treasury.enabled` ligada (AND).
 * Flag desconhecida → sempre false (fail-closed).
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
  return TREASURY_FEATURE_FLAG_IDS.filter((id) =>
    isTreasuryFeatureFlagEnabled(id, env)
  );
}

/** Snapshot completo (todas as flags conhecidas → boolean). Fail-closed. */
export function getTreasuryFeatureFlagsMap(
  env: Record<string, string | undefined> = process.env
): Record<TreasuryFeatureFlagId, boolean> {
  const out = {} as Record<TreasuryFeatureFlagId, boolean>;
  for (const id of TREASURY_FEATURE_FLAG_IDS) {
    out[id] = isTreasuryFeatureFlagEnabled(id, env);
  }
  return out;
}

/**
 * Guard HTTP: 404 quando a mestra (ou flag específica) está off.
 * Não apaga dados — apenas bloqueia acesso ao endpoint.
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
