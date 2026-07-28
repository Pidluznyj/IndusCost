/**
 * Tipos do espelho assíncrono IndusCost → planilha (Power Automate).
 */

export const MATERIAL_STOCK_SPREADSHEET_MIRROR_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SYNCED",
  "ERROR",
] as const;

export type MaterialStockSpreadsheetMirrorStatus =
  (typeof MATERIAL_STOCK_SPREADSHEET_MIRROR_STATUSES)[number];

export const MATERIAL_STOCK_SPREADSHEET_MIRROR_ACTIVE_STATUSES = [
  "PENDING",
  "PROCESSING",
] as const satisfies readonly MaterialStockSpreadsheetMirrorStatus[];

export const MATERIAL_STOCK_SPREADSHEET_MIRROR_EVENT_TYPES = [
  "CONFERENCE",
  "LEVELS_UPDATE",
  "MATERIAL_MASTER",
] as const;

export type MaterialStockSpreadsheetMirrorEventType =
  (typeof MATERIAL_STOCK_SPREADSHEET_MIRROR_EVENT_TYPES)[number];

/** Snapshot espelhado — sem custos. */
export type MaterialStockSpreadsheetMirrorPayload = {
  operation: "UPSERT";
  eventId: string;
  idempotencyKey: string;
  eventType: MaterialStockSpreadsheetMirrorEventType;
  occurredAt: string;
  /** Chave estável oficial. */
  materialId: string;
  /** Código único comprovado (@unique). */
  code: string;
  description: string;
  unit: string;
  currentQuantity: number;
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  lastStockConferenceAt: string | null;
  stockConferenceVersion: number;
  materialStatus: string | null;
};

export const MATERIAL_STOCK_SPREADSHEET_FORBIDDEN_PAYLOAD_KEYS = [
  "currentCost",
  "averageCost",
  "standardCost",
  "freight",
  "landedCost",
  "standardLoss",
] as const;
