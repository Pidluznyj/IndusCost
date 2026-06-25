/**
 * Normalização do payload do dashboard — tolerante a campos ausentes.
 * Sem Prisma; seguro para frontend e testes.
 */
import type {
  InventoryDashboardCriticalItem,
  InventoryDashboardPayload,
  InventoryDashboardRecentMovement,
} from "@/src/types/inventory";

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeCriticalItem(raw: unknown): InventoryDashboardCriticalItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const itemId = safeString(row.itemId);
  const code = safeString(row.code);
  if (!itemId && !code) return null;
  return {
    itemId,
    code,
    description: safeString(row.description),
    itemType: safeString(row.itemType) as InventoryDashboardCriticalItem["itemType"],
    availableQuantity: finiteNumber(row.availableQuantity),
    minimumStock: finiteNumberOrNull(row.minimumStock),
    reorderPoint: finiteNumberOrNull(row.reorderPoint),
    operationalStatus: safeString(row.operationalStatus) || "OK",
  };
}

function normalizeRecentMovement(raw: unknown): InventoryDashboardRecentMovement | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = safeString(row.id);
  if (!id) return null;
  return {
    id,
    itemId: safeString(row.itemId),
    itemCode: safeString(row.itemCode) || null,
    itemDescription: safeString(row.itemDescription) || null,
    movementType: safeString(row.movementType) as InventoryDashboardRecentMovement["movementType"],
    quantity: finiteNumber(row.quantity),
    unit: safeString(row.unit) || "UN",
    movementDate: safeString(row.movementDate),
    warehouseCode: safeString(row.warehouseCode) || null,
    warehouseName: safeString(row.warehouseName) || null,
    responsibleUserId: safeString(row.responsibleUserId) || null,
  };
}

function normalizeArray<T>(value: unknown, mapper: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const mapped = mapper(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Aceita payload parcial da API sem quebrar a UI. */
export function normalizeInventoryDashboard(raw: unknown): InventoryDashboardPayload {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    totalInventoryValue: finiteNumber(data.totalInventoryValue),
    itemsCount: finiteNumber(data.itemsCount),
    belowMinimumCount: finiteNumber(data.belowMinimumCount),
    belowReorderPointCount: finiteNumber(data.belowReorderPointCount),
    negativeStockCount: finiteNumber(data.negativeStockCount),
    blockedItemsCount: finiteNumber(data.blockedItemsCount),
    reservedItemsCount: finiteNumber(data.reservedItemsCount),
    quarantineItemsCount: finiteNumber(data.quarantineItemsCount),
    recentMovements: normalizeArray(data.recentMovements, normalizeRecentMovement),
    criticalRawMaterials: normalizeArray(data.criticalRawMaterials, normalizeCriticalItem),
    criticalSupplies: normalizeArray(data.criticalSupplies, normalizeCriticalItem),
    finishedProductsAvailable: normalizeArray(data.finishedProductsAvailable, normalizeCriticalItem),
  };
}

export const EMPTY_INVENTORY_DASHBOARD: InventoryDashboardPayload = normalizeInventoryDashboard({});
