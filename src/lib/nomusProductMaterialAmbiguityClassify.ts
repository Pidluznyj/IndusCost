/**
 * Classificação central Product × Material (Nomus / custo / BOM).
 * Puro — sem Prisma. Reutilizado por Carga Mestre, resolução e apply BOM.
 */

import { isRegistryActiveStatus } from "@/src/lib/nomusComponentRegistryResolve";

export type ProductMaterialAmbiguityStatus =
  | "RESOLVIDO_COMO_MATERIAL"
  | "RESOLVIDO_COMO_PRODUCT"
  | "AMBIGUO_BLOQUEADO"
  | "ALINHADO_MATERIAL"
  | "ALINHADO_PRODUCT"
  | "FALTANTE";

export type AmbiguitySuggestedDecision =
  | "PREFER_MATERIAL"
  | "PREFER_PRODUCT"
  | "MANTER_BLOQUEADO"
  | "NENHUMA";

export type ProductMaterialRegistrySnapshot = {
  code: string;
  product: {
    id: string;
    active: boolean;
    ownBomLineCount: number;
    routingCount: number;
    costingMode: string | null;
  } | null;
  material: {
    id: string;
    active: boolean;
    currentCost: number | null;
    standardCost: number | null;
  } | null;
  prefersMaterial: boolean;
  prefersProduct: boolean;
  nomusControlledBomAsProductCount: number;
  nomusControlledBomAsMaterialCount: number;
};

export type ProductMaterialAmbiguityClassification = {
  status: ProductMaterialAmbiguityStatus;
  suggestedDecision: AmbiguitySuggestedDecision;
  reason: string;
  risks: string[];
  /** Ações operacionais sugeridas (preview batch / apply). */
  plannedActions: Array<
    | "REATIVAR_MATERIAL"
    | "RELINK_PRODUCTBOM_PARA_MATERIAL"
    | "RELINK_PRODUCTBOM_PARA_PRODUCT"
    | "REGISTRAR_PREFER_MATERIAL"
    | "NENHUMA"
  >;
};

function toPositiveCost(m: ProductMaterialRegistrySnapshot["material"]): boolean {
  if (!m) return false;
  const c = m.currentCost ?? 0;
  const s = m.standardCost ?? 0;
  return c > 0 || s > 0;
}

function productHasFabricationStructure(
  p: NonNullable<ProductMaterialRegistrySnapshot["product"]>
): boolean {
  return p.ownBomLineCount > 0 || p.routingCount > 0;
}

