/**
 * Detecção de bleed / mega-key — grant legado não intencional neste recurso.
 */

import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.js";
import {
  classifyLegacyAliasStatus,
  listLegacyAliasesForResource,
} from "@/src/lib/security/permissionContract/helpers.js";
import { MEGA_KEY_MIGRATION_MAP } from "@/src/lib/security/permissionMegaKeyMigration.js";

function aliasIndex(
  resourceKey: string,
  action: PermissionContractAction,
  legacyKey: string
): number {
  const aliases = listLegacyAliasesForResource(resourceKey);
  const hit = aliases.find((a) => a.action === action && a.legacyKey === legacyKey);
  return hit?.index ?? -1;
}

/** Chaves legadas que historicamente abriam este recurso por bleed documentado (P09). */
export function listMigrationBleedKeysForResource(
  resourceKey: string,
  action: PermissionContractAction,
  effectiveBag: ReadonlySet<string>
): string[] {
  if (action !== "view") return [];
  const out: string[] = [];
  for (const entry of MEGA_KEY_MIGRATION_MAP) {
    if (!effectiveBag.has(entry.legacyKey)) continue;
    if (entry.removedFromResourceKeys.includes(resourceKey)) {
      out.push(entry.legacyKey);
    }
  }
  return out;
}

/** true quando a chave legada abre este recurso por bleed/mega-key documentado. */
export function isLegacyBleedGrant(
  legacyKey: string,
  resourceKey: string,
  action: PermissionContractAction
): boolean {
  const migration = MEGA_KEY_MIGRATION_MAP.find((e) => e.legacyKey === legacyKey);
  if (migration?.removedFromResourceKeys.includes(resourceKey)) {
    return true;
  }
  if (
    migration?.canonicalResourceKey === resourceKey ||
    migration?.replacementKeys.includes(resourceKey)
  ) {
    return false;
  }

  const index = aliasIndex(resourceKey, action, legacyKey);
  if (index < 0) {
    return false;
  }

  const status = classifyLegacyAliasStatus(legacyKey, resourceKey, index);
  if (status === "canonical_1_1") {
    return false;
  }
  return status === "cross_resource_bleed_temporary" || status === "mega_key_temporary";
}
