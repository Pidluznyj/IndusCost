/**
 * Resolução canônica de catálogo por código (Nomus → IndusCost).
 *
 * Precedência oficial: Material.code (mesmo após normalizeSku) > Product COMPONENT/PRODUCT.
 * Não apaga, consolida nem reclassifica históricos.
 */

import type { ItemType, PrismaClient } from "@prisma/client";
import { normalizeSku } from "@/src/lib/nomusBomComparison.js";
import { isRegistryActiveStatus } from "@/src/lib/nomusComponentRegistryResolve.js";

export type CatalogEntityImportDecision =
  | "RECOGNIZED_AS_MATERIAL"
  | "MATERIAL_INACTIVE_REQUIRES_REVIEW"
  | "USE_EXISTING_COMPONENT"
  | "USE_EXISTING_PRODUCT"
  | "NOT_FOUND"
  | "HISTORICAL_CLASSIFICATION_CONFLICT";

export type CatalogEntityResolution = {
  originalCode: string;
  normalizedCode: string;
  status: "material" | "material_inactive" | "component" | "product" | "not_found";
  materialId: string | null;
  materialIsActive: boolean;
  materialIds: string[];
  componentProductId: string | null;
  finishedProductId: string | null;
  conflictingProductIds: string[];
  hasHistoricalConflict: boolean;
  /** Decisão para importação de master (create Product?). */
  importDecision: CatalogEntityImportDecision;
  /** Pode criar Product (PRODUCT/COMPONENT) com este código? */
  mayCreateProduct: boolean;
  /** Vínculo BOM recomendado (XOR). */
  bomLink:
    | { kind: "material"; materialId: string; childProductId: null; warning: string | null }
    | { kind: "product"; materialId: null; childProductId: string; warning: string | null }
    | { kind: "blocked"; materialId: null; childProductId: null; reason: string }
    | { kind: "none"; materialId: null; childProductId: null; reason: string };
  message: string;
};

export type CatalogEntityLookupRecord = {
  id: string;
  code: string;
  status: string | null;
  type?: ItemType | null;
};

export type CatalogEntityLookupMaps = {
  materialsByNorm: Map<string, CatalogEntityLookupRecord[]>;
  productsByNorm: Map<string, CatalogEntityLookupRecord[]>;
};

export function emptyCatalogEntityLookupMaps(): CatalogEntityLookupMaps {
  return {
    materialsByNorm: new Map(),
    productsByNorm: new Map(),
  };
}

function pushMap(
  map: Map<string, CatalogEntityLookupRecord[]>,
  key: string,
  row: CatalogEntityLookupRecord
) {
  const list = map.get(key) ?? [];
  list.push(row);
  map.set(key, list);
}

export function buildCatalogEntityLookupMaps(input: {
  materials: Array<{ id: string; code: string; status: string | null }>;
  products: Array<{ id: string; sku: string; status: string | null; type: ItemType }>;
}): CatalogEntityLookupMaps {
  const maps = emptyCatalogEntityLookupMaps();
  for (const m of input.materials) {
    pushMap(maps.materialsByNorm, normalizeSku(m.code), {
      id: m.id,
      code: m.code,
      status: m.status,
    });
  }
  for (const p of input.products) {
    pushMap(maps.productsByNorm, normalizeSku(p.sku), {
      id: p.id,
      code: p.sku,
      status: p.status,
      type: p.type,
    });
  }
  return maps;
}

/** Carrega Material/Product para um conjunto de códigos (raw + normalizado). */
export async function loadCatalogEntityLookupMaps(
  db: PrismaClient,
  codes: string[]
): Promise<CatalogEntityLookupMaps> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) return emptyCatalogEntityLookupMaps();
  const normalized = unique.map((c) => normalizeSku(c));
  const lookup = [...new Set([...unique, ...normalized])];

  const [materials, products] = await Promise.all([
    db.material.findMany({
      where: { code: { in: lookup } },
      select: { id: true, code: true, status: true },
    }),
    db.product.findMany({
      where: { sku: { in: lookup } },
      select: { id: true, sku: true, status: true, type: true },
    }),
  ]);

  return buildCatalogEntityLookupMaps({ materials, products });
}

