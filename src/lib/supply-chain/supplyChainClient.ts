/**
 * Cliente HTTP das flags SC (menu / casca).
 */

import { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http.js";
import type { SUPPLY_CHAIN_FEATURE_RESOURCES } from "./supplyChainFeatureFlags.js";

export const SUPPLY_CHAIN_FEATURE_STATUS_API_PATH =
  "/api/supply-chain/feature-status";

export type SupplyChainFeatureStatusResponse = {
  enabled: {
    purchases: boolean;
    inventory: boolean;
    receiving: boolean;
    shadowPlanning: boolean;
    indicators: boolean;
    supplierPerformance: boolean;
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

/**
 * Estado das feature flags SC para a interface.
 *
 * `null` enquanto carrega — quem consome NÃO pode tratar `null` como "ligado":
 * o contrato é fail-closed, e uma tela que assume ligado enquanto carrega
 * pisca ação indisponível. Falha de rede também resolve para tudo desligado.
 */
export function useSupplyChainFeatureFlags(): SupplyChainFeatureStatusResponse["enabled"] | null {
  const [flags, setFlags] = useState<SupplyChainFeatureStatusResponse["enabled"] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) setFlags(status.enabled);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFlags({
            purchases: false,
            inventory: false,
            receiving: false,
            shadowPlanning: false,
            indicators: false,
            supplierPerformance: false,
          });
        }
      });
    return () => controller.abort();
  }, []);

  return flags;
}
