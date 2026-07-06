import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canApproveInventoryCount,
  canCreateBasicInventoryMovement,
  canCreateInventoryAdjustment,
  canCreateInventoryMovementType,
  canCreateInventoryTransfer,
  canManageInventoryBlock,
  canManageInventoryCounts,
  canManageInventoryItems,
  canManageInventoryReservations,
  canManageInventoryWarehouses,
  canViewInventory,
  canViewInventoryAudit,
} from "@/src/lib/inventory/inventoryPermissionChecks";
import type { InventoryMovementType } from "@/src/types/inventory";

export function useInventoryPermissions() {
  const auth = useAuth();
  const perms = auth.authUser?.effectivePermissions ?? [];

  return useMemo(() => {
    const canView = canViewInventory(perms);
    const canManageItems = canManageInventoryItems(perms);
    const canManageWarehouses = canManageInventoryWarehouses(perms);
    const canCreateMovement = canCreateBasicInventoryMovement(perms);
    const canCreateAdjustment = canCreateInventoryAdjustment(perms);
    const canCreateTransfer = canCreateInventoryTransfer(perms);
    const canBlock = canManageInventoryBlock(perms);
    const canManageReservations = canManageInventoryReservations(perms);
    const canManageCounts = canManageInventoryCounts(perms);
    const canApproveCount = canApproveInventoryCount(perms);
    const canViewAudit = canViewInventoryAudit(perms);

    const canCreateMovementType = (type: InventoryMovementType) =>
      canCreateInventoryMovementType(perms, type);

    return {
      canView,
      /** @deprecated use canManageItems */
      canManage: canManageItems,
      canManageItems,
      canManageWarehouses,
      canCreateMovement,
      canCreateAdjustment,
      canCreateTransfer,
      canBlock,
      canManageReservations,
      canManageCounts,
      canApproveCount,
      canViewAudit,
      canCreateMovementType,
    };
  }, [perms]);
}
