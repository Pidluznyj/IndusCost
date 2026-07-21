/**
 * Camada de sidebar: ícones, filtro por permissão e helpers de expansão de grupos.
 * Paths e permissões continuam definidos em modulePermissions + navigationGroups.
 * resourceKey (catálogo relacional) tem prioridade quando `canViewResource` é informado.
 */

import {
  buildGroupedNavigationStructure,
  getModulePath,
  resolveNavigationGroupIdForModule,
  type GroupedNavigationStructure,
  type NavigationGroupId,
  type NavigationGroupWithItems,
  type NavigationGroupedItem,
} from "@/src/lib/navigationGroups.js";
import {
  canAccessModule,
  resolveModuleIdFromPath,
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";

export type SidebarMenuItemDef = {
  id: AppModuleId;
  label: string;
  path: string;
  resourceKey?: string | null;
};

export type SidebarAccessibleNavigation = {
  directItems: NavigationGroupedItem[];
  groups: NavigationGroupWithItems[];
  fallbackGroup: NavigationGroupWithItems | null;
  /** Ordem oficial do menu, filtrada por permissão (modo colapsado / auditoria). */
  flatAccessibleItems: SidebarMenuItemDef[];
};

export type SidebarResourceViewer = (resourceKey: string) => boolean;

export type SidebarAccessOptions = {
  /**
   * Quando informado, itens com `resourceKey` usam o catálogo relacional.
   * Itens sem resourceKey continuam em `canAccessModule`.
   */
  canViewResource?: SidebarResourceViewer;
};

function toMenuItemDef(item: NavigationGroupedItem): SidebarMenuItemDef {
  return {
    id: item.itemId,
    label: item.label,
    path: item.path,
    resourceKey: item.resourceKey,
  };
}

function isSidebarItemVisible(
  item: NavigationGroupedItem,
  check: PermissionChecker,
  canViewResource?: SidebarResourceViewer
): boolean {
  if (item.resourceKey && canViewResource) {
    return canViewResource(item.resourceKey);
  }
  return canAccessModule(item.itemId, check);
}

function filterItems(
  items: NavigationGroupedItem[],
  check: PermissionChecker,
  canViewResource?: SidebarResourceViewer
): NavigationGroupedItem[] {
  return items.filter((item) => isSidebarItemVisible(item, check, canViewResource));
}

function filterGroup(
  group: NavigationGroupWithItems,
  check: PermissionChecker,
  canViewResource?: SidebarResourceViewer
): NavigationGroupWithItems | null {
  const items = filterItems(group.items, check, canViewResource);
  // Pai só aparece se houver ao menos um submenu/item visível (regra 2).
  if (items.length === 0) return null;
  return {
    ...group,
    items,
    itemIds: items.map((item) => item.itemId),
  };
}

/** Estrutura agrupada visível na sidebar respeitando resourceKey + canAccessModule. */
export function buildAccessibleSidebarNavigation(
  check: PermissionChecker,
  structure: GroupedNavigationStructure = buildGroupedNavigationStructure(),
  options?: SidebarAccessOptions
): SidebarAccessibleNavigation {
  const canViewResource = options?.canViewResource;
  const directItems = filterItems(structure.directItems, check, canViewResource);
  const groups = structure.groups
    .map((group) => filterGroup(group, check, canViewResource))
    .filter((group): group is NavigationGroupWithItems => group != null);
  const fallbackGroup = structure.fallbackGroup
    ? filterGroup(structure.fallbackGroup, check, canViewResource)
    : null;

  const flatAccessibleItems = SIDEBAR_MODULE_ORDER.filter((moduleId) => {
    const fromStructure =
      structure.directItems.find((item) => item.itemId === moduleId) ??
      structure.groups.flatMap((g) => g.items).find((item) => item.itemId === moduleId) ??
      structure.fallbackGroup?.items.find((item) => item.itemId === moduleId);
    if (fromStructure) {
      return isSidebarItemVisible(fromStructure, check, canViewResource);
    }
    return canAccessModule(moduleId, check);
  }).map((moduleId) => {
    const fromStructure =
      structure.directItems.find((item) => item.itemId === moduleId) ??
      structure.groups.flatMap((g) => g.items).find((item) => item.itemId === moduleId) ??
      structure.fallbackGroup?.items.find((item) => item.itemId === moduleId);
    if (fromStructure) return toMenuItemDef(fromStructure);
    return {
      id: moduleId,
      label: moduleId,
      path: getModulePath(moduleId),
      resourceKey: null,
    };
  });

  return {
    directItems,
    groups,
    fallbackGroup,
    flatAccessibleItems,
  };
}

export function resolveActiveModuleFromPath(pathname: string): AppModuleId | null {
  return resolveModuleIdFromPath(pathname);
}

export function resolveActiveNavigationGroupId(
  pathname: string,
  navigation: SidebarAccessibleNavigation = buildAccessibleSidebarNavigation({
    hasPermission: () => true,
    hasAnyPermission: () => true,
  })
): NavigationGroupId | null {
  const moduleId = resolveActiveModuleFromPath(pathname);
  if (!moduleId) return null;

  const groupId = resolveNavigationGroupIdForModule(moduleId);
  if (groupId === "dashboard") return null;

  const inDirect = navigation.directItems.some((item) => item.itemId === moduleId);
  if (inDirect) return null;

  const inGroup = navigation.groups.some(
    (group) => group.id === groupId && group.items.some((item) => item.itemId === moduleId)
  );
  if (inGroup) return groupId;

  if (
    navigation.fallbackGroup?.items.some((item) => item.itemId === moduleId) &&
    groupId === "outros"
  ) {
    return "outros";
  }

  return null;
}

/** Grupos que devem estar abertos para a rota ativa. */
export function resolveExpandedGroupsForPath(
  pathname: string,
  navigation?: SidebarAccessibleNavigation
): NavigationGroupId[] {
  const activeGroupId = resolveActiveNavigationGroupId(pathname, navigation);
  return activeGroupId ? [activeGroupId] : [];
}

export function mergeExpandedNavigationGroups(
  current: ReadonlySet<NavigationGroupId>,
  required: readonly NavigationGroupId[]
): Set<NavigationGroupId> {
  const next = new Set(current);
  for (const groupId of required) {
    next.add(groupId);
  }
  return next;
}

export const SIDEBAR_GROUP_UI_LABELS = [
  "Engenharia",
  "Cadeia de Suprimentos",
  "Comercial",
  "Financeiro",
  "Operações",
  "Administração",
] as const;

export const SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY = "induscost.sidebar.expandedGroups";

const PERSISTABLE_GROUP_IDS: readonly NavigationGroupId[] = [
  "engenharia",
  "cadeia_suprimentos",
  "comercial",
  "financeiro",
  "operacoes",
  "administracao",
  "outros",
];

function isPersistableNavigationGroupId(value: unknown): value is NavigationGroupId {
  return (
    typeof value === "string" &&
    (PERSISTABLE_GROUP_IDS as readonly string[]).includes(value)
  );
}

/** Lê localStorage (ou valor injetado em testes) com fallback seguro para Set vazio. */
export function parseStoredExpandedGroups(raw: string | null | undefined): Set<NavigationGroupId> {
  if (raw == null || raw.trim() === "") return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const valid = parsed.filter(isPersistableNavigationGroupId);
    return new Set(valid);
  } catch {
    return new Set();
  }
}

