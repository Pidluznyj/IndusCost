import { computeNomusParentStructureFingerprint } from "@/src/lib/nomusBomStructureFingerprint";
import { reconcileOptionalPricingSnapshotsForParent } from "@/src/lib/nomusOptionalChoiceReconciliation";

export type NomusEngineeringGovernancePrep = {
  parentCode: string;
  structureFingerprint: string | null;
  optionalChoicesRefreshed: number;
  optionalGroupsUpdated: number;
};

const prepCache = new Map<string, { at: number; result: NomusEngineeringGovernancePrep }>();
const CACHE_TTL_MS = 5_000;

/**
 * Prepara governança persistente antes de montar BOM efetiva / preview / apply.
 * Reconcilia snapshots de opcionais stale por drift de line id (não por mudança real).
 */
export async function prepareNomusEngineeringGovernance(
  parentCode: string
): Promise<NomusEngineeringGovernancePrep> {
  const trimmed = parentCode.trim();
  const cacheKey = trimmed.toUpperCase();
  const cached = prepCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  const reconciled = await reconcileOptionalPricingSnapshotsForParent(trimmed);
  const structureFingerprint =
    reconciled.structureFingerprint ?? (await computeNomusParentStructureFingerprint(trimmed));

  const result: NomusEngineeringGovernancePrep = {
    parentCode: trimmed,
    structureFingerprint,
    optionalChoicesRefreshed: reconciled.refreshedChoices,
    optionalGroupsUpdated: reconciled.updatedGroups,
  };

  prepCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

/** Limpa cache (testes). */
export function clearNomusEngineeringGovernanceCache(): void {
  prepCache.clear();
}
