/**
 * Normalização de saldos para UI — frontend puro.
 */
import { calculateInventoryStatus } from "@/src/lib/inventory/inventoryStatus.js";
import { normalizeInventoryBalanceRow } from "@/src/components/inventory/inventoryItemPresentation";
import type { InventoryBalanceRow, InventoryItemType } from "@/src/types/inventory";

export type InventoryBalanceListRow = InventoryBalanceRow & {
  itemCode: string;
  itemDescription: string;
  itemType: InventoryItemType;
  itemStatus: "ACTIVE" | "INACTIVE";
  unit: string;
  family: string | null;
  group: string | null;
  minimumStock: number | null;
  reorderPoint: number | null;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: string;
  operationalStatus: string;
};

export type InventoryBalanceListSummary = {
  filteredItemsCount: number;
  filteredRowsCount: number;
  totalInventoryValue: number;
  criticalCount: number;
  belowMinimumCount: number;
  negativeCount: number;
};

export type InventoryBalanceListResponse = {
  rows: InventoryBalanceListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: InventoryBalanceListSummary;
};

export const EMPTY_BALANCE_LIST_SUMMARY: InventoryBalanceListSummary = {
  filteredItemsCount: 0,
  filteredRowsCount: 0,
  totalInventoryValue: 0,
  criticalCount: 0,
  belowMinimumCount: 0,
  negativeCount: 0,
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

export function normalizeInventoryBalanceListRow(raw: unknown): InventoryBalanceListRow | null {
  const base = normalizeInventoryBalanceRow(raw);
  if (!base) return null;

  const row = raw as Record<string, unknown>;
  const item = row.item && typeof row.item === "object" ? (row.item as Record<string, unknown>) : {};
  const warehouse =
    row.warehouse && typeof row.warehouse === "object" ? (row.warehouse as Record<string, unknown>) : {};

  const minimumStock = finiteOrNull(item.minimumStock);
  const reorderPoint = finiteOrNull(item.reorderPoint);
  const itemStatus = (safeString(item.status) || "ACTIVE") as "ACTIVE" | "INACTIVE";

  const operationalStatus = calculateInventoryStatus(
    {
      physicalQuantity: base.physicalQuantity,
      reservedQuantity: base.reservedQuantity,
      blockedQuantity: base.blockedQuantity,
      quarantineQuantity: base.quarantineQuantity,
      availableQuantity: base.availableQuantity,
    },
    { status: itemStatus, minimumStock, reorderPoint }
  );

  return {
    ...base,
    itemCode: safeString(item.code),
    itemDescription: safeString(item.description),
    itemType: safeString(item.itemType) as InventoryItemType,
    itemStatus,
    unit: safeString(item.unit) || "UN",
    family: safeString(item.family) || null,
    group: safeString(item.group) || null,
    minimumStock,
    reorderPoint,
    warehouseCode: safeString(warehouse.code),
    warehouseName: safeString(warehouse.name),
    warehouseStatus: safeString(warehouse.status) || "ACTIVE",
    operationalStatus,
  };
}

export function normalizeInventoryBalanceListSummary(raw: unknown): InventoryBalanceListSummary {
  if (!raw || typeof raw !== "object") return EMPTY_BALANCE_LIST_SUMMARY;
  const s = raw as Record<string, unknown>;
  return {
    filteredItemsCount: finiteNumber(s.filteredItemsCount),
    filteredRowsCount: finiteNumber(s.filteredRowsCount),
    totalInventoryValue: finiteNumber(s.totalInventoryValue),
    criticalCount: finiteNumber(s.criticalCount),
    belowMinimumCount: finiteNumber(s.belowMinimumCount),
    negativeCount: finiteNumber(s.negativeCount),
  };
}

export function normalizeInventoryBalanceListResponse(raw: unknown): InventoryBalanceListResponse {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows = rowsRaw
    .map(normalizeInventoryBalanceListRow)
    .filter((r): r is InventoryBalanceListRow => r != null);

  const page = finiteNumber(data.page, 1);
  const pageSize = finiteNumber(data.pageSize, 50) || 50;
  const total = finiteNumber(data.total, rows.length);
  const totalPages = finiteNumber(data.totalPages, Math.max(1, Math.ceil(total / pageSize)));

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages,
    summary: normalizeInventoryBalanceListSummary(data.summary),
  };
}
