import type { InventoryCountLineRow, InventoryCountSessionRow } from "@/src/types/inventory";

export type InventoryCountListResponse = {
  rows: InventoryCountSessionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type InventoryCountDetailResponse = {
  session: InventoryCountSessionRow;
  lines: InventoryCountLineRow[];
};

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSession(raw: Record<string, unknown>): InventoryCountSessionRow {
  return {
    id: String(raw.id ?? ""),
    code: String(raw.code ?? ""),
    warehouseId: String(raw.warehouseId ?? ""),
    warehouseCode: raw.warehouseCode != null ? String(raw.warehouseCode) : null,
    warehouseName: raw.warehouseName != null ? String(raw.warehouseName) : null,
    status: String(raw.status ?? "OPEN") as InventoryCountSessionRow["status"],
    responsibleUserId: raw.responsibleUserId != null ? String(raw.responsibleUserId) : null,
    approvedByUserId: raw.approvedByUserId != null ? String(raw.approvedByUserId) : null,
    startedAt: raw.startedAt != null ? String(raw.startedAt) : null,
    finishedAt: raw.finishedAt != null ? String(raw.finishedAt) : null,
    approvedAt: raw.approvedAt != null ? String(raw.approvedAt) : null,
    notes: raw.notes != null ? String(raw.notes) : null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    divergenceCount: asNumber(raw.divergenceCount),
    impactedQuantity: asNumber(raw.impactedQuantity),
  };
}

function normalizeLine(raw: Record<string, unknown>): InventoryCountLineRow {
  return {
    id: String(raw.id ?? ""),
    sessionId: String(raw.sessionId ?? ""),
    itemId: String(raw.itemId ?? ""),
    itemCode: raw.itemCode != null ? String(raw.itemCode) : null,
    itemDescription: raw.itemDescription != null ? String(raw.itemDescription) : null,
    itemUnit: raw.itemUnit != null ? String(raw.itemUnit) : null,
    warehouseId: String(raw.warehouseId ?? ""),
    locationId: raw.locationId != null ? String(raw.locationId) : null,
    systemQuantity: asNumber(raw.systemQuantity),
    countedQuantity: asNumberOrNull(raw.countedQuantity),
    differenceQuantity: asNumberOrNull(raw.differenceQuantity),
    differencePercent: asNumberOrNull(raw.differencePercent),
    justification: raw.justification != null ? String(raw.justification) : null,
    generatedMovementId:
      raw.generatedMovementId != null ? String(raw.generatedMovementId) : null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}

export function normalizeInventoryCountListResponse(raw: unknown): InventoryCountListResponse {
  const data = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data.rows)
    ? data.rows.map((r) => normalizeSession(r as Record<string, unknown>))
    : [];
  const total = asNumber(data.total);
  const page = Math.max(1, asNumber(data.page) || 1);
  const pageSize = Math.max(1, asNumber(data.pageSize) || 50);
  const totalPages = Math.max(1, asNumber(data.totalPages) || 1);
  return { rows, total, page, pageSize, totalPages };
}

export function normalizeInventoryCountDetailResponse(raw: unknown): InventoryCountDetailResponse {
  const data = (raw ?? {}) as Record<string, unknown>;
  const session = normalizeSession((data.session ?? {}) as Record<string, unknown>);
  const lines = Array.isArray(data.lines)
    ? data.lines.map((r) => normalizeLine(r as Record<string, unknown>))
    : [];
  return { session, lines };
}

export function countLineHasDivergence(line: InventoryCountLineRow): boolean {
  return line.differenceQuantity != null && line.differenceQuantity !== 0;
}
