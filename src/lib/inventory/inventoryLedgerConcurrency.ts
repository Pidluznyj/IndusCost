/**
 * Helpers de concorrência do ledger — motor puro (OP-09).
 * Ordenação estável de chaves evita deadlock em transferências.
 */
import { buildInventoryBalanceKey } from "./inventoryTypes.js";

export type InventoryBalanceLockTarget = {
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
};

export function inventoryBalanceLockKey(target: InventoryBalanceLockTarget): string {
  return `${target.itemId}:${buildInventoryBalanceKey(target.warehouseId, target.locationId)}`;
}

/** Ordena escopos de saldo para aquisição de lock determinística. */
export function orderBalanceLockTargets(
  targets: readonly InventoryBalanceLockTarget[]
): InventoryBalanceLockTarget[] {
  return [...targets].sort((a, b) =>
    inventoryBalanceLockKey(a).localeCompare(inventoryBalanceLockKey(b))
  );
}
