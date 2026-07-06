import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canFleet,
  canManageFleetSettings,
  canViewFleetFinancial,
  evaluateFleetRouteAccess,
  type FleetRouteGuardKey,
} from "@/src/lib/fleetAuth";

/** Permissões efetivas do módulo frota no frontend (espelho do backend; não substitui validação API). */
export function useFleetPermissions() {
  const { authUser } = useAuth();

  return useMemo(() => {
    const perms = authUser?.effectivePermissions ?? [];

    return {
      canView: evaluateFleetRouteAccess(perms, "view"),
      canManage: canFleet(perms, ["fleet.manage"]),
      canEditVehicles: evaluateFleetRouteAccess(perms, "vehiclesEdit"),
      canCreateReservations: evaluateFleetRouteAccess(perms, "reservationsCreate"),
      canApproveReservations: evaluateFleetRouteAccess(perms, "reservationsApprove"),
      canManageReservations: evaluateFleetRouteAccess(perms, "reservationsManage"),
      canManageMaintenance: evaluateFleetRouteAccess(perms, "maintenanceManage"),
      canManageDrivers: evaluateFleetRouteAccess(perms, "driversManage"),
      canFinancial: canViewFleetFinancial(perms),
      canSettings: canManageFleetSettings(perms),
      canImport: evaluateFleetRouteAccess(perms, "importManage"),
      canCheckout: canFleet(perms, ["fleet.usage.checkout", "fleet.reservations.create", "fleet.manage"]),
      canCheckin: canFleet(perms, ["fleet.usage.checkin", "fleet.reservations.create", "fleet.manage"]),
      evaluate: (guard: FleetRouteGuardKey) => evaluateFleetRouteAccess(perms, guard),
    };
  }, [authUser]);
}

export const FLEET_UI_FORBIDDEN_MESSAGE =
  "Você não tem permissão para esta ação. Solicite ao administrador o acesso adequado no módulo Gestão de Frota.";
