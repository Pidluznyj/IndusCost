/**
 * Índice de aliases 1:1 resource ↔ legado a partir do seed PT (+ regras de eixo).
 */

import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog.js";
import { PERMISSION_RESOURCE_SEEDS } from "@/src/lib/permissionResourceSeedData.js";
import type { DualWriteAliasBinding } from "./types.ts";

const CATALOG_SET = new Set(ALL_PERMISSION_KEYS);

export function isManageAlias(key: string): boolean {
  return (
    key === "users.manage" ||
    key === "accessProfiles.manage" ||
    /\.(manage|admin)$/.test(key)
  );
}

export function isExecuteAlias(key: string): boolean {
  return /\.(execute|export|sync|create|apply)$/.test(key);
}

export function aliasAxis(key: string): "view" | "execute" | "manage" {
  if (isManageAlias(key)) return "manage";
  if (isExecuteAlias(key)) return "execute";
  return "view";
}

export type DualWriteAliasIndex = {
  byLegacy: Map<string, DualWriteAliasBinding[]>;
  byResource: Map<string, DualWriteAliasBinding[]>;
  parentByResource: Map<string, string | null>;
  mappedLegacyKeys: Set<string>;
  catalogKeys: ReadonlySet<string>;
};

let cachedIndex: DualWriteAliasIndex | null = null;

export function buildDualWriteAliasIndex(
  seeds = PERMISSION_RESOURCE_SEEDS
): DualWriteAliasIndex {
  const byLegacy = new Map<string, DualWriteAliasBinding[]>();
  const byResource = new Map<string, DualWriteAliasBinding[]>();
  const parentByResource = new Map<string, string | null>();
  const mappedLegacyKeys = new Set<string>();

  for (const seed of seeds) {
    parentByResource.set(seed.key, seed.parentKey);
    for (const legacyKey of seed.legacyAliasKeys) {
      const binding: DualWriteAliasBinding = {
        resourceKey: seed.key,
        legacyKey,
        axis: aliasAxis(legacyKey),
      };
      mappedLegacyKeys.add(legacyKey);
      const lg = byLegacy.get(legacyKey) ?? [];
      lg.push(binding);
      byLegacy.set(legacyKey, lg);
      const rg = byResource.get(seed.key) ?? [];
      rg.push(binding);
      byResource.set(seed.key, rg);
    }
  }

  return {
    byLegacy,
    byResource,
    parentByResource,
    mappedLegacyKeys,
    catalogKeys: CATALOG_SET,
  };
}

export function getDualWriteAliasIndex(): DualWriteAliasIndex {
  if (!cachedIndex) cachedIndex = buildDualWriteAliasIndex();
  return cachedIndex;
}

export function resetDualWriteAliasIndexCache(): void {
  cachedIndex = null;
}

export function flagAllowsAlias(
  flags: { canView: boolean; canExecute: boolean; canManage: boolean },
  axis: "view" | "execute" | "manage"
): boolean {
  if (axis === "manage") return flags.canManage;
  if (axis === "execute") return flags.canExecute || flags.canManage;
  return flags.canView || flags.canExecute || flags.canManage;
}
