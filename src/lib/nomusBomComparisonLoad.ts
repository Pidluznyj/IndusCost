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

export async function listDistinctParentCodesFromStage(limit: number): Promise<string[]> {
  const rows = await prisma.nomusBomComponentStage.findMany({
    distinct: ["parentCode"],
    select: { parentCode: true },
    orderBy: { parentCode: "asc" },
    take: limit,
  });
  return rows.map((r) => r.parentCode);
}
