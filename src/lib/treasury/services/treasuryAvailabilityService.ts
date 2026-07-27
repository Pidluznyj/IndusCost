/**
 * Disponibilidade técnica do módulo — sem regras financeiras.
 */

import type { TreasuryAvailabilityResponse } from "../contracts/treasuryContracts.js";
import { toTreasuryAvailabilityResponse } from "../mappers/treasuryMappers.js";
import { isTreasuryModuleEnabled } from "../treasuryFeatureFlags.js";

export function getTreasuryAvailability(input?: {
  env?: Record<string, string | undefined>;
  serverTime?: Date;
}): TreasuryAvailabilityResponse {
  const enabled = isTreasuryModuleEnabled(input?.env ?? process.env);
  return toTreasuryAvailabilityResponse({
    enabled,
    serverTime: input?.serverTime,
  });
}
