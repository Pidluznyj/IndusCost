/** Permissões do módulo frota (espelho do permissionCatalog). */
export const FLEET_PERMISSIONS = [
  "fleet.view",
  "fleet.manage",
  "fleet.vehicles.edit",
  "fleet.reservations.create",
  "fleet.reservations.approve",
  "fleet.maintenance.manage",
  "fleet.financial.view",
  "fleet.settings.manage",
] as const;

export type FleetPermission = (typeof FLEET_PERMISSIONS)[number];

/** Mesma regra do middleware requireAnyPermission (OR). */
export function canAccessFleetRoute(
  userPermissions: readonly string[],
  requiredAny: readonly string[]
): boolean {
  if (requiredAny.length === 0) return true;
  const set = new Set(userPermissions);
  return requiredAny.some((p) => set.has(p));
}

export function canViewFleetFinancial(userPermissions: readonly string[]): boolean {
  return canAccessFleetRoute(userPermissions, ["fleet.financial.view", "fleet.manage"]);
}

export const FLEET_ROUTE_GUARDS = {
  view: ["fleet.view"] as const,
  vehiclesEdit: ["fleet.vehicles.edit", "fleet.manage"] as const,
  manage: ["fleet.manage"] as const,
  reservationsCreate: ["fleet.reservations.create", "fleet.manage"] as const,
  reservationsApprove: ["fleet.reservations.approve", "fleet.manage"] as const,
  maintenanceManage: ["fleet.maintenance.manage", "fleet.manage"] as const,
  financialWrite: ["fleet.financial.view", "fleet.manage"] as const,
  settingsManage: ["fleet.settings.manage"] as const,
} as const;
