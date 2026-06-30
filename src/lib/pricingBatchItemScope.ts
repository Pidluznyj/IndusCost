/**
 * Escopo de itens no Processamento em Lote da Formação de Preço.
 *
 * Classificação oficial: campo `Product.type` no Prisma (`ItemType`).
 * - PRODUCT  → produto acabado/final
 * - COMPONENT → componente/semiacabado usado em BOM
 * Matéria-prima é modelo `Material`, fora deste escopo.
 */

export type PricingBatchItemScope = "products" | "components" | "all";

export type PricingBatchItemType = "PRODUCT" | "COMPONENT";

export const PRICING_BATCH_ITEM_SCOPE_OPTIONS: ReadonlyArray<{
  value: PricingBatchItemScope;
  label: string;
  description: string;
}> = [
  {
    value: "products",
    label: "Produtos",
    description: "Somente produtos acabados (Product.type = PRODUCT).",
  },
  {
    value: "components",
    label: "Componentes",
    description: "Somente componentes de engenharia (Product.type = COMPONENT).",
  },
  {
    value: "all",
    label: "Produtos e componentes",
    description: "Ambos os tipos elegíveis para formação de preço.",
  },
];

export const DEFAULT_PRICING_BATCH_ITEM_SCOPE: PricingBatchItemScope = "products";

export function parsePricingBatchItemScope(value: unknown): PricingBatchItemScope {
  const raw = String(value ?? "").trim();
  if (raw === "components" || raw === "all") return raw;
  return DEFAULT_PRICING_BATCH_ITEM_SCOPE;
}

export function resolvePricingBatchItemType(productType: unknown): PricingBatchItemType {
  return productType === "COMPONENT" ? "COMPONENT" : "PRODUCT";
}

export function pricingBatchItemTypeLabel(type: PricingBatchItemType): string {
  return type === "COMPONENT" ? "Componente" : "Produto";
}

export function matchesPricingBatchItemScope(
  productType: unknown,
  scope: PricingBatchItemScope
): boolean {
  const itemType = resolvePricingBatchItemType(productType);
  if (scope === "all") return true;
  if (scope === "components") return itemType === "COMPONENT";
  return itemType === "PRODUCT";
}

export function filterProductsForPricingBatchScope<T extends { type?: unknown }>(
  products: T[],
  scope: PricingBatchItemScope
): T[] {
  return products.filter((product) => matchesPricingBatchItemScope(product.type, scope));
}

export function pruneSelectedIdsForPricingBatchScope(
  selectedIds: string[],
  products: Array<{ id: string; type?: unknown }>,
  scope: PricingBatchItemScope
): string[] {
  const allowed = new Set(
    filterProductsForPricingBatchScope(products, scope).map((product) => product.id)
  );
  return selectedIds.filter((id) => allowed.has(id));
}
