/**
 * Parser puro da query string — GET /api/materials/stock-tablet/search.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import type { MaterialStockStatus } from "./materialStockLevelRules.js";
import {
  MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE,
  MATERIAL_STOCK_TABLET_DEFAULT_STALE_DAYS,
  MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE,
  type MaterialStockTabletMaterialStatusFilter,
} from "./materialStockTabletTypes.js";

const STOCK_STATUSES = new Set<MaterialStockStatus>([
  "NAO_CONFIGURADO",
  "SEM_ESTOQUE",
  "EMERGENCIA",
  "CRITICO",
  "ATENCAO",
  "SAUDAVEL",
]);

export type MaterialStockTabletSearchQuery = {
  page: number;
  pageSize: number;
  skip: number;
  /** Texto livre — código ou descrição (parcial). */
  q: string;
  /** Status do cadastro Material. Default ACTIVE. */
  materialStatus: MaterialStockTabletMaterialStatusFilter;
  /** Status de nível calculado (opcional). */
  stockStatus: MaterialStockStatus | null;
  /** true = ao menos um de contingência/mínimo/recomendado é null. */
  missingLevels: boolean;
  /** true = nunca conferido ou última conferência antes do cutoff. */
  staleConference: boolean;
  staleDays: number;
};

function parsePage(value: unknown, fallback = 1): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parsePageSize(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE;
  return Math.min(MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE, n);
}

function parseBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  return false;
}

function parseMaterialStatus(value: unknown): MaterialStockTabletMaterialStatusFilter {
  const raw = safeTrim(value).toUpperCase();
  if (raw === "INACTIVE" || raw === "ALL") return raw;
  return "ACTIVE";
}

function parseStockStatus(value: unknown): MaterialStockStatus | null {
  const raw = safeTrim(value).toUpperCase();
  if (!raw) return null;
  if (STOCK_STATUSES.has(raw as MaterialStockStatus)) return raw as MaterialStockStatus;
  return null;
}

function parseStaleDays(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return MATERIAL_STOCK_TABLET_DEFAULT_STALE_DAYS;
  return Math.min(365, n);
}

export function parseMaterialStockTabletSearchQuery(
  query: Record<string, unknown>
): MaterialStockTabletSearchQuery {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize ?? query.limit);
  const q = safeTrim(query.q ?? query.search);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    q,
    materialStatus: parseMaterialStatus(query.materialStatus ?? query.status),
    stockStatus: parseStockStatus(query.stockStatus),
    missingLevels: parseBool(query.missingLevels ?? query.withoutLevels),
    staleConference: parseBool(
      query.staleConference ?? query.noRecentConference ?? query.withoutRecentConference
    ),
    staleDays: parseStaleDays(query.staleDays),
  };
}
