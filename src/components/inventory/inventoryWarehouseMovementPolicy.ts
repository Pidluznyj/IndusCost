/**
 * Política de seleção de almoxarifado para novas movimentações.
 */
import type { InventoryWarehouseRow } from "@/src/types/inventory";

export type WarehouseMovementEligibility = Pick<
  InventoryWarehouseRow,
  "id" | "code" | "name" | "status" | "allowsMovements"
>;

/** Almoxarifado elegível para registrar nova movimentação. */
export function isWarehouseSelectableForMovement(warehouse: WarehouseMovementEligibility): boolean {
  return warehouse.status === "ACTIVE" && warehouse.allowsMovements === true;
}

export function filterWarehousesForMovement<T extends WarehouseMovementEligibility>(
  warehouses: T[]
): T[] {
  return warehouses.filter(isWarehouseSelectableForMovement);
}

export function warehouseMovementBlockReason(warehouse: WarehouseMovementEligibility): string | null {
  if (warehouse.status === "INACTIVE") return "Almoxarifado inativo.";
  if (!warehouse.allowsMovements) return "Almoxarifado não permite movimentações.";
  return null;
}
