import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import { PERFORMANCE_MODULE_ID } from "./performanceDomain.js";

/** Some o item enquanto a flag não chegou ou está desligada. Permissão não liga a flag. */
export function filterPerformanceMenuNavigation(
  navigation: SidebarAccessibleNavigation,
  featureEnabled: boolean | null
): SidebarAccessibleNavigation {
  if (featureEnabled === true) return navigation;
  const drop = <T extends { itemId: string }>(items: readonly T[]) => items.filter((item) => item.itemId !== PERFORMANCE_MODULE_ID);
  return {
    ...navigation,
    groups: navigation.groups.map((group) => ({ ...group, items: drop(group.items) })).filter((group) => group.items.length > 0),
    fallbackGroup: navigation.fallbackGroup
      ? { ...navigation.fallbackGroup, items: drop(navigation.fallbackGroup.items) }
      : null,
    flatAccessibleItems: navigation.flatAccessibleItems.filter((item) => item.id !== PERFORMANCE_MODULE_ID),
  };
}
