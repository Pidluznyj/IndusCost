/**
 * Labels de tipos e status de item — frontend puro.
 */
import type { InventoryItemStatus, InventoryItemType } from "@/src/types/inventory";

export const INVENTORY_ITEM_TYPE_LABELS: Record<InventoryItemType, string> = {
  FINISHED_PRODUCT: "Produto acabado",
  SEMI_FINISHED: "Produto semiacabado",
  COMPONENT: "Componente",
  RAW_MATERIAL: "Matéria-prima",
  PACKAGING: "Embalagem",
  PRODUCTION_SUPPLY: "Suprimento de produção",
  ADMINISTRATIVE_SUPPLY: "Suprimento administrativo",
  MAINTENANCE: "Manutenção",
  PPE: "EPI",
  TOOLING: "Ferramental",
  OTHER: "Outros",
};

export const INVENTORY_ITEM_TYPE_OPTIONS = (
  Object.entries(INVENTORY_ITEM_TYPE_LABELS) as [InventoryItemType, string][]
).map(([value, label]) => ({ value, label }));

export const INVENTORY_ITEM_STATUS_LABELS: Record<InventoryItemStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};

export function formatInventoryItemType(type: string): string {
  return INVENTORY_ITEM_TYPE_LABELS[type as InventoryItemType] ?? type;
}

export function formatInventoryItemStatus(status: string): string {
  return INVENTORY_ITEM_STATUS_LABELS[status as InventoryItemStatus] ?? status;
}

/** Unidades comuns sugeridas no cadastro. */
export const INVENTORY_UNIT_SUGGESTIONS = ["UN", "KG", "G", "L", "ML", "M", "M2", "M3", "CX", "PC"] as const;
