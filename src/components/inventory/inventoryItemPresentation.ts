/**
 * Normalização de itens e saldos para UI — frontend puro.
 */
import type { InventoryBalanceRow, InventoryItemRow } from "@/src/types/inventory";
import { calculateInventoryStatus } from "@/src/lib/inventory/inventoryStatus.js";

export type InventoryItemListResponse = {
  rows: InventoryItemRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type InventoryItemBalanceSummary = {
  physicalQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  quarantineQuantity: number;
  availableQuantity: number;
  lastMovementAt: string | null;
  operationalStatus: string;
  hasBalances: boolean;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeInventoryItemRow(raw: unknown): InventoryItemRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = safeString(row.id);
  const code = safeString(row.code);
  if (!id && !code) return null;

  return {
    id,
    code,
    description: safeString(row.description),
    itemType: safeString(row.itemType) as InventoryItemRow["itemType"],
    unit: safeString(row.unit) || "UN",
    family: safeString(row.family) || null,
    group: safeString(row.group) || null,
    status: (safeString(row.status) || "ACTIVE") as InventoryItemRow["status"],
    controlsLot: row.controlsLot === true,
    controlsExpiration: row.controlsExpiration === true,
    controlsLocation: row.controlsLocation === true,
    controlsQuality: row.controlsQuality === true,
    controlsStock: row.controlsStock !== false,
    allowsReservation: row.allowsReservation !== false,
    allowsBlock: row.allowsBlock !== false,
    minimumStock: row.minimumStock == null ? null : finiteNumber(row.minimumStock),
    safetyStock: row.safetyStock == null ? null : finiteNumber(row.safetyStock),
    maximumStock: row.maximumStock == null ? null : finiteNumber(row.maximumStock),
    reorderPoint: row.reorderPoint == null ? null : finiteNumber(row.reorderPoint),
    preferredSupplierName: safeString(row.preferredSupplierName) || null,
    averageCost: row.averageCost == null ? null : finiteNumber(row.averageCost),
    lastKnownCost: row.lastKnownCost == null ? null : finiteNumber(row.lastKnownCost),
    productId: safeString(row.productId) || null,
    materialId: safeString(row.materialId) || null,
    materialCodeSnapshot: safeString(row.materialCodeSnapshot) || null,
    materialDescriptionSnapshot: safeString(row.materialDescriptionSnapshot) || null,
    materialUnitSnapshot: safeString(row.materialUnitSnapshot) || null,
    materialCategorySnapshot: safeString(row.materialCategorySnapshot) || null,
    defaultWarehouseId: safeString(row.defaultWarehouseId) || null,
    defaultLocationId: safeString(row.defaultLocationId) || null,
    nomusProductCode: safeString(row.nomusProductCode) || null,
    nomusProductId: safeString(row.nomusProductId) || null,
    notes: safeString(row.notes) || null,
    createdAt: safeString(row.createdAt),
    updatedAt: safeString(row.updatedAt),
    createdByUserId: safeString(row.createdByUserId) || null,
    updatedByUserId: safeString(row.updatedByUserId) || null,
  };
}

export function normalizeInventoryItemListResponse(raw: unknown): InventoryItemListResponse {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows = rowsRaw
    .map(normalizeInventoryItemRow)
    .filter((r): r is InventoryItemRow => r != null);

  const page = finiteNumber(data.page, 1);
  const pageSize = finiteNumber(data.pageSize, 50) || 50;
  const total = finiteNumber(data.total, rows.length);
  const totalPages = finiteNumber(data.totalPages, Math.max(1, Math.ceil(total / pageSize)));

  return { rows, total, page, pageSize, totalPages };
}

export function normalizeInventoryBalanceRow(raw: unknown): InventoryBalanceRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = safeString(row.id);
  if (!id) return null;

  return {
    id,
    itemId: safeString(row.itemId),
    warehouseId: safeString(row.warehouseId),
    locationId: safeString(row.locationId) || null,
    balanceKey: safeString(row.balanceKey),
    physicalQuantity: finiteNumber(row.physicalQuantity),
    reservedQuantity: finiteNumber(row.reservedQuantity),
    blockedQuantity: finiteNumber(row.blockedQuantity),
    quarantineQuantity: finiteNumber(row.quarantineQuantity),
    availableQuantity: finiteNumber(row.availableQuantity),
    averageCost: row.averageCost == null ? null : finiteNumber(row.averageCost),
    totalValue: row.totalValue == null ? null : finiteNumber(row.totalValue),
    lastMovementAt: safeString(row.lastMovementAt) || null,
    updatedAt: safeString(row.updatedAt),
  };
}

export function summarizeInventoryBalances(
  balances: InventoryBalanceRow[],
  item?: Pick<InventoryItemRow, "status" | "minimumStock" | "reorderPoint">
): InventoryItemBalanceSummary {
  if (balances.length === 0) {
    const operationalStatus =
      item?.status === "INACTIVE"
        ? "INACTIVE"
        : calculateInventoryStatus(
            {
              physicalQuantity: 0,
              reservedQuantity: 0,
              blockedQuantity: 0,
              quarantineQuantity: 0,
              availableQuantity: 0,
            },
            {
              status: item?.status,
              minimumStock: item?.minimumStock,
              reorderPoint: item?.reorderPoint,
            }
          );
    return {
      physicalQuantity: 0,
      reservedQuantity: 0,
      blockedQuantity: 0,
      quarantineQuantity: 0,
      availableQuantity: 0,
      lastMovementAt: null,
      operationalStatus,
      hasBalances: false,
    };
  }

  let physicalQuantity = 0;
  let reservedQuantity = 0;
  let blockedQuantity = 0;
  let quarantineQuantity = 0;
  let availableQuantity = 0;
  let lastMovementAt: string | null = null;

  for (const b of balances) {
    physicalQuantity += b.physicalQuantity;
    reservedQuantity += b.reservedQuantity;
    blockedQuantity += b.blockedQuantity;
    quarantineQuantity += b.quarantineQuantity;
    availableQuantity += b.availableQuantity;
    if (b.lastMovementAt) {
      if (!lastMovementAt || b.lastMovementAt > lastMovementAt) {
        lastMovementAt = b.lastMovementAt;
      }
    }
  }

  const operationalStatus = calculateInventoryStatus(
    {
      physicalQuantity,
      reservedQuantity,
      blockedQuantity,
      quarantineQuantity,
      availableQuantity,
    },
    {
      status: item?.status,
      minimumStock: item?.minimumStock,
      reorderPoint: item?.reorderPoint,
    }
  );

  return {
    physicalQuantity,
    reservedQuantity,
    blockedQuantity,
    quarantineQuantity,
    availableQuantity,
    lastMovementAt,
    operationalStatus,
    hasBalances: true,
  };
}

export function normalizeInventoryBalancesResponse(raw: unknown): InventoryBalanceRow[] {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  return rowsRaw
    .map(normalizeInventoryBalanceRow)
    .filter((r): r is InventoryBalanceRow => r != null);
}
