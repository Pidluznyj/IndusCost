import type { SidebarAccessibleNavigation, SidebarMenuItemDef } from "@/src/lib/sidebarNavigation.js";
import { projectInternalContractKeysFromLegacyBag } from "@/src/lib/internalSurfaceAccess.js";
import { EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER } from "@/src/lib/effectiveAccessDtoTypes.js";
import { projectLegacyBagToBaseline } from "@/src/lib/security/effectiveAccess/legacyCompat.js";
import {
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractResource,
} from "@/src/lib/security/permissionContract/index.js";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import {
  buildGroupedNavigationStructure,
  type GroupedNavigationStructure,
  type NavigationGroupedItem,
  type NavigationGroupWithItems,
} from "@/src/lib/navigationGroups.js";
import {
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
} from "@/src/lib/modulePermissions.js";
import { getModulePath } from "@/src/lib/navigationGroups.js";

/**
 * Chaves do **contrato** que revelam cada item da sidebar.
 * Parent `finance`: shell se `finance` ou filho operacional (AP/AR/CC) —
 * sem billing/sales_orders (evita bleed de `sales_orders.view`).
 * Conciliação/opex/taxes/reports/suppliers têm listas próprias.
 */
export const SIDEBAR_MODULE_CONTRACT_KEYS: Record<AppModuleId, readonly string[]> = {
  dashboard: ["dashboard"],
  employees: ["admin.employees"],
  machines: ["operations.machines"],
  materials: ["engineering.materials"],
  purchases: ["operations.purchases"],
  maintenance: ["operations.maintenance"],
  inventory: ["operations.inventory"],
  "operations-performance": ["operations.performance"],
  projects: ["engineering.projects"],
  fleet: ["operations.fleet"],
  products: ["engineering.products"],
  "transformation-simulator": ["engineering.transformation_simulator"],
  opex: ["finance.opex"],
  taxes: ["finance.taxes"],
  pricing: ["commercial.pricing"],
  proposals: ["commercial.proposals"],
  "sales-orders": ["commercial.sales_orders"],
  customers: ["commercial.customers"],
  "crm-commercial": ["commercial.crm"],
  commissions: ["commercial.commissions"],
  simulations: ["engineering.simulations"],
  reports: ["finance.reports"],
  finance: [
    "finance",
    "finance.accounts_payable",
    "finance.accounts_receivable",
    "finance.cost_centers",
  ],
  suppliers: ["finance.suppliers"],
  "portfolio-reconciliation": ["finance.portfolio_reconciliation"],
  guide: ["admin.guide"],
  settings: ["admin.settings"],
};

const CONTRACT_BY_KEY: ReadonlyMap<string, PermissionContractResource> = new Map(
  PERMISSION_CONTRACT_RESOURCES.map((r) => [r.resourceKey, r])
);

/**
 * Projeção bag → recursos de contrato para sidebar (modo sombra /me ausente).
 * 1:1 estrito + primary legacy (index 0) de cada chave listada no mapa do módulo.
 * Não usa ROLE_MATRIX nem aliases FE multi-recurso amplos.
 */
export function projectSidebarContractKeysFromLegacyBag(
  legacyPermissions: readonly string[]
): string[] {
  const bag = new Set(
    legacyPermissions.map((k) => k.trim()).filter((k) => k.length > 0)
  );
  const granted = new Set<string>();

  const { grants } = projectLegacyBagToBaseline({
    legacyPermissions: [...bag],
  });
  for (const [resourceKey, actions] of Object.entries(grants)) {
    if (actions?.view) granted.add(resourceKey);
  }

  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    for (const contractKey of SIDEBAR_MODULE_CONTRACT_KEYS[moduleId] ?? []) {
      const resource = CONTRACT_BY_KEY.get(contractKey);
      if (!resource) continue;
      const view = resource.actions.find((a) => a.action === "view");
      const primaryLegacy = view?.legacyPermissionKeys[0];
      if (primaryLegacy && bag.has(primaryLegacy)) {
        granted.add(contractKey);
      }
    }
  }

  // Mega/bleed legado que o contrato restringiu a um único recurso do mapa sidebar
  // (ex.: costs.view → só finance.opex após P09).
  const legacyOwners = new Map<string, Set<string>>();
  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    for (const contractKey of SIDEBAR_MODULE_CONTRACT_KEYS[moduleId] ?? []) {
      const view = CONTRACT_BY_KEY.get(contractKey)?.actions.find(
        (a) => a.action === "view"
      );
      for (const legacy of view?.legacyPermissionKeys ?? []) {
        const set = legacyOwners.get(legacy) ?? new Set<string>();
        set.add(contractKey);
        legacyOwners.set(legacy, set);
      }
    }
  }
  for (const legacy of bag) {
    const owners = legacyOwners.get(legacy);
    if (owners?.size === 1) {
      granted.add([...owners][0]!);
    }
  }

  return [...granted].sort();
}

