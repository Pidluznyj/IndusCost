/**
 * Regras de movimentação no cliente — delega cálculo ao motor puro compartilhado.
 */
import {
  previewMovementImpact,
  validateMovementRequest,
} from "@/src/lib/inventory/inventoryMovementRules.js";
import {
  INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES,
  InventoryValidationError,
  emptyInventoryBalance,
  type InventoryBalanceSnapshot,
  type InventoryItemType,
  type InventoryMovementType,
} from "@/src/lib/inventory/inventoryTypes.js";

const EXIT_TYPES = new Set<InventoryMovementType>([
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
  "NEGATIVE_ADJUSTMENT",
]);

export function requiresMovementCostCenter(
  movementType: InventoryMovementType,
  itemType: InventoryItemType | null
): boolean {
  if (!itemType || !EXIT_TYPES.has(movementType)) return false;
  return INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES.has(itemType);
}

export type MovementBalancePreview = {
  currentPhysical: number;
  currentAvailable: number;
  nextPhysical: number;
  nextAvailable: number;
  physicalDelta: number;
  availableDelta: number;
};

export function computeMovementBalancePreview(
  balance: InventoryBalanceSnapshot | null,
  movementType: InventoryMovementType,
  quantity: number
): MovementBalancePreview {
  const current = balance ?? emptyInventoryBalance();
  const { impact, nextBalance } = previewMovementImpact(current, movementType, quantity);
  return {
    currentPhysical: current.physicalQuantity,
    currentAvailable: current.availableQuantity,
    nextPhysical: nextBalance.physicalQuantity,
    nextAvailable: nextBalance.availableQuantity,
    physicalDelta: impact.physicalDelta,
    availableDelta: nextBalance.availableQuantity - current.availableQuantity,
  };
}

export function validateClientMovement(
  balance: InventoryBalanceSnapshot | null,
  movementType: InventoryMovementType,
  quantity: number,
  options: {
    reason?: string;
    costCenterId?: string | null;
    itemType?: InventoryItemType | null;
    sourceWarehouseId?: string | null;
    destinationWarehouseId?: string | null;
  } = {}
): { ok: true } | { ok: false; message: string; code?: string } {
  try {
    validateMovementRequest(balance ?? emptyInventoryBalance(), {
      movementType,
      quantity,
      reason: options.reason,
      costCenterId: options.costCenterId,
      itemType: options.itemType,
      sourceWarehouseId: options.sourceWarehouseId,
      destinationWarehouseId: options.destinationWarehouseId,
    });
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof InventoryValidationError) {
      return { ok: false, message: e.message, code: e.code };
    }
    return { ok: false, message: "Validação de movimentação falhou." };
  }
}

export function resolvePrimaryWarehouseIdForMovement(
  movementType: InventoryMovementType,
  sourceWarehouseId: string,
  destinationWarehouseId: string
): string | null {
  const entryTypes = new Set<InventoryMovementType>([
    "MANUAL_ENTRY",
    "PURCHASE_ENTRY",
    "PRODUCTION_ENTRY",
    "RETURN",
    "POSITIVE_ADJUSTMENT",
  ]);
  if (entryTypes.has(movementType)) return destinationWarehouseId || sourceWarehouseId || null;
  if (movementType === "TRANSFER") return sourceWarehouseId || null;
  return sourceWarehouseId || destinationWarehouseId || null;
}
