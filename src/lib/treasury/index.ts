/**
 * Barrel server-oriented da Tesouraria.
 * Não importar este arquivo a partir do frontend (pode puxar routes/controllers).
 * FE deve importar só contracts / money / access / feature flags / domain types.
 */

export { registerTreasuryRoutes } from "./treasuryRoutes.js";
export type { TreasuryAuthGuards } from "./treasuryRoutes.js";
export {
  TREASURY_API_PREFIX,
  TREASURY_AVAILABILITY_PATH,
  TREASURY_SCAFFOLD_VERSION,
} from "./contracts/treasuryContracts.js";
export type {
  TreasuryAvailabilityResponse,
  TreasuryMoneyString,
} from "./contracts/treasuryContracts.js";
export {
  TREASURY_ENABLED_ENV,
  TREASURY_FEATURE_FLAG_ENV,
  TREASURY_FEATURE_FLAG_IDS,
  TREASURY_FEATURE_RESOURCE,
  TREASURY_MASTER_FLAG,
  canShowTreasuryNavigation,
  isTreasuryFeatureFlagEnabled,
  isTreasuryModuleEnabled,
  listEnabledTreasuryFeatureFlags,
  requireTreasuryFeatureFlag,
  requireTreasuryModuleEnabled,
} from "./treasuryFeatureFlags.js";
export {
  TREASURY_ACTIONS,
  TREASURY_LEGACY_BAG_KEYS,
  TREASURY_RESOURCE_KEY,
  TREASURY_RESOURCE_KEYS,
} from "./treasuryAccess.js";
export {
  TREASURY_CAPABILITY_MATRIX,
  canTreasuryCapability,
  resolveTreasuryCapabilities,
} from "./treasuryPermissions.js";
export { startTreasuryScheduledJobs, listTreasuryJobs } from "./jobs/treasuryJobs.js";
