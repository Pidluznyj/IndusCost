/**
 * Permissões do módulo Gestão de Frota.
 *
 * Matriz detalhada: docs/FLEET_PERMISSIONS.md
 *
 * Resumo:
 * - fleet.view          → leitura (403 sem ela em GET /api/fleet/*)
 * - fleet.vehicles.edit → veículos/contratos/documentos (com fleet.manage)
 * - fleet.reservations.create / approve → reservas e checklists
 * - fleet.maintenance.manage → manutenções
 * - fleet.financial.view  → valores financeiros visíveis + escrita financeira
 * - fleet.settings.manage → PUT /api/fleet/settings
 * - fleet.manage          → superusuário do módulo (todas as ações acima)
 */

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

export const FLEET_FORBIDDEN_MESSAGE =
  "Você não tem permissão para acessar este recurso.";

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
  driversManage: ["fleet.manage"] as const,
  reservationsCreate: ["fleet.reservations.create", "fleet.manage"] as const,
  reservationsApprove: ["fleet.reservations.approve", "fleet.manage"] as const,
  maintenanceManage: ["fleet.maintenance.manage", "fleet.manage"] as const,
  financialWrite: ["fleet.financial.view", "fleet.manage"] as const,
  settingsManage: ["fleet.settings.manage"] as const,
  checklistOps: ["fleet.reservations.create", "fleet.manage"] as const,
  attachmentWrite: [
    "fleet.manage",
    "fleet.financial.view",
    "fleet.reservations.create",
    "fleet.maintenance.manage",
  ] as const,
  importManage: ["fleet.manage"] as const,
} as const;

export type FleetRouteGuardKey = keyof typeof FLEET_ROUTE_GUARDS;

/** Espelha a decisão do middleware (403 quando false). */
export function evaluateFleetRouteAccess(
  userPermissions: readonly string[],
  guard: FleetRouteGuardKey
): boolean {
  return canAccessFleetRoute(userPermissions, FLEET_ROUTE_GUARDS[guard]);
}

/** HTTP 403 esperado quando evaluateFleetRouteAccess retorna false. */
export const FLEET_API_FORBIDDEN_STATUS = 403;
