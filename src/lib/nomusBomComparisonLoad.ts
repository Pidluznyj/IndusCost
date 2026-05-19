import { prisma } from "@/src/lib/prisma";
import {
  chooseEffectiveNomusList,
  compareBom,
  normalizeSku,
  toNumberSafe,
  type BomComparisonResult,
  type IndusBomLine,
  type NomusEffectiveBomLine,
} from "@/src/lib/nomusBomComparison";

export function stageRowToNomusLine(row: {
  externalLineId: number;
  parentCode: string;
  componentCode: string;
  componentDescription: string | null;
  qtdeNecessaria: unknown;
  qtdePerdaNormal: unknown;
  listaMateriaisId: number | null;
  listaMateriaisNome: string | null;
  listaMateriaisPadrao: boolean | null;
  listaMateriaisPadraoBlocoK: boolean | null;
  listaMateriaisAtivo: boolean | null;
  opcional: boolean | null;
  alternativo: boolean | null;
  preferencial: boolean | null;
  itemDeEmbarque: boolean | null;
  posicao: number | null;
}): NomusEffectiveBomLine {
  return {
    externalLineId: row.externalLineId,
    parentCode: row.parentCode,
    componentCode: row.componentCode,
    componentDescription: row.componentDescription,
    quantity: toNumberSafe(row.qtdeNecessaria),
    lossQuantity: toNumberSafe(row.qtdePerdaNormal),
    listaMateriaisId: row.listaMateriaisId,
    listaMateriaisNome: row.listaMateriaisNome,
    listaMateriaisPadrao: row.listaMateriaisPadrao,
    listaMateriaisPadraoBlocoK: row.listaMateriaisPadraoBlocoK,
    listaMateriaisAtivo: row.listaMateriaisAtivo,
    opcional: row.opcional,
    alternativo: row.alternativo,
    preferencial: row.preferencial,
    itemDeEmbarque: row.itemDeEmbarque,
    posicao: row.posicao,
  };
}

export async function loadNomusStageLinesForParent(parentCode: string): Promise<NomusEffectiveBomLine[]> {
  const trimmed = parentCode.trim();
  const normalized = normalizeSku(trimmed);
  const rows = await prisma.nomusBomComponentStage.findMany({
    where: {
      OR: [{ parentCode: trimmed }, { parentCode: normalized }],
    },
    orderBy: [{ posicao: "asc" }, { componentCode: "asc" }],
  });

  return rows.map((row) =>
    stageRowToNomusLine({
      externalLineId: row.externalLineId,
      parentCode: row.parentCode,
      componentCode: row.componentCode,
      componentDescription: row.componentDescription,
      qtdeNecessaria: row.qtdeNecessaria,
      qtdePerdaNormal: row.qtdePerdaNormal,
      listaMateriaisId: row.listaMateriaisId,
      listaMateriaisNome: row.listaMateriaisNome,
      listaMateriaisPadrao: row.listaMateriaisPadrao,
      listaMateriaisPadraoBlocoK: row.listaMateriaisPadraoBlocoK,
      listaMateriaisAtivo: row.listaMateriaisAtivo,
      opcional: row.opcional,
      alternativo: row.alternativo,
      preferencial: row.preferencial,
      itemDeEmbarque: row.itemDeEmbarque,
      posicao: row.posicao,
    })
  );
}

export async function loadIndusBomLinesForProduct(
  productId: string,
  productSku: string
): Promise<IndusBomLine[]> {
  const bomRows = await prisma.productBOM.findMany({
    where: { productId },
    include: {
      Material: { select: { code: true, description: true } },
      ChildProduct: { select: { sku: true, name: true, type: true } },
    },
    orderBy: { id: "asc" },
  });

  return bomRows.map((row) => {
    if (row.materialId && row.Material) {
      return {
        productSku,
        componentCode: row.Material.code,
        componentKind: "MATERIAL" as const,
        componentDescription: row.Material.description,
        quantity: toNumberSafe(row.quantity),
        lossPercentage: toNumberSafe(row.lossPercentage),
        bomLineId: row.id,
      };
    }
    if (row.childProductId && row.ChildProduct) {
      return {
        productSku,
        componentCode: row.ChildProduct.sku,
        componentKind:
          row.ChildProduct.type === "PRODUCT" || row.ChildProduct.type === "COMPONENT"
            ? "PRODUCT"
            : "UNKNOWN",
        componentDescription: row.ChildProduct.name,
        quantity: toNumberSafe(row.quantity),
        lossPercentage: toNumberSafe(row.lossPercentage),
        bomLineId: row.id,
      };
    }
    return {
      productSku,
      componentCode: `UNKNOWN:${row.id}`,
      componentKind: "UNKNOWN" as const,
      componentDescription: null,
      quantity: toNumberSafe(row.quantity),
      lossPercentage: toNumberSafe(row.lossPercentage),
      bomLineId: row.id,
    };
  });
}

