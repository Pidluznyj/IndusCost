/**
 * Projeção e invariantes do ledger de estoque (puro — sem Prisma/API).
 * Origem da verdade: sequência de movimentos; saldo materializado é projeção.
 */
import {
  applyMovementImpactToBalance,
  applyTransferDestinationImpact,
  assertBalanceFormula,
  resolveMovementImpact,
  resolveReversalImpact,
} from "./inventoryBalanceMath.js";
import {
  buildInventoryBalanceKey,
  emptyInventoryBalance,
  normalizeInventoryBalance,
  roundInventoryQuantity,
  type InventoryBalanceSnapshot,
  type InventoryMovementType,
  InventoryValidationError,
} from "./inventoryTypes.js";

export type InventoryLedgerMovementFact = {
  id: string;
  movementType: InventoryMovementType;
  quantity: number;
  /** Escopo afetado (origem para saídas/transfer; destino para entradas). */
  warehouseId: string;
  locationId?: string | null;
  /** Destino da transferência (obrigatório quando movementType === TRANSFER). */
  destinationWarehouseId?: string | null;
  destinationLocationId?: string | null;
  /** Para REVERSAL: tipo do movimento original. */
  originalMovementType?: InventoryMovementType | null;
  reversedMovementId?: string | null;
  unit: string;
  createdByUserId?: string | null;
  movementDate: string;
};

export type InventoryLedgerScopeBalance = InventoryBalanceSnapshot & {
  balanceKey: string;
  warehouseId: string;
  locationId: string | null;
  lastMovementId: string | null;
};

/** available = physical − reserved − blocked − quarantine */
export function assertAvailableIsDerived(balance: InventoryBalanceSnapshot): void {
  assertBalanceFormula(balance);
}

/**
 * Projeta saldos a partir do ledger (ordem cronológica / inserção).
 * Transferência aplica saída na origem e entrada no destino.
 */
export function projectBalancesFromLedger(
  movements: readonly InventoryLedgerMovementFact[]
): Map<string, InventoryLedgerScopeBalance> {
  const balances = new Map<string, InventoryLedgerScopeBalance>();
  const reversedOriginalIds = new Set<string>();

  const ensure = (
    warehouseId: string,
    locationId: string | null | undefined
  ): InventoryLedgerScopeBalance => {
    const balanceKey = buildInventoryBalanceKey(warehouseId, locationId);
    const existing = balances.get(balanceKey);
    if (existing) return existing;
    const created: InventoryLedgerScopeBalance = {
      ...emptyInventoryBalance(),
      balanceKey,
      warehouseId,
      locationId: locationId?.trim() ? locationId.trim() : null,
      lastMovementId: null,
    };
    balances.set(balanceKey, created);
    return created;
  };

  for (const movement of movements) {
    const qty = roundInventoryQuantity(movement.quantity);
    if (qty <= 0) {
      throw new InventoryValidationError("Quantidade deve ser maior que zero.", "INVALID_QUANTITY");
    }

    if (movement.movementType === "REVERSAL") {
      if (!movement.reversedMovementId) {
        throw new InventoryValidationError(
          "REVERSAL exige reversedMovementId.",
          "REVERSAL_REQUIRES_ORIGINAL"
        );
      }
      if (reversedOriginalIds.has(movement.reversedMovementId)) {
        throw new InventoryValidationError(
          "Movimento já estornado — duplo estorno proibido.",
          "DOUBLE_REVERSAL"
        );
      }
      if (!movement.originalMovementType) {
        throw new InventoryValidationError(
          "REVERSAL exige originalMovementType.",
          "REVERSAL_REQUIRES_ORIGINAL"
        );
      }
      reversedOriginalIds.add(movement.reversedMovementId);
    }

    if (movement.movementType === "TRANSFER") {
      const destWh = movement.destinationWarehouseId?.trim();
      if (!destWh) {
        throw new InventoryValidationError(
          "TRANSFER exige destinationWarehouseId.",
          "TRANSFER_REQUIRES_DESTINATION"
        );
      }
      const sourceKey = buildInventoryBalanceKey(movement.warehouseId, movement.locationId);
      const destKey = buildInventoryBalanceKey(destWh, movement.destinationLocationId);
      if (sourceKey === destKey) {
        throw new InventoryValidationError(
          "TRANSFER exige origem ≠ destino.",
          "TRANSFER_SAME_SCOPE"
        );
      }

      const source = ensure(movement.warehouseId, movement.locationId);
      const afterSource = applyMovementImpactToBalance(
        source,
        resolveMovementImpact("TRANSFER", qty)
      );
      Object.assign(source, afterSource, { lastMovementId: movement.id });

      const dest = ensure(destWh, movement.destinationLocationId);
      const afterDest = applyTransferDestinationImpact(dest, qty);
      Object.assign(dest, afterDest, { lastMovementId: movement.id });
      continue;
    }

    const scope = ensure(movement.warehouseId, movement.locationId);
    const impact =
      movement.movementType === "REVERSAL"
        ? resolveReversalImpact(movement.originalMovementType!, qty)
        : resolveMovementImpact(movement.movementType, qty);
    const after = applyMovementImpactToBalance(scope, impact);
    Object.assign(scope, after, { lastMovementId: movement.id });
  }

  for (const balance of balances.values()) {
    const normalized = normalizeInventoryBalance(balance);
    Object.assign(balance, normalized);
    assertAvailableIsDerived(balance);
  }

  return balances;
}

/** Compara saldo materializado com projeção do ledger (mesma chave). */
export function assertMaterializedMatchesLedger(
  materialized: InventoryBalanceSnapshot,
  projected: InventoryBalanceSnapshot
): void {
  assertAvailableIsDerived(materialized);
  assertAvailableIsDerived(projected);
  const fields: (keyof InventoryBalanceSnapshot)[] = [
    "physicalQuantity",
    "reservedQuantity",
    "blockedQuantity",
    "quarantineQuantity",
    "availableQuantity",
  ];
  for (const field of fields) {
    if (roundInventoryQuantity(materialized[field]) !== roundInventoryQuantity(projected[field])) {
      throw new InventoryValidationError(
        `Saldo materializado diverge do ledger em ${field}.`,
        "BALANCE_LEDGER_MISMATCH"
      );
    }
  }
}

/** Unidade oficial do item logístico deve espelhar a unidade da MP quando houver vínculo. */
export function assertOfficialUnitMatchesMaterial(
  itemUnit: string,
  materialUnit: string | null | undefined
): void {
  if (materialUnit == null || materialUnit === "") return;
  if (itemUnit.trim() !== materialUnit.trim()) {
    throw new InventoryValidationError(
      "Unidade oficial do item logístico diverge da unidade da matéria-prima oficial.",
      "OFFICIAL_UNIT_MISMATCH"
    );
  }
}

/** Snapshot de linha deve respeitar a fórmula de disponível. */
export function assertStockSnapshotLineFormula(line: InventoryBalanceSnapshot): void {
  assertAvailableIsDerived(line);
}
