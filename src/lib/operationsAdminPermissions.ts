/**
 * Permissões Operações + Administração (Prompt 15) — padrão Comissões / Prompt 13:
 * resourceKey (view/nav) + legado para mutações justificadas.
 * RH: salários e contatos de emergência exigem employees.edit (dados sensíveis).
 */

import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  canAccessSettingsSection,
  canManageAccessProfiles,
  canManageUsers,
  canViewAccessProfiles,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";

export type ResourceAwareChecker = PermissionChecker & {
  canViewResource?: (resourceKey: string) => boolean;
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

function legacyOrResource(
  check: ResourceAwareChecker,
  resourceKey: string | null | undefined,
  legacy: () => boolean
): boolean {
  if (resourceKey && typeof check.canViewResource === "function") {
    if (check.canViewResource(resourceKey)) return true;
  }
  return legacy();
}

/** Abas de estoque com recurso canônico fino (contrato). */
export const INVENTORY_TAB_RESOURCE_KEYS: Partial<Record<OpsInventoryTabId, string>> = {
  items: ResourceKeys.OPERACOES_ESTOQUE_ITENS,
  warehouses: ResourceKeys.OPERACOES_ESTOQUE_ALMOXARIFADOS,
  movements: ResourceKeys.OPERACOES_ESTOQUE_MOVIMENTACOES,
  counts: ResourceKeys.OPERACOES_ESTOQUE_CONFERENCIAS,
};

// ─── Operações: Estoque ──────────────────────────────────────

export function canViewInventory(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.OPERACOES_ESTOQUE, () =>
    check.hasPermission("inventory.view")
  );
}

export function canViewInventoryTab(
  tabId: OpsInventoryTabId,
  check: ResourceAwareChecker
): boolean {
  if (!canViewInventory(check)) return false;
  const resourceKey = INVENTORY_TAB_RESOURCE_KEYS[tabId];
  if (!resourceKey) {
    // overview / balances / reservations / audit — herdam view do módulo
    return true;
  }
  return legacyOrResource(check, resourceKey, () => check.hasPermission("inventory.view"));
}

export function listVisibleInventoryTabIds(
  tabIds: readonly OpsInventoryTabId[],
  check: ResourceAwareChecker
): OpsInventoryTabId[] {
  return tabIds.filter((id) => canViewInventoryTab(id, check));
}

// ─── Operações: Compras / Máquinas / Performance / Manutenção / Frota ─

export function canViewPurchases(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.OPERACOES_COMPRAS, () =>
    check.hasPermission("purchases.view")
  );
}

export function canCreatePurchases(check: PermissionChecker): boolean {
  return check.hasPermission("purchases.create");
}

export function canEditPurchases(check: PermissionChecker): boolean {
  return check.hasPermission("purchases.edit");
}

export function canViewMachines(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.OPERACOES_MAQUINAS, () =>
    check.hasPermission("machines.view") || check.hasPermission("costs.view")
  );
}

export function canEditMachines(check: PermissionChecker): boolean {
  return check.hasPermission("machines.edit");
}

export function canViewOperationsPerformance(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.OPERACOES_PERFORMANCE, () =>
    check.hasPermission("operations.component-performance.view") ||
      check.hasPermission("operations.component-performance.edit") ||
      check.hasPermission("products.view")
  );
}

export function canEditOperationsPerformance(check: PermissionChecker): boolean {
  return (
    check.hasPermission("operations.component-performance.edit") ||
    check.hasPermission("products.edit")
  );
}

export function canViewMaintenance(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.OPERACOES_MANUTENCAO, () =>
    check.hasPermission("maintenance.view")
  );
}

export function canManageMaintenance(check: PermissionChecker): boolean {
  return check.hasPermission("maintenance.manage");
}

export function canViewFleet(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.OPERACOES_FROTA, () => {
    const held = check.authUser?.effectivePermissions;
    if (held?.length) {
      return held.includes("fleet.view") || held.includes("fleet.manage");
    }
    return check.hasPermission("fleet.view") || check.hasPermission("fleet.manage");
  });
}

export function canManageFleet(check: PermissionChecker): boolean {
  return check.hasPermission("fleet.manage");
}

// ─── Administração: RH ───────────────────────────────────────

export function canViewEmployees(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.ADMIN_PESSOAS, () =>
    check.hasPermission("employees.view") || check.hasPermission("costs.view")
  );
}

export function canEditEmployees(check: PermissionChecker): boolean {
  return check.hasPermission("employees.edit");
}

/**
 * Dados sensíveis de RH (salário, encargos, contato de emergência):
 * somente quem edita RH — evita exposição a quem entra só com costs.view.
 */
export function canViewEmployeeCompensation(check: PermissionChecker): boolean {
  return check.hasPermission("employees.edit");
}

export function canViewEmployeeEmergencyContacts(check: PermissionChecker): boolean {
  return check.hasPermission("employees.edit");
}

// ─── Administração: Configurações / Guia / ACL ───────────────

export function canViewSettings(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.CONFIGURACOES, () =>
    check.hasPermission("settings.view") || check.hasPermission("users.manage")
  );
}

export function canViewGuide(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.ADMIN_GUIA, () =>
    check.hasPermission("guide.view") || check.hasPermission("dashboard.view")
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
