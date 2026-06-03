/**
 * Carrega evidências de cadastro Product/Material para classificação de ambiguidade.
 * Server-side (Prisma).
 */

import { prisma } from "@/src/lib/prisma";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  isRegistryActiveStatus,
  prefersMaterialForNomusComponent,
} from "@/src/lib/nomusComponentRegistryResolve";
import type { ProductMaterialRegistrySnapshot } from "@/src/lib/nomusProductMaterialAmbiguityClassify";

function toNumber(d: unknown): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isFinite(n) ? n : null;
}

export async function loadProductMaterialRegistrySnapshots(
  codes: string[]
): Promise<Map<string, ProductMaterialRegistrySnapshot>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const result = new Map<string, ProductMaterialRegistrySnapshot>();
  if (unique.length === 0) return result;

  const lookupValues = [...new Set(unique.map((c) => normalizeSku(c)))];
  const [products, materials] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: lookupValues } },
      select: {
        id: true,
        sku: true,
        status: true,
        costingMode: true,
        _count: { select: { ProductBOM: true, ProductRouting: true } },
      },
    }),
    prisma.material.findMany({
      where: { code: { in: lookupValues } },
      select: {
        id: true,
        code: true,
        status: true,
        currentCost: true,
        standardCost: true,
      },
    }),
  ]);

  const productByKey = new Map(products.map((p) => [normalizeSku(p.sku), p]));
  const materialByKey = new Map(materials.map((m) => [normalizeSku(m.code), m]));
  const productIds = products.map((p) => p.id);
  const materialIds = materials.map((m) => m.id);

  const [asProductCounts, asMaterialCounts] = await Promise.all([
    productIds.length > 0
      ? prisma.productBOM.groupBy({
          by: ["childProductId"],
          where: {
            isNomusControlled: true,
            childProductId: { in: productIds },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    materialIds.length > 0
      ? prisma.productBOM.groupBy({
          by: ["materialId"],
          where: {
            isNomusControlled: true,
            materialId: { in: materialIds },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const bomProductCount = new Map(
    asProductCounts.map((r) => [r.childProductId!, r._count._all])
  );
  const bomMaterialCount = new Map(
    asMaterialCounts.map((r) => [r.materialId!, r._count._all])
  );

  for (const code of unique) {
    const key = normalizeSku(code);
    const p = productByKey.get(key);
    const m = materialByKey.get(key);
    result.set(key, {
      code,
      product: p
        ? {
            id: p.id,
            active: isRegistryActiveStatus(p.status),
            ownBomLineCount: p._count.ProductBOM,
            routingCount: p._count.ProductRouting,
            costingMode: p.costingMode != null ? String(p.costingMode) : null,
          }
        : null,
      material: m
        ? {
            id: m.id,
            active: isRegistryActiveStatus(m.status),
            currentCost: toNumber(m.currentCost),
            standardCost: toNumber(m.standardCost),
          }
        : null,
      prefersMaterial: prefersMaterialForNomusComponent(code),
      prefersProduct: false,
      nomusControlledBomAsProductCount: p ? (bomProductCount.get(p.id) ?? 0) : 0,
      nomusControlledBomAsMaterialCount: m ? (bomMaterialCount.get(m.id) ?? 0) : 0,
    });
  }

  return result;
}

export async function loadProductMaterialRegistrySnapshot(
  code: string
): Promise<ProductMaterialRegistrySnapshot> {
  const map = await loadProductMaterialRegistrySnapshots([code]);
  return (
    map.get(normalizeSku(code)) ?? {
      code,
      product: null,
      material: null,
      prefersMaterial: prefersMaterialForNomusComponent(code),
      prefersProduct: false,
      nomusControlledBomAsProductCount: 0,
      nomusControlledBomAsMaterialCount: 0,
    }
  );
}
