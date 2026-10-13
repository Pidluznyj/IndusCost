/**
 * Rótulos pt-BR dos tipos de item — puro (sem Prisma), compartilhado entre UI e API
 * (a ordenação da listagem por "Tipo" segue o rótulo exibido, não a ordem do enum).
 */
import type { InventoryItemType } from "./inventoryTypes.js";

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
