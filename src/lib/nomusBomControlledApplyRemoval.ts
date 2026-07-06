import { detectOperationalItem } from "@/src/lib/nomusBomClassification";
import type { EffectivePricingBomSource } from "@/src/lib/nomusEffectivePricingBomTypes";
import { isLocalAssemblyComponentCode } from "@/src/lib/nomusEffectivePricingBomTypes";

/** Fontes da BOM efetiva cujos componentes excluídos podem gerar REMOVE_PRODUCT_BOM_LINE no apply controlado. */
export const CONTROLLED_APPLY_REMOVAL_SOURCES: ReadonlySet<EffectivePricingBomSource> = new Set([
  "LOCAL_ONLY_EXCLUDED_BY_REVIEW",
  "LOCAL_ONLY_OBSOLETE_NOMUS",
  "LOCAL_ONLY_DUPLICATED_BY_NOMUS",
  "NOMUS_OPTIONAL_NOT_SELECTED",
  "NOMUS_OPTIONAL_SELECTED_NONE",
  "NOMUS_ALTERNATIVE_NOT_SELECTED",
]);

export type ExcludedOptionalResolution =
  | "EXCLUDED_BY_OPTIONAL_SELECTION_NONE"
  | "EXCLUDED_OPTIONAL_NOT_SELECTED";

export function isEffectiveLineRemovableByControlledApply(source: EffectivePricingBomSource): boolean {
  return CONTROLLED_APPLY_REMOVAL_SOURCES.has(source);
}

export function excludedOptionalResolutionForSource(
  source: EffectivePricingBomSource,
  resolution?: string | null
): ExcludedOptionalResolution | null {
  if (source === "NOMUS_OPTIONAL_SELECTED_NONE") return "EXCLUDED_BY_OPTIONAL_SELECTION_NONE";
  if (source === "NOMUS_OPTIONAL_NOT_SELECTED" || source === "NOMUS_ALTERNATIVE_NOT_SELECTED") {
    if (resolution === "selected_none") return "EXCLUDED_BY_OPTIONAL_SELECTION_NONE";
    return "EXCLUDED_OPTIONAL_NOT_SELECTED";
  }
  return null;
}

/**
 * Linha ProductBOM pode ser removida por exclusão de opcional/alternativa na BOM efetiva.
 * Respeita localException, 800.xx, processo operacional e decisão humana de manter.
 */
export function isProductBomRowEligibleForExcludedComponentRemoval(input: {
  componentCode: string;
  componentDescription?: string | null;
  localException?: boolean;
  reviewDecisionType?: string | null;
}): boolean {
  if (input.localException === true) return false;
  if (isLocalAssemblyComponentCode(input.componentCode)) return false;
  if (detectOperationalItem(input.componentCode, input.componentDescription ?? null)) return false;
  if (input.reviewDecisionType === "INCLUDE_AS_LOCAL_EXCEPTION") return false;
  return true;
}
