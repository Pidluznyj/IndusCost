/**
 * Normalização de almoxarifados e resumo de saldo — frontend puro.
 */
import { calculateInventoryStatus } from "@/src/lib/inventory/inventoryStatus.js";
import type { InventoryWarehouseRow } from "@/src/types/inventory";

export type InventoryWarehouseListResponse = {
  rows: InventoryWarehouseRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type InventoryWarehouseBalanceRow = {
  itemId: string;
  itemCode: string;
  itemDescription: string;
  availableQuantity: number;
  physicalQuantity: number;
  totalValue: number | null;
  minimumStock: number | null;
  reorderPoint: number | null;
  operationalStatus: string;
};

export type InventoryWarehouseSummary = {
  itemsCount: number;
  totalInventoryValue: number;
  criticalItems: InventoryWarehouseBalanceRow[];
  recentMovements: Array<{
    id: string;
    itemCode: string | null;
    movementType: string;
    quantity: number;
    unit: string;
    movementDate: string;
  }>;
  balanceRows: InventoryWarehouseBalanceRow[];
  hasBalances: boolean;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeInventoryWarehouseRow(raw: unknown): InventoryWarehouseRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = safeString(row.id);
  const code = safeString(row.code);
  if (!id && !code) return null;

  return {
    id,
    code,
    name: safeString(row.name),
    description: safeString(row.description) || null,
    status: (safeString(row.status) || "ACTIVE") as InventoryWarehouseRow["status"],
    allowsMovements: row.allowsMovements !== false,
    createdAt: safeString(row.createdAt),
    updatedAt: safeString(row.updatedAt),
  };
}

export function normalizeInventoryWarehouseListResponse(raw: unknown): InventoryWarehouseListResponse {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows = rowsRaw
    .map(normalizeInventoryWarehouseRow)
    .filter((r): r is InventoryWarehouseRow => r != null);

  const page = finiteNumber(data.page, 1);
  const pageSize = finiteNumber(data.pageSize, 50) || 50;
  const total = finiteNumber(data.total, rows.length);
  const totalPages = finiteNumber(data.totalPages, Math.max(1, Math.ceil(total / pageSize)));

  return { rows, total, page, pageSize, totalPages };
}

function normalizeBalanceWithItem(raw: unknown): InventoryWarehouseBalanceRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const item = row.item && typeof row.item === "object" ? (row.item as Record<string, unknown>) : {};
  const itemId = safeString(row.itemId);
  if (!itemId) return null;

  const availableQuantity = finiteNumber(row.availableQuantity);
  const physicalQuantity = finiteNumber(row.physicalQuantity);
  const minimumStock = finiteOrNull(item.minimumStock);
  const reorderPoint = finiteOrNull(item.reorderPoint);
  const itemStatus = safeString(item.status) || "ACTIVE";

  const operationalStatus = calculateInventoryStatus(
    {
      physicalQuantity,
      reservedQuantity: finiteNumber(row.reservedQuantity),
      blockedQuantity: finiteNumber(row.blockedQuantity),
      quarantineQuantity: finiteNumber(row.quarantineQuantity),
      availableQuantity,
    },
    { status: itemStatus as "ACTIVE" | "INACTIVE", minimumStock, reorderPoint }
  );

  return {
    itemId,
    itemCode: safeString(item.code),
    itemDescription: safeString(item.description),
    availableQuantity,
    physicalQuantity,
    totalValue: finiteOrNull(row.totalValue),
    minimumStock,
    reorderPoint,
    operationalStatus,
  };
}

export function normalizeWarehouseBalancesResponse(raw: unknown): InventoryWarehouseBalanceRow[] {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  return rowsRaw
    .map(normalizeBalanceWithItem)
    .filter((r): r is InventoryWarehouseBalanceRow => r != null);
}

export function buildWarehouseSummaryFromBalances(
  balances: InventoryWarehouseBalanceRow[]
): InventoryWarehouseSummary {
  const itemsCount = balances.length;
  const totalInventoryValue = balances.reduce((sum, b) => sum + (b.totalValue ?? 0), 0);
  const criticalItems = balances.filter(
    (b) =>
      b.operationalStatus === "CRITICAL" ||
      b.operationalStatus === "OUT_OF_STOCK" ||
      b.operationalStatus === "NEGATIVE"
  );

  return {
    itemsCount,
    totalInventoryValue,
    criticalItems,
    recentMovements: [],
    balanceRows: balances,
    hasBalances: balances.length > 0,
  };
}

export const EMPTY_WAREHOUSE_SUMMARY: InventoryWarehouseSummary = buildWarehouseSummaryFromBalances([]);
