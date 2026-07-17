/**
 * Permissões Operações + Administração (PERM-42: DTO-first).
 * resourceKey oficial + legado só quando `canPerformAction` ausente.
 * Regras de negócio de estoque/compras/manutenção/frota intactas.
 */

import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  canAccessSettingsSection,
  canManageAccessProfiles,
  canManageUsers,
  canViewAccessProfiles,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { ADMIN_SETTINGS_RESOURCE_KEYS } from "@/src/lib/adminSettingsAccess.js";

export type ResourceAwareChecker = PermissionChecker & {
  canViewResource?: (resourceKey: string) => boolean;
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

export type OpsInventoryTabId =
  | "overview"
  | "items"
  | "warehouses"
  | "balances"
  | "movements"
  | "counts"
  | "reservations"
  | "audit";

/**
 * Com `canPerformAction` (DTO), a decisão é autoritativa — sem OR legado
 * que misture products.view ↔ Performance ou dashboard.view ↔ Guia.
 */
function dtoOrLegacy(
  auth: ResourceAwareChecker,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  if (action === "view" && typeof auth.canViewResource === "function") {
    if (auth.canViewResource(resourceKey)) return true;
  }
  return legacy();
}

/** Abas de estoque com recurso canônico fino (contrato). Almoxarifados = warehouses. */
export const INVENTORY_TAB_RESOURCE_KEYS: Partial<Record<OpsInventoryTabId, string>> = {
  items: ResourceKeys.OPERACOES_ESTOQUE_ITENS,
  warehouses: ResourceKeys.OPERACOES_ESTOQUE_ALMOXARIFADOS,
  movements: ResourceKeys.OPERACOES_ESTOQUE_MOVIMENTACOES,
  counts: ResourceKeys.OPERACOES_ESTOQUE_CONFERENCIAS,
};

// ─── Operações: Estoque ──────────────────────────────────────

export function canViewInventory(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.inventory, "view", () =>
    auth.hasPermission("inventory.view")
  );
}

export function canViewInventoryTab(
  tabId: OpsInventoryTabId,
  auth: ResourceAwareChecker
): boolean {
  if (!canViewInventory(auth)) return false;
  const resourceKey = INVENTORY_TAB_RESOURCE_KEYS[tabId];
  if (!resourceKey) {
    // overview / balances / reservations / audit — herdam view do módulo
    return true;
  }
  return dtoOrLegacy(auth, resourceKey, "view", () => auth.hasPermission("inventory.view"));
}

export function listVisibleInventoryTabIds(
  tabIds: readonly OpsInventoryTabId[],
  auth: ResourceAwareChecker
): OpsInventoryTabId[] {
  return tabIds.filter((id) => canViewInventoryTab(id, auth));
}

// ─── Operações: Compras / Máquinas / Performance / Manutenção / Frota ─

export function canViewPurchases(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.purchases, "view", () =>
    auth.hasPermission("purchases.view")
  );
}

export function canCreatePurchases(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.purchases, "create", () =>
    auth.hasPermission("purchases.create")
  );
}

export function canEditPurchases(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.purchases, "update", () =>
    auth.hasPermission("purchases.edit")
  );
}

export function canDeletePurchases(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.purchases, "delete", () =>
    auth.hasPermission("purchases.delete") || auth.hasPermission("purchases.edit")
  );
}

export function canViewMachines(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.machines, "view", () =>
    auth.hasPermission("machines.view")
  );
}

export function canEditMachines(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.machines, "update", () =>
    auth.hasPermission("machines.edit")
  );
}

/** Performance — sem bleed de products.view (PERM-42). */
export function canViewOperationsPerformance(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.performance, "view", () =>
    auth.hasPermission("operations.component-performance.view") ||
      auth.hasPermission("operations.component-performance.edit")
  );
}

export function canEditOperationsPerformance(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.performance, "update", () =>
    auth.hasPermission("operations.component-performance.edit")
  );
}

export function canViewProductionOrders(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.productionOrders, "view", () =>
    auth.hasPermission("operations.production-orders.view")
  );
}

export function canViewMaintenance(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.maintenance, "view", () =>
    auth.hasPermission("maintenance.view")
  );
}

export function canManageMaintenance(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.maintenance, "manage", () =>
    auth.hasPermission("maintenance.manage")
  );
}

