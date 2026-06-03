import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canViewFleetFinancial,
  evaluateFleetRouteAccess,
} from "@/src/lib/fleetAuth";

/** Permissões efetivas do módulo frota no frontend (espelho do backend; não substitui validação API). */
export function useFleetPermissions() {
  const { authUser, hasPermission, hasAnyPermission } = useAuth();

  return useMemo(() => {
    const perms = authUser?.effectivePermissions ?? [];
    const has = (p: string) => hasPermission(p);
    const any = (ps: string[]) => hasAnyPermission(ps);

    return {
      canView: has("fleet.view"),
      canManage: has("fleet.manage"),
      canEditVehicles: any(["fleet.vehicles.edit", "fleet.manage"]),
      canCreateReservations: any(["fleet.reservations.create", "fleet.manage"]),
      canApproveReservations: any(["fleet.reservations.approve", "fleet.manage"]),
      canManageMaintenance: any(["fleet.maintenance.manage", "fleet.manage"]),
      canManageDrivers: has("fleet.manage"),
      canFinancial: canViewFleetFinancial(perms),
      canSettings: has("fleet.settings.manage"),
      canImport: has("fleet.manage"),
      evaluate: (guard: Parameters<typeof evaluateFleetRouteAccess>[1]) =>
        evaluateFleetRouteAccess(perms, guard),
    };
  }, [authUser, hasPermission, hasAnyPermission]);
}

export const FLEET_UI_FORBIDDEN_MESSAGE =
  "Você não tem permissão para esta ação. Solicite ao administrador o acesso adequado no módulo Gestão de Frota.";
