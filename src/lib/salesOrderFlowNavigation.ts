/**
 * Filtro de menu do Fluxo de Pedidos (feature flag + permissão).
 */
import { canShowSalesOrderFlowNavigation } from "@/src/lib/sales/salesOrderFlowFeatureFlags.js";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import { SALES_ORDER_FLOW_MODULE_ID } from "@/src/lib/salesOrderFlowUi.js";

function filterGroupItems<T extends { itemId: string }>(
  items: readonly T[],
  includeFlow: boolean
): T[] {
  if (includeFlow) return [...items];
  return items.filter((item) => item.itemId !== SALES_ORDER_FLOW_MODULE_ID);
}

/**
 * Remove o item Fluxo de Pedidos quando a feature está desligada ou a
 * permissão de view do fluxo não existe. Fail closed: `featureEnabled !== true`
 * também oculta o item.
 */
export function filterSalesOrderFlowMenuNavigation(
  navigation: SidebarAccessibleNavigation,
  input: {
    featureEnabled: boolean | null;
    hasFlowViewAccess: boolean;
  }
): SidebarAccessibleNavigation {
  const includeFlow = canShowSalesOrderFlowNavigation({
    featureEnabled: input.featureEnabled === true,
    hasSalesOrdersViewAccess: input.hasFlowViewAccess,
  });

  return {
    ...navigation,
    groups: navigation.groups
      .map((group) => ({
        ...group,
        items: filterGroupItems(group.items, includeFlow),
      }))
      .filter((group) => group.items.length > 0),
    fallbackGroup: navigation.fallbackGroup
      ? {
          ...navigation.fallbackGroup,
          items: filterGroupItems(navigation.fallbackGroup.items, includeFlow),
        }
      : null,
    flatItems: filterGroupItems(navigation.flatItems, includeFlow),
  };
}
