import { prisma } from "@/src/lib/prisma";
import {
  chooseEffectiveNomusList,
  compareBom,
  computeEffectiveLineQuantity,
  normalizeSku,
  toNumberSafe,
  type BomComparisonResult,
  type IndusBomLine,
  type NomusEffectiveBomLine,
} from "@/src/lib/nomusBomComparison";
import {
  filterStageRowsToCurrentParentSnapshot,
  getParentStageSnapshotMeta,
} from "@/src/lib/nomusBomComponentStageSnapshot";
import {
  isRegistryActiveStatus,
  pickRegistryRecordForAutoResolve,
  resolveRegistryPairForComponentCode,
} from "@/src/lib/nomusComponentRegistryResolve";
import { parseLinkedPreferredExternalLineId } from "@/src/lib/nomusPreferredAlternativeLink";

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
  rawPayload?: unknown;
}): NomusEffectiveBomLine {
  const requiredQuantity = toNumberSafe(row.qtdeNecessaria);
  const lossQuantity = toNumberSafe(row.qtdePerdaNormal);
  // ProductBOM.quantity = qtdeNecessaria (perda normal Nomus não é somada no IndusCost).
  const effectiveQuantity = computeEffectiveLineQuantity(requiredQuantity, lossQuantity);
  return {
    externalLineId: row.externalLineId,
    parentCode: row.parentCode,
    componentCode: row.componentCode,
    componentDescription: row.componentDescription,
    quantity: effectiveQuantity,
    requiredQuantity,
    lossQuantity,
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
    linkedPreferredExternalLineId:
      row.alternativo === true
        ? parseLinkedPreferredExternalLineId(row.rawPayload)
        : null,
  };
}

export async function loadNomusStageLinesForParent(parentCode: string): Promise<NomusEffectiveBomLine[]> {
  const trimmed = parentCode.trim();
  const normalized = normalizeSku(trimmed);
  const [rows, snapshotMeta] = await Promise.all([
    prisma.nomusBomComponentStage.findMany({
      where: {
        OR: [{ parentCode: trimmed }, { parentCode: normalized }],
      },
      orderBy: [{ posicao: "asc" }, { componentCode: "asc" }],
    }),
    getParentStageSnapshotMeta(trimmed),
  ]);

  const currentRows = filterStageRowsToCurrentParentSnapshot(rows, snapshotMeta);

  return currentRows.map((row) =>
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
      rawPayload: row.rawPayload,
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
  inactiveProductIds?: string[];
  inactiveMaterialIds?: string[];
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
      select: { id: true, sku: true, status: true },
    }),
    prisma.material.findMany({
      where: { code: { in: lookupValues } },
      select: { id: true, code: true, status: true },
    }),
  ]);

  const productsBySku = new Map<string, typeof products>();
  for (const product of products) {
    const key = normalizeSku(product.sku);
    const list = productsBySku.get(key) ?? [];
    list.push(product);
    productsBySku.set(key, list);
  }

  const materialsByCode = new Map<string, typeof materials>();
  for (const material of materials) {
    const key = normalizeSku(material.code);
    const list = materialsByCode.get(key) ?? [];
    list.push(material);
    materialsByCode.set(key, list);
  }

  return uniqueCodes.map((componentCode) => {
    const key = normalizeSku(componentCode);
    const productCandidates = productsBySku.get(key) ?? [];
    const materialCandidates = materialsByCode.get(key) ?? [];

    const product = pickRegistryRecordForAutoResolve({
      records: productCandidates,
      isActive: (r) => isRegistryActiveStatus(r.status),
    });
    const material = pickRegistryRecordForAutoResolve({
      records: materialCandidates,
      isActive: (r) => isRegistryActiveStatus(r.status),
    });

    const inactiveProductIds = productCandidates
      .filter((r) => !isRegistryActiveStatus(r.status))
      .map((r) => r.id);
    const inactiveMaterialIds = materialCandidates
      .filter((r) => !isRegistryActiveStatus(r.status))
      .map((r) => r.id);

    const resolved = resolveRegistryPairForComponentCode({
      componentCode,
      product,
      material,
      inactiveProductIds,
      inactiveMaterialIds,
    });

    return {
      componentCode,
      productId: resolved.productId,
      materialId: resolved.materialId,
      resolvedKind: resolved.resolvedKind,
      inactiveProductIds,
      inactiveMaterialIds,
    };
  });
}
