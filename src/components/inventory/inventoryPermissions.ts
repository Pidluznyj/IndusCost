import { useAuth } from "@/src/contexts/AuthContext";

export function useInventoryPermissions() {
  const auth = useAuth();
  return {
    canView: auth.hasPermission("inventory.view"),
    canManage: auth.hasPermission("inventory.manage"),
    canCreateMovement: auth.hasPermission("inventory.movements.create"),
    canManageReservations: auth.hasPermission("inventory.reservations.manage"),
    canManageCounts:
      auth.hasPermission("inventory.count.manage") || auth.hasPermission("inventory.manage"),
  };
}
