/**
 * Disponibilidade técnica do módulo — sem regras financeiras.
 */

import type { TreasuryAvailabilityResponse } from "../contracts/treasuryContracts.js";
import { toTreasuryAvailabilityResponse } from "../mappers/treasuryMappers.js";
import {
  getTreasuryFeatureFlagsMap,
  isTreasuryModuleEnabled,
} from "../treasuryFeatureFlags.js";

export function getTreasuryAvailability(input?: {
  env?: Record<string, string | undefined>;
  serverTime?: Date;
}): TreasuryAvailabilityResponse {
  const env = input?.env ?? process.env;
  const enabled = isTreasuryModuleEnabled(env);
  return toTreasuryAvailabilityResponse({
    enabled,
    flags: getTreasuryFeatureFlagsMap(env),
    serverTime: input?.serverTime,
  });
}
