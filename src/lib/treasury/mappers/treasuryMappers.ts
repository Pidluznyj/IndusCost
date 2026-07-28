/**
 * Mappers DTO da Tesouraria (sem Prisma).
 */

import {
  TREASURY_SCAFFOLD_VERSION,
  formatTreasuryTimestampIso,
  type TreasuryAvailabilityResponse,
} from "../contracts/treasuryContracts.js";

export function toTreasuryAvailabilityResponse(input: {
  enabled: boolean;
  flags: Record<string, boolean>;
  serverTime?: Date;
}): TreasuryAvailabilityResponse {
  return {
    ok: true,
    module: "treasury",
    status: input.enabled ? "scaffold" : "disabled",
    enabled: input.enabled,
    flags: input.flags,
    scaffoldVersion: TREASURY_SCAFFOLD_VERSION,
    serverTimeIso: formatTreasuryTimestampIso(input.serverTime ?? new Date()),
  };
}
