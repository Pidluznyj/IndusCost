/**
 * Agrupamento oficial da navegação lateral (sidebar).
 * Fonte de verdade dos itens: SIDEBAR_MODULE_ORDER + MODULE_LABELS em modulePermissions.
 * Este módulo apenas mapeia itens existentes para grupos — sem novos paths, labels ou permissões.
 */

import { COMMISSIONS_VIEW_PERMISSIONS } from "@/src/lib/commissionsPermissions.js";
import { COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS } from "@/src/lib/commercialPriceTableAccess.js";
import {
  MODULE_LABELS,
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
} from "@/src/lib/modulePermissions.js";
import {
  resolveSidebarGroupResourceKey,
  resolveSidebarModuleResourceKey,
} from "@/src/lib/sidebarMenuResources.js";

/** Chave de ícone (nome do componente lucide-react) para uso futuro na sidebar agrupada. */
export type NavigationIconKey =
  | "LayoutDashboard"
  | "Package"
  | "HandCoins"
  | "Banknote"
  | "Warehouse"
  | "Truck"
  | "Settings"
  | "Users"
  | "FolderQuestion";

export type NavigationGroupId =
  | "dashboard"
  | "engenharia"
  | "cadeia_suprimentos"
  | "comercial"
  | "financeiro"
  | "operacoes"
  | "gestao_pessoas"
  | "administracao"
  | "outros";

export type NavigationGroup = {
  id: NavigationGroupId;
  label: string;
  iconKey: NavigationIconKey;
  order: number;
  /** ids de AppModuleId neste grupo (ordem de exibição dentro do grupo). */
  itemIds: readonly AppModuleId[];
  /** Grupo renderizado como item direto (sem accordion), ex.: Dashboard no topo. */
  isDirect?: boolean;
  /** resourceKey do catálogo (MENU pai). Visibilidade efetiva = filhos filtrados. */
  resourceKey?: string | null;
};

/** Referência mínima ao item de menu existente (sem ícones React — camada de dados). */
export type SidebarNavigationItemSource = {
  id: AppModuleId;
  label: string;
  path: string;
};

export type NavigationGroupedItem = {
  groupId: NavigationGroupId;
  itemId: AppModuleId;
  label: string;
  path: string;
  requiredPermissions: readonly string[];
  /** resourceKey do catálogo; null = fallback canAccessModule. */
  resourceKey: string | null;
  originalItem: SidebarNavigationItemSource;
};

export type NavigationGroupWithItems = NavigationGroup & {
  items: NavigationGroupedItem[];
};

export type GroupedNavigationStructure = {
  /** Itens diretos no topo (ex.: Dashboard), fora de accordions. */
  directItems: NavigationGroupedItem[];
  /** Grupos colapsáveis com ao menos um item mapeado. */
  groups: NavigationGroupWithItems[];
  /** Grupo fallback quando existir item não mapeado explicitamente. */
  fallbackGroup: NavigationGroupWithItems | null;
  /** ids presentes na navegação atual sem mapeamento explícito (auditoria). */
  unmappedItemIds: AppModuleId[];
};

