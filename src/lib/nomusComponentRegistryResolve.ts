import { normalizeSku } from "@/src/lib/nomusBomComparison";

/** SKUs com resolução automática Product+Material → Material (regra de engenharia validada). */
export const NOMUS_PREFER_MATERIAL_COMPONENT_CODES = new Set([normalizeSku("420.01A-")]);

export function isRegistryActiveStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? "ACTIVE").trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "";
}

export function prefersMaterialForNomusComponent(componentCode: string): boolean {
  return NOMUS_PREFER_MATERIAL_COMPONENT_CODES.has(normalizeSku(componentCode));
}

export type RegistryPickInput<T extends { id: string }> = {
  records: T[];
  isActive: (record: T) => boolean;
};

/** Preferência explícita: nunca escolher registro inativo para resolução automática Nomus. */
export function pickRegistryRecordForAutoResolve<T extends { id: string }>(
  input: RegistryPickInput<T>
): T | null {
  const active = input.records.filter((r) => input.isActive(r));
  if (active.length === 1) return active[0]!;
  if (active.length > 1) return active[0]!;
  return null;
}

export type ResolvedRegistryPair = {
  productId: string | null;
  materialId: string | null;
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE";
  inactiveProductIds: string[];
  inactiveMaterialIds: string[];
};

export function resolveRegistryPairForComponentCode(input: {
  componentCode: string;
  product: { id: string } | null;
  material: { id: string } | null;
  inactiveProductIds?: string[];
  inactiveMaterialIds?: string[];
}): ResolvedRegistryPair {
  const inactiveProductIds = input.inactiveProductIds ?? [];
  const inactiveMaterialIds = input.inactiveMaterialIds ?? [];
  const { product, material } = input;

  if (product && material) {
    return {
      productId: product.id,
      materialId: material.id,
      resolvedKind: "BOTH",
      inactiveProductIds,
      inactiveMaterialIds,
    };
  }
  if (product) {
    return {
      productId: product.id,
      materialId: null,
      resolvedKind: "PRODUCT",
      inactiveProductIds,
      inactiveMaterialIds,
    };
  }
  if (material) {
    return {
      productId: null,
      materialId: material.id,
      resolvedKind: "MATERIAL",
      inactiveProductIds,
      inactiveMaterialIds,
    };
  }
  return {
    productId: null,
    materialId: null,
    resolvedKind: "NONE",
    inactiveProductIds,
    inactiveMaterialIds,
  };
}