function buildSidebarDtoFromLegacyBag(args: {
  role: AuthUser["role"];
  legacyPermissions: readonly string[];
}): EffectiveAccessMeDto {
  const sidebarKeys = projectSidebarContractKeysFromLegacyBag(
    args.legacyPermissions
  );
  const internalKeys = projectInternalContractKeysFromLegacyBag(
    args.legacyPermissions
  );
  const keys = [...new Set([...sidebarKeys, ...internalKeys])].sort();
  const actionsByResource: EffectiveAccessMeDto["actionsByResource"] = {};
  const capabilities: EffectiveAccessMeDto["capabilities"] = {};
  for (const resourceKey of keys) {
    actionsByResource[resourceKey] = ["view"];
    capabilities[resourceKey] = {
      canView: true,
      canExecute: false,
      canManage: false,
    };
  }
  return {
    permissionsVersion: EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER,
    role: args.role,
    isSuperAdmin: false,
    allowedResources: keys,
    actionsByResource,
    navigationReveal: keys,
    capabilities,
    compatibility: {
      mode: "shadow",
      legacyBagAuthoritative: true,
      legacyPermissionsPresent: args.legacyPermissions.length > 0,
      legacyCompatApplied: true,
    },
  };
}

const EMPTY_NAV: SidebarAccessibleNavigation = {
  directItems: [],
  groups: [],
  fallbackGroup: null,
  flatAccessibleItems: [],
};

function revealSet(dto: EffectiveAccessMeDto): ReadonlySet<string> {
  return new Set([...dto.navigationReveal, ...dto.allowedResources]);
}

/** View efetivo no DTO (capabilities ou actionsByResource.view). */
export function dtoAllowsView(dto: EffectiveAccessMeDto, contractKey: string): boolean {
  if (dto.isSuperAdmin) return true;
  const cap = dto.capabilities[contractKey];
  if (cap?.canView) return true;
  const actions = dto.actionsByResource[contractKey];
  if (actions?.includes("view")) return true;
  return dto.navigationReveal.includes(contractKey);
}

/**
 * Item da sidebar visível se alguma chave de contrato estiver revelada/allowed.
 * Sem mapeamento → negado (pendente de correção).
 */
export function canViewSidebarModuleFromDto(
  dto: EffectiveAccessMeDto | null | undefined,
  moduleId: AppModuleId
): boolean {
  if (!dto) return false;
  if (dto.isSuperAdmin) return true;
  const keys = SIDEBAR_MODULE_CONTRACT_KEYS[moduleId];
  if (!keys?.length) return false;
  const revealed = revealSet(dto);
  return keys.some((k) => revealed.has(k) || dtoAllowsView(dto, k));
}

export function listSidebarModulesMissingContractMap(
  order: readonly AppModuleId[] = SIDEBAR_MODULE_ORDER
): AppModuleId[] {
  return order.filter((id) => !(SIDEBAR_MODULE_CONTRACT_KEYS[id]?.length > 0));
}

/**
 * Monta DTO para sidebar: prefere bloco do `/me`; senão projeta bag → contrato
 * com profile vazio + legacyCompat (bag absoluta; sem ROLE_MATRIX FE).
 */
