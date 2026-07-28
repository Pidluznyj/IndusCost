/**
 * Filtro de menu da Central de Tesouraria (feature flag + permissão).
 */
import { canShowTreasuryNavigation } from "@/src/lib/treasury/treasuryFeatureFlags.js";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";

export const TREASURY_MODULE_ID = "treasury" as const;

function filterGroupItems<T extends { itemId: string }>(
  items: readonly T[],
  includeTreasury: boolean
): T[] {
  if (includeTreasury) return [...items];
  return items.filter((item) => item.itemId !== TREASURY_MODULE_ID);
}

/**
 * Remove o item Tesouraria quando a feature está desligada ou a
 * permissão finance.treasury.view não existe. Fail closed: featureEnabled !== true
 * também oculta o item.
 */
export function filterTreasuryMenuNavigation(
  navigation: SidebarAccessibleNavigation,
  input: {
    featureEnabled: boolean | null;
    hasTreasuryViewAccess: boolean;
  }
): SidebarAccessibleNavigation {
  const includeTreasury = canShowTreasuryNavigation({
    featureEnabled: input.featureEnabled === true,
    hasTreasuryViewAccess: input.hasTreasuryViewAccess,
  });

  return {
    ...navigation,
    groups: navigation.groups
      .map((group) => ({
        ...group,
        items: filterGroupItems(group.items, includeTreasury),
      }))
      .filter((group) => group.items.length > 0),
    fallbackGroup: navigation.fallbackGroup
      ? {
          ...navigation.fallbackGroup,
          items: filterGroupItems(navigation.fallbackGroup.items, includeTreasury),
        }
      : null,
    flatAccessibleItems: includeTreasury
      ? [...navigation.flatAccessibleItems]
      : navigation.flatAccessibleItems.filter((item) => item.id !== TREASURY_MODULE_ID),
  };
}

/** View do módulo (menu / deep-link) — bags canônicas. */
export function canViewTreasuryModule(input: {
  hasPermission: (permission: string) => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
}): boolean {
  if (input.canPerformAction?.("finance.treasury", "view")) return true;
  return input.hasPermission("finance.treasury.view");
}
