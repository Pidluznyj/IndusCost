/**
 * Filtro de menu dos módulos SC controlados (flag + permissão).
 */

import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import {
  canShowSupplyChainModuleNavigation,
  type SupplyChainModuleId,
  SUPPLY_CHAIN_MODULE_IDS,
} from "./supplyChainFeatureFlags.js";

export type SupplyChainMenuFeatureState = {
  purchases: boolean | null;
  inventory: boolean | null;
  receiving: boolean | null;
};

export type SupplyChainMenuAccessState = {
  purchases: boolean;
  inventory: boolean;
  receiving: boolean;
};

function moduleIncluded(
  moduleId: SupplyChainModuleId,
  features: SupplyChainMenuFeatureState,
  access: SupplyChainMenuAccessState
): boolean {
  const featureEnabled =
    moduleId === "sc-purchases"
      ? features.purchases === true
      : moduleId === "sc-inventory"
        ? features.inventory === true
        : features.receiving === true;
  const hasViewAccess =
    moduleId === "sc-purchases"
      ? access.purchases
      : moduleId === "sc-inventory"
        ? access.inventory
        : access.receiving;
  return canShowSupplyChainModuleNavigation({ featureEnabled, hasViewAccess });
}

function keepItem(itemId: string, features: SupplyChainMenuFeatureState, access: SupplyChainMenuAccessState): boolean {
  if (!(SUPPLY_CHAIN_MODULE_IDS as readonly string[]).includes(itemId)) {
    return true;
  }
  return moduleIncluded(itemId as SupplyChainModuleId, features, access);
}

/**
 * Remove cascas SC quando a flag está off ou sem permissão específica.
 * Não afeta `purchases` / `inventory` legados.
 */
export function filterSupplyChainMenuNavigation(
  navigation: SidebarAccessibleNavigation,
  features: SupplyChainMenuFeatureState,
  access: SupplyChainMenuAccessState
): SidebarAccessibleNavigation {
  const filterItems = <T extends { itemId?: string; id?: string }>(items: readonly T[]): T[] =>
    items.filter((item) => {
      const id = (item.itemId ?? item.id) as string;
      return keepItem(id, features, access);
    });

  return {
    ...navigation,
    groups: navigation.groups
      .map((group) => ({
        ...group,
        items: filterItems(group.items),
      }))
      .filter((group) => group.items.length > 0),
    fallbackGroup: navigation.fallbackGroup
      ? {
          ...navigation.fallbackGroup,
          items: filterItems(navigation.fallbackGroup.items),
        }
      : null,
    flatAccessibleItems: filterItems(navigation.flatAccessibleItems),
  };
}