export function serializeExpandedGroups(groups: ReadonlySet<NavigationGroupId>): string {
  return JSON.stringify([...groups].sort());
}

/** Estado inicial: preferências salvas + grupo da rota ativa (se houver). */
export function resolveInitialExpandedGroups(
  pathname: string,
  navigation: SidebarAccessibleNavigation,
  stored: ReadonlySet<NavigationGroupId> = new Set()
): Set<NavigationGroupId> {
  return mergeExpandedNavigationGroups(stored, resolveExpandedGroupsForPath(pathname, navigation));
}

/** Grupo visível expandido: preferência do usuário ou rota ativa. */
export function isNavigationGroupExpanded(
  groupId: NavigationGroupId,
  expandedGroups: ReadonlySet<NavigationGroupId>,
  activeGroupId: NavigationGroupId | null
): boolean {
  return expandedGroups.has(groupId) || activeGroupId === groupId;
}

/** Alterna grupo; não recolhe o grupo da rota ativa. */
export function toggleExpandedGroupInSet(
  current: ReadonlySet<NavigationGroupId>,
  groupId: NavigationGroupId,
  activeGroupId: NavigationGroupId | null
): Set<NavigationGroupId> {
  const next = new Set(current);
  if (next.has(groupId)) {
    if (activeGroupId !== groupId) {
      next.delete(groupId);
    }
  } else {
    next.add(groupId);
  }
  return next;
}

export function getSidebarGroupPanelId(groupId: NavigationGroupId): string {
  return `sidebar-group-panel-${groupId}`;
}

export function getSidebarGroupButtonId(groupId: NavigationGroupId): string {
  return `sidebar-group-button-${groupId}`;
}
