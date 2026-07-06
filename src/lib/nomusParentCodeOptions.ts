import { prisma } from "@/src/lib/prisma";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  const n = limit ?? DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(n)), MAX_LIMIT);
}

function parentCodeSearchWhere(search?: string) {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  return {
    parentCode: { contains: trimmed, mode: "insensitive" as const },
  };
}

function rankParentCodeMatch(search: string, parentCode: string): number {
  const wanted = normalizeSku(search);
  const code = normalizeSku(parentCode);
  if (code === wanted) return 0;
  if (code.startsWith(wanted)) return 1;
  if (code.includes(wanted)) return 2;
  return 3;
}

async function resolveIndusProductIdByParentCodes(
  parentCodes: string[]
): Promise<Map<string, string | null>> {
  if (parentCodes.length === 0) return new Map();

  const lookupValues = [
    ...new Set(parentCodes.flatMap((code) => [code.trim(), normalizeSku(code)].filter(Boolean))),
  ];

  const products = await prisma.product.findMany({
    where: { sku: { in: lookupValues } },
    select: { id: true, sku: true },
  });

  const byNormalizedSku = new Map<string, string>();
  for (const product of products) {
    byNormalizedSku.set(normalizeSku(product.sku), product.id);
  }

  const result = new Map<string, string | null>();
  for (const code of parentCodes) {
    result.set(code, byNormalizedSku.get(normalizeSku(code)) ?? null);
  }
  return result;
}

export async function listNomusParentCodeOptions(
  search: string,
  limit?: number
): Promise<{ search: string; rows: NomusParentCodeOption[] }> {
  const trimmedSearch = search.trim();
  const take = clampLimit(limit);

  const grouped = await prisma.nomusBomComponentStage.groupBy({
    by: ["parentCode"],
    where: parentCodeSearchWhere(trimmedSearch || undefined),
    _count: { _all: true },
    _max: {
      parentDescription: true,
      listaMateriaisNome: true,
    },
  });

  let sorted = grouped;
  if (trimmedSearch) {
    sorted = [...grouped].sort((a, b) => {
      const rankA = rankParentCodeMatch(trimmedSearch, a.parentCode);
      const rankB = rankParentCodeMatch(trimmedSearch, b.parentCode);
      if (rankA !== rankB) return rankA - rankB;
      return a.parentCode.localeCompare(b.parentCode, undefined, { sensitivity: "base" });
    });
  } else {
    sorted = [...grouped].sort((a, b) =>
      a.parentCode.localeCompare(b.parentCode, undefined, { sensitivity: "base" })
    );
  }

  const page = sorted.slice(0, take);
  const productIds = await resolveIndusProductIdByParentCodes(page.map((g) => g.parentCode));

  const rows: NomusParentCodeOption[] = page.map((g) => ({
    parentCode: g.parentCode,
    parentDescription: g._max.parentDescription ?? null,
    indusProductId: productIds.get(g.parentCode) ?? null,
    nomusLinesCount: g._count._all,
    selectedListName: g._max.listaMateriaisNome ?? null,
  }));

  return { search: trimmedSearch, rows };
}