export function classifyProductMaterialAmbiguity(
  input: ProductMaterialRegistrySnapshot
): ProductMaterialAmbiguityClassification {
  const { product, material } = input;
  const risks: string[] = [];
  const plannedActions: ProductMaterialAmbiguityClassification["plannedActions"] = [];

  if (!product && !material) {
    return {
      status: "FALTANTE",
      suggestedDecision: "NENHUMA",
      reason: "Código Nomus sem Product nem Material no IndusCost.",
      risks,
      plannedActions: ["NENHUMA"],
    };
  }

  if (product && !material) {
    return {
      status: "ALINHADO_PRODUCT",
      suggestedDecision: "NENHUMA",
      reason: "Existe apenas como Product — cadastro alinhado.",
      risks,
      plannedActions: ["NENHUMA"],
    };
  }

  if (material && !product) {
    return {
      status: "ALINHADO_MATERIAL",
      suggestedDecision: "NENHUMA",
      reason: "Existe apenas como Material — cadastro alinhado.",
      risks,
      plannedActions: ["NENHUMA"],
    };
  }

  const p = product!;
  const m = material!;
  const materialActive = m.active;
  const materialHasCost = toPositiveCost(m);
  const productActive = p.active;
  const productFab = productHasFabricationStructure(p);
  const bomAsProduct = input.nomusControlledBomAsProductCount;
  const bomAsMaterial = input.nomusControlledBomAsMaterialCount;
  const bothUsedInBom = bomAsProduct > 0 && bomAsMaterial > 0;
  const materialDominatesBom =
    bomAsMaterial > 0 && bomAsProduct === 0;
  const productDominatesBom =
    bomAsProduct > 0 && bomAsMaterial === 0;

  const materialResolutionSignals =
    materialActive &&
    materialHasCost &&
    !productFab &&
    bomAsProduct === 0 &&
    (input.prefersMaterial ||
      materialDominatesBom ||
      (bomAsMaterial > 0 && bomAsMaterial >= bomAsProduct));

  if (materialResolutionSignals) {
    if (!materialActive) plannedActions.push("REATIVAR_MATERIAL");
    if (bomAsProduct > 0) plannedActions.push("RELINK_PRODUCTBOM_PARA_MATERIAL");
    if (input.prefersMaterial) plannedActions.push("REGISTRAR_PREFER_MATERIAL");
    if (plannedActions.length === 0) plannedActions.push("NENHUMA");

    const parts = [
      "Existe como Product e Material, mas a evidência prefere Material:",
      materialActive ? "Material ativo" : "Material inativo (requer reativação)",
      materialHasCost ? "com custo" : "sem custo",
      productFab ? "Product com BOM/roteiro" : "Product sem BOM/roteiro",
      `ProductBOM Nomus: ${bomAsProduct}×Product, ${bomAsMaterial}×Material`,
    ];
    if (input.prefersMaterial) parts.push("allowlist PREFER_MATERIAL");

    return {
      status: "RESOLVIDO_COMO_MATERIAL",
      suggestedDecision: "PREFER_MATERIAL",
      reason: parts.join("; ") + ".",
      risks,
      plannedActions,
    };
  }

  const productResolutionSignals =
    productActive &&
    productFab &&
    (!materialActive || !materialHasCost) &&
    !bothUsedInBom &&
    (input.prefersProduct || productDominatesBom || bomAsProduct > bomAsMaterial);

  if (productResolutionSignals) {
    if (bomAsMaterial > 0) plannedActions.push("RELINK_PRODUCTBOM_PARA_PRODUCT");
    if (plannedActions.length === 0) plannedActions.push("NENHUMA");

    return {
      status: "RESOLVIDO_COMO_PRODUCT",
      suggestedDecision: "PREFER_PRODUCT",
      reason:
        "Existe como Product e Material, mas a evidência prefere Product: Product com BOM/roteiro e Material inativo, sem custo ou não usado em BOM Nomus.",
      risks,
      plannedActions,
    };
  }

  if (bothUsedInBom) {
    risks.push(
      "Product e Material usados em ProductBOM Nomus-controlled — risco de custo/estrutura divergente.",
    );
  }
  if (materialActive && materialHasCost && productActive && productFab) {
    risks.push("Product e Material parecem válidos para fabricação e compra.");
  }
  if (input.prefersMaterial && !materialActive) {
    risks.push("Preferência MATERIAL, mas Material inativo — executar resolução controlada.");
  }

  return {
    status: "AMBIGUO_BLOQUEADO",
    suggestedDecision: "MANTER_BLOQUEADO",
    reason:
      "Product e Material coexistem sem evidência suficiente para decisão automática — revisão humana ou resolução controlada.",
    risks,
    plannedActions: ["NENHUMA"],
  };
}

/** Mapeia status de ambiguidade para classificação da Carga Mestre. */
export function masterDataClassificationFromAmbiguityStatus(
  status: ProductMaterialAmbiguityStatus
): "RESOLVED_AS_MATERIAL" | "RESOLVED_AS_PRODUCT" | "EXISTING_BOTH_AMBIGUOUS" | null {
  switch (status) {
    case "RESOLVIDO_COMO_MATERIAL":
      return "RESOLVED_AS_MATERIAL";
    case "RESOLVIDO_COMO_PRODUCT":
      return "RESOLVED_AS_PRODUCT";
    case "AMBIGUO_BLOQUEADO":
      return "EXISTING_BOTH_AMBIGUOUS";
    default:
      return null;
  }
}
