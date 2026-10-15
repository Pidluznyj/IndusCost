/**
 * Filtro de menu de Competências e Desenvolvimento (feature flag). Fail closed:
 * enquanto o status não chegou (null) ou com a flag desligada, o item não aparece.
 * A permissão continua vindo do DTO (/me); este filtro só retira o item.
 */
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import { COMPETENCY_MODULE_ID } from "./competencyAccess";

export function filterCompetenciesMenuNavigation(
  navigation: SidebarAccessibleNavigation,
  featureEnabled: boolean | null,
): SidebarAccessibleNavigation {
  if (featureEnabled === true) return navigation;
  const drop = <T extends { itemId: string }>(items: readonly T[]) => items.filter((i) => i.itemId !== COMPETENCY_MODULE_ID);
  return {
    ...navigation,
    groups: navigation.groups.map((g) => ({ ...g, items: drop(g.items) })).filter((g) => g.items.length > 0),
    fallbackGroup: navigation.fallbackGroup ? { ...navigation.fallbackGroup, items: drop(navigation.fallbackGroup.items) } : null,
    flatAccessibleItems: navigation.flatAccessibleItems.filter((item) => item.id !== COMPETENCY_MODULE_ID),
  };
}