/** Permissões de menu por módulo — espelho read-only de canAccessModule (OR entre entradas). */
export const MODULE_MENU_PERMISSION_KEYS: Record<AppModuleId, readonly string[]> = {
  dashboard: ["dashboard.view"],
  "crm-commercial": [
    "crm.view",
    "crm.general.view",
    "crm.seller.view",
    "crm.seller.own",
    "crm.seller.all",
  ],
  commissions: [...COMMISSIONS_VIEW_PERMISSIONS],
  customers: ["customers.view"],
  proposals: ["proposals.view"],
  "sales-orders": ["sales_orders.view"],
  "sales-order-flow": ["sales_orders.flow.view"],
  "output-documents": ["output_documents.view"],
  products: ["products.view"],
  "transformation-simulator": ["products.view", "simulations.view"],
  purchases: ["purchases.view"],
  "sc-purchases": ["operations.supply_chain.purchases.view"],
  pricing: ["pricing.view"],
  "commercial-price-table": [...COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS],
  employees: ["employees.view"],
  "employees-dashboard": ["employees.dashboard.view", "employees.edit"],
  "org-chart": ["employees.view"],
  machines: ["machines.view"],
  materials: ["materials.view"],
  opex: ["opex.view", "costs.view"],
  simulations: ["simulations.view"],
  taxes: ["taxes.view"],
  settings: ["settings.view", "users.manage"],
  maintenance: ["maintenance.view"],
  inventory: ["inventory.view"],
  "sc-inventory": ["operations.supply_chain.inventory.view"],
  "sc-receiving": ["operations.supply_chain.receiving.view"],
  "operations-performance": [
    "operations.component-performance.view",
    "operations.component-performance.edit",
    "products.view",
  ],
  "production-orders": ["operations.production-orders.view"],
  projects: ["projects.view"],
  fleet: ["fleet.view", "fleet.manage"],
  reports: ["reports.view", "dashboard.view"],
  finance: [
    "finance.view",
    "finance.accountsReceivable.view",
    "finance.accountsPayable.view",
    "reports.view",
    "settings.nomus.view",
    "settings.view",
  ],
  suppliers: [
    "finance.suppliers.view",
    "finance.cost_centers.view",
    "finance.view",
  ],
  "portfolio-reconciliation": [
    "finance.portfolioReconciliation.view",
    "finance.portfolioReconciliation.conciliation.view",
    "finance.portfolioReconciliation.intelligence.view",
    "finance.portfolioReconciliation.orderToCashAudit.view",
    "finance.portfolioReconciliation.orderStatusPedidos.view",
  ],
  guide: ["guide.view", "dashboard.view"],
};

