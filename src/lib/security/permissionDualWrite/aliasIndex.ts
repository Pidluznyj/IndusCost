/**
 * Índice de aliases 1:1 resource ↔ legado a partir do seed PT (+ regras de eixo).
 */

import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog.js";
import {
  PERMISSION_RESOURCE_SEEDS,
  type PermissionResourceSeed,
} from "@/src/lib/permissionResourceSeedData.js";
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
  /** 1:1 — um legado → um recurso canônico (submenu dedicado). */
  canonicalByLegacy: Map<string, DualWriteAliasBinding>;
  /** Bindings por recurso apenas quando o recurso é canônico do legado. */
  oneToOneByResource: Map<string, DualWriteAliasBinding[]>;
  parentByResource: Map<string, string | null>;
  mappedLegacyKeys: Set<string>;
  catalogKeys: ReadonlySet<string>;
};

let cachedIndex: DualWriteAliasIndex | null = null;

function typeRank(type: PermissionResourceSeed["type"] | undefined): number {
  // Preferir SUBMENU dedicado; evitar MENU âncora e TAB com mega-key herdada.
  if (type === "SUBMENU") return 0;
  if (type === "MENU") return 1;
  if (type === "ACTION") return 2;
  if (type === "TAB") return 3;
  return 9;
}

/**
 * Canônico 1:1: SUBMENU dedicado (poucos aliases) > MENU > TAB.
 * Desempate: menos aliases no seed, depois mais profundo.
 */
export function pickCanonicalAliasBinding(
  bindings: readonly DualWriteAliasBinding[],
  metaByResource: ReadonlyMap<
    string,
    { aliasCount: number; type: PermissionResourceSeed["type"] }
  > = new Map()
): DualWriteAliasBinding {
  return [...bindings].sort((a, b) => {
    const metaA = metaByResource.get(a.resourceKey);
    const metaB = metaByResource.get(b.resourceKey);
    const tr = typeRank(metaA?.type) - typeRank(metaB?.type);
    if (tr !== 0) return tr;
    const countA = metaA?.aliasCount ?? Number.MAX_SAFE_INTEGER;
    const countB = metaB?.aliasCount ?? Number.MAX_SAFE_INTEGER;
    if (countA !== countB) return countA - countB;
    const depthA = a.resourceKey.split(".").length;
    const depthB = b.resourceKey.split(".").length;
    if (depthB !== depthA) return depthB - depthA;
    return a.resourceKey.localeCompare(b.resourceKey);
  })[0]!;
}

export function buildDualWriteAliasIndex(
  seeds = PERMISSION_RESOURCE_SEEDS
): DualWriteAliasIndex {
  const byLegacy = new Map<string, DualWriteAliasBinding[]>();
  const byResource = new Map<string, DualWriteAliasBinding[]>();
  const parentByResource = new Map<string, string | null>();
  const mappedLegacyKeys = new Set<string>();
  const metaByResource = new Map<
    string,
    { aliasCount: number; type: PermissionResourceSeed["type"] }
  >();

  for (const seed of seeds) {
    parentByResource.set(seed.key, seed.parentKey);
    metaByResource.set(seed.key, {
      aliasCount: seed.legacyAliasKeys.length,
      type: seed.type,
    });
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

  const canonicalByLegacy = new Map<string, DualWriteAliasBinding>();
  const oneToOneByResource = new Map<string, DualWriteAliasBinding[]>();
  for (const [legacyKey, bindings] of byLegacy) {
    const canonical = pickCanonicalAliasBinding(bindings, metaByResource);
    canonicalByLegacy.set(legacyKey, canonical);
    const list = oneToOneByResource.get(canonical.resourceKey) ?? [];
    list.push(canonical);
    oneToOneByResource.set(canonical.resourceKey, list);
  }

  return {
    byLegacy,
    byResource,
    canonicalByLegacy,
    oneToOneByResource,
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
