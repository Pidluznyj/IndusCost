import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, toNumberSafe } from "@/src/lib/nomusBomComparison";
import {
  computeNomusParentStructureFingerprint,
  type NomusStructureLineFingerprint,
} from "@/src/lib/nomusBomStructureFingerprint";
import type { AggregatedOptionalItem } from "@/src/lib/nomusOptionalPricingSelection";
import { getEffectiveNomusContext } from "@/src/lib/nomusOptionalPricingSelection";

function lineIdsKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

function quantitiesMatch(
  a: number | null | undefined,
  b: number | null | undefined
): boolean {
  const left = toNumberSafe(a);
  const right = toNumberSafe(b);
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.000001;
}

/** Comparação estrita — ids Nomus + quantidade (comportamento legado). */
export function strictOptionalItemMatchesCurrent(
  choice: { componentCode: string; plannedQuantity: unknown; nomusSourceLineIds: unknown },
  current: AggregatedOptionalItem | undefined
): boolean {
  if (!current) return false;
  const choiceIds = Array.isArray(choice.nomusSourceLineIds)
    ? (choice.nomusSourceLineIds as number[])
    : [];
  if (lineIdsKey(choiceIds) !== lineIdsKey(current.nomusSourceLineIds)) return false;
  return quantitiesMatch(toNumberSafe(choice.plannedQuantity), current.plannedQuantity);
}

/**
 * Comparação semântica — mesmo componente e quantidade na pool atual,
 * mesmo quando externalLineId mudou entre syncs.
 */
export function semanticOptionalItemMatchesCurrent(
  choice: { componentCode: string; plannedQuantity: unknown },
  current: AggregatedOptionalItem | undefined
): boolean {
  if (!current) return false;
  if (
    normalizeComponentCode(choice.componentCode) !==
    normalizeComponentCode(current.componentCode)
  ) {
    return false;
  }
  return quantitiesMatch(toNumberSafe(choice.plannedQuantity), current.plannedQuantity);
}

export function optionalItemMatchesCurrent(
  choice: { componentCode: string; plannedQuantity: unknown; nomusSourceLineIds: unknown },
  current: AggregatedOptionalItem | undefined
): boolean {
  if (strictOptionalItemMatchesCurrent(choice, current)) return true;
  return semanticOptionalItemMatchesCurrent(choice, current);
}

export type OptionalChoiceReconciliationResult = {
  refreshedChoices: number;
  updatedGroups: number;
  structureFingerprint: string | null;
};

/**
 * Atualiza snapshots persistidos de choices quando a estrutura Nomus é semanticamente
 * a mesma, mas ids de linha mudaram — evita falso STALE após nova sync.
 */
export async function reconcileOptionalPricingSnapshotsForParent(
  parentCode: string
): Promise<OptionalChoiceReconciliationResult> {
  const trimmed = parentCode.trim();
  const ctx = await getEffectiveNomusContext(trimmed);
  if (!ctx) {
    return { refreshedChoices: 0, updatedGroups: 0, structureFingerprint: null };
  }

  const optionalByCode = new Map(
    ctx.optionalItems.map((item) => [normalizeComponentCode(item.componentCode), item])
  );
  const structureFingerprint = await computeNomusParentStructureFingerprint(trimmed);

  const groups = await prisma.nomusOptionalPricingGroup.findMany({
    where: { parentCode: { equals: trimmed, mode: "insensitive" }, isActive: true },
    include: { choices: { where: { isActive: true } } },
  });

  let refreshedChoices = 0;
  let updatedGroups = 0;

  for (const group of groups) {
    let groupFingerprintUpdated = false;

    for (const choice of group.choices) {
      const current = optionalByCode.get(normalizeComponentCode(choice.componentCode));
      if (!current) continue;
      if (strictOptionalItemMatchesCurrent(choice, current)) continue;
      if (!semanticOptionalItemMatchesCurrent(choice, current)) continue;

      await prisma.nomusOptionalPricingChoice.update({
        where: { id: choice.id },
        data: {
          plannedQuantity: current.plannedQuantity,
          nomusSourceLineIds: current.nomusSourceLineIds,
          componentDescription: current.componentDescription ?? choice.componentDescription,
        },
      });
      refreshedChoices += 1;
    }

    if (structureFingerprint && group.nomusStructureFingerprint !== structureFingerprint) {
      await prisma.nomusOptionalPricingGroup.update({
        where: { id: group.id },
        data: { nomusStructureFingerprint: structureFingerprint },
      });
      groupFingerprintUpdated = true;
    }

    if (groupFingerprintUpdated) updatedGroups += 1;
  }

  return { refreshedChoices, updatedGroups, structureFingerprint };
}

export function buildNomusStructureLinesFromOptionalItems(
  items: AggregatedOptionalItem[]
): NomusStructureLineFingerprint[] {
  return items
    .map((item) => ({
      componentCode: normalizeComponentCode(item.componentCode),
      quantity: toNumberSafe(item.plannedQuantity),
      opcional: item.isOptional,
      alternativo: item.isAlternative,
      preferencial: item.isPreferred,
      perdaNormal: null,
    }))
    .sort((a, b) => a.componentCode.localeCompare(b.componentCode, "pt-BR"));
}
