/**
 * Deriva linhas de PermissionResourceSeed a partir do contrato canônico (P08).
 * Não remove recursos; apenas materializa a árvore canônica para merge com o seed PT.
 */

import {
  inferPermissionHierarchyType,
  toLegacyResourceStorageType,
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractResource,
} from "@/src/lib/security/permissionContract/index.js";

export type DerivedPermissionResourceSeed = {
  key: string;
  label: string;
  description: string;
  /** Persistência atual (Prisma): MENU/SUBMENU = aliases oficiais MODULE/PAGE. */
  type: "MENU" | "SUBMENU" | "TAB" | "ACTION";
  parentKey: string | null;
  module: string;
  sortOrder: number;
  isSystem: true;
  legacyAliasKeys: string[];
};

/** Tipo de storage legado a partir da hierarquia oficial (PERM-26). */
function inferType(
  r: PermissionContractResource
): DerivedPermissionResourceSeed["type"] {
  return toLegacyResourceStorageType(inferPermissionHierarchyType(r));
}

function buildDescription(r: PermissionContractResource): string {
  const aliases = [
    ...new Set(r.actions.flatMap((a) => [...a.legacyPermissionKeys])),
  ].sort();
  const parts = [
    "[canonical_from_contract]",
    `sensitivity=${r.sensitivity}`,
  ];
  if (r.notes?.trim()) parts.push(r.notes.trim());
  if (aliases.length) parts.push(`legacyAliases=${aliases.join(",")}`);
  if (r.relationalResourceKeys.length) {
    parts.push(`bridges=${r.relationalResourceKeys.join(",")}`);
  }
  return parts.join(" | ");
}

/** Converte um recurso do contrato em linha de seed (sem side effects). */
export function contractResourceToSeedRow(
  r: PermissionContractResource
): DerivedPermissionResourceSeed {
  const legacyAliasKeys = [
    ...new Set(r.actions.flatMap((a) => [...a.legacyPermissionKeys])),
  ].sort();
  return {
    key: r.resourceKey,
    label: r.label,
    description: buildDescription(r),
    type: inferType(r),
    parentKey: r.parentKey,
    module: r.groupId,
    sortOrder: r.sortOrder,
    isSystem: true,
    legacyAliasKeys,
  };
}

/**
 * Todas as linhas derivadas do contrato, em ordem topológica (pais antes dos filhos).
 */
export function derivePermissionResourceSeedsFromContract(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): DerivedPermissionResourceSeed[] {
  const rows = resources.map(contractResourceToSeedRow);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const depth = (key: string, seen = new Set<string>()): number => {
    if (seen.has(key)) return 0;
    seen.add(key);
    const row = byKey.get(key);
    if (!row?.parentKey) return 0;
    return 1 + depth(row.parentKey, seen);
  };
  return [...rows].sort((a, b) => {
    const d = depth(a.key) - depth(b.key);
    if (d !== 0) return d;
    return a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
  });
}

/**
 * Merge idempotente: legado PT preservado; canônicos do contrato preenchidos se ausentes.
 * Nunca remove chaves do legado.
 */
export function mergeLegacyAndContractSeeds<T extends { key: string }>(
  legacy: readonly T[],
  derived: readonly T[]
): T[] {
  const keys = new Set(legacy.map((r) => r.key));
  const out: T[] = [...legacy];
  for (const row of derived) {
    if (keys.has(row.key)) continue;
    keys.add(row.key);
    out.push(row);
  }
  return out;
}
