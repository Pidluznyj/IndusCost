/**
 * Contratos client-safe da API tablet de Conferência de Estoque.
 * Sem campos de custo / BOM / fornecedor.
 */

import type { MaterialStockStatus } from "./materialStockLevelRules.js";

export const MATERIAL_STOCK_TABLET_SEARCH_PATH =
  "/api/materials/stock-tablet/search" as const;

export const MATERIAL_STOCK_TABLET_CONFERENCE_PATH =
  "/api/materials/stock-tablet/conference" as const;

export const MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE = 30;
export const MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE = 50;
/** Janela padrão (dias) para “sem conferência recente”. */
export const MATERIAL_STOCK_TABLET_DEFAULT_STALE_DAYS = 7;

export type MaterialStockTabletMaterialStatusFilter =
  | "ACTIVE"
  | "INACTIVE"
  | "ALL";

export type MaterialStockTabletResponsible = {
  id: string;
  name: string;
};

export type MaterialStockTabletListItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
  /** Estoque atual oficial (`Material.quantity`). */
  currentQuantity: number;
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  stockStatus: MaterialStockStatus;
  lastStockConferenceAt: string | null;
  lastStockConferenceUser: MaterialStockTabletResponsible | null;
  stockConferenceVersion: number;
  updatedAt: string | null;
};

export type MaterialStockTabletSearchResponse = {
  rows: MaterialStockTabletListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
