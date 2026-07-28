/**
 * Cliente HTTP — availability / flags de rollout (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_AVAILABILITY_PATH,
  type TreasuryAvailabilityResponse,
} from "@/src/lib/treasury/contracts/index.js";

export async function fetchTreasuryAvailability(input?: {
  signal?: AbortSignal;
}): Promise<TreasuryAvailabilityResponse> {
  return fetchJsonOk<TreasuryAvailabilityResponse>(TREASURY_AVAILABILITY_PATH, {
    signal: input?.signal,
  });
}
