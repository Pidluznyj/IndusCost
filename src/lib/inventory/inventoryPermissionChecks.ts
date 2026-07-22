/**
 * Verificação de permissões do módulo Estoque — motor puro (sem Prisma).
 * Mantém compatibilidade com chaves legadas (inventory.manage, inventory.movements.create, etc.).
 */
import type { InventoryMovementType } from "./inventoryTypes.js";

export const INVENTORY_PERMISSION_KEYS = {
  view: "inventory.view",
  itemManage: "inventory.item.manage",
  warehouseManage: "inventory.warehouse.manage",
  movementCreate: "inventory.movement.create",
  movementCreateLegacy: "inventory.movements.create",
  movementOverride: "inventory.movements.override",
  adjustmentCreate: "inventory.adjustment.create",
  transferCreate: "inventory.transfer.create",
  reservationManage: "inventory.reservation.manage",
  reservationManageLegacy: "inventory.reservations.manage",
  blockManage: "inventory.block.manage",
  countManage: "inventory.count.manage",
  countApprove: "inventory.count.approve",
  auditView: "inventory.audit.view",
  manageLegacy: "inventory.manage",
} as const;

const ADJUSTMENT_TYPES = new Set<InventoryMovementType>([
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
]);

const BLOCK_TYPES = new Set<InventoryMovementType>(["BLOCK", "UNBLOCK"]);

const RESERVATION_TYPES = new Set<InventoryMovementType>(["RESERVE", "CANCEL_RESERVATION"]);

function held(perms: readonly string[], key: string): boolean {
  return perms.includes(key);
}

function heldAny(perms: readonly string[], keys: readonly string[]): boolean {
  return keys.some((k) => held(perms, k));
}

/** Gestor legado — acesso amplo a ações de estoque. */
function hasLegacyManage(perms: readonly string[]): boolean {
  return held(perms, INVENTORY_PERMISSION_KEYS.manageLegacy);
}

export function canViewInventory(perms: readonly string[]): boolean {
  return held(perms, INVENTORY_PERMISSION_KEYS.view) || hasLegacyManage(perms);
}

export function canManageInventoryItems(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.itemManage) ||
    hasLegacyManage(perms)
  );
}

export function canManageInventoryWarehouses(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.warehouseManage) ||
    hasLegacyManage(perms)
  );
}

export function canCreateBasicInventoryMovement(perms: readonly string[]): boolean {
  return heldAny(perms, [
    INVENTORY_PERMISSION_KEYS.movementCreate,
    INVENTORY_PERMISSION_KEYS.movementCreateLegacy,
  ]) || hasLegacyManage(perms);
}

export function canCreateInventoryAdjustment(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.adjustmentCreate) ||
    held(perms, INVENTORY_PERMISSION_KEYS.movementCreateLegacy) ||
    hasLegacyManage(perms)
  );
}

export function canCreateInventoryTransfer(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.transferCreate) ||
    held(perms, INVENTORY_PERMISSION_KEYS.movementCreateLegacy) ||
    hasLegacyManage(perms)
  );
}

export function canManageInventoryBlock(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.blockManage) ||
    held(perms, INVENTORY_PERMISSION_KEYS.movementCreateLegacy) ||
    hasLegacyManage(perms)
  );
}

export function canManageInventoryReservations(perms: readonly string[]): boolean {
  return heldAny(perms, [
    INVENTORY_PERMISSION_KEYS.reservationManage,
    INVENTORY_PERMISSION_KEYS.reservationManageLegacy,
  ]) || hasLegacyManage(perms);
}

export function canManageInventoryCounts(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.countManage) ||
    hasLegacyManage(perms)
  );
}

export function canApproveInventoryCount(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.countApprove) ||
    held(perms, INVENTORY_PERMISSION_KEYS.countManage) ||
    hasLegacyManage(perms)
  );
}

export function canViewInventoryAudit(perms: readonly string[]): boolean {
  return (
    held(perms, INVENTORY_PERMISSION_KEYS.auditView) ||
    hasLegacyManage(perms)
  );
}

export function canOverrideInventoryStock(perms: readonly string[]): boolean {
  return held(perms, INVENTORY_PERMISSION_KEYS.movementOverride) || hasLegacyManage(perms);
}

/** Verifica permissão para um tipo específico de movimentação. */
export function canCreateInventoryMovementType(
  perms: readonly string[],
  movementType: InventoryMovementType
): boolean {
  if (ADJUSTMENT_TYPES.has(movementType) || movementType === "INITIAL_BALANCE") {
    return canCreateInventoryAdjustment(perms);
  }
  if (BLOCK_TYPES.has(movementType)) return canManageInventoryBlock(perms);
  if (movementType === "TRANSFER") return canCreateInventoryTransfer(perms);
  if (RESERVATION_TYPES.has(movementType)) return canManageInventoryReservations(perms);
  // REVERSAL e demais tipos básicos (entrada/saída/perda/devolução)
  return canCreateBasicInventoryMovement(perms);
}

export function assertInventoryMovementPermission(
  perms: readonly string[] | undefined,
  movementType: InventoryMovementType
): void {
  const list = perms ?? [];
  if (!canCreateInventoryMovementType(list, movementType)) {
    const err = new Error("Sem permissão para registrar esta movimentação.");
    (err as Error & { code: string }).code = "NOT_AUTHORIZED";
    throw err;
  }
}

export const INVENTORY_MOVEMENT_PERMISSION_DENIED_MESSAGE =
  "Você não tem permissão para esta operação. Solicite acesso ao gestor de estoque.";