export function resolveSidebarEffectiveAccessDto(args: {
  user: AuthUser | null | undefined;
  effectiveAccessFromMe?: EffectiveAccessMeDto | null;
}): EffectiveAccessMeDto | null {
  const { user, effectiveAccessFromMe } = args;
  if (!user) return null;
  if (user.isActive === false && user.role !== "SUPER_ADMIN") return null;
  if (effectiveAccessFromMe) return effectiveAccessFromMe;
  if (user.role === "SUPER_ADMIN") {
    return {
      permissionsVersion: 0,
      role: "SUPER_ADMIN",
      isSuperAdmin: true,
      allowedResources: [],
      actionsByResource: {},
      navigationReveal: [],
      capabilities: {},
      compatibility: {
        mode: "shadow",
        legacyBagAuthoritative: true,
        legacyPermissionsPresent: (user.effectivePermissions?.length ?? 0) > 0,
        legacyCompatApplied: false,
      },
    };
  }
  return buildSidebarDtoFromLegacyBag({
    role: user.role,
    legacyPermissions: user.effectivePermissions ?? user.permissions ?? [],
  });
}

function toMenuItemDef(item: NavigationGroupedItem): SidebarMenuItemDef {
  return {
    id: item.itemId,
    label: item.label,
    path: item.path,
    resourceKey: item.resourceKey,
  };
}

function filterItemsFromDto(
  items: NavigationGroupedItem[],
  dto: EffectiveAccessMeDto
): NavigationGroupedItem[] {
  return items.filter((item) => canViewSidebarModuleFromDto(dto, item.itemId));
}

function filterGroupFromDto(
  group: NavigationGroupWithItems,
  dto: EffectiveAccessMeDto
): NavigationGroupWithItems | null {
  const items = filterItemsFromDto(group.items, dto);
  if (items.length === 0) return null;
  return {
    ...group,
    items,
    itemIds: items.map((i) => i.itemId),
  };
}

/**
 * Navegação sidebar só com DTO efetivo.
 * - loading / sem user / erro de sessão → vazio (caller)
 * - SUPER_ADMIN → estrutura completa
 * - grupo só se tiver filho visível
 * - item sem contract map → negado
 */
export function buildSidebarNavigationFromEffectiveAccess(
  dto: EffectiveAccessMeDto | null | undefined,
  structure: GroupedNavigationStructure = buildGroupedNavigationStructure()
): SidebarAccessibleNavigation {
  if (!dto) return EMPTY_NAV;

  if (dto.isSuperAdmin) {
    const flatAccessibleItems = SIDEBAR_MODULE_ORDER.map((moduleId) => {
      const fromStructure =
        structure.directItems.find((i) => i.itemId === moduleId) ??
        structure.groups.flatMap((g) => g.items).find((i) => i.itemId === moduleId) ??
        structure.fallbackGroup?.items.find((i) => i.itemId === moduleId);
      if (fromStructure) return toMenuItemDef(fromStructure);
      return {
        id: moduleId,
        label: moduleId,
        path: getModulePath(moduleId),
        resourceKey: null,
      };
    });
    return {
      directItems: [...structure.directItems],
      groups: [...structure.groups],
      fallbackGroup: structure.fallbackGroup,
      flatAccessibleItems,
    };
  }

  const directItems = filterItemsFromDto(structure.directItems, dto);
  const groups = structure.groups
    .map((g) => filterGroupFromDto(g, dto))
    .filter((g): g is NavigationGroupWithItems => g != null);
  const fallbackGroup = structure.fallbackGroup
    ? filterGroupFromDto(structure.fallbackGroup, dto)
    : null;

  const flatAccessibleItems = SIDEBAR_MODULE_ORDER.filter((moduleId) =>
    canViewSidebarModuleFromDto(dto, moduleId)
  ).map((moduleId) => {
    const fromStructure =
      structure.directItems.find((i) => i.itemId === moduleId) ??
      structure.groups.flatMap((g) => g.items).find((i) => i.itemId === moduleId) ??
      structure.fallbackGroup?.items.find((i) => i.itemId === moduleId);
    if (fromStructure) return toMenuItemDef(fromStructure);
    return {
      id: moduleId,
      label: moduleId,
      path: getModulePath(moduleId),
      resourceKey: null,
    };
  });

  return { directItems, groups, fallbackGroup, flatAccessibleItems };
}

export { EMPTY_NAV as EMPTY_SIDEBAR_NAVIGATION };
