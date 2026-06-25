/**
 * Parsers de query string para listagens do módulo Estoque.
 * Usa safeTrim — nunca chama .trim() em undefined.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import {
  INVENTORY_ITEM_TYPES,
  type InventoryItemType,
} from "./inventoryTypes.js";

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
  belowMinimum: boolean;
  belowReorderPoint: boolean;
  hasReservation: boolean;
  hasBlocked: boolean;
  hasQuarantine: boolean;
  negativeStock: boolean;
};

export type InventoryMovementsListQuery = {
  page: number;
  pageSize: number;
  skip: number;
  movementType: string | null;
  warehouseId: string | null;
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
    belowMinimum: parseBool(query.belowMinimum),
    belowReorderPoint: parseBool(query.belowReorderPoint),
    hasReservation: parseBool(query.hasReservation),
    hasBlocked: parseBool(query.hasBlocked),
    hasQuarantine: parseBool(query.hasQuarantine),
    negativeStock: parseBool(query.negativeStock),
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
    movementType: optTrim(query.movementType),
    warehouseId: optTrim(query.warehouseId),
    startDate: parseDate(query.startDate ?? query.start),
    endDate: parseDate(query.endDate ?? query.end),
  };
}
