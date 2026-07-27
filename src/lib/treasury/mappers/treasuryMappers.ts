/**
 * Mappers DTO da Tesouraria (sem Prisma).
 */

import {
  TREASURY_SCAFFOLD_VERSION,
  type TreasuryAvailabilityResponse,
} from "../contracts/treasuryContracts.js";

export function toTreasuryAvailabilityResponse(input: {
  enabled: boolean;
  serverTime?: Date;
}): TreasuryAvailabilityResponse {
  return {
    ok: true,
    module: "treasury",
    status: input.enabled ? "scaffold" : "disabled",
    enabled: input.enabled,
    scaffoldVersion: TREASURY_SCAFFOLD_VERSION,
    serverTimeIso: (input.serverTime ?? new Date()).toISOString(),
  };
}
