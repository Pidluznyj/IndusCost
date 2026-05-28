import type { ItemType } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";

export type BomUsageSearchKind = "PRODUCT" | "MATERIAL";

export type BomUsageItemKind = "MATERIAL" | "PRODUCT" | "COMPONENT";

export type BomUsageMaterialItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type BomUsageProductItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ItemType;
};

export type BomUsageItem = BomUsageMaterialItem | BomUsageProductItem;

export type BomUsageLine = {
  bomLineId: string;
  parentProductId: string;
  parentSku: string;
  parentName: string;
  parentDescription: string | null;
  parentType: ItemType;
  parentStatus: string | null;
  quantity: number;
  lossPercentage: number | null;
  notes: string | null;
  sourceSystem: string | null;
  isNomusControlled: boolean;
  localException: boolean;
  nomusComponentCode: string | null;
  lastNomusSyncAt: string | null;
};

export type BomUsageResult = {
  searchedCode: string;
  itemKind: BomUsageItemKind;
  item: BomUsageItem;
  directUsageCount: number;
  usages: BomUsageLine[];
};

export type BomUsageAmbiguityCandidate = {
  kind: BomUsageSearchKind;
  id: string;
  code: string;
  label: string;
};

export type ResolveProductBomUsageInput = {
  code: string;
  kind?: BomUsageSearchKind | null;
};

export type ResolveProductBomUsageOutcome =
  | { status: "ok"; data: BomUsageResult }
  | { status: "not_found"; searchedCode: string; message: string }
  | {
      status: "ambiguous";
      searchedCode: string;
      message: string;
      candidates: BomUsageAmbiguityCandidate[];
    };

export function normalizeBomUsageSearchCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").toUpperCase();
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapUsageRows(
  rows: Array<{
    id: string;
    quantity: unknown;
    lossPercentage: unknown;
    notes: string | null;
    sourceSystem: string | null;
    isNomusControlled: boolean;
    localException: boolean;
    nomusComponentCode: string | null;
    lastNomusSyncAt: Date | null;
    ParentProduct: {
      id: string;
      sku: string;
      name: string;
      description: string | null;
      type: ItemType;
      status: string | null;
    };
  }>
): BomUsageLine[] {
  return rows
    .map((row) => ({
      bomLineId: row.id,
      parentProductId: row.ParentProduct.id,
      parentSku: row.ParentProduct.sku,
      parentName: row.ParentProduct.name,
      parentDescription: row.ParentProduct.description,
      parentType: row.ParentProduct.type,
      parentStatus: row.ParentProduct.status,
      quantity: decimalToNumber(row.quantity) ?? 0,
      lossPercentage: decimalToNumber(row.lossPercentage),
      notes: row.notes,
      sourceSystem: row.sourceSystem,
      isNomusControlled: row.isNomusControlled,
      localException: row.localException,
      nomusComponentCode: row.nomusComponentCode,
      lastNomusSyncAt: row.lastNomusSyncAt?.toISOString() ?? null,
    }))
    .sort((a, b) => a.parentSku.localeCompare(b.parentSku, "pt-BR"));
}

const parentProductSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  type: true,
  status: true,
} as const;

const bomLineSelect = {
  id: true,
  quantity: true,
  lossPercentage: true,
  notes: true,
  sourceSystem: true,
  isNomusControlled: true,
  localException: true,
  nomusComponentCode: true,
  lastNomusSyncAt: true,
  ParentProduct: { select: parentProductSelect },
} as const;

async function findProductBySku(normalizedCode: string) {
  return prisma.product.findFirst({
    where: {
      sku: { equals: normalizedCode, mode: "insensitive" },
      type: { in: ["PRODUCT", "COMPONENT"] },
    },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      type: true,
    },
  });
}

async function findMaterialByCode(normalizedCode: string) {
  return prisma.material.findFirst({
    where: { code: { equals: normalizedCode, mode: "insensitive" } },
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
    },
  });
}

async function buildResultForProduct(
  searchedCode: string,
  product: NonNullable<Awaited<ReturnType<typeof findProductBySku>>>
): Promise<BomUsageResult> {
  const rows = await prisma.productBOM.findMany({
    where: { childProductId: product.id },
    select: bomLineSelect,
  });
  const itemKind: BomUsageItemKind = product.type === "COMPONENT" ? "COMPONENT" : "PRODUCT";
  return {
    searchedCode,
    itemKind,
    item: {
      id: product.id,
      code: product.sku,
      name: product.name,
      description: product.description,
      type: product.type,
    },
    directUsageCount: rows.length,
    usages: mapUsageRows(rows),
  };
}

async function buildResultForMaterial(
  searchedCode: string,
  material: NonNullable<Awaited<ReturnType<typeof findMaterialByCode>>>
): Promise<BomUsageResult> {
  const rows = await prisma.productBOM.findMany({
    where: { materialId: material.id },
    select: bomLineSelect,
  });
  return {
    searchedCode,
    itemKind: "MATERIAL",
    item: {
      id: material.id,
      code: material.code,
      description: material.description,
      unit: material.unit,
    },
    directUsageCount: rows.length,
    usages: mapUsageRows(rows),
  };
}

export async function resolveProductBomUsage(
  input: ResolveProductBomUsageInput
): Promise<ResolveProductBomUsageOutcome> {
  const rawCode = input.code?.trim() ?? "";
  if (!rawCode) {
    return {
      status: "not_found",
      searchedCode: "",
      message: "Informe um código de produto, componente ou matéria-prima.",
    };
  }

  const searchedCode = normalizeBomUsageSearchCode(rawCode);
  const kind = input.kind ?? null;

  const [product, material] = await Promise.all([
    kind === "MATERIAL" ? Promise.resolve(null) : findProductBySku(searchedCode),
    kind === "PRODUCT" ? Promise.resolve(null) : findMaterialByCode(searchedCode),
  ]);

  if (product && material && !kind) {
    return {
      status: "ambiguous",
      searchedCode,
      message:
        "O código informado existe como produto/componente e como matéria-prima. Informe kind=PRODUCT ou kind=MATERIAL para desambiguar.",
      candidates: [
        {
          kind: "PRODUCT",
          id: product.id,
          code: product.sku,
          label: `${product.type === "COMPONENT" ? "Componente" : "Produto"} — ${product.sku} (${product.name})`,
        },
        {
          kind: "MATERIAL",
          id: material.id,
          code: material.code,
          label: `Matéria-prima — ${material.code} (${material.description})`,
        },
      ],
    };
  }

  if (product) {
    return { status: "ok", data: await buildResultForProduct(searchedCode, product) };
  }

  if (material) {
    return { status: "ok", data: await buildResultForMaterial(searchedCode, material) };
  }

  return {
    status: "not_found",
    searchedCode,
    message: `Nenhum produto, componente ou matéria-prima encontrado com o código "${searchedCode}".`,
  };
}
