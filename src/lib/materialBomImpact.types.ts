/**
 * Tipos / labels client-safe — produtos impactados na BOM oficial pela MP.
 */

export const MATERIAL_BOM_IMPACT_EMPTY_MESSAGE =
  "Nenhum produto vinculado a esta matéria-prima na BOM oficial.";

export type MaterialBomImpactItem = {
  componentId?: string | null;
  componentName?: string | null;
  productId: string;
  productSku: string;
  productName: string;
  quantityConsumed: number;
  unit: string;
  estimatedCurrentCost: number;
  potentialImpact?: number | null;
};

export type MaterialBomImpactResponse = {
  items: MaterialBomImpactItem[];
  totalProducts: number;
  hasLinks: boolean;
};