export function resolveCatalogEntityByCode(
  code: string,
  maps: CatalogEntityLookupMaps
): CatalogEntityResolution {
  const originalCode = code.trim();
  const normalizedCode = normalizeSku(originalCode);
  const materials = maps.materialsByNorm.get(normalizedCode) ?? [];
  const products = maps.productsByNorm.get(normalizedCode) ?? [];

  const activeMaterials = materials.filter((m) => isRegistryActiveStatus(m.status));
  const inactiveMaterials = materials.filter((m) => !isRegistryActiveStatus(m.status));
  const activeProducts = products.filter((p) => isRegistryActiveStatus(p.status));
  const components = activeProducts.filter((p) => p.type === "COMPONENT");
  const finished = activeProducts.filter((p) => p.type !== "COMPONENT");
  const allProductIds = products.map((p) => p.id);

  const activeMaterial = activeMaterials[0] ?? null;
  const inactiveMaterial = !activeMaterial ? inactiveMaterials[0] ?? null : null;
  const componentProductId = components[0]?.id ?? null;
  const finishedProductId = finished[0]?.id ?? null;

  if (activeMaterial) {
    const conflictingProductIds = allProductIds;
    const hasHistoricalConflict = conflictingProductIds.length > 0;
    const warning = hasHistoricalConflict
      ? `${originalCode} — matéria-prima utilizada por precedência. Foram encontrados registros Product históricos com o mesmo código. Nenhum registro histórico foi alterado.`
      : null;
    return {
      originalCode,
      normalizedCode,
      status: "material",
      materialId: activeMaterial.id,
      materialIsActive: true,
      materialIds: materials.map((m) => m.id),
      componentProductId,
      finishedProductId,
      conflictingProductIds,
      hasHistoricalConflict,
      importDecision: hasHistoricalConflict
        ? "HISTORICAL_CLASSIFICATION_CONFLICT"
        : "RECOGNIZED_AS_MATERIAL",
      mayCreateProduct: false,
      bomLink: {
        kind: "material",
        materialId: activeMaterial.id,
        childProductId: null,
        warning,
      },
      message: hasHistoricalConflict
        ? warning!
        : `${originalCode} — não importado como produto ou componente porque o código já existe no cadastro oficial de matérias-primas.`,
    };
  }

  if (inactiveMaterial || inactiveMaterials.length > 0) {
    const matId = inactiveMaterial?.id ?? inactiveMaterials[0]!.id;
    return {
      originalCode,
      normalizedCode,
      status: "material_inactive",
      materialId: matId,
      materialIsActive: false,
      materialIds: materials.map((m) => m.id),
      componentProductId,
      finishedProductId,
      conflictingProductIds: allProductIds,
      hasHistoricalConflict: allProductIds.length > 0,
      importDecision: "MATERIAL_INACTIVE_REQUIRES_REVIEW",
      mayCreateProduct: false,
      bomLink: {
        kind: "blocked",
        materialId: null,
        childProductId: null,
        reason: `${originalCode} — matéria-prima inativa (${matId}). Revisão manual necessária; Product não será criado.`,
      },
      message: `${originalCode} — Material inativo impede criação de Product/COMPONENT. BOM bloqueada para revisão.`,
    };
  }

  if (componentProductId) {
    return {
      originalCode,
      normalizedCode,
      status: "component",
      materialId: null,
      materialIsActive: false,
      materialIds: [],
      componentProductId,
      finishedProductId,
      conflictingProductIds: [],
      hasHistoricalConflict: false,
      importDecision: "USE_EXISTING_COMPONENT",
      mayCreateProduct: false,
      bomLink: {
        kind: "product",
        materialId: null,
        childProductId: componentProductId,
        warning: null,
      },
      message: `${originalCode} — Component existente reutilizado.`,
    };
  }

  if (finishedProductId) {
    return {
      originalCode,
      normalizedCode,
      status: "product",
      materialId: null,
      materialIsActive: false,
      materialIds: [],
      componentProductId: null,
      finishedProductId,
      conflictingProductIds: [],
      hasHistoricalConflict: false,
      importDecision: "USE_EXISTING_PRODUCT",
      mayCreateProduct: false,
      bomLink: {
        kind: "product",
        materialId: null,
        childProductId: finishedProductId,
        warning: null,
      },
      message: `${originalCode} — Product existente reutilizado.`,
    };
  }

  // Product inativo sem Material: não cria automaticamente um segundo Product no mesmo sku
  // (unique), mas mayCreateProduct=false se já existe qualquer Product.
  if (products.length > 0) {
    const anyId = products[0]!.id;
    return {
      originalCode,
      normalizedCode,
      status: products[0]!.type === "COMPONENT" ? "component" : "product",
      materialId: null,
      materialIsActive: false,
      materialIds: [],
      componentProductId: products[0]!.type === "COMPONENT" ? anyId : null,
      finishedProductId: products[0]!.type !== "COMPONENT" ? anyId : null,
      conflictingProductIds: [],
      hasHistoricalConflict: false,
      importDecision:
        products[0]!.type === "COMPONENT" ? "USE_EXISTING_COMPONENT" : "USE_EXISTING_PRODUCT",
      mayCreateProduct: false,
      bomLink: {
        kind: "blocked",
        materialId: null,
        childProductId: null,
        reason: `${originalCode} — Product inativo existente; revisão manual.`,
      },
      message: `${originalCode} — Product existente (inativo) impede novo create.`,
    };
  }

  return {
    originalCode,
    normalizedCode,
    status: "not_found",
    materialId: null,
    materialIsActive: false,
    materialIds: [],
    componentProductId: null,
    finishedProductId: null,
    conflictingProductIds: [],
    hasHistoricalConflict: false,
    importDecision: "NOT_FOUND",
    mayCreateProduct: true,
    bomLink: {
      kind: "none",
      materialId: null,
      childProductId: null,
      reason: "Sem Material nem Product para o código.",
    },
    message: `${originalCode} — nenhuma entidade de catálogo encontrada.`,
  };
}

export async function resolveCatalogEntityByCodeAsync(
  db: PrismaClient,
  code: string
): Promise<CatalogEntityResolution> {
  const maps = await loadCatalogEntityLookupMaps(db, [code]);
  return resolveCatalogEntityByCode(code, maps);
}

/** Material (ativo ou inativo) impede create/update de Product no mesmo código. */
export function materialBlocksProductMutation(resolution: CatalogEntityResolution): boolean {
  return resolution.status === "material" || resolution.status === "material_inactive";
}