export async function buildBomComparisonForParentCode(parentCode: string): Promise<BomComparisonResult> {
  const trimmed = parentCode.trim();
  const sku = normalizeSku(trimmed);
  const product = await prisma.product.findFirst({
    where: {
      OR: [{ sku }, { sku: trimmed }],
    },
    select: { id: true, sku: true, name: true, description: true },
  });

  const nomusAllLines = await loadNomusStageLinesForParent(parentCode);
  const listSelection = chooseEffectiveNomusList(nomusAllLines);

  const nomusParentDescription =
    (
      await prisma.nomusBomComponentStage.findFirst({
        where: { OR: [{ parentCode: trimmed }, { parentCode: sku }] },
        select: { parentDescription: true },
      })
    )?.parentDescription ?? null;

  if (!product) {
    return compareBom(sku, nomusAllLines, [], {
      parentDescription: nomusParentDescription,
      missingProductInIndusCost: true,
      listSelection,
    });
  }

  const indusLines = await loadIndusBomLinesForProduct(product.id, product.sku);

  return compareBom(sku, nomusAllLines, indusLines, {
    parentDescription: product.description ?? product.name,
    indusProductId: product.id,
    indusProductName: product.name,
    listSelection,
    missingProductInIndusCost: false,
  });
}

export async function buildBomComparisonForProductId(productId: string): Promise<BomComparisonResult | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, description: true },
  });
  if (!product) return null;
  return buildBomComparisonForParentCode(product.sku);
}

export type ListDistinctParentCodesOptions = {
  limit: number;
  offset?: number;
  search?: string;
};

function parentCodeSearchWhere(search?: string) {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  return {
    parentCode: { contains: trimmed, mode: "insensitive" as const },
  };
}

export async function listDistinctParentCodesFromStage(
  limitOrOptions: number | ListDistinctParentCodesOptions
): Promise<string[]> {
  const options: ListDistinctParentCodesOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions, offset: 0 } : limitOrOptions;

  const rows = await prisma.nomusBomComponentStage.findMany({
    distinct: ["parentCode"],
    select: { parentCode: true },
    where: parentCodeSearchWhere(options.search),
    orderBy: { parentCode: "asc" },
    skip: Math.max(0, options.offset ?? 0),
    take: options.limit,
  });
  return rows.map((r) => r.parentCode);
}

export async function countDistinctParentCodesInStage(search?: string): Promise<number> {
  const grouped = await prisma.nomusBomComponentStage.groupBy({
    by: ["parentCode"],
    where: parentCodeSearchWhere(search),
  });
  return grouped.length;
}

export type ResolvedNomusComponentRow = {
  componentCode: string;
  productId?: string | null;
  materialId?: string | null;
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE";
};

export async function resolveNomusComponentCodes(
  componentCodes: string[]
): Promise<ResolvedNomusComponentRow[]> {
  const uniqueCodes = [...new Set(componentCodes.map((c) => c.trim()).filter(Boolean))];
  if (uniqueCodes.length === 0) return [];

  const normalizedSet = new Set(uniqueCodes.map((c) => normalizeSku(c)));
  const lookupValues = [...new Set([...uniqueCodes, ...normalizedSet])];

  const [products, materials] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: lookupValues } },
      select: { id: true, sku: true },
    }),
    prisma.material.findMany({
      where: { code: { in: lookupValues } },
      select: { id: true, code: true },
    }),
  ]);

  const productBySku = new Map<string, { id: string; sku: string }>();
  for (const product of products) {
    productBySku.set(normalizeSku(product.sku), product);
  }

  const materialByCode = new Map<string, { id: string; code: string }>();
  for (const material of materials) {
    materialByCode.set(normalizeSku(material.code), material);
  }

  return uniqueCodes.map((componentCode) => {
    const key = normalizeSku(componentCode);
    const product = productBySku.get(key);
    const material = materialByCode.get(key);

    let resolvedKind: ResolvedNomusComponentRow["resolvedKind"] = "NONE";
    if (product && material) resolvedKind = "BOTH";
    else if (product) resolvedKind = "PRODUCT";
    else if (material) resolvedKind = "MATERIAL";

    return {
      componentCode,
      productId: product?.id ?? null,
      materialId: material?.id ?? null,
      resolvedKind,
    };
  });
}
