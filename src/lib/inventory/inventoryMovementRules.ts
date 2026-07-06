/**
 * Regras de validação de movimentações — motor puro.
 */
import {
  INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES,
  InventoryValidationError,
  type InventoryBalanceSnapshot,
  type InventoryMovementRequest,
  type InventoryMovementType,
  type InventoryMovementValidationContext,
} from "./inventoryTypes.js";
import { applyMovementToBalance, resolveMovementImpact } from "./inventoryBalanceMath.js";

const MANUAL_REASON_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
  "BLOCK",
  "UNBLOCK",
  "RESERVE",
  "CANCEL_RESERVATION",
  "LOSS",
  "SCRAP",
  "RETURN",
  "TRANSFER",
]);

const ADJUSTMENT_TYPES = new Set<InventoryMovementType>([
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
]);

const EXIT_TYPES = new Set<InventoryMovementType>([
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
  "NEGATIVE_ADJUSTMENT",
]);

function hasNonEmptyReason(reason: unknown): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

function requiresCostCenter(movement: InventoryMovementRequest): boolean {
  if (!EXIT_TYPES.has(movement.movementType)) return false;
  const itemType = movement.itemType;
  if (!itemType) return false;
  return INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES.has(itemType);
}

export function validateMovementRequest(
  balance: InventoryBalanceSnapshot,
  movement: InventoryMovementRequest,
  context: InventoryMovementValidationContext = {}
): InventoryBalanceSnapshot {
  const qty = movement.quantity;
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new InventoryValidationError("Quantidade deve ser maior que zero.", "INVALID_QUANTITY");
  }

  const requireReason = context.requireReason ?? true;
  if (requireReason && MANUAL_REASON_TYPES.has(movement.movementType) && !hasNonEmptyReason(movement.reason)) {
    throw new InventoryValidationError("Motivo é obrigatório para esta movimentação.", "REASON_REQUIRED");
  }

  if (ADJUSTMENT_TYPES.has(movement.movementType) && !hasNonEmptyReason(movement.reason)) {
    throw new InventoryValidationError("Ajuste exige motivo.", "ADJUSTMENT_REASON_REQUIRED");
  }

  if (requiresCostCenter(movement) && !movement.costCenterId?.trim()) {
    throw new InventoryValidationError(
      "Centro de custo é obrigatório para saída deste tipo de item.",
      "COST_CENTER_REQUIRED"
    );
  }

  if (movement.movementType === "TRANSFER") {
    const sourceWh = movement.sourceWarehouseId?.trim();
    const destWh = movement.destinationWarehouseId?.trim();
    if (!sourceWh || !destWh) {
      throw new InventoryValidationError("Transferência exige almoxarifado de origem e destino.", "TRANSFER_WAREHOUSE");
    }
    const sameWarehouse = sourceWh === destWh;
    const sameLocation =
      (movement.sourceLocationId?.trim() ?? "") === (movement.destinationLocationId?.trim() ?? "");
    if (sameWarehouse && sameLocation) {
      throw new InventoryValidationError(
        "Transferência para o mesmo local é inválida.",
        "TRANSFER_SAME_LOCATION"
      );
    }
  }

  const nextBalance = applyMovementToBalance(balance, movement.movementType, qty);

  if (nextBalance.physicalQuantity < 0 && !context.allowNegativeStock) {
    throw new InventoryValidationError(
      "Movimento deixaria saldo físico negativo.",
      "INSUFFICIENT_PHYSICAL"
    );
  }

  if (movement.movementType === "UNBLOCK" && balance.blockedQuantity < qty) {
    throw new InventoryValidationError("Quantidade de desbloqueio excede saldo bloqueado.", "INSUFFICIENT_BLOCKED");
  }

  if (movement.movementType === "CANCEL_RESERVATION" && balance.reservedQuantity < qty) {
    throw new InventoryValidationError(
      "Quantidade de cancelamento excede saldo reservado.",
      "INSUFFICIENT_RESERVED"
    );
  }

  const reducesAvailable =
    EXIT_TYPES.has(movement.movementType) ||
    movement.movementType === "RESERVE" ||
    movement.movementType === "BLOCK";

  if (
    reducesAvailable &&
    nextBalance.availableQuantity < 0 &&
    !context.allowNegativeAvailable &&
    !context.allowNegativeStock
  ) {
    throw new InventoryValidationError(
      "Movimento excede saldo disponível.",
      "INSUFFICIENT_AVAILABLE"
    );
  }

  return nextBalance;
}

export function previewMovementImpact(
  balance: InventoryBalanceSnapshot,
  movementType: InventoryMovementType,
  quantity: number
) {
  return {
    impact: resolveMovementImpact(movementType, quantity),
    nextBalance: applyMovementToBalance(balance, movementType, quantity),
  };
}
