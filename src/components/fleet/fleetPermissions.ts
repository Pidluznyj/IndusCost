import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  canFleet,
  canManageFleetSettings,
  canViewFleetFinancial,
  evaluateFleetRouteAccess,
  type FleetRouteGuardKey,
} from "@/src/lib/fleetAuth";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess";

/**
 * Permissões FE da Frota (PERM-42).
 * View/manage do módulo: DTO `operations.fleet` quando presente.
 * Facetas (financeiro, reservas, etc.): regras granulares `fleet.*` preservadas.
 */
export function useFleetPermissions() {
  const auth = useAuth();
  const { authUser, effectiveAccess } = auth;
  const permissions = usePermissions();
  const hasDto = Boolean(effectiveAccess);

  return useMemo(() => {
    const perms = authUser?.effectivePermissions ?? [];
    const dtoView = permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.fleet,
      "view"
    );
    const dtoManage = permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.fleet,
      "manage"
    );

    const canView = hasDto
      ? dtoView || dtoManage
      : evaluateFleetRouteAccess(perms, "view");
    const canManage = hasDto
      ? dtoManage
      : canFleet(perms, ["fleet.manage"]);

    return {
      canView,
      canManage,
      canEditVehicles: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "vehiclesEdit")
        : evaluateFleetRouteAccess(perms, "vehiclesEdit"),
      canCreateReservations: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "reservationsCreate")
        : evaluateFleetRouteAccess(perms, "reservationsCreate"),
      canApproveReservations: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "reservationsApprove")
        : evaluateFleetRouteAccess(perms, "reservationsApprove"),
      canManageReservations: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "reservationsManage")
        : evaluateFleetRouteAccess(perms, "reservationsManage"),
      canManageMaintenance: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "maintenanceManage")
        : evaluateFleetRouteAccess(perms, "maintenanceManage"),
      canManageDrivers: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "driversManage")
        : evaluateFleetRouteAccess(perms, "driversManage"),
      // Financeiro da frota permanece gated por fleet.financial.* (não misturar com page view)
      canFinancial: canViewFleetFinancial(perms),
      canSettings: hasDto
        ? dtoManage || canManageFleetSettings(perms)
        : canManageFleetSettings(perms),
      canImport: hasDto
        ? dtoManage || evaluateFleetRouteAccess(perms, "importManage")
        : evaluateFleetRouteAccess(perms, "importManage"),
      canCheckout:
        (hasDto && dtoManage) ||
        canFleet(perms, [
          "fleet.usage.checkout",
          "fleet.reservations.create",
          "fleet.manage",
        ]),
      canCheckin:
        (hasDto && dtoManage) ||
        canFleet(perms, [
          "fleet.usage.checkin",
          "fleet.reservations.create",
          "fleet.manage",
        ]),
      evaluate: (guard: FleetRouteGuardKey) => evaluateFleetRouteAccess(perms, guard),
    };
  }, [authUser, hasDto, permissions.canPerformAction]);
}

export const FLEET_UI_FORBIDDEN_MESSAGE =
  "Você não tem permissão para esta ação. Solicite ao administrador o acesso adequado no módulo Gestão de Frota.";
