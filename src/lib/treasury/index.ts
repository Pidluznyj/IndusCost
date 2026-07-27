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
  TREASURY_FEATURE_RESOURCE,
  canShowTreasuryNavigation,
  isTreasuryModuleEnabled,
  requireTreasuryModuleEnabled,
} from "./treasuryFeatureFlags.js";
export { TREASURY_ACTIONS, TREASURY_RESOURCE_KEY } from "./treasuryAccess.js";
export { startTreasuryScheduledJobs, listTreasuryJobs } from "./jobs/treasuryJobs.js";
