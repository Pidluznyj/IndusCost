/**
 * Status administrativo read-only das flags SC (sem DB).
 */

import {
  getSupplyChainFeatureFlags,
  SUPPLY_CHAIN_FEATURE_ENV,
  SUPPLY_CHAIN_FEATURE_RESOURCES,
  type SupplyChainFeatureFlagsSnapshot,
} from "./supplyChainFeatureFlags.js";

export type SupplyChainModulesAdminStatus = {
  features: SupplyChainFeatureFlagsSnapshot;
  env: typeof SUPPLY_CHAIN_FEATURE_ENV;
  resources: typeof SUPPLY_CHAIN_FEATURE_RESOURCES;
  modules: Array<{
    moduleId: "sc-purchases" | "sc-inventory" | "sc-receiving";
    label: string;
    path: string;
    enabled: boolean;
    contractKey: string;
    viewPermission: string;
  }>;
  notes: string[];
  generatedAt: string;
};

export function buildSupplyChainModulesAdminStatus(
  env: Record<string, string | undefined> = process.env,
  now: () => Date = () => new Date()
): SupplyChainModulesAdminStatus {
  const features = getSupplyChainFeatureFlags(env);
  return {
    features,
    env: SUPPLY_CHAIN_FEATURE_ENV,
    resources: SUPPLY_CHAIN_FEATURE_RESOURCES,
    modules: [
      {
        moduleId: "sc-purchases",
        label: "Compras SC",
        path: "/supply-chain/purchases",
        enabled: features.purchases,
        contractKey: "operations.supply_chain.purchases",
        viewPermission: "operations.supply_chain.purchases.view",
      },
      {
        moduleId: "sc-inventory",
        label: "Estoque SC",
        path: "/supply-chain/inventory",
        enabled: features.inventory,
        contractKey: "operations.supply_chain.inventory",
        viewPermission: "operations.supply_chain.inventory.view",
      },
      {
        moduleId: "sc-receiving",
        label: "Recebimentos",
        path: "/supply-chain/receiving",
        enabled: features.receiving,
        contractKey: "operations.supply_chain.receiving",
        viewPermission: "operations.supply_chain.receiving.view",
      },
    ],
    notes: [
      "Flags desligadas por padrão (fail closed).",
      "Rotas legadas /purchases e /inventory permanecem independentes destas flags.",
      "Permissão de view é específica — não usa purchases.view nem inventory.view.",
    ],
    generatedAt: now().toISOString(),
  };
}
