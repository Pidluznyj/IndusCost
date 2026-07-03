/**
 * Escopo de itens na geração de DRAFT da tabela oficial de custo de produção.
 *
 * Reutiliza `Product.type` (PRODUCT / COMPONENT). Matéria-prima (`Material`) fica fora.
 */
import {
  productionCostTableEligibleItemTypesFilter,
  type ProductionCostTableEligibleItemType,
} from "./productEngineeringCostSnapshot.js";

export type ProductionCostDraftItemScope =
  | "PRODUCT"
  | "COMPONENT"
  | "PRODUCT_AND_COMPONENT"
  | "SOLD_COMPONENTS";

export const DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE: ProductionCostDraftItemScope =
  "PRODUCT_AND_COMPONENT";

export const PRODUCTION_COST_DRAFT_ITEM_SCOPE_OPTIONS: ReadonlyArray<{
  value: ProductionCostDraftItemScope;
  label: string;
  description: string;
}> = [
  {
    value: "PRODUCT_AND_COMPONENT",
    label: "Produtos e componentes",
    description: "Todos os itens de engenharia ativos (PRODUCT + COMPONENT).",
  },
  {
    value: "PRODUCT",
    label: "Somente produtos",
    description: "Apenas Product.type = PRODUCT.",
  },
  {
    value: "COMPONENT",
    label: "Somente componentes",
    description: "Apenas Product.type = COMPONENT.",
  },
  {
    value: "SOLD_COMPONENTS",
    label: "Componentes vendidos",
    description: "Componentes ativos que aparecem em pedidos de venda no período.",
  },
];

export function parseProductionCostDraftItemScope(
  value: unknown
): ProductionCostDraftItemScope {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  if (raw === "PRODUCT") return "PRODUCT";
  if (raw === "COMPONENT") return "COMPONENT";
  if (raw === "SOLD_COMPONENTS" || raw === "SOLD_COMPONENT") return "SOLD_COMPONENTS";
  if (
    raw === "PRODUCT_AND_COMPONENT" ||
    raw === "ALL" ||
    raw === "PRODUCTS_AND_COMPONENTS"
  ) {
    return "PRODUCT_AND_COMPONENT";
  }
  return DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE;
}

export function resolveProductionCostDraftItemType(
  productType: unknown
): ProductionCostTableEligibleItemType {
  return productType === "COMPONENT" ? "COMPONENT" : "PRODUCT";
}

export function matchesProductionCostDraftItemScope(
  productType: unknown,
  scope: ProductionCostDraftItemScope
): boolean {
  const itemType = resolveProductionCostDraftItemType(productType);
  if (scope === "PRODUCT_AND_COMPONENT") return true;
  if (scope === "PRODUCT") return itemType === "PRODUCT";
  if (scope === "COMPONENT" || scope === "SOLD_COMPONENTS") return itemType === "COMPONENT";
  return false;
}

export function prismaProductTypeFilterForProductionCostDraftScope(
  scope: ProductionCostDraftItemScope
): "PRODUCT" | "COMPONENT" | { in: ProductionCostTableEligibleItemType[] } {
  switch (scope) {
    case "PRODUCT":
      return "PRODUCT";
    case "COMPONENT":
    case "SOLD_COMPONENTS":
      return "COMPONENT";
    case "PRODUCT_AND_COMPONENT":
    default:
      return productionCostTableEligibleItemTypesFilter();
  }
}

export function productionCostDraftScopeLabel(scope: ProductionCostDraftItemScope): string {
  const option = PRODUCTION_COST_DRAFT_ITEM_SCOPE_OPTIONS.find((row) => row.value === scope);
  return option?.label ?? scope;
}

export function productionCostDraftIncludeAllLabel(scope: ProductionCostDraftItemScope): string {
  switch (scope) {
    case "PRODUCT":
      return "Todos os produtos ativos";
    case "COMPONENT":
      return "Todos os componentes ativos";
    case "SOLD_COMPONENTS":
      return "Todos os componentes vendidos no período";
    case "PRODUCT_AND_COMPONENT":
    default:
      return "Produtos e componentes ativos";
  }
}