/** Definição estática dos grupos oficiais da sidebar. */
export const NAVIGATION_GROUP_DEFINITIONS: readonly NavigationGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    iconKey: "LayoutDashboard",
    order: 1,
    itemIds: ["dashboard"],
    isDirect: true,
  },
  {
    id: "engenharia",
    label: "Engenharia",
    iconKey: "Package",
    order: 2,
    itemIds: ["products", "transformation-simulator", "simulations", "projects"],
  },
  {
    id: "cadeia_suprimentos",
    label: "Cadeia de Suprimentos",
    iconKey: "Truck",
    order: 3,
    itemIds: [
      "materials",
      "purchases",
      "sc-purchases",
      "inventory",
      "sc-inventory",
      "sc-receiving",
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    iconKey: "HandCoins",
    order: 4,
    itemIds: [
      "crm-commercial",
      "customers",
      "proposals",
      "commercial-price-table",
      "sales-orders",
      "sales-order-flow",
      "output-documents",
      "pricing",
      "commissions",
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    iconKey: "Banknote",
    order: 5,
    itemIds: ["finance", "suppliers", "portfolio-reconciliation", "opex", "taxes", "reports"],
  },
  {
    id: "operacoes",
    label: "Operações",
    iconKey: "Warehouse",
    order: 6,
    itemIds: [
      "machines",
      "operations-performance",
      "production-orders",
      "maintenance",
      "fleet",
    ],
  },
  {
    id: "gestao_pessoas",
    label: "Gestão de pessoas",
    iconKey: "Users",
    order: 7,
    itemIds: ["employees-dashboard", "employees", "org-chart"],
  },
  {
    id: "administracao",
    label: "Administração",
    iconKey: "Settings",
    order: 8,
    itemIds: ["settings", "guide"],
  },
];

const FALLBACK_GROUP_DEFINITION: NavigationGroup = {
  id: "outros",
  label: "Outros",
  iconKey: "FolderQuestion",
  order: 99,
  itemIds: [],
};

const EXPLICIT_MODULE_TO_GROUP = new Map<AppModuleId, NavigationGroupId>(
  NAVIGATION_GROUP_DEFINITIONS.flatMap((group) =>
    group.itemIds.map((itemId) => [itemId, group.id] as const)
  )
);

export function getModulePath(moduleId: AppModuleId): string {
  if (moduleId === "suppliers") return "/finance/suppliers";
  if (moduleId === "portfolio-reconciliation") return "/finance/portfolio-reconciliation";
  if (moduleId === "sales-order-flow") return "/commercial/sales-order-flow";
  if (moduleId === "commercial-price-table") return "/commercial/price-table";
  if (moduleId === "sc-purchases") return "/supply-chain/purchases";
  if (moduleId === "sc-inventory") return "/supply-chain/inventory";
  if (moduleId === "sc-receiving") return "/supply-chain/receiving";
  return `/${moduleId}`;
}

export function getSidebarNavigationItemSource(moduleId: AppModuleId): SidebarNavigationItemSource {
  return {
    id: moduleId,
    label: MODULE_LABELS[moduleId],
    path: getModulePath(moduleId),
  };
}

export function getModuleMenuPermissionKeys(moduleId: AppModuleId): readonly string[] {
  return MODULE_MENU_PERMISSION_KEYS[moduleId];
}

export function resolveNavigationGroupIdForModule(moduleId: AppModuleId): NavigationGroupId {
  return EXPLICIT_MODULE_TO_GROUP.get(moduleId) ?? "outros";
}

export function buildNavigationGroupedItem(moduleId: AppModuleId): NavigationGroupedItem {
  const originalItem = getSidebarNavigationItemSource(moduleId);
  return {
    groupId: resolveNavigationGroupIdForModule(moduleId),
    itemId: moduleId,
    label: originalItem.label,
    path: originalItem.path,
    requiredPermissions: getModuleMenuPermissionKeys(moduleId),
    resourceKey: resolveSidebarModuleResourceKey(moduleId),
    originalItem,
  };
}

/** Estrutura agrupada completa a partir da ordem oficial do menu lateral. */
export function buildGroupedNavigationStructure(): GroupedNavigationStructure {
  const allItems = SIDEBAR_MODULE_ORDER.map(buildNavigationGroupedItem);
  const unmappedItemIds = allItems
    .filter((item) => item.groupId === "outros")
    .map((item) => item.itemId);

  const directItems = allItems.filter((item) => {
    const def = NAVIGATION_GROUP_DEFINITIONS.find((g) => g.id === item.groupId);
    return def?.isDirect === true;
  });

  const directItemIds = new Set(directItems.map((item) => item.itemId));

  const groups: NavigationGroupWithItems[] = NAVIGATION_GROUP_DEFINITIONS.filter(
    (group) => !group.isDirect
  )
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      ...group,
      resourceKey: resolveSidebarGroupResourceKey(group.id),
      items: group.itemIds
        .map((itemId) => allItems.find((item) => item.itemId === itemId))
        .filter((item): item is NavigationGroupedItem => item != null),
    }))
    .filter((group) => group.items.length > 0);

  const fallbackItems = allItems.filter(
    (item) => item.groupId === "outros" && !directItemIds.has(item.itemId)
  );

  const fallbackGroup: NavigationGroupWithItems | null =
    fallbackItems.length > 0
      ? {
          ...FALLBACK_GROUP_DEFINITION,
          itemIds: fallbackItems.map((item) => item.itemId),
          items: fallbackItems,
        }
      : null;

  return {
    directItems,
    groups,
    fallbackGroup,
    unmappedItemIds,
  };
}

/** Todos os itens agrupados em ordem estável (direct → groups → fallback). */
export function flattenGroupedNavigationItems(
  structure: GroupedNavigationStructure = buildGroupedNavigationStructure()
): NavigationGroupedItem[] {
  return [
    ...structure.directItems,
    ...structure.groups.flatMap((group) => group.items),
    ...(structure.fallbackGroup?.items ?? []),
  ];
}
