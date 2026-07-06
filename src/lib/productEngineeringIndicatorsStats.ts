import type { Product } from "@/src/types/product";

export function productEngineeringRollup(products: Product[]) {
  const byType = { PRODUCT: 0, COMPONENT: 0, MATERIAL: 0 };
  let bomLines = 0;
  let routingOps = 0;
  let manufacturedWithoutBom = 0;
  let manufacturedWithoutRouting = 0;

  for (const p of products) {
    if (p.type in byType) byType[p.type as keyof typeof byType]++;
    const b = p.ProductBOM?.length ?? 0;
    const ro = p.ProductRouting?.length ?? 0;
    bomLines += b;
    routingOps += ro;
    if (p.type === "PRODUCT" || p.type === "COMPONENT") {
      if (b === 0) manufacturedWithoutBom++;
      if (ro === 0) manufacturedWithoutRouting++;
    }
  }

  return {
    total: products.length,
    byType,
    bomLines,
    routingOps,
    manufacturedWithoutBom,
    manufacturedWithoutRouting,
  };
}