export function canViewFleet(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.fleet, "view", () => {
    const held = auth.authUser?.effectivePermissions;
    if (held?.length) {
      return held.includes("fleet.view") || held.includes("fleet.manage");
    }
    return auth.hasPermission("fleet.view") || auth.hasPermission("fleet.manage");
  });
}

export function canManageFleet(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, OPERATIONS_RESOURCE_KEYS.fleet, "manage", () =>
    auth.hasPermission("fleet.manage")
  );
}

// ─── Administração: RH ───────────────────────────────────────

export function canViewEmployees(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS, "view", () =>
    auth.hasPermission("employees.view")
  );
}

export function canEditEmployees(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS, "update", () =>
    auth.hasPermission("employees.edit")
  );
}

export function canCreateEmployees(auth: ResourceAwareChecker): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(ResourceKeys.ADMIN_PESSOAS, "create") ||
      auth.canPerformAction(ResourceKeys.ADMIN_PESSOAS, "update")
    );
  }
  return (
    auth.hasPermission("employees.create") || auth.hasPermission("employees.edit")
  );
}

/**
 * Dados sensíveis de RH (salário, encargos, contato de emergência).
 * Facetas finas OR legado employees.edit — costs.view não libera RH.
 */
export function canViewEmployeeCompensation(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_SENSITIVE_DATA, "view", () =>
    auth.hasPermission("employees.edit") ||
      auth.hasPermission("employees.sensitive_data.view")
  );
}

export function canViewEmployeeEmergencyContacts(auth: ResourceAwareChecker): boolean {
  return canViewEmployeeCompensation(auth);
}

export function canViewEmployeePersonalData(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_PERSONAL_DATA, "view", () =>
    auth.hasPermission("employees.edit") ||
      auth.hasPermission("employees.personal_data.view") ||
      auth.hasPermission("people.pii.view")
  );
}

export function canViewEmployeeAdministrativeData(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_ADMINISTRATIVE_DATA, "view", () =>
    auth.hasPermission("employees.edit") ||
      auth.hasPermission("employees.administrative_data.view")
  );
}

export function canViewEmployeeLinks(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_LINKS, "view", () =>
    auth.hasPermission("employees.links.view") ||
      auth.hasPermission("employees.view") ||
      auth.hasPermission("employees.edit") ||
      auth.hasPermission("people.search")
  );
}

export function canManageEmployeeLinks(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_LINKS, "manage", () =>
    auth.hasPermission("employees.links.manage") ||
      auth.hasPermission("people.link.manage") ||
      auth.hasPermission("employees.edit") ||
      auth.hasPermission("users.manage")
  );
}

export function canManageEmployeeUserLink(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_USER_LINK, "manage", () =>
    auth.hasPermission("employees.user_link.manage") ||
      auth.hasPermission("employees.edit") ||
      auth.hasPermission("users.manage")
  );
}

export function canManageEmployeeEpi(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_PESSOAS_EPI, "manage", () =>
    auth.hasPermission("employees.epi.manage") || auth.hasPermission("employees.edit")
  );
}

// ─── Administração: Configurações / Guia / ACL ───────────────

export function canViewSettings(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ADMIN_SETTINGS_RESOURCE_KEYS.settings, "view", () =>
    auth.hasPermission("settings.view") ||
      auth.hasPermission("users.manage") ||
      (typeof auth.canViewResource === "function" &&
        auth.canViewResource(ResourceKeys.CONFIGURACOES))
  );
}

/** Guia — sem bleed de dashboard.view (PERM-42). */
export function canViewGuide(auth: ResourceAwareChecker): boolean {
  return dtoOrLegacy(auth, ResourceKeys.ADMIN_GUIA, "view", () =>
    auth.hasPermission("guide.view")
  );
}

export function canAccessSettingsHubSection(
  section:
    | "globals"
    | "branding"
    | "operational"
    | "nomusSync"
    | "priceTables"
    | "security"
    | "integrations"
    | "system",
  check: PermissionChecker
): boolean {
  return canAccessSettingsSection(section, check);
}

export function canManageUsersAdmin(check: PermissionChecker): boolean {
  return canManageUsers(check);
}

export function canViewProfilesAdmin(check: PermissionChecker): boolean {
  return canViewAccessProfiles(check);
}

export function canManageProfilesAdmin(check: PermissionChecker): boolean {
  return canManageAccessProfiles(check);
}
