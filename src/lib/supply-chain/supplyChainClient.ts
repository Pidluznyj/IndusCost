/**
 * Cliente HTTP das flags SC (menu / casca).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import type { SUPPLY_CHAIN_FEATURE_RESOURCES } from "./supplyChainFeatureFlags.js";

export const SUPPLY_CHAIN_FEATURE_STATUS_API_PATH =
  "/api/supply-chain/feature-status";

export type SupplyChainFeatureStatusResponse = {
  enabled: {
    purchases: boolean;
    inventory: boolean;
    receiving: boolean;
  };
  resources: typeof SUPPLY_CHAIN_FEATURE_RESOURCES;
  defaultWhenAbsent: false;
};

export function fetchSupplyChainFeatureStatus(
  signal?: AbortSignal
): Promise<SupplyChainFeatureStatusResponse> {
  return fetchJsonOk<SupplyChainFeatureStatusResponse>(
    SUPPLY_CHAIN_FEATURE_STATUS_API_PATH,
    signal ? { signal } : undefined
  );
}
