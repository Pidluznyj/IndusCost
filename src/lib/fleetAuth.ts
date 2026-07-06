/**
 * Permissões do módulo Gestão de Frota.
 * Matriz: docs/FLEET_PERMISSIONS.md
 * Resolução com compatibilidade legado + granular: fleetPermissionResolve.ts
 */

export {
  FLEET_LEGACY_PERMISSIONS,
  FLEET_GRANULAR_PERMISSIONS,
  FLEET_ALL_PERMISSION_KEYS,
  FLEET_ROUTE_GUARDS,
  FLEET_API_FORBIDDEN_STATUS,
  FLEET_FORBIDDEN_MESSAGE,
  expandFleetPermissions,
  canFleet,
  canViewFleetFinancial,
  canManageFleetSettings,
  canAccessFleetRoute,
  evaluateFleetRouteAccess,
  type FleetLegacyPermission,
  type FleetGranularPermission,
  type FleetRouteGuardKey,
} from "@/src/lib/fleetPermissionResolve.js";

/** @deprecated Use FLEET_LEGACY_PERMISSIONS — mantido para imports existentes. */
export { FLEET_LEGACY_PERMISSIONS as FLEET_PERMISSIONS } from "@/src/lib/fleetPermissionResolve.js";

export type FleetPermission =
  import("@/src/lib/fleetPermissionResolve.js").FleetLegacyPermission;
