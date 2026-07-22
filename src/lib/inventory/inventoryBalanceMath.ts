/**
 * Impacto de movimentações sobre saldo — motor puro.
 */
import {
  calculateAvailableBalance,
  InventoryValidationError,
  normalizeInventoryBalance,
  roundInventoryQuantity,
  type InventoryBalanceSnapshot,
  type InventoryMovementType,
} from "./inventoryTypes.js";

export type InventoryMovementImpact = {
  physicalDelta: number;
  reservedDelta: number;
  blockedDelta: number;
  quarantineDelta: number;
};

const PHYSICAL_IN_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "PURCHASE_ENTRY",
  "PRODUCTION_ENTRY",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
  "INITIAL_BALANCE",
]);

const PHYSICAL_OUT_TYPES = new Set<InventoryMovementType>([
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
  "NEGATIVE_ADJUSTMENT",
]);

export function resolveMovementImpact(
  movementType: InventoryMovementType,
  quantity: number
): InventoryMovementImpact {
  const qty = roundInventoryQuantity(quantity);
  if (qty <= 0) {
    throw new InventoryValidationError("Quantidade deve ser maior que zero.", "INVALID_QUANTITY");
  }

  if (PHYSICAL_IN_TYPES.has(movementType)) {
    return { physicalDelta: qty, reservedDelta: 0, blockedDelta: 0, quarantineDelta: 0 };
  }
  if (PHYSICAL_OUT_TYPES.has(movementType)) {
    return { physicalDelta: -qty, reservedDelta: 0, blockedDelta: 0, quarantineDelta: 0 };
  }
  if (movementType === "TRANSFER") {
    return { physicalDelta: -qty, reservedDelta: 0, blockedDelta: 0, quarantineDelta: 0 };
  }
  if (movementType === "BLOCK") {
    return { physicalDelta: 0, reservedDelta: 0, blockedDelta: qty, quarantineDelta: 0 };
  }
  if (movementType === "UNBLOCK") {
    return { physicalDelta: 0, reservedDelta: 0, blockedDelta: -qty, quarantineDelta: 0 };
  }
  if (movementType === "RESERVE") {
    return { physicalDelta: 0, reservedDelta: qty, blockedDelta: 0, quarantineDelta: 0 };
  }
  if (movementType === "CANCEL_RESERVATION") {
    return { physicalDelta: 0, reservedDelta: -qty, blockedDelta: 0, quarantineDelta: 0 };
  }
  if (movementType === "REVERSAL") {
    throw new InventoryValidationError(
      "REVERSAL deve ser resolvido a partir do movimento original.",
      "REVERSAL_REQUIRES_ORIGINAL"
    );
  }

  throw new InventoryValidationError(`Tipo de movimento não suportado: ${movementType}.`);
}

export function resolveReversalImpact(originalType: InventoryMovementType, quantity: number): InventoryMovementImpact {
  const original = resolveMovementImpact(originalType, quantity);
  return {
    physicalDelta: -original.physicalDelta,
    reservedDelta: -original.reservedDelta,
    blockedDelta: -original.blockedDelta,
    quarantineDelta: -original.quarantineDelta,
  };
}

export function applyMovementImpactToBalance(
  balance: InventoryBalanceSnapshot,
  impact: InventoryMovementImpact
): InventoryBalanceSnapshot {
  return normalizeInventoryBalance({
    physicalQuantity: balance.physicalQuantity + impact.physicalDelta,
    reservedQuantity: balance.reservedQuantity + impact.reservedDelta,
    blockedQuantity: balance.blockedQuantity + impact.blockedDelta,
    quarantineQuantity: balance.quarantineQuantity + impact.quarantineDelta,
    availableQuantity: 0,
  });
}

export function applyMovementToBalance(
  balance: InventoryBalanceSnapshot,
  movementType: InventoryMovementType,
  quantity: number
): InventoryBalanceSnapshot {
  const impact = resolveMovementImpact(movementType, quantity);
  return applyMovementImpactToBalance(balance, impact);
}

/** Impacto de entrada no destino de uma transferência. */
export function applyTransferDestinationImpact(
  balance: InventoryBalanceSnapshot,
  quantity: number
): InventoryBalanceSnapshot {
  return applyMovementImpactToBalance(balance, {
    physicalDelta: roundInventoryQuantity(quantity),
    reservedDelta: 0,
    blockedDelta: 0,
    quarantineDelta: 0,
  });
}

export function assertBalanceFormula(balance: InventoryBalanceSnapshot): void {
  const expected = calculateAvailableBalance(balance);
  if (roundInventoryQuantity(balance.availableQuantity) !== expected) {
    throw new InventoryValidationError(
      `Fórmula de disponível violada: esperado ${expected}, obtido ${balance.availableQuantity}.`,
      "AVAILABLE_FORMULA"
    );
  }
}
