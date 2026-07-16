/**
 * Classificação de diffs legado × novo.
 * Bleed histórico nunca classifica como acesso intencional preservado.
 */

import {
  getPermissionContractResource,
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractAction,
} from "@/src/lib/security/permissionContract/index.js";
import type { EffectiveAccessSource } from "@/src/lib/security/effectiveAccess/types.js";
import type { AccessDiffCategory, LegacyBagEvaluation } from "./types.ts";

export function classifyAccessDiff(args: {
  resourceKey: string;
  action: PermissionContractAction;
  legacy: LegacyBagEvaluation;
  newAllow: boolean;
  newSource: EffectiveAccessSource;
  hasProfileReplace?: boolean;
}): AccessDiffCategory {
  const resource = getPermissionContractResource(
    args.resourceKey,
    PERMISSION_CONTRACT_RESOURCES
  );
  if (!resource) {
    return "unmapped_resource";
  }

  const binding = resource.actions.find((a) => a.action === args.action);
  if (!binding) {
    return "unmapped_resource";
  }

  const { legacy, newAllow, newSource } = args;
  const legacyAllow = legacy.allow;
  const bleedOnly =
    legacyAllow && legacy.dedicatedKeys.length === 0 && legacy.bleedKeys.length > 0;
  const hasDedicated = legacy.dedicatedKeys.length > 0;

  if (!legacyAllow && !newAllow) {
    return "both_denied";
  }

  if (legacyAllow && newAllow) {
    if (bleedOnly && !hasDedicated) {
      if (
        newSource === "OVERRIDE_ALLOW" ||
        newSource === "PROFILE" ||
        newSource === "STRUCTURED_GRANT"
      ) {
        return "new_legitimate_access";
      }
    }
    return "preserved_intentional";
  }

  if (!legacyAllow && newAllow) {
    if (
      newSource === "SUPER_ADMIN" ||
      newSource === "ROLE" ||
      newSource === "PROFILE" ||
      newSource === "OVERRIDE_ALLOW" ||
      newSource === "STRUCTURED_GRANT" ||
      newSource === "LEGACY_PROJECTED"
    ) {
      return "new_legitimate_access";
    }
    if (newSource === "DENY_DEFAULT" || newSource === "UNKNOWN_RESOURCE") {
      return "conflict";
    }
    return "new_legitimate_access";
  }

  // legacy allow, new deny
  if (bleedOnly) {
    return "mega_key_bleed";
  }

  if (newSource === "OVERRIDE_DENY" || newSource === "ANCESTOR_VIEW_DENY") {
    return "removed_by_deny";
  }

  if (hasDedicated) {
    return "lockout_risk";
  }

  if (legacy.bleedKeys.length > 0 && legacy.dedicatedKeys.length === 0) {
    return "mega_key_bleed";
  }

  if (args.hasProfileReplace && newSource === "DENY_DEFAULT") {
    return "permissive_fallback";
  }

  if (legacy.bleedKeys.length > 0) {
    return "mega_key_bleed";
  }

  return "lockout_risk";
}

export function emptyCategoryCounts(): Record<AccessDiffCategory, number> {
  return {
    preserved_intentional: 0,
    new_legitimate_access: 0,
    removed_by_deny: 0,
    mega_key_bleed: 0,
    permissive_fallback: 0,
    unmapped_resource: 0,
    conflict: 0,
    lockout_risk: 0,
    both_denied: 0,
  };
}

export function incrementCategory(
  counts: Record<AccessDiffCategory, number>,
  category: AccessDiffCategory
): void {
  counts[category] = (counts[category] ?? 0) + 1;
}
