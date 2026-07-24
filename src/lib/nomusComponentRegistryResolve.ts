import { normalizeSku } from "@/src/lib/nomusBomComparison";

/**
 * Allowlist histórica (compatibilidade / UI de ambiguidade).
 * A fonte oficial de precedência Material é `resolveCatalogEntityByCode` /
 * `pickNomusApplyRegistryLink` (match exato via normalizeSku) — códigos fora
 * desta lista também usam Material quando houver correspondência.
 */
export const NOMUS_PREFER_MATERIAL_COMPONENT_CODES = new Set([normalizeSku("420.01A-")]);

export function isRegistryActiveStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? "ACTIVE").trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "";
}

export function prefersMaterialForNomusComponent(componentCode: string): boolean {
  return NOMUS_PREFER_MATERIAL_COMPONENT_CODES.has(normalizeSku(componentCode));
}

/** Registra preferência explícita Material (ex.: após apply de ambiguidade). */
export function registerPreferMaterialComponentCode(componentCode: string): void {
  const key = normalizeSku(componentCode.trim());
  if (key) NOMUS_PREFER_MATERIAL_COMPONENT_CODES.add(key);
}

export type NomusApplyRegistryLinkInput = {
  componentCode: string;
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE";
  productId: string | null;
  materialId: string | null;
  inactiveMaterialIds?: string[];
  inactiveProductIds?: string[];
};

export type NomusApplyRegistryLinkResult =
  | {
      ok: true;
      materialId: string | null;
      childProductId: string | null;
      resolvedKind: "PRODUCT" | "MATERIAL";
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Escolha de vínculo ProductBOM no apply Nomus.
 *
 * Política global (2026): Material ativo com match exato (normalizeSku) tem precedência
 * sobre Product — inclusive em BOTH. Allowlist PREFER_MATERIAL permanece como
 * compatibilidade histórica, mas não é mais pré-requisito para usar Material.
 *
 * Material inativo (mesmo com Product ativo) bloqueia a linha para revisão.
 */
export function pickNomusApplyRegistryLink(
  input: NomusApplyRegistryLinkInput
): NomusApplyRegistryLinkResult {
  const inactiveMaterial = (input.inactiveMaterialIds ?? []).length > 0;
  const inactiveProduct = (input.inactiveProductIds ?? []).length > 0;

  // Precedência: Material inativo impede create/link automático (revisão manual).
  if (inactiveMaterial && !input.materialId) {
    return {
      ok: false,
      reason:
        "Matéria-prima inativa com o mesmo código — revisão manual necessária (MATERIAL_INACTIVE_REQUIRES_REVIEW).",
    };
  }

  if (input.resolvedKind === "NONE") {
    return { ok: false, reason: "Componente sem Material nem Product cadastrado." };
  }

  if (input.materialId && (input.resolvedKind === "MATERIAL" || input.resolvedKind === "BOTH")) {
    return {
      ok: true,
      materialId: input.materialId,
      childProductId: null,
      resolvedKind: "MATERIAL",
    };
  }

  if (input.resolvedKind === "MATERIAL" && input.materialId) {
    return {
      ok: true,
      materialId: input.materialId,
      childProductId: null,
      resolvedKind: "MATERIAL",
    };
  }

  if (input.resolvedKind === "PRODUCT" && input.productId) {
    return {
      ok: true,
      materialId: null,
      childProductId: input.productId,
      resolvedKind: "PRODUCT",
    };
  }

  if (inactiveProduct && input.materialId) {
    return {
      ok: true,
      materialId: input.materialId,
      childProductId: null,
      resolvedKind: "MATERIAL",
    };
  }

  return { ok: false, reason: "Resolução Product/Material não aplicável." };
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
