import { normalizeComponentCode, type NomusEffectiveBomLine } from "@/src/lib/nomusBomComparison";

/** Chave Nomus em `rawPayload` (componentesListaMateriais). */
export const PREFERRED_ALTERNATIVE_LINK_PAYLOAD_KEY =
  "idComponentePreferencialVinculadoAlternativo";

export function parseLinkedPreferredExternalLineId(rawPayload: unknown): number | null {
  if (rawPayload == null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const value = (rawPayload as Record<string, unknown>)[PREFERRED_ALTERNATIVE_LINK_PAYLOAD_KEY];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type PreferredAlternativeSet = {
  preferredExternalLineId: number;
  preferredComponentCode: string;
  alternativeComponentCodes: string[];
  /** Preferencial existe na lista efetiva / snapshot atual. */
  preferredInSnapshot: boolean;
};

export function buildPreferredAlternativeSets(
  lines: NomusEffectiveBomLine[]
): PreferredAlternativeSet[] {
  const lineByExternalId = new Map(lines.map((l) => [l.externalLineId, l]));
  const byPreferredId = new Map<number, PreferredAlternativeSet>();

  for (const line of lines) {
    if (line.alternativo !== true) continue;
    const preferredId = line.linkedPreferredExternalLineId;
    if (preferredId == null) continue;

    const preferredLine = lineByExternalId.get(preferredId);
    let set = byPreferredId.get(preferredId);
    if (!set) {
      set = {
        preferredExternalLineId: preferredId,
        preferredComponentCode: preferredLine?.componentCode ?? "",
        alternativeComponentCodes: [],
        preferredInSnapshot: preferredLine != null && preferredLine.preferencial === true,
      };
      byPreferredId.set(preferredId, set);
    }
    if (!set.alternativeComponentCodes.includes(line.componentCode)) {
      set.alternativeComponentCodes.push(line.componentCode);
    }
    if (preferredLine?.componentCode) {
      set.preferredComponentCode = preferredLine.componentCode;
      set.preferredInSnapshot = true;
    }
  }

  return [...byPreferredId.values()].filter((s) => s.alternativeComponentCodes.length > 0);
}

export function componentCodesInPreferredAlternativeSets(
  sets: PreferredAlternativeSet[]
): Set<string> {
  const codes = new Set<string>();
  for (const set of sets) {
    if (set.preferredComponentCode) {
      codes.add(normalizeComponentCode(set.preferredComponentCode));
    }
    for (const alt of set.alternativeComponentCodes) {
      codes.add(normalizeComponentCode(alt));
    }
  }
  return codes;
}

export function findPreferredAlternativeSetForComponent(
  sets: PreferredAlternativeSet[],
  componentCode: string
): PreferredAlternativeSet | undefined {
  const key = normalizeComponentCode(componentCode);
  return sets.find((s) => {
    if (s.preferredComponentCode && normalizeComponentCode(s.preferredComponentCode) === key) {
      return true;
    }
    return s.alternativeComponentCodes.some((c) => normalizeComponentCode(c) === key);
  });
}

export function isLinkedPreferredPricingComponent(
  line: NomusEffectiveBomLine,
  linkedPreferredCodes: Set<string>
): boolean {
  return (
    line.preferencial === true &&
    linkedPreferredCodes.has(normalizeComponentCode(line.componentCode))
  );
}
