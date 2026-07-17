import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
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
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess";
import type { InventoryMovementType } from "@/src/types/inventory";

/**
 * Permissões FE do Estoque (PERM-42).
 * Com DTO (`effectiveAccess`): `canPerformAction` autoritativo.
 * Sem DTO: bag legada (regras de movimento/ajuste/transfer intactas).
 */
export function useInventoryPermissions() {
  const auth = useAuth();
  const permissions = usePermissions();
  const perms = auth.authUser?.effectivePermissions ?? [];
  const hasDto = Boolean(auth.effectiveAccess);

  return useMemo(() => {
    const dto = (resourceKey: string, action: string) =>
      permissions.canPerformAction(resourceKey, action as "view");

    const canView = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventory, "view")
      : canViewInventory(perms);
    const canManageItems = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryItems, "manage")
      : canManageInventoryItems(perms);
    const canManageWarehouses = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryWarehouses, "manage")
      : canManageInventoryWarehouses(perms);
    const canCreateMovement = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryMovements, "create")
      : canCreateBasicInventoryMovement(perms);
    const canCreateAdjustment = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryMovements, "create") ||
        dto(OPERATIONS_RESOURCE_KEYS.inventory, "manage")
      : canCreateInventoryAdjustment(perms);
    const canCreateTransfer = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryMovements, "create") ||
        dto(OPERATIONS_RESOURCE_KEYS.inventory, "manage")
      : canCreateInventoryTransfer(perms);
    const canBlock = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventory, "manage")
      : canManageInventoryBlock(perms);
    const canManageReservations = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventory, "manage")
      : canManageInventoryReservations(perms);
    const canManageCounts = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryCounts, "manage")
      : canManageInventoryCounts(perms);
    const canApproveCount = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventoryCounts, "approve")
      : canApproveInventoryCount(perms);
    const canViewAudit = hasDto
      ? dto(OPERATIONS_RESOURCE_KEYS.inventory, "view")
      : canViewInventoryAudit(perms);

    const canCreateMovementType = (type: InventoryMovementType) => {
      if (!hasDto) return canCreateInventoryMovementType(perms, type);
      if (type === "TRANSFER") return canCreateTransfer;
      if (type === "POSITIVE_ADJUSTMENT" || type === "NEGATIVE_ADJUSTMENT") {
        return canCreateAdjustment;
      }
      if (type === "BLOCK" || type === "UNBLOCK") return canBlock;
      if (type === "RESERVE" || type === "CANCEL_RESERVATION") {
        return canManageReservations;
      }
      return canCreateMovement;
    };

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
  }, [perms, hasDto, permissions.canPerformAction]);
}
