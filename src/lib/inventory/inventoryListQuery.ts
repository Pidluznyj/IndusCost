/**
 * Parsers de query string para listagens do módulo Estoque.
 * Usa safeTrim — nunca chama .trim() em undefined.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import { INVENTORY_ITEM_TYPE_LABELS } from "./inventoryItemTypeLabels.js";
import {
  INVENTORY_ITEM_TYPES,
  type InventoryItemType,
} from "./inventoryTypes.js";

/** Colunas ordenáveis do grid de itens (Estoque › Itens). */
export const INVENTORY_ITEMS_SORT_FIELDS = [
  "code",
  "description",
  "itemType",
  "unit",
  "family",
  "status",
] as const;

export type InventoryItemsSortField = (typeof INVENTORY_ITEMS_SORT_FIELDS)[number];
export type InventorySortDirection = "asc" | "desc";

export type InventoryItemsListQuery = {
  page: number;
  pageSize: number;
  skip: number;
  search: string;
  itemType: InventoryItemType | null;
  status: "ACTIVE" | "INACTIVE" | null;
  family: string | null;
  group: string | null;
  belowMinimum: boolean;
  belowReorderPoint: boolean;
  activeOnly: boolean;
  sortBy: InventoryItemsSortField;
  sortDir: InventorySortDirection;
};

export type InventoryBalancesListQuery = {
  page: number;
  pageSize: number;
  skip: number;
  search: string;
  itemId: string | null;
  warehouseId: string | null;
  itemType: InventoryItemType | null;
  status: "ACTIVE" | "INACTIVE" | null;
  family: string | null;
  group: string | null;
  belowMinimum: boolean;
  belowReorderPoint: boolean;
  hasReservation: boolean;
  hasBlocked: boolean;
  hasQuarantine: boolean;
  negativeStock: boolean;
  locationId: string | null;
};

export type InventoryMovementsListQuery = {
  page: number;
  pageSize: number;
  skip: number;
  itemId: string | null;
  movementType: string | null;
  warehouseId: string | null;
  responsibleUserId: string | null;
  originType: string | null;
  documentNumber: string | null;
  costCenterId: string | null;
  startDate: Date | null;
  endDate: Date | null;
};

function parsePage(value: unknown, fallback = 1): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parsePageSize(value: unknown, fallback = 50, max = 200): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

function parseBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  return false;
}

function parseItemType(value: unknown): InventoryItemType | null {
  const raw = safeTrim(value);
  if (!raw) return null;
  return (INVENTORY_ITEM_TYPES as readonly string[]).includes(raw)
    ? (raw as InventoryItemType)
    : null;
}

function parseItemStatus(value: unknown): "ACTIVE" | "INACTIVE" | null {
  const raw = safeTrim(value);
  if (raw === "ACTIVE" || raw === "INACTIVE") return raw;
  return null;
}

function optTrim(value: unknown): string | null {
  const t = safeTrim(value);
  return t.length ? t : null;
}

function parseDate(value: unknown): Date | null {
  const raw = safeTrim(value);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseItemsSortField(value: unknown): InventoryItemsSortField {
  const raw = safeTrim(value);
  return (INVENTORY_ITEMS_SORT_FIELDS as readonly string[]).includes(raw)
    ? (raw as InventoryItemsSortField)
    : "code";
}

function parseSortDirection(value: unknown): InventorySortDirection {
  return safeTrim(value).toLowerCase() === "desc" ? "desc" : "asc";
}

type InventoryItemsOrderByEntry =
  | Partial<Record<Exclude<InventoryItemsSortField, "family">, InventorySortDirection>>
  | { family: { sort: InventorySortDirection; nulls: "last" } };

/**
 * orderBy do Prisma para a listagem de itens; código é o desempate estável.
 * "Tipo" é enum no banco (ordem de declaração): a ordem pelo rótulo exibido é
 * aplicada em memória por {@link sortInventoryItemsByTypeLabel}.
 */
export function buildInventoryItemsOrderBy(
  sortBy: InventoryItemsSortField,
  sortDir: InventorySortDirection
): InventoryItemsOrderByEntry[] {
  if (sortBy === "code" || sortBy === "itemType") {
    return [{ code: sortBy === "code" ? sortDir : "asc" }];
  }
  if (sortBy === "family") {
    return [{ family: { sort: sortDir, nulls: "last" } }, { code: "asc" }];
  }
  return [{ [sortBy]: sortDir }, { code: "asc" }];
}

/** Ordena pelo rótulo pt-BR do tipo; espera a entrada já ordenada por código (desempate). */
export function sortInventoryItemsByTypeLabel<T extends { itemType: string }>(
  rows: readonly T[],
  sortDir: InventorySortDirection
): T[] {
  const label = (row: T) =>
    INVENTORY_ITEM_TYPE_LABELS[row.itemType as InventoryItemType] ?? row.itemType;
  const factor = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => factor * label(a).localeCompare(label(b), "pt-BR"));
}

export function parseInventoryItemsListQuery(
  query: Record<string, unknown> = {}
): InventoryItemsListQuery {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    search: safeTrim(query.search),
    itemType: parseItemType(query.itemType),
    status: parseItemStatus(query.status),
    family: optTrim(query.family),
    group: optTrim(query.group),
    belowMinimum: parseBool(query.belowMinimum),
    belowReorderPoint: parseBool(query.belowReorderPoint),
    activeOnly: parseBool(query.activeOnly),
    sortBy: parseItemsSortField(query.sortBy),
    sortDir: parseSortDirection(query.sortDir),
  };
}

export function parseInventoryBalancesListQuery(
  query: Record<string, unknown> = {}
): InventoryBalancesListQuery {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    search: safeTrim(query.search),
    itemId: optTrim(query.itemId),
    warehouseId: optTrim(query.warehouseId),
    itemType: parseItemType(query.itemType),
    status: parseItemStatus(query.status),
    family: optTrim(query.family),
    group: optTrim(query.group),
    belowMinimum: parseBool(query.belowMinimum),
    belowReorderPoint: parseBool(query.belowReorderPoint),
    hasReservation: parseBool(query.hasReservation),
    hasBlocked: parseBool(query.hasBlocked),
    hasQuarantine: parseBool(query.hasQuarantine),
    negativeStock: parseBool(query.negativeStock),
    locationId: optTrim(query.locationId),
  };
}

export function parseInventoryMovementsListQuery(
  query: Record<string, unknown> = {}
): InventoryMovementsListQuery {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    itemId: optTrim(query.itemId),
    movementType: optTrim(query.movementType),
    warehouseId: optTrim(query.warehouseId),
    responsibleUserId: optTrim(query.responsibleUserId ?? query.userId),
    originType: optTrim(query.originType),
    documentNumber: optTrim(query.documentNumber),
    costCenterId: optTrim(query.costCenterId),
    startDate: parseDate(query.startDate ?? query.start),
    endDate: parseDate(query.endDate ?? query.end),
  };
}
