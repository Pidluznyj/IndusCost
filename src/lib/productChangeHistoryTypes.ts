/**
 * Tipos puros do histórico de alterações de produto/material.
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 * Seguro para frontend e backend.
 *
 * A fonte real é a tabela EngineeringChangeLog já existente no schema —
 * aqui apenas declaramos a forma sob a qual ela é exposta para a UI.
 */

export type ProductChangeEntityType =
  | "PRODUCT"
  | "PRODUCT_BOM"
  | "MATERIAL"
  | "ROUTING"
  | "PRICE_INPUT";

export type ProductChangeOrigin =
  | "NOMUS_SYNC"
  | "NOMUS_ENGINEERING_APPLY"
  | "MANUAL_EDIT"
  | "LOCAL_EXCEPTION";

/**
 * Ação humana derivada de (entityType, changeOrigin, fieldName, oldValue, newValue).
 * A coluna física do banco continua sendo changeOrigin + fieldName.
 */
export type ProductChangeActionLabel =
  | "CREATED"
  | "UPDATED"
  | "DEACTIVATED"
  | "REACTIVATED"
  | "SKIPPED"
  | "BLOCKED"
  | "IMPORTED"
  | "EQUALIZED";

export type ProductChangeHistoryEntry = {
  id: string;
  entityType: ProductChangeEntityType;
  entityId: string | null;
  productId: string | null;
  productSku: string | null;
  sourceSystem: string | null;
  changeOrigin: ProductChangeOrigin;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  oldValueJson: unknown | null;
  newValueJson: unknown | null;
  changedBy: string | null;
  changedAt: string;
  runId: string | null;
  planHash: string | null;
  reason: string | null;
  /** Resumo humano amigável (gerado pela lib server quando o registro foi criado). */
  summary: string | null;
  /** Rótulo humano da ação (derivado para a UI). */
  actionLabel: ProductChangeActionLabel;
};

export type ProductChangeHistoryResult = {
  productId: string;
  productSku: string | null;
  productName: string | null;
  entries: ProductChangeHistoryEntry[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
};
