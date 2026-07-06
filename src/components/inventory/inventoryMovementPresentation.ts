/**
 * Normalização de movimentações — frontend puro.
 */
import {
  emptyInventoryBalance,
  snapshotFromBalance,
  type InventoryBalanceSnapshot,
} from "@/src/lib/inventory/inventoryTypes.js";
import type { InventoryMovementRow } from "@/src/types/inventory";

export type InventoryMovementListResponse = {
  rows: InventoryMovementRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeNullableString(value: unknown): string | null {
  const s = safeString(value);
  return s || null;
}

export function normalizeInventoryMovementRow(raw: unknown): InventoryMovementRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = safeString(row.id);
  const itemId = safeString(row.itemId);
  if (!id || !itemId) return null;

  return {
    id,
    itemId,
    itemCode: safeNullableString(row.itemCode),
    itemDescription: safeNullableString(row.itemDescription),
    sourceWarehouseId: safeNullableString(row.sourceWarehouseId),
    destinationWarehouseId: safeNullableString(row.destinationWarehouseId),
    sourceWarehouseCode: safeNullableString(row.sourceWarehouseCode),
    sourceWarehouseName: safeNullableString(row.sourceWarehouseName),
    destinationWarehouseCode: safeNullableString(row.destinationWarehouseCode),
    destinationWarehouseName: safeNullableString(row.destinationWarehouseName),
    warehouseCode: safeNullableString(row.warehouseCode),
    warehouseName: safeNullableString(row.warehouseName),
    movementType: safeString(row.movementType) as InventoryMovementRow["movementType"],
    quantity: finiteNumber(row.quantity),
    unit: safeString(row.unit),
    reason: safeString(row.reason),
    notes: safeNullableString(row.notes),
    responsibleUserId: safeNullableString(row.responsibleUserId),
    movementDate: safeString(row.movementDate),
    originType: safeString(row.originType),
    originId: safeNullableString(row.originId),
    documentNumber: safeNullableString(row.documentNumber),
    costCenterId: safeNullableString(row.costCenterId),
    financialCostCenterId: safeNullableString(row.financialCostCenterId),
    reservationId: safeNullableString(row.reservationId),
    reversedMovementId: safeNullableString(row.reversedMovementId),
    previousPhysicalBalance: finiteNumber(row.previousPhysicalBalance),
    nextPhysicalBalance: finiteNumber(row.nextPhysicalBalance),
    previousAvailableBalance: finiteNumber(row.previousAvailableBalance),
    nextAvailableBalance: finiteNumber(row.nextAvailableBalance),
    createdAt: safeString(row.createdAt),
  };
}

export function normalizeInventoryMovementListResponse(raw: unknown): InventoryMovementListResponse {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows = rowsRaw
    .map(normalizeInventoryMovementRow)
    .filter((r): r is InventoryMovementRow => r != null);

  const page = finiteNumber(data.page, 1);
  const pageSize = finiteNumber(data.pageSize, 50) || 50;
  const total = finiteNumber(data.total, rows.length);
  const totalPages = finiteNumber(data.totalPages, Math.max(1, Math.ceil(total / pageSize)));

  return { rows, total, page, pageSize, totalPages };
}

export function normalizeInventoryBalanceSnapshot(raw: unknown): InventoryBalanceSnapshot {
  if (!raw || typeof raw !== "object") return emptyInventoryBalance();
  const row = raw as Record<string, unknown>;
  return snapshotFromBalance({
    physicalQuantity: finiteNumber(row.physicalQuantity),
    reservedQuantity: finiteNumber(row.reservedQuantity),
    blockedQuantity: finiteNumber(row.blockedQuantity),
    quarantineQuantity: finiteNumber(row.quarantineQuantity),
    availableQuantity: finiteNumber(row.availableQuantity),
  });
}

export function findBalanceForWarehouse(
  balances: unknown[],
  warehouseId: string
): InventoryBalanceSnapshot {
  const match = balances.find((b) => {
    if (!b || typeof b !== "object") return false;
    return (b as Record<string, unknown>).warehouseId === warehouseId;
  });
  return normalizeInventoryBalanceSnapshot(match);
}

export function movementHasBalanceAudit(row: InventoryMovementRow): boolean {
  return (
    row.previousPhysicalBalance !== 0 ||
    row.nextPhysicalBalance !== 0 ||
    row.movementDate.length > 0
  );
}
