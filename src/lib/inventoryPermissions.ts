/** Permissões do módulo Estoque / Almoxarifado (rotas server). */

import {
  canApproveInventoryCount,
  canCreateBasicInventoryMovement,
  canCreateInventoryAdjustment,
  canCreateInventoryTransfer,
  canManageInventoryBlock,
  canManageInventoryCounts,
  canManageInventoryItems,
  canManageInventoryReservations,
  canManageInventoryWarehouses,
  canViewInventory,
  canViewInventoryAudit,
  INVENTORY_PERMISSION_KEYS,
} from "./inventory/inventoryPermissionChecks.js";

export const INVENTORY_VIEW_PERMISSIONS = [INVENTORY_PERMISSION_KEYS.view] as const;

export const INVENTORY_ITEM_MANAGE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.itemManage,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_WAREHOUSE_MANAGE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.warehouseManage,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

/** @deprecated Preferir INVENTORY_MOVEMENT_CREATE_PERMISSIONS — mantido para rotas existentes. */
export const INVENTORY_MANAGE_PERMISSIONS = [INVENTORY_PERMISSION_KEYS.manageLegacy] as const;

export const INVENTORY_MOVEMENT_CREATE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.movementCreate,
  INVENTORY_PERMISSION_KEYS.movementCreateLegacy,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_ADJUSTMENT_CREATE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.adjustmentCreate,
  INVENTORY_PERMISSION_KEYS.movementCreateLegacy,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_TRANSFER_CREATE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.transferCreate,
  INVENTORY_PERMISSION_KEYS.movementCreateLegacy,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_BLOCK_MANAGE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.blockManage,
  INVENTORY_PERMISSION_KEYS.movementCreateLegacy,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_RESERVATIONS_MANAGE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.reservationManage,
  INVENTORY_PERMISSION_KEYS.reservationManageLegacy,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_COUNT_MANAGE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.countManage,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_COUNT_APPROVE_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.countApprove,
  INVENTORY_PERMISSION_KEYS.countManage,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

export const INVENTORY_AUDIT_VIEW_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.auditView,
  INVENTORY_PERMISSION_KEYS.manageLegacy,
] as const;

/** Criar movimentação ou reserva manual (rota genérica). */
export const INVENTORY_MOVEMENT_OR_RESERVATION_PERMISSIONS = [
  ...INVENTORY_MOVEMENT_CREATE_PERMISSIONS,
  ...INVENTORY_RESERVATIONS_MANAGE_PERMISSIONS,
] as const;

export {
  canApproveInventoryCount,
  canCreateBasicInventoryMovement,
  canCreateInventoryAdjustment,
  canCreateInventoryTransfer,
  canManageInventoryBlock,
  canManageInventoryCounts,
  canManageInventoryItems,
  canManageInventoryReservations,
  canManageInventoryWarehouses,
  canViewInventory,
  canViewInventoryAudit,
  INVENTORY_PERMISSION_KEYS,
};
