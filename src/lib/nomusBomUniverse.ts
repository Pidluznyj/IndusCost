import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import { detectOperationalItem } from "@/src/lib/nomusBomClassification";
import { isLocalAssemblyComponentCode } from "@/src/lib/nomusEffectivePricingBomTypes";
import { prisma } from "@/src/lib/prisma";

export const AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON =
  "Item existe no universo Nomus, mas não consta mais na BOM efetiva Nomus deste produto.";

export type NomusUniverseCodeSet = ReadonlySet<string>;

export function isCodeKnownInNomusUniverse(
  code: string,
  universe: NomusUniverseCodeSet
): boolean {
  const key = normalizeComponentCode(code);
  if (!key) return false;
  return universe.has(key);
}

/**
 * Códigos conhecidos no ecossistema Nomus (BOM stage + produtos controlados).
 * Material.code não tem origem Nomus confiável no schema — não entra neste universo.
 */
export async function buildNomusUniverseCodeSet(): Promise<Set<string>> {
  const codes = new Set<string>();

  const [componentGroups, parentGroups, products] = await Promise.all([
    prisma.nomusBomComponentStage.groupBy({ by: ["componentCode"] }),
    prisma.nomusBomComponentStage.groupBy({ by: ["parentCode"] }),
    prisma.product.findMany({
      where: {
        OR: [
          { isNomusControlled: true },
          { sourceSystem: { equals: "NOMUS", mode: "insensitive" } },
        ],
      },
      select: { sku: true },
    }),
  ]);

  for (const row of componentGroups) {
    if (row.componentCode) codes.add(normalizeComponentCode(row.componentCode));
  }
  for (const row of parentGroups) {
    if (row.parentCode) codes.add(normalizeComponentCode(row.parentCode));
  }
  for (const product of products) {
    if (product.sku) {
      codes.add(normalizeComponentCode(product.sku));
      codes.add(normalizeSku(product.sku));
    }
  }

  codes.delete("");
  return codes;
}

export function isAutoRemovableObsoleteLocalLine(input: {
  componentCode: string;
  componentDescription?: string | null;
  localException?: boolean;
  nomusUniverse: NomusUniverseCodeSet;
}): boolean {
  if (input.localException === true) return false;
  if (isLocalAssemblyComponentCode(input.componentCode)) return false;
  if (detectOperationalItem(input.componentCode, input.componentDescription)) return false;
  return isCodeKnownInNomusUniverse(input.componentCode, input.nomusUniverse);
}
